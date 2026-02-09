/**
 * ScopeHound v3 — AI-Powered Competitive Intelligence Agent
 * Cloudflare Worker · Free tier · Slack delivery · Web dashboard
 *
 * Monitors: pages (pricing, homepage, features), blogs (RSS + announcement detection),
 * SEO signals, and Product Hunt launches.
 * Delivers prioritized, AI-analyzed alerts to Slack.
 *
 * Config is stored in KV — use /setup to configure, or set via API.
 */

// ─── DEFAULTS ────────────────────────────────────────────────────────────────

const DEFAULT_ANNOUNCEMENT_KEYWORDS = {
  funding: ["funding", "raised", "series a", "series b", "series c", "seed round", "investment"],
  partnership: ["partnership", "partners with", "teaming up", "collaboration", "integrates with", "integration"],
  acquisition: ["acquires", "acquired", "acquisition", "merger", "merged with"],
  events: ["webinar", "conference", "summit", "event", "keynote", "workshop"],
  hiring: ["hiring", "we're growing", "join our team", "open positions", "careers"],
  product: ["launch", "launching", "introduces", "announcing", "new feature", "now available", "release"],
};

// ─── TIER DEFINITIONS ────────────────────────────────────────────────────────

const TIERS = {
  recon:     { name: "Recon",     price: 19.99, competitors: 3,  pages: 6,   scansPerDay: 1, historyDays: 30 },
  operator:  { name: "Operator",  price: 49,  competitors: 15, pages: 60,  scansPerDay: 1, historyDays: 90 },
  commander: { name: "Commander", price: 99,  competitors: 25, pages: 100, scansPerDay: 2, historyDays: 365 },
  strategic: { name: "Strategic", price: 199, competitors: 50, pages: 200, scansPerDay: 4, historyDays: -1 },
};

function getTierLimits(tier) {
  return TIERS[tier] || TIERS.recon;
}

// ─── CONFIG LOADER ───────────────────────────────────────────────────────────

async function loadConfig(env, userId) {
  const prefix = userId ? `user_config:${userId}:` : "config:";
  const [compRaw, settRaw] = await Promise.all([
    env.STATE.get(prefix + "competitors"),
    env.STATE.get(prefix + "settings"),
  ]);
  const competitors = compRaw ? JSON.parse(compRaw) : [];
  const settings = settRaw ? JSON.parse(settRaw) : {};
  return {
    competitors,
    settings: {
      slackWebhookUrl: settings.slackWebhookUrl || env.SLACK_WEBHOOK_URL || null,
      productHuntToken: settings.productHuntToken || env.PRODUCTHUNT_TOKEN || null,
      productHuntTopics: settings.productHuntTopics || [],
      announcementKeywords: settings.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS,
      phMinVotes: settings.phMinVotes ?? 0,
    },
  };
}

// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────

function htmlToText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
}

function normalizeForHash(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/nonce="[^"]*"/gi, "")
    .replace(/data-reactid="[^"]*"/gi, "")
    .replace(/data-turbo-track="[^"]*"/gi, "")
    .replace(/csrf[^"]*"[^"]*"/gi, "")
    .replace(/data-n-head="[^"]*"/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function hashContent(content) {
  const normalized = normalizeForHash(content);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchUrl(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      headers: { "User-Agent": "Scopehound/3.0 (Competitive Intelligence)" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.log(`  Fetch error ${url}: ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.log(`  Fetch error ${url}: ${error.message}`);
    return null;
  }
}

function parseRssFeed(xml) {
  const posts = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1] || "Untitled";
    const link = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i)?.[1] || "";
    const guid = item.match(/<guid[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/i)?.[1] || link || title;
    posts.push({ id: guid, title: title.trim(), link: link.trim() });
    if (posts.length >= 10) break;
  }
  return posts;
}

// ─── SEO EXTRACTION (pure regex, no AI) ──────────────────────────────────────

function extractSeoSignals(html) {
  const get = (regex) => {
    const m = html.match(regex);
    return m ? m[1].trim() : null;
  };
  const getAll = (regex) => {
    const results = [];
    let m;
    const r = new RegExp(regex.source, regex.flags);
    while ((m = r.exec(html)) !== null) results.push(m[1].replace(/<[^>]+>/g, "").trim());
    return results;
  };
  return {
    title: get(/<title[^>]*>([\s\S]*?)<\/title>/i),
    metaDescription:
      get(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) ||
      get(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i),
    ogTitle:
      get(/<meta[^>]*property=["']og:title["'][^>]*content=["']([\s\S]*?)["']/i) ||
      get(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:title["']/i),
    ogDescription:
      get(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i) ||
      get(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:description["']/i),
    h1s: getAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi),
  };
}

function compareSeoSignals(oldSeo, newSeo) {
  if (!oldSeo || !newSeo) return null;
  const changes = [];
  for (const field of ["title", "metaDescription", "ogTitle", "ogDescription"]) {
    if (oldSeo[field] !== newSeo[field] && (oldSeo[field] || newSeo[field])) {
      changes.push({ field, old: oldSeo[field], new: newSeo[field] });
    }
  }
  const oldH1 = (oldSeo.h1s || []).join(", ");
  const newH1 = (newSeo.h1s || []).join(", ");
  if (oldH1 !== newH1) changes.push({ field: "h1", old: oldH1, new: newH1 });
  return changes.length > 0 ? changes : null;
}

// ─── TEXT DIFF ───────────────────────────────────────────────────────────────

function computeTextDiff(oldText, newText) {
  const toSentences = (t) => t.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15);
  const oldSet = new Set(toSentences(oldText));
  const newSet = new Set(toSentences(newText));
  const added = [...newSet].filter((s) => !oldSet.has(s)).slice(0, 10);
  const removed = [...oldSet].filter((s) => !newSet.has(s)).slice(0, 10);
  return {
    added,
    removed,
    beforeExcerpt: removed.slice(0, 3).join(" ").slice(0, 500),
    afterExcerpt: added.slice(0, 3).join(" ").slice(0, 500),
    changeRatio: (added.length + removed.length) / Math.max(oldSet.size, 1),
  };
}

// ─── AI FUNCTIONS ────────────────────────────────────────────────────────────

async function extractPricingWithLLM(html, ai) {
  if (!ai) return null;
  const text = htmlToText(html);
  const prompt = `Extract all pricing information from this webpage text. Return a JSON object with this structure:
{"plans":[{"name":"Plan Name","price":"$X/mo or $X/year or Custom or Free","features":["key feature 1","key feature 2"]}],"notes":"Any important pricing notes like discounts, trials, etc."}
If no pricing is found, return {"plans":[],"notes":"No pricing found"}.
Only return valid JSON, no other text.
Webpage text:
${text}`;
  try {
    const response = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    });
    const content = response.response;
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (error) {
    console.log(`  AI pricing error: ${error.message}`);
    return null;
  }
}

async function analyzePageChange(ai, competitorName, pageLabel, pageType, diff) {
  if (!ai) return null;
  if (diff.changeRatio > 0.8) {
    return {
      summary: "Page significantly redesigned",
      analysis: "The page content changed substantially, likely a full redesign or replatform.",
      priority: pageType === "pricing" ? "high" : "medium",
      recommendation: "Review the page manually to assess the changes.",
    };
  }
  const prompt = `You are a competitive intelligence analyst. A competitor's web page has changed.
Competitor: ${competitorName}
Page: ${pageLabel}
REMOVED content: ${diff.beforeExcerpt || "(none)"}
ADDED content: ${diff.afterExcerpt || "(none)"}
Respond with ONLY valid JSON:
{"summary":"One sentence: what specifically changed","analysis":"2-3 sentences: why this matters competitively","priority":"high or medium or low","recommendation":"One sentence: what action to take"}
Priority guide: high = pricing/product changes, major positioning shifts. medium = feature updates, messaging changes. low = minor copy edits.
Return ONLY the JSON object.`;
  try {
    const response = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    });
    const content = response.response;
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (error) {
    console.log(`  AI analysis error: ${error.message}`);
    return null;
  }
}

async function classifyAnnouncement(ai, competitorName, postTitle, matchedCategory) {
  if (!ai) return { category: matchedCategory, priority: "medium", summary: postTitle };
  const prompt = `Classify this blog post from competitor "${competitorName}".
Title: "${postTitle}"
Detected category: ${matchedCategory}
Respond with ONLY valid JSON:
{"category":"funding or partnership or acquisition or event or hiring or product or other","priority":"high or medium or low","summary":"One sentence explanation"}
Return ONLY the JSON object.`;
  try {
    const response = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    });
    const content = response.response;
    if (!content) return { category: matchedCategory, priority: "medium", summary: postTitle };
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { category: matchedCategory, priority: "medium", summary: postTitle };
  } catch (error) {
    return { category: matchedCategory, priority: "medium", summary: postTitle };
  }
}

// ─── PRICING COMPARISON ─────────────────────────────────────────────────────

function comparePricing(oldPricing, newPricing) {
  if (!oldPricing || !newPricing || !oldPricing.plans || !newPricing.plans) return null;
  const changes = [];
  const oldPlans = new Map(oldPricing.plans.map((p) => [p.name.toLowerCase(), p]));
  const newPlans = new Map(newPricing.plans.map((p) => [p.name.toLowerCase(), p]));
  for (const [name, oldPlan] of oldPlans) {
    const newPlan = newPlans.get(name);
    if (!newPlan) changes.push(`Removed: *${oldPlan.name}* (was ${oldPlan.price})`);
    else if (oldPlan.price !== newPlan.price) changes.push(`*${oldPlan.name}*: ${oldPlan.price} → ${newPlan.price}`);
  }
  for (const [name, newPlan] of newPlans) {
    if (!oldPlans.has(name)) changes.push(`New plan: *${newPlan.name}* at ${newPlan.price}`);
  }
  return changes.length > 0 ? changes : null;
}

// ─── ANNOUNCEMENT DETECTION ─────────────────────────────────────────────────

function detectAnnouncement(title, keywords) {
  const lower = title.toLowerCase();
  for (const [category, kws] of Object.entries(keywords)) {
    for (const kw of kws) {
      if (lower.includes(kw)) return category;
    }
  }
  return null;
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────

async function loadHistory(env, userId) {
  try {
    const key = userId ? "user_state:" + userId + ":history" : "change_history";
    const data = await env.STATE.get(key);
    if (data) return JSON.parse(data);
  } catch (e) {}
  return [];
}

async function saveHistory(env, history, userId, historyDays) {
  const days = historyDays || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const pruned = history.filter((e) => new Date(e.date) > cutoff).slice(-500);
  const key = userId ? "user_state:" + userId + ":history" : "change_history";
  await env.STATE.put(key, JSON.stringify(pruned));
}

// ─── SLACK FORMATTING ────────────────────────────────────────────────────────

const PRIORITY_EMOJI = { high: "🔴", medium: "🟡", low: "🔵" };
const CATEGORY_EMOJI = {
  funding: "💰", partnership: "🤝", acquisition: "🏢",
  events: "📅", hiring: "👥", product: "🚀", other: "📰",
};

function formatPageChangeAlert(compName, page, analysis, diff, pricingChanges) {
  const priority = analysis?.priority || "medium";
  const emoji = PRIORITY_EMOJI[priority] || "🟡";
  const lines = [`${emoji} *${priority.toUpperCase()}* | *${compName}* updated their ${page.label}`];
  if (analysis?.summary) lines.push(`\n*What changed:* ${analysis.summary}`);
  if (analysis?.analysis) lines.push(`*Why it matters:* ${analysis.analysis}`);
  if (analysis?.recommendation) lines.push(`*Action:* ${analysis.recommendation}`);
  if (pricingChanges && pricingChanges.length > 0) {
    lines.push("\n_Pricing details:_");
    for (const c of pricingChanges) lines.push(`  • ${c}`);
  }
  if (diff?.beforeExcerpt) lines.push(`\n_Before:_ ${diff.beforeExcerpt.slice(0, 200)}...`);
  if (diff?.afterExcerpt) lines.push(`_After:_ ${diff.afterExcerpt.slice(0, 200)}...`);
  lines.push(`\n<${page.url}|View page>`);
  return { text: lines.join("\n"), priority };
}

function formatBlogAlert(name, posts) {
  const lines = [`🔵 *LOW* | *${name}* published new blog posts:`];
  for (const p of posts.slice(0, 5)) lines.push(`  • <${p.link}|${p.title}>`);
  return { text: lines.join("\n"), priority: "low" };
}

function formatAnnouncementAlert(name, post, classification) {
  const priority = classification?.priority || "medium";
  const emoji = PRIORITY_EMOJI[priority] || "🟡";
  const catEmoji = CATEGORY_EMOJI[classification?.category] || "📰";
  const lines = [
    `${emoji} *${priority.toUpperCase()}* | *${name}* made an announcement`,
    `${catEmoji} *Category:* ${classification?.category || "unknown"}`,
    `*"${post.title}"*`,
  ];
  if (classification?.summary && classification.summary !== post.title) lines.push(`_${classification.summary}_`);
  lines.push(`<${post.link}|Read post>`);
  return { text: lines.join("\n"), priority };
}

function formatSeoAlert(compName, pageLabel, pageUrl, changes) {
  const lines = [`🔵 *LOW* | *${compName}* changed SEO on ${pageLabel}`];
  const fieldNames = { title: "Title", metaDescription: "Meta Desc", ogTitle: "OG Title", ogDescription: "OG Desc", h1: "H1" };
  for (const c of changes.slice(0, 5)) {
    const fn = fieldNames[c.field] || c.field;
    if (c.old && c.new) lines.push(`  • *${fn}:* "${c.old}" → "${c.new}"`);
    else if (c.new) lines.push(`  • *${fn}:* Added "${c.new}"`);
    else lines.push(`  • *${fn}:* Removed "${c.old}"`);
  }
  lines.push(`<${pageUrl}|View page>`);
  return { text: lines.join("\n"), priority: "low" };
}

function formatProductHuntAlert(topic, posts) {
  const lines = [`🟡 *MEDIUM* | New launches in ${topic}:`];
  for (const p of posts.slice(0, 5)) {
    const votes = p.votesCount > 0 ? ` (${p.votesCount} votes)` : "";
    lines.push(`  • <${p.url}|${p.name}>${votes}`);
    lines.push(`    _${p.tagline}_`);
  }
  return { text: lines.join("\n"), priority: "medium" };
}

function formatDigestHeader(alerts) {
  const h = alerts.filter((a) => a.priority === "high").length;
  const m = alerts.filter((a) => a.priority === "medium").length;
  const l = alerts.filter((a) => a.priority === "low").length;
  const parts = [];
  if (h) parts.push(`${h} high`);
  if (m) parts.push(`${m} medium`);
  if (l) parts.push(`${l} low`);
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `🐕 *ScopeHound Daily Report* — ${date}\n\n${alerts.length} change(s) detected: ${parts.join(", ")}`;
}

// ─── SLACK NOTIFICATION ─────────────────────────────────────────────────────

async function sendSlack(webhookUrl, message) {
  if (!webhookUrl) { console.log(`[SLACK skip] ${message.slice(0, 80)}`); return; }
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!r.ok) console.log(`[SLACK ERROR] ${r.status}`);
  } catch (e) { console.log(`[SLACK ERROR] ${e.message}`); }
}

// ─── PRODUCT HUNT ────────────────────────────────────────────────────────────

async function fetchProductHuntPosts(topic, token) {
  if (!token) return [];
  const query = `{ posts(first: 20, topic: "${topic}") { edges { node { id name tagline url votesCount createdAt website } } } }`;
  try {
    const r = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    if (data.errors) return [];
    return data.data.posts.edges.map((e) => e.node);
  } catch (e) { console.log(`  PH error: ${e.message}`); return []; }
}

// ─── STATE MIGRATION (v1 → v2) ──────────────────────────────────────────────

async function migrateState(env, old, competitors, topics, userId) {
  const state = { _version: 2, competitors: {}, productHunt: {} };
  for (const comp of competitors) {
    const oc = old[comp.name];
    if (!oc) continue;
    state.competitors[comp.name] = {
      pages: {},
      blog: { postIds: oc.blogPostIds || [] },
      seo: {},
      pricing: oc.pricing || null,
    };
    if (oc.pricingHash) {
      const pp = comp.pages.find((p) => p.type === "pricing");
      if (pp) {
        state.competitors[comp.name].pages[pp.id] = {
          hash: oc.pricingHash, textSnapshot: null,
          lastChecked: new Date().toISOString(), lastChanged: null,
        };
      }
    }
  }
  for (const topic of topics) {
    const phKey = `ph_${topic.slug}`;
    if (old[phKey]) state.productHunt[topic.slug] = { postIds: old[phKey].postIds || [] };
  }
  const stateKey = userId ? "user_state:" + userId + ":monitor" : "monitor_state";
  await env.STATE.put(stateKey, JSON.stringify(state));
  console.log("State migrated v1 → v2");
  return state;
}

// ─── MAIN MONITORING LOGIC ──────────────────────────────────────────────────

async function runMonitor(env, configOverride, userId) {
  const config = configOverride || await loadConfig(env, userId);
  const { competitors, settings } = config;

  if (competitors.length === 0) {
    console.log("No competitors configured. Visit /setup to add competitors.");
    return [];
  }

  console.log(`ScopeHound v3 running at ${new Date().toISOString()}`);
  console.log(`Monitoring ${competitors.length} competitors`);
  console.log("=".repeat(50));

  const alerts = [];
  const historyEvents = [];
  const slackUrl = settings.slackWebhookUrl;
  const phToken = settings.productHuntToken;
  const phTopics = settings.productHuntTopics || [];
  const phMinVotes = settings.phMinVotes ?? 0;
  const keywords = settings.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS;

  // Load or migrate state
  const stateKey = userId ? "user_state:" + userId + ":monitor" : "monitor_state";
  let state;
  try {
    const raw = await env.STATE.get(stateKey);
    if (raw) {
      state = JSON.parse(raw);
      if (state._version !== 2) state = await migrateState(env, state, competitors, phTopics, userId);
    }
  } catch (e) { console.log("State load error, starting fresh"); }
  if (!state) state = { _version: 2, competitors: {}, productHunt: {} };

  let history = await loadHistory(env, userId);

  // ── CHECK COMPETITORS ──
  for (const competitor of competitors) {
    console.log(`\n── ${competitor.name} ──`);
    if (!state.competitors[competitor.name]) {
      state.competitors[competitor.name] = { pages: {}, blog: { postIds: [] }, seo: {}, pricing: null };
    }
    const cs = state.competitors[competitor.name];

    for (const page of (competitor.pages || [])) {
      console.log(`  ${page.label}...`);
      const content = await fetchUrl(page.url);
      if (!content) continue;

      const ps = cs.pages[page.id] || { hash: null, textSnapshot: null, lastChecked: null, lastChanged: null };
      const newHash = await hashContent(content);
      const newText = htmlToText(content);
      const isFirstRun = ps.hash === null;

      const newSeo = extractSeoSignals(content);
      const oldSeo = cs.seo[page.id] || null;
      if (!isFirstRun && oldSeo) {
        const seoChanges = compareSeoSignals(oldSeo, newSeo);
        if (seoChanges) {
          console.log(`    SEO changed (${seoChanges.length} field(s))`);
          alerts.push(formatSeoAlert(competitor.name, page.label, page.url, seoChanges));
          historyEvents.push({
            date: new Date().toISOString(), competitor: competitor.name,
            pageId: page.id, pageLabel: page.label, type: "seo_change",
            priority: "low", summary: `SEO changed: ${seoChanges.map((c) => c.field).join(", ")}`,
          });
        }
      }
      cs.seo[page.id] = newSeo;

      if (isFirstRun) {
        console.log(`    Indexing (first run)`);
        if (page.type === "pricing") {
          const pricing = await extractPricingWithLLM(content, env.AI);
          if (pricing) { cs.pricing = pricing; console.log(`    ${pricing.plans?.length || 0} plans extracted`); }
        }
        ps.hash = newHash;
        ps.textSnapshot = newText;
        ps.lastChecked = new Date().toISOString();
      } else if (newHash !== ps.hash) {
        console.log(`    CHANGED`);
        const oldText = ps.textSnapshot || "";
        const diff = computeTextDiff(oldText, newText);
        let analysis = null;
        let pricingChanges = null;

        if (page.type === "pricing") {
          const newPricing = await extractPricingWithLLM(content, env.AI);
          if (newPricing && cs.pricing) pricingChanges = comparePricing(cs.pricing, newPricing);
          if (newPricing) cs.pricing = newPricing;
          analysis = await analyzePageChange(env.AI, competitor.name, page.label, page.type, diff);
          if (!analysis) analysis = { summary: "Pricing page changed", priority: "high", analysis: "", recommendation: "Review pricing page." };
        } else {
          analysis = await analyzePageChange(env.AI, competitor.name, page.label, page.type, diff);
          if (!analysis) analysis = { summary: "Page content changed", priority: "medium", analysis: "", recommendation: "Review the page." };
        }

        alerts.push(formatPageChangeAlert(competitor.name, page, analysis, diff, pricingChanges));
        historyEvents.push({
          date: new Date().toISOString(), competitor: competitor.name,
          pageId: page.id, pageLabel: page.label, type: "page_change",
          priority: analysis.priority, summary: analysis.summary,
          analysis: analysis.analysis, recommendation: analysis.recommendation,
          diff: { before: diff.beforeExcerpt, after: diff.afterExcerpt },
        });
        ps.hash = newHash;
        ps.textSnapshot = newText;
        ps.lastChecked = new Date().toISOString();
        ps.lastChanged = new Date().toISOString();
      } else {
        console.log(`    Unchanged`);
        ps.lastChecked = new Date().toISOString();
      }
      cs.pages[page.id] = ps;
    }

    if (competitor.blogRss) {
      console.log(`  Blog RSS...`);
      const rssContent = await fetchUrl(competitor.blogRss);
      if (rssContent) {
        const posts = parseRssFeed(rssContent);
        const lastSeenIds = cs.blog.postIds || [];
        const isFirstRun = lastSeenIds.length === 0;
        if (isFirstRun) {
          console.log(`    Indexed ${posts.length} posts (first run)`);
        } else {
          const newPosts = posts.filter((p) => !lastSeenIds.includes(p.id));
          if (newPosts.length > 0) {
            console.log(`    ${newPosts.length} new post(s)`);
            const regularPosts = [];
            for (const post of newPosts) {
              const cat = detectAnnouncement(post.title, keywords);
              if (cat) {
                console.log(`    Announcement: ${cat} — "${post.title}"`);
                const cl = await classifyAnnouncement(env.AI, competitor.name, post.title, cat);
                alerts.push(formatAnnouncementAlert(competitor.name, post, cl));
                historyEvents.push({
                  date: new Date().toISOString(), competitor: competitor.name,
                  type: "announcement", priority: cl.priority,
                  summary: cl.summary || post.title, category: cl.category, url: post.link,
                });
              } else {
                regularPosts.push(post);
              }
            }
            if (regularPosts.length > 0) {
              alerts.push(formatBlogAlert(competitor.name, regularPosts));
              for (const p of regularPosts) {
                historyEvents.push({
                  date: new Date().toISOString(), competitor: competitor.name,
                  type: "blog_post", priority: "low", summary: p.title, url: p.link,
                });
              }
            }
          } else {
            console.log(`    No new posts`);
          }
        }
        cs.blog.postIds = posts.map((p) => p.id);
      }
    }
  }

  // ── PRODUCT HUNT ──
  if (phTopics.length > 0) {
    console.log(`\n── Product Hunt ──`);
    for (const topic of phTopics) {
      console.log(`  ${topic.name}...`);
      const phState = state.productHunt[topic.slug] || { postIds: [] };
      const lastSeenIds = phState.postIds || [];
      const isFirstRun = lastSeenIds.length === 0;
      const posts = await fetchProductHuntPosts(topic.slug, phToken);
      const filtered = posts.filter((p) => p.votesCount >= phMinVotes);
      if (isFirstRun) {
        console.log(`    Indexed ${filtered.length} posts (first run)`);
      } else {
        const newPosts = filtered.filter((p) => !lastSeenIds.includes(p.id));
        if (newPosts.length > 0) {
          console.log(`    ${newPosts.length} new launch(es)`);
          alerts.push(formatProductHuntAlert(topic.name, newPosts));
          for (const p of newPosts) {
            historyEvents.push({
              date: new Date().toISOString(), type: "producthunt", priority: "medium",
              summary: `${p.name}: ${p.tagline}`, topic: topic.name, url: p.url, votes: p.votesCount,
            });
          }
        } else {
          console.log(`    No new launches`);
        }
      }
      state.productHunt[topic.slug] = { postIds: filtered.map((p) => p.id) };
    }
  }

  // ── PERSIST ──
  await env.STATE.put(stateKey, JSON.stringify(state));
  // Determine history retention days for this user's tier
  let historyDays = 90;
  if (userId) {
    try {
      const uRaw = await env.STATE.get("user:" + userId);
      if (uRaw) { const u = JSON.parse(uRaw); const td = TIERS[u.tier]; if (td && td.historyDays > 0) historyDays = td.historyDays; else if (td && td.historyDays === -1) historyDays = 99999; }
    } catch {}
  }
  if (historyEvents.length > 0) {
    history = history.concat(historyEvents);
    await saveHistory(env, history, userId, historyDays);
  }
  await buildDashboardCache(env, state, history, competitors, userId);
  console.log("\nState saved");

  // ── SEND ALERTS ──
  if (alerts.length > 0) {
    console.log(`\nSending ${alerts.length} alert(s) to Slack...`);
    await sendSlack(slackUrl, formatDigestHeader(alerts));
    for (const a of alerts.filter((a) => a.priority === "high")) await sendSlack(slackUrl, a.text);
    for (const a of alerts.filter((a) => a.priority === "medium")) await sendSlack(slackUrl, a.text);
    const low = alerts.filter((a) => a.priority === "low");
    if (low.length > 0) await sendSlack(slackUrl, low.map((a) => a.text).join("\n\n---\n\n"));
  } else {
    console.log("\nNo changes detected.");
  }

  console.log("Done!");
  return alerts;
}

// ─── DASHBOARD CACHE ─────────────────────────────────────────────────────────

async function buildDashboardCache(env, state, history, competitors, userId) {
  const cache = {
    generatedAt: new Date().toISOString(),
    competitors: competitors.map((comp) => {
      const cs = state.competitors[comp.name] || {};
      return {
        name: comp.name, website: comp.website,
        pricing: cs.pricing || null,
        seo: cs.seo || {},
        pages: (comp.pages || []).map((p) => ({
          id: p.id, label: p.label, type: p.type, url: p.url,
          lastChecked: cs.pages?.[p.id]?.lastChecked || null,
          lastChanged: cs.pages?.[p.id]?.lastChanged || null,
        })),
        blogRss: comp.blogRss,
      };
    }),
    recentChanges: (history || []).slice(-50).reverse(),
  };
  const cacheKey = userId ? "user_state:" + userId + ":dashboard" : "dashboard_cache";
  await env.STATE.put(cacheKey, JSON.stringify(cache));
}

// ─── RSS AUTO-DETECTION ─────────────────────────────────────────────────────

async function detectRssFeed(websiteUrl) {
  const base = websiteUrl.replace(/\/+$/, "");
  const paths = ["/feed/", "/blog/feed/", "/rss.xml", "/blog/rss.xml", "/feed.xml", "/atom.xml"];
  for (const path of paths) {
    try {
      const r = await fetch(base + path, {
        headers: { "User-Agent": "Scopehound/3.0" },
        redirect: "follow",
      });
      if (r.ok) {
        const ct = r.headers.get("content-type") || "";
        const text = await r.text();
        if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom") || text.includes("<rss") || text.includes("<feed") || text.includes("<item>")) {
          return base + path;
        }
      }
    } catch (e) {}
  }
  try {
    const html = await fetchUrl(base);
    if (html) {
      const m = html.match(/<link[^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i);
      if (m) {
        const href = m[2];
        return href.startsWith("http") ? href : base + href;
      }
    }
  } catch (e) {}
  return null;
}

async function discoverPages(websiteUrl) {
  const base = websiteUrl.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const pages = [{ url: base, type: "general", label: "Homepage" }];
  const seen = new Set([base, base + "/"]);
  try {
    const html = await fetchUrl(base);
    if (!html) return pages;
    // Extract RSS from <link> tags
    const rssMatch = html.match(/<link[^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i);
    let rssUrl = null;
    if (rssMatch) {
      rssUrl = rssMatch[2].startsWith("http") ? rssMatch[2] : origin + rssMatch[2];
    }
    // Extract all <a href="..."> links
    const linkRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
    let match;
    const links = [];
    while ((match = linkRegex.exec(html)) !== null) {
      let href = match[1];
      if (href.startsWith("/")) href = origin + href;
      if (!href.startsWith("http")) continue;
      try { if (new URL(href).origin !== origin) continue; } catch { continue; }
      const path = new URL(href).pathname.toLowerCase();
      links.push({ href: href.split("?")[0].split("#")[0], path });
    }
    // Match against known patterns
    const patterns = [
      { match: ["/pricing", "/plans", "/plan", "/price"], type: "pricing", label: "Pricing" },
      { match: ["/blog", "/news", "/updates", "/changelog", "/articles"], type: "blog", label: "Blog" },
      { match: ["/careers", "/jobs", "/hiring", "/join"], type: "careers", label: "Careers" },
      { match: ["/features", "/product"], type: "general", label: "Features" },
    ];
    for (const p of patterns) {
      for (const link of links) {
        if (p.match.some(m => link.path === m || link.path === m + "/")) {
          if (!seen.has(link.href)) {
            const entry = { url: link.href, type: p.type, label: p.label };
            if (p.type === "blog" && rssUrl) entry.rss = rssUrl;
            pages.push(entry);
            seen.add(link.href);
          }
          break;
        }
      }
    }
    // If no blog found but RSS detected, try to detect blog via RSS
    if (!pages.find(p => p.type === "blog") && !rssUrl) {
      rssUrl = await detectRssFeed(base);
    }
    if (!pages.find(p => p.type === "blog") && rssUrl) {
      pages.push({ url: base + "/blog", type: "blog", label: "Blog", rss: rssUrl });
    }
    // If no pricing found, check common paths directly
    if (!pages.find(p => p.type === "pricing")) {
      for (const tryPath of ["/pricing", "/plans"]) {
        try {
          const r = await fetch(origin + tryPath, { method: "HEAD", headers: { "User-Agent": "Scopehound/3.0" }, redirect: "follow" });
          if (r.ok) { pages.push({ url: origin + tryPath, type: "pricing", label: "Pricing" }); break; }
        } catch {}
      }
    }
  } catch (e) {
    console.log("discoverPages error: " + e.message);
  }
  return pages;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

function requireAuth(request, env) {
  const token = request.headers.get("X-Admin-Token") || new URL(request.url).searchParams.get("token");
  if (!env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "ADMIN_TOKEN secret not set. Add it in Cloudflare dashboard → Settings → Variables." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized. Provide X-Admin-Token header or ?token= param." }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// ─── MODE DETECTION ─────────────────────────────────────────────────────────

function isHostedMode(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.STRIPE_SECRET_KEY && env.JWT_SECRET);
}

async function resolveAuth(request, env) {
  if (isHostedMode(env)) {
    const user = await getSessionUser(request, env);
    if (!user) {
      return { user: null, response: new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      })};
    }
    return { user, response: null };
  }
  const authErr = requireAuth(request, env);
  if (authErr) return { user: null, response: authErr };
  return { user: { id: "admin", tier: "strategic", email: "admin" }, response: null };
}

// ─── JWT SESSION MANAGEMENT ─────────────────────────────────────────────────

function base64urlEncode(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateJWT(payload, secret) {
  const encoder = new TextEncoder();
  const header = base64urlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(header + "." + body));
  return header + "." + body + "." + base64urlEncode(sig);
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64urlDecode(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function createSession(env, userId) {
  const payload = { sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 86400 };
  return await generateJWT(payload, env.JWT_SECRET);
}

async function getSessionUser(request, env) {
  if (!env.JWT_SECRET) return null;
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/sh_session=([^;]+)/);
  if (!match) return null;
  const payload = await verifyJWT(match[1], env.JWT_SECRET);
  if (!payload || !payload.sub) return null;
  try {
    const raw = await env.STATE.get("user:" + payload.sub);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setSessionCookie(headers, token) {
  headers.append("Set-Cookie", `sh_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
}

function clearSessionCookie(headers) {
  headers.append("Set-Cookie", "sh_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}

// ─── OAUTH PROVIDERS ────────────────────────────────────────────────────────

function getGoogleAuthUrl(env, origin, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: origin + "/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state: state,
    prompt: "select_account",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

async function exchangeGoogleCode(code, redirectUri, env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!r.ok) return null;
  return await r.json();
}

async function getGoogleUserInfo(accessToken) {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!r.ok) return null;
  return await r.json();
}

async function findOrCreateUser(env, provider, profile, refCode) {
  // Check if user exists by email
  const existingId = await env.STATE.get("user_email:" + profile.email);
  if (existingId) {
    const raw = await env.STATE.get("user:" + existingId);
    if (raw) return JSON.parse(raw);
  }
  // Create new user
  const id = crypto.randomUUID();
  const user = {
    id,
    email: profile.email,
    name: profile.name || profile.email.split("@")[0],
    picture: profile.picture || null,
    provider,
    providerId: profile.id,
    tier: "recon",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    referredBy: refCode || null,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    env.STATE.put("user:" + id, JSON.stringify(user)),
    env.STATE.put("user_email:" + profile.email, id),
  ]);
  // Record affiliate signup if referred
  if (refCode) {
    await recordAffiliateSignup(env, refCode, user);
  }
  return user;
}

// ─── STRIPE INTEGRATION ─────────────────────────────────────────────────────

async function stripeAPI(path, method, body, env) {
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return await r.json();
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  try {
    const parts = {};
    for (const item of sigHeader.split(",")) {
      const [key, value] = item.split("=");
      parts[key.trim()] = value.trim();
    }
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return null;
    if (Math.floor(Date.now() / 1000) - parseInt(timestamp) > 300) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + rawBody));
    const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (expected.length !== signature.length) return null;
    let result = 0;
    for (let i = 0; i < expected.length; i++) result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    if (result !== 0) return null;
    return JSON.parse(rawBody);
  } catch (e) {
    return null;
  }
}

async function createCheckoutSession(env, user, tier, origin) {
  const tierDef = TIERS[tier];
  if (!tierDef) return null;
  const priceIds = env.STRIPE_PRICE_IDS ? JSON.parse(env.STRIPE_PRICE_IDS) : {};
  const priceId = priceIds[tier];
  if (!priceId) return null;
  const params = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: origin + "/billing?success=1",
    cancel_url: origin + "/billing",
    "metadata[user_id]": user.id,
    "metadata[tier]": tier,
    "subscription_data[metadata][user_id]": user.id,
    "subscription_data[metadata][tier]": tier,
  };
  if (user.stripeCustomerId) {
    params.customer = user.stripeCustomerId;
  } else {
    params.customer_email = user.email;
  }
  if (user.referredBy) {
    params["subscription_data[metadata][affiliate_code]"] = user.referredBy;
  }
  return await stripeAPI("/checkout/sessions", "POST", params, env);
}

async function addActiveSubscriber(env, userId) {
  const raw = await env.STATE.get("active_subscribers");
  const list = raw ? JSON.parse(raw) : [];
  if (!list.includes(userId)) {
    list.push(userId);
    await env.STATE.put("active_subscribers", JSON.stringify(list));
  }
}

async function removeActiveSubscriber(env, userId) {
  const raw = await env.STATE.get("active_subscribers");
  if (!raw) return;
  const list = JSON.parse(raw).filter(id => id !== userId);
  await env.STATE.put("active_subscribers", JSON.stringify(list));
}

async function handleStripeWebhook(event, env) {
  // Idempotency check
  const eventKey = "processed_events:" + event.id;
  const already = await env.STATE.get(eventKey);
  if (already) return { status: "duplicate" };

  let processed = false;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const tier = session.metadata?.tier;
      if (!userId || !tier) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      user.tier = tier;
      user.stripeCustomerId = session.customer;
      user.stripeSubscriptionId = session.subscription;
      user.subscriptionStatus = "active";
      await Promise.all([
        env.STATE.put("user:" + userId, JSON.stringify(user)),
        env.STATE.put("sub:" + session.subscription, userId),
        env.STATE.put("stripe_customer:" + session.customer, userId),
        addActiveSubscriber(env, userId),
      ]);
      // Record affiliate commission on first payment
      const affCode = session.metadata?.affiliate_code || user.referredBy;
      if (affCode) {
        await recordAffiliateCommission(env, affCode, userId, TIERS[tier].price * 100, tier);
      }
      processed = true;
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const userId = await env.STATE.get("sub:" + sub.id);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      const newTier = sub.metadata?.tier || user.tier;
      user.tier = newTier;
      user.subscriptionStatus = sub.status;
      await env.STATE.put("user:" + userId, JSON.stringify(user));
      if (sub.status === "active") await addActiveSubscriber(env, userId);
      else await removeActiveSubscriber(env, userId);
      processed = true;
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId = await env.STATE.get("sub:" + sub.id);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      user.tier = "recon";
      user.subscriptionStatus = "canceled";
      user.stripeSubscriptionId = null;
      await env.STATE.put("user:" + userId, JSON.stringify(user));
      await removeActiveSubscriber(env, userId);
      processed = true;
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      if (!subId) break;
      const userId = await env.STATE.get("sub:" + subId);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      if (user.referredBy) {
        await recordAffiliateCommission(env, user.referredBy, userId, invoice.amount_paid, user.tier);
      }
      processed = true;
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      if (!subId) break;
      const userId = await env.STATE.get("sub:" + subId);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      user.subscriptionStatus = "past_due";
      await env.STATE.put("user:" + userId, JSON.stringify(user));
      processed = true;
      break;
    }
  }

  // Only mark as processed if we actually did something
  if (processed) {
    await env.STATE.put(eventKey, "1", { expirationTtl: 86400 });
  }
  return { status: processed ? "processed" : "skipped", type: event.type };
}

// ─── TIER ENFORCEMENT ───────────────────────────────────────────────────────

function enforceTierLimits(user, competitors) {
  const limits = getTierLimits(user?.tier || "recon");
  if (competitors.length > limits.competitors) {
    return { error: `Your ${limits.name} plan allows ${limits.competitors} competitors. Upgrade at /billing.` };
  }
  const totalPages = competitors.reduce((n, c) => n + (c.pages?.length || 0), 0);
  if (totalPages > limits.pages) {
    return { error: `Your ${limits.name} plan allows ${limits.pages} pages. Upgrade at /billing.` };
  }
  return null;
}

// ─── AFFILIATE TRACKING ─────────────────────────────────────────────────────

function generateAffiliateCode() {
  return crypto.randomUUID().slice(0, 8);
}

function maskEmail(email) {
  if (!email) return "***";
  const [local, domain] = email.split("@");
  return local[0] + "***@" + domain;
}

async function recordAffiliateSignup(env, code, user) {
  try {
    const raw = await env.STATE.get("affiliate:" + code);
    if (!raw) return;
    const affiliate = JSON.parse(raw);
    if (affiliate.status !== "approved" && affiliate.status !== "active") return;
    affiliate.referralCount = (affiliate.referralCount || 0) + 1;
    affiliate.status = "active";
    await env.STATE.put("affiliate:" + code, JSON.stringify(affiliate));
    // Add to referrals list
    const refsRaw = await env.STATE.get("affiliate:" + code + ":referrals");
    const refs = refsRaw ? JSON.parse(refsRaw) : [];
    refs.push({
      userId: user.id,
      email: maskEmail(user.email),
      signedUpAt: new Date().toISOString(),
      tier: user.tier,
      monthlyCommission: 0,
      totalPaid: 0,
      monthsRemaining: 24,
      status: "active",
    });
    await env.STATE.put("affiliate:" + code + ":referrals", JSON.stringify(refs));
  } catch (e) {
    console.log("Affiliate signup error: " + e.message);
  }
}

async function recordAffiliateCommission(env, code, userId, amountCents, tier) {
  try {
    const raw = await env.STATE.get("affiliate:" + code);
    if (!raw) return;
    const affiliate = JSON.parse(raw);
    const commission = Math.round(amountCents * (affiliate.commissionRate || 0.5));
    affiliate.totalEarnings = (affiliate.totalEarnings || 0) + commission;
    affiliate.pendingEarnings = (affiliate.pendingEarnings || 0) + commission;
    await env.STATE.put("affiliate:" + code, JSON.stringify(affiliate));
    // Update referral entry
    const refsRaw = await env.STATE.get("affiliate:" + code + ":referrals");
    if (refsRaw) {
      const refs = JSON.parse(refsRaw);
      const ref = refs.find((r) => r.userId === userId);
      if (ref) {
        ref.monthlyCommission = commission;
        ref.totalPaid = (ref.totalPaid || 0) + commission;
        ref.monthsRemaining = Math.max(0, (ref.monthsRemaining || 24) - 1);
        ref.tier = tier;
        if (ref.monthsRemaining <= 0) ref.status = "completed";
      }
      await env.STATE.put("affiliate:" + code + ":referrals", JSON.stringify(refs));
    }
  } catch (e) {
    console.log("Affiliate commission error: " + e.message);
  }
}

// ─── DASHBOARD HTML ──────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Competitive Intelligence</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.5}
a{color:#7a8c52;text-decoration:none}
a:hover{text-decoration:underline}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.subtitle{color:#6b7280;font-size:13px}
nav{display:flex;gap:4px;background:#12161a;padding:8px 24px;border-bottom:1px solid #2a3038}
nav button{background:none;border:1px solid transparent;color:#6b7280;padding:8px 16px;border-radius:2px;cursor:pointer;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600}
nav button:hover{color:#d4d8de}
nav button.active{background:#1a1f25;color:#d4d8de;border-color:#2a3038}
main{max-width:1200px;margin:0 auto;padding:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px}
.card h3{font-size:15px;margin-bottom:4px;font-weight:700}
.card .url{color:#6b7280;font-size:12px;margin-bottom:12px}
.card .pages{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.pill{font-size:11px;padding:3px 8px;border-radius:2px;background:#1a1f25;border:1px solid #2a3038;text-transform:uppercase;letter-spacing:0.03em}
.pill.changed{border-color:#c4a747;color:#c4a747}
.pill.stable{border-color:#3d6b35;color:#3d6b35}
.pill.new{border-color:#6b7280;color:#6b7280}
.feed{display:flex;flex-direction:column;gap:12px}
.event{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px}
.event-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.05em}
.badge.high{background:#c2303022;color:#c23030;border:1px solid #c2303066}
.badge.medium{background:#c4a74722;color:#c4a747;border:1px solid #c4a74766}
.badge.low{background:#3d6b3522;color:#3d6b35;border:1px solid #3d6b3566}
.event .meta{color:#6b7280;font-size:12px}
.event .summary{margin:6px 0}
.event .detail{color:#6b7280;font-size:13px;margin-top:4px}
.event .diff{font-size:12px;margin-top:8px;padding:8px;background:#0a0c0e;border-radius:2px;border:1px solid #2a3038}
.diff .removed{color:#c23030}
.diff .added{color:#3d6b35}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1a1f25;font-size:13px}
th{color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em}
.pricing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.pricing-card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px}
.pricing-card h3{margin-bottom:12px}
.plan{padding:8px 0;border-bottom:1px solid #1a1f25}
.plan:last-child{border-bottom:none}
.plan-name{font-weight:700;font-size:14px}
.plan-price{color:#5c6b3c;font-size:13px}
.plan-features{color:#6b7280;font-size:12px;margin-top:4px}
.empty{text-align:center;padding:48px;color:#6b7280}
.loading{text-align:center;padding:48px;color:#6b7280}
.setup-banner{background:#1a1f25;border:1px solid #c4a747;padding:12px 24px;text-align:center;color:#c4a747;font-size:14px}
.setup-banner a{color:#c4a747;text-decoration:underline}
</style>
</head>
<body>
<header>
<div><h1>Scope<span>Hound</span></h1></div>
<div class="subtitle" id="lastUpdated">Loading...</div>
</header>
<nav>
<button class="active" data-tab="overview">Overview</button>
<button data-tab="changes">Recent Changes</button>
<button data-tab="pricing">Pricing</button>
<button data-tab="seo">SEO Signals</button>
</nav>
<main>
<div id="content"><div class="loading">Loading dashboard data...</div></div>
</main>
<script>
let DATA=null;
const $=id=>document.getElementById(id);
const content=$("content");
function timeAgo(d){if(!d)return"never";const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";const days=Math.floor(s/86400);return days===1?"yesterday":days+"d ago";}
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function pageStatus(p){if(!p.lastChecked)return"new";if(!p.lastChanged)return"stable";const d=(Date.now()-new Date(p.lastChanged))/86400000;return d<7?"changed":"stable";}
function renderOverview(){if(!DATA.competitors||DATA.competitors.length===0){content.innerHTML='<div class="empty">No competitors configured. <a href="./setup">Run setup</a> to get started.</div>';return;}let h='<div class="grid">';for(const c of DATA.competitors){h+='<div class="card"><h3><a href="'+esc(c.website)+'" target="_blank">'+esc(c.name)+'</a></h3><div class="url">'+esc(c.website)+'</div><div class="pages">';for(const p of c.pages){const s=pageStatus(p);h+='<span class="pill '+s+'">'+esc(p.label)+' · '+timeAgo(p.lastChanged)+'</span>';}if(c.blogRss)h+='<span class="pill stable">Blog RSS</span>';h+='</div>';if(c.pricing&&c.pricing.plans&&c.pricing.plans.length>0){h+='<div style="font-size:12px;color:#6b7280">Plans: '+c.pricing.plans.map(p=>esc(p.name)+' ('+esc(p.price)+')').join(' · ')+'</div>';}h+='</div>';}h+='</div>';content.innerHTML=h;}
function renderChanges(){if(!DATA.recentChanges||DATA.recentChanges.length===0){content.innerHTML='<div class="empty">No changes recorded yet. Run a scan to start tracking.</div>';return;}let h='<div class="feed">';for(const e of DATA.recentChanges){h+='<div class="event"><div class="event-header"><span class="badge '+(e.priority||"low")+'">'+(e.priority||"low")+'</span>';if(e.competitor)h+='<strong>'+esc(e.competitor)+'</strong>';if(e.pageLabel)h+=' · '+esc(e.pageLabel);h+='<span class="meta">'+timeAgo(e.date)+'</span></div><div class="summary">'+esc(e.summary)+'</div>';if(e.analysis)h+='<div class="detail">'+esc(e.analysis)+'</div>';if(e.recommendation)h+='<div class="detail"><strong>Action:</strong> '+esc(e.recommendation)+'</div>';if(e.diff&&(e.diff.before||e.diff.after)){h+='<div class="diff">';if(e.diff.before)h+='<div class="removed">- '+esc(e.diff.before.slice(0,200))+'</div>';if(e.diff.after)h+='<div class="added">+ '+esc(e.diff.after.slice(0,200))+'</div>';h+='</div>';}if(e.url)h+='<div style="margin-top:6px"><a href="'+esc(e.url)+'" target="_blank">View</a></div>';h+='</div>';}h+='</div>';content.innerHTML=h;}
function renderPricing(){let h='<div class="pricing-grid">';let any=false;for(const c of DATA.competitors){if(!c.pricing||!c.pricing.plans||c.pricing.plans.length===0)continue;any=true;h+='<div class="pricing-card"><h3>'+esc(c.name)+'</h3>';for(const p of c.pricing.plans){h+='<div class="plan"><div class="plan-name">'+esc(p.name)+'</div><div class="plan-price">'+esc(p.price)+'</div>';if(p.features&&p.features.length)h+='<div class="plan-features">'+p.features.map(f=>esc(f)).join(' · ')+'</div>';h+='</div>';}if(c.pricing.notes&&c.pricing.notes!=="No pricing found")h+='<div style="font-size:12px;color:#6b7280;margin-top:8px">'+esc(c.pricing.notes)+'</div>';h+='</div>';}if(!any)h+='<div class="empty">No pricing data yet. Run a scan to extract pricing.</div>';h+='</div>';content.innerHTML=h;}
function renderSeo(){let h='<table><thead><tr><th>Competitor</th><th>Page</th><th>Title</th><th>Meta Description</th><th>H1</th></tr></thead><tbody>';let any=false;for(const c of DATA.competitors){if(!c.seo||Object.keys(c.seo).length===0)continue;for(const p of c.pages){const s=c.seo[p.id];if(!s)continue;any=true;h+='<tr><td>'+esc(c.name)+'</td><td>'+esc(p.label)+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.title||"—")+'</td><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.metaDescription||"—")+'</td><td>'+esc((s.h1s||[]).join(", ")||"—")+'</td></tr>';}}if(!any)h+='<tr><td colspan="5" class="empty">No SEO data yet.</td></tr>';h+='</tbody></table>';content.innerHTML=h;}
const tabs={overview:renderOverview,changes:renderChanges,pricing:renderPricing,seo:renderSeo};
document.querySelectorAll("nav button").forEach(btn=>{btn.addEventListener("click",()=>{document.querySelectorAll("nav button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");if(DATA)tabs[btn.dataset.tab]();});});
fetch("./api/dashboard-data").then(r=>r.json()).then(d=>{DATA=d;$("lastUpdated").textContent="Last scan: "+timeAgo(d.generatedAt);renderOverview();}).catch(()=>{content.innerHTML='<div class="empty">Failed to load data. <a href="./setup">Run setup</a> or hit /test first.</div>';});
</script>
</body>
</html>`;

// ─── SETUP WIZARD HTML ──────────────────────────────────────────────────────

const SETUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Setup</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52}
.wrap{max-width:640px;margin:0 auto;padding:32px 20px}
h1{font-size:24px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
h2{font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:16px;color:#d4d8de}
.subtitle{color:#6b7280;font-size:14px;margin-bottom:32px}
.steps{display:flex;gap:8px;margin-bottom:32px}
.step-dot{width:32px;height:4px;background:#2a3038;border-radius:2px}
.step-dot.active{background:#5c6b3c}
.step-dot.done{background:#3d6b35}
.panel{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:24px;margin-bottom:16px}
label{display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:6px}
input[type=text],input[type=url],input[type=password]{width:100%;background:#0a0c0e;border:1px solid #2a3038;color:#d4d8de;padding:10px 12px;font-size:14px;border-radius:2px;outline:none}
input:focus{border-color:#5c6b3c}
.field{margin-bottom:16px}
.btn{display:inline-block;padding:10px 20px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;border:none;border-radius:2px}
.btn-primary{background:#5c6b3c;color:#d4d8de}
.btn-primary:hover{background:#7a8c52}
.btn-secondary{background:transparent;border:1px solid #2a3038;color:#6b7280}
.btn-secondary:hover{border-color:#5c6b3c;color:#d4d8de}
.btn-danger{background:#c23030;color:#fff}
.btn-sm{padding:6px 12px;font-size:11px}
.actions{display:flex;justify-content:space-between;margin-top:24px}
.competitor-card{background:#0a0c0e;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:12px}
.competitor-card .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.competitor-card .card-header strong{font-size:14px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-top:8px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
.msg-err{background:#c2303022;border:1px solid #c23030;color:#c23030}
.msg-info{background:#c4a74722;border:1px solid #c4a747;color:#c4a747}
.hidden{display:none}
.summary-item{padding:8px 0;border-bottom:1px solid #2a3038;font-size:14px}
.summary-item:last-child{border-bottom:none}
.summary-label{color:#6b7280;font-size:12px;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrap">
<h1>Scope<span>Hound</span></h1>
<p class="subtitle">Configure your competitive intelligence agent</p>
<div class="steps"><div class="step-dot active" id="dot0"></div><div class="step-dot" id="dot1"></div><div class="step-dot" id="dot2"></div><div class="step-dot" id="dot3"></div></div>

<!-- STEP 0: Auth + Slack -->
<div id="step0">
<h2>Step 1: Connect</h2>
<div class="panel">
<div class="field"><label>Admin Token</label><input type="password" id="adminToken" placeholder="The ADMIN_TOKEN you set as a Cloudflare secret"><p style="font-size:12px;color:#6b7280;margin-top:4px">Set this in Cloudflare Dashboard → Worker → Settings → Variables → Secrets</p></div>
<div class="field"><label>Slack Webhook URL</label><input type="url" id="slackUrl" placeholder="https://hooks.slack.com/services/..."><p style="font-size:12px;color:#6b7280;margin-top:4px">Create one at <a href="https://api.slack.com/messaging/webhooks" target="_blank">api.slack.com/messaging/webhooks</a></p></div>
<button class="btn btn-secondary btn-sm" onclick="testSlack()">Test Connection</button>
<div id="slackMsg"></div>
</div>
<div class="actions"><div></div><button class="btn btn-primary" onclick="goStep(1)">Next</button></div>
</div>

<!-- STEP 1: Competitors -->
<div id="step1" class="hidden">
<h2>Step 2: Competitors</h2>
<div id="compList"></div>
<button class="btn btn-secondary btn-sm" onclick="addComp()" style="margin-bottom:16px">+ Add Competitor</button>
<div class="actions"><button class="btn btn-secondary" onclick="goStep(0)">Back</button><button class="btn btn-primary" onclick="goStep(2)">Next</button></div>
</div>

<!-- STEP 2: Product Hunt -->
<div id="step2" class="hidden">
<h2>Step 3: Product Hunt (Optional)</h2>
<div class="panel">
<div class="field"><label>Product Hunt API Token</label><input type="text" id="phToken" placeholder="Optional — get from api.producthunt.com/v2/oauth/applications"></div>
<div class="field"><label>Topics to Monitor (comma-separated slugs)</label><input type="text" id="phTopics" placeholder="e.g. affiliate-marketing, influencer-marketing"></div>
</div>
<div class="actions"><button class="btn btn-secondary" onclick="goStep(1)">Back</button><button class="btn btn-primary" onclick="goStep(3)">Next</button></div>
</div>

<!-- STEP 3: Review + Launch -->
<div id="step3" class="hidden">
<h2>Step 4: Review + Launch</h2>
<div class="panel" id="summaryPanel"></div>
<div id="launchMsg"></div>
<div class="actions"><button class="btn btn-secondary" onclick="goStep(2)">Back</button><button class="btn btn-primary" id="launchBtn" onclick="launch()">Save & Run First Scan</button></div>
</div>
</div>

<script>
let step=0;
const comps=[];
let existingConfig=null;
const base=location.origin;

function $(id){return document.getElementById(id)}
function goStep(n){
  $("step"+step).classList.add("hidden");
  step=n;
  $("step"+step).classList.remove("hidden");
  for(let i=0;i<4;i++){
    const d=$("dot"+i);
    d.classList.remove("active","done");
    if(i<n)d.classList.add("done");
    else if(i===n)d.classList.add("active");
  }
  if(n===3)renderSummary();
}

function addComp(data){
  const idx=comps.length;
  const c=data||{name:"",website:"",pricingUrl:"",blogRss:""};
  comps.push(c);
  renderComps();
}

function removeComp(i){comps.splice(i,1);renderComps();}

function renderComps(){
  let h="";
  for(let i=0;i<comps.length;i++){
    const c=comps[i];
    h+='<div class="competitor-card"><div class="card-header"><strong>Competitor '+(i+1)+'</strong><button class="btn btn-danger btn-sm" onclick="removeComp('+i+')">Remove</button></div>';
    h+='<div class="row"><div class="field"><label>Name</label><input type="text" value="'+esc(c.name)+'" onchange="comps['+i+'].name=this.value"></div><div class="field"><label>Website</label><input type="url" value="'+esc(c.website)+'" onchange="comps['+i+'].website=this.value;autoFill('+i+',this.value)" placeholder="https://example.com"></div></div>';
    h+='<div class="row"><div class="field"><label>Pricing URL</label><input type="url" id="pricing'+i+'" value="'+esc(c.pricingUrl)+'" onchange="comps['+i+'].pricingUrl=this.value"></div><div class="field"><label>Blog RSS</label><div style="display:flex;gap:6px"><input type="url" id="rss'+i+'" value="'+esc(c.blogRss)+'" onchange="comps['+i+'].blogRss=this.value" style="flex:1" placeholder="Optional"><button class="btn btn-secondary btn-sm" onclick="detectRss('+i+')">Detect</button></div></div></div></div>';
  }
  $("compList").innerHTML=h;
}

function esc(s){return(s||"").replace(/"/g,"&quot;").replace(/</g,"&lt;")}

function autoFill(i,url){
  if(!url)return;
  const u=url.replace(/\\/+$/,"");
  if(!comps[i].pricingUrl){comps[i].pricingUrl=u+"/pricing";const el=$("pricing"+i);if(el)el.value=comps[i].pricingUrl;}
}

async function detectRss(i){
  const tok=$("adminToken").value;
  if(!tok){alert("Enter admin token first");return;}
  const url=comps[i].website;if(!url)return;
  try{
    const r=await fetch(base+"/api/config/detect-rss",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Token":tok},body:JSON.stringify({url})});
    const d=await r.json();
    if(d.found){comps[i].blogRss=d.feedUrl;const el=$("rss"+i);if(el)el.value=d.feedUrl;}
    else{alert("No RSS feed found for "+url);}
  }catch(e){alert("Detection failed: "+e.message);}
}

async function testSlack(){
  const tok=$("adminToken").value;
  const url=$("slackUrl").value;
  if(!tok||!url){$("slackMsg").innerHTML='<div class="msg msg-err">Enter both fields first</div>';return;}
  try{
    const r=await fetch(base+"/api/config/test-slack",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Token":tok},body:JSON.stringify({webhookUrl:url})});
    const d=await r.json();
    $("slackMsg").innerHTML=d.success?'<div class="msg msg-ok">Connected! Check your Slack channel.</div>':'<div class="msg msg-err">'+(d.error||"Failed")+'</div>';
  }catch(e){$("slackMsg").innerHTML='<div class="msg msg-err">'+e.message+'</div>';}
}

function renderSummary(){
  let h='<div class="summary-item"><div class="summary-label">Competitors</div>'+comps.length+' configured</div>';
  h+='<div class="summary-item"><div class="summary-label">Slack</div>'+($("slackUrl").value?"Connected":"Not set")+'</div>';
  h+='<div class="summary-item"><div class="summary-label">Product Hunt</div>'+($("phToken").value?"Token set":"Not configured")+'</div>';
  h+='<div class="summary-item"><div class="summary-label">Schedule</div>Daily at 9am UTC</div>';
  $("summaryPanel").innerHTML=h;
}

function buildCompetitors(){
  return comps.filter(c=>c.name&&c.website).map(c=>{
    const pages=[];
    const site=c.website.replace(/\\/+$/,"");
    if(c.pricingUrl)pages.push({id:"pricing",url:c.pricingUrl,type:"pricing",label:"Pricing"});
    pages.push({id:"home",url:site,type:"general",label:"Homepage"});
    return{name:c.name,website:site,blogRss:c.blogRss||null,pages};
  });
}

async function launch(){
  const tok=$("adminToken").value;
  if(!tok){$("launchMsg").innerHTML='<div class="msg msg-err">Admin token required</div>';return;}
  $("launchBtn").disabled=true;
  $("launchBtn").textContent="Saving...";
  try{
    const competitors=buildCompetitors();
    const phTopicStr=$("phTopics").value;
    const topics=phTopicStr?phTopicStr.split(",").map(s=>s.trim()).filter(Boolean).map(s=>({slug:s,name:s.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" ")})):[];
    const settings={slackWebhookUrl:$("slackUrl").value||null,productHuntToken:$("phToken").value||null,productHuntTopics:topics};
    const h={"Content-Type":"application/json","X-Admin-Token":tok};
    const [r1,r2]=await Promise.all([fetch(base+"/api/config/competitors",{method:"POST",headers:h,body:JSON.stringify({competitors})}),fetch(base+"/api/config/settings",{method:"POST",headers:h,body:JSON.stringify(settings)})]);
    const d1=await r1.json(),d2=await r2.json();
    if(!d1.success||!d2.success){$("launchMsg").innerHTML='<div class="msg msg-err">Save failed: '+(d1.error||d2.error||"unknown")+'</div>';$("launchBtn").disabled=false;$("launchBtn").textContent="Save & Run First Scan";return;}
    $("launchBtn").textContent="Running first scan...";
    $("launchMsg").innerHTML='<div class="msg msg-info">Config saved. Running first scan (this may take a minute)...</div>';
    const r3=await fetch(base+"/api/config/trigger-scan",{method:"POST",headers:h});
    const d3=await r3.json();
    $("launchMsg").innerHTML='<div class="msg msg-ok">Done! Indexed '+competitors.length+' competitors. Redirecting to dashboard...</div>';
    setTimeout(()=>location.href=base+"/dashboard",2000);
  }catch(e){$("launchMsg").innerHTML='<div class="msg msg-err">Error: '+e.message+'</div>';$("launchBtn").disabled=false;$("launchBtn").textContent="Save & Run First Scan";}
}

// Load existing config on page load
(async function(){
  const tok=new URLSearchParams(location.search).get("token");
  if(!tok)return;
  $("adminToken").value=tok;
  try{
    const r=await fetch(base+"/api/config?token="+tok);
    if(!r.ok)return;
    const d=await r.json();
    if(d.competitors&&d.competitors.length>0){
      for(const c of d.competitors){
        const pp=c.pages?.find(p=>p.type==="pricing");
        comps.push({name:c.name,website:c.website,pricingUrl:pp?.url||"",blogRss:c.blogRss||""});
      }
      renderComps();
    }
    if(d.settings){
      if(d.settings.slackWebhookUrl)$("slackUrl").value=d.settings.slackWebhookUrl;
      if(d.settings.productHuntToken)$("phToken").value=d.settings.productHuntToken;
      if(d.settings.productHuntTopics&&d.settings.productHuntTopics.length)$("phTopics").value=d.settings.productHuntTopics.map(t=>t.slug).join(", ");
    }
  }catch(e){}
})();

if(comps.length===0)addComp();
</script>
</body>
</html>`;

// ─── SIGN-IN HTML (hosted mode) ──────────────────────────────────────────────

const SIGNIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Sign In</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:40px 32px;width:100%;max-width:380px;text-align:center}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:32px}
.btn-google{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;background:#fff;color:#333;border:none;border-radius:2px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px;text-decoration:none}
.btn-google:hover{background:#f0f0f0}
.btn-apple{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;background:#000;color:#fff;border:1px solid #333;border-radius:2px;font-size:14px;font-weight:600;cursor:default;opacity:0.4;position:relative;margin-bottom:24px}
.btn-apple .soon{position:absolute;right:12px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280}
.footer{font-size:12px;color:#6b7280}
.footer a{color:#7a8c52}
</style>
</head>
<body>
<div class="card">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Sign in to your intelligence dashboard</p>
<a href="/auth/google" class="btn-google"><svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continue with Google</a>
<div class="btn-apple"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.32 2.32-1.95 4.27-3.74 4.25z"/></svg>Continue with Apple<span class="soon">Soon</span></div>
<div class="footer">Want full control? <a href="https://github.com/ZeroLupo/scopehound">Self-host for free</a></div>
</div>
</body>
</html>`;

// ─── BILLING HTML (hosted mode) ─────────────────────────────────────────────

const BILLING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Billing</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52;text-decoration:none}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.wrap{max-width:900px;margin:0 auto;padding:32px 24px}
h2{font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:20px}
.current{background:#12161a;border:1px solid #5c6b3c;border-radius:2px;padding:20px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.current-plan{font-size:18px;font-weight:700;text-transform:uppercase}
.current-status{font-size:12px;color:#3d6b35;text-transform:uppercase;letter-spacing:0.05em}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.plan{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px;display:flex;flex-direction:column}
.plan.active{border-color:#5c6b3c}
.plan-name{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px}
.plan-price{font-size:24px;font-weight:700;margin-bottom:4px}
.plan-price .mo{font-size:12px;color:#6b7280;font-weight:400}
.plan-features{list-style:none;margin:12px 0;flex:1}
.plan-features li{font-size:12px;color:#6b7280;padding:3px 0;border-bottom:1px solid #1a1f25}
.plan-features li:last-child{border-bottom:none}
.btn{display:block;width:100%;padding:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;text-align:center;cursor:pointer;border:none;border-radius:2px}
.btn-primary{background:#5c6b3c;color:#d4d8de}
.btn-primary:hover{background:#7a8c52}
.btn-secondary{background:transparent;border:1px solid #2a3038;color:#6b7280}
.btn-secondary:hover{border-color:#5c6b3c;color:#d4d8de}
.btn-current{background:#1a1f25;color:#6b7280;cursor:default}
.manage{text-align:center;margin-top:24px;font-size:13px;color:#6b7280}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-bottom:16px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
@media(max-width:700px){.grid{grid-template-columns:1fr 1fr}.current{flex-direction:column;align-items:flex-start}}
@media(max-width:480px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Scope<span>Hound</span></h1><a href="/dashboard">Dashboard</a></header>
<div class="wrap">
<div id="successMsg"></div>
<div class="current" id="currentPlan"><div><div class="current-plan" id="planName">Loading...</div><div class="current-status" id="planStatus"></div></div></div>
<h2>Plans</h2>
<div class="grid">
<div class="plan" data-tier="recon"><div class="plan-name">Recon</div><div class="plan-price">$19.99<span class="mo">/mo</span></div><ul class="plan-features"><li>3 competitors</li><li>6 pages</li><li>Daily scans</li><li>30-day history</li></ul><button class="btn btn-primary" id="btn-recon" onclick="checkout('recon')">Subscribe</button></div>
<div class="plan" data-tier="operator"><div class="plan-name">Operator</div><div class="plan-price">$49<span class="mo">/mo</span></div><ul class="plan-features"><li>15 competitors</li><li>60 pages</li><li>Daily scans</li><li>90-day history</li><li>3 users</li></ul><button class="btn btn-primary" id="btn-operator" onclick="checkout('operator')">Upgrade</button></div>
<div class="plan" data-tier="commander"><div class="plan-name">Commander</div><div class="plan-price">$99<span class="mo">/mo</span></div><ul class="plan-features"><li>25 competitors</li><li>100 pages</li><li>2x daily</li><li>1-year history</li><li>10 users</li></ul><button class="btn btn-primary" id="btn-commander" onclick="checkout('commander')">Upgrade</button></div>
<div class="plan" data-tier="strategic"><div class="plan-name">Strategic</div><div class="plan-price">$199<span class="mo">/mo</span></div><ul class="plan-features"><li>50 competitors</li><li>200 pages</li><li>4x daily</li><li>Unlimited history</li><li>Unlimited users</li></ul><button class="btn btn-primary" id="btn-strategic" onclick="checkout('strategic')">Upgrade</button></div>
</div>
<div class="manage" id="manageSection" style="display:none"><a href="#" onclick="manageSubscription();return false">Manage subscription on Stripe</a></div>
</div>
<script>
async function loadProfile(){
  try{const r=await fetch("/api/user/profile");if(!r.ok)return;const u=await r.json();
  document.getElementById("planName").textContent=u.tier?u.tier.toUpperCase()+" PLAN":"RECON PLAN";
  document.getElementById("planStatus").textContent=u.subscriptionStatus==="active"?"Active":u.subscriptionStatus||"No subscription";
  const tier=u.tier||"recon";
  document.querySelectorAll(".plan").forEach(p=>{const t=p.dataset.tier;const btn=p.querySelector("button");
  if(t===tier){p.classList.add("active");btn.className="btn btn-current";btn.textContent="Current Plan";btn.onclick=null;}
  else if(["operator","commander","strategic"].indexOf(t)>["operator","commander","strategic"].indexOf(tier)){btn.textContent="Upgrade";btn.className="btn btn-primary";}
  else{btn.textContent="Downgrade";btn.className="btn btn-secondary";}});
  if(u.stripeCustomerId)document.getElementById("manageSection").style.display="block";
  }catch(e){}
  if(new URLSearchParams(location.search).get("success")){window.location.href="/setup";return;}
}
async function checkout(tier){try{const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tier})});const d=await r.json();if(d.url)location.href=d.url;else alert(d.error||"Failed");}catch(e){alert(e.message);}}
async function manageSubscription(){try{const r=await fetch("/api/billing/portal",{method:"POST"});const d=await r.json();if(d.url)location.href=d.url;else alert(d.error||"Failed");}catch(e){alert(e.message);}}
loadProfile();
</script>
</body>
</html>`;

// ─── HOSTED SETUP WIZARD HTML ─────────────────────────────────────────────────

const HOSTED_SETUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Setup</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52;text-decoration:none}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.wrap{max-width:700px;margin:0 auto;padding:32px 24px}
h2{font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px}
.subtitle{font-size:13px;color:#6b7280;margin-bottom:20px}
.steps{display:flex;gap:8px;margin-bottom:32px}
.step-tab{flex:1;padding:10px;text-align:center;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:#12161a;border:1px solid #2a3038;border-radius:2px;color:#6b7280;cursor:default}
.step-tab.active{border-color:#5c6b3c;color:#d4d8de}
.step-tab.done{border-color:#3d6b35;color:#3d6b35}
.panel{display:none}
.panel.active{display:block}
label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:6px}
input[type="text"],input[type="url"]{width:100%;padding:10px 12px;background:#12161a;border:1px solid #2a3038;border-radius:2px;color:#d4d8de;font-size:14px;margin-bottom:12px}
input:focus{outline:none;border-color:#5c6b3c}
.btn{display:inline-block;padding:10px 20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;text-align:center;cursor:pointer;border:none;border-radius:2px}
.btn-primary{background:#5c6b3c;color:#d4d8de}
.btn-primary:hover{background:#7a8c52}
.btn-secondary{background:transparent;border:1px solid #2a3038;color:#6b7280}
.btn-secondary:hover{border-color:#5c6b3c;color:#d4d8de}
.btn-sm{padding:6px 14px;font-size:11px}
.btn:disabled{opacity:0.4;cursor:not-allowed}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-bottom:12px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
.msg-err{background:#6b353522;border:1px solid #6b3535;color:#c55}
.comp-card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:12px;position:relative}
.comp-card .remove{position:absolute;top:12px;right:12px;background:none;border:none;color:#6b7280;cursor:pointer;font-size:16px}
.comp-card .remove:hover{color:#c55}
.pages-list{margin:8px 0 0}
.pages-list label{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:400;text-transform:none;letter-spacing:0;color:#d4d8de;margin-bottom:4px;cursor:pointer}
.pages-list input[type="checkbox"]{width:auto;margin:0;accent-color:#5c6b3c}
.pages-list .page-url{color:#6b7280;font-size:11px;margin-left:4px}
.custom-page{display:flex;gap:8px;margin-top:8px}
.custom-page input{flex:1;margin-bottom:0}
.tier-info{font-size:12px;color:#6b7280;margin-bottom:16px}
.tier-info strong{color:#5c6b3c}
.scanning{color:#6b7280;font-size:13px;font-style:italic}
.helper{font-size:12px;color:#6b7280;margin-bottom:16px}
.helper a{color:#7a8c52}
.review-item{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a1f25;font-size:14px}
.review-label{color:#6b7280}
.nav-btns{display:flex;justify-content:space-between;margin-top:24px}
@media(max-width:600px){.steps{flex-direction:column}}
</style>
</head>
<body>
<header><h1>Scope<span>Hound</span></h1><a href="/billing">Billing</a></header>
<div class="wrap">
<div class="steps">
<div class="step-tab active" id="tab1">1. Slack</div>
<div class="step-tab" id="tab2">2. Competitors</div>
<div class="step-tab" id="tab3">3. Launch</div>
</div>

<!-- Step 1: Slack -->
<div class="panel active" id="panel1">
<h2>Connect Slack</h2>
<p class="subtitle">ScopeHound delivers your daily competitive intel briefing to Slack.</p>
<p class="helper">Need help? <a href="https://api.slack.com/messaging/webhooks" target="_blank">How to create a Slack webhook</a></p>
<label for="slackUrl">Slack Webhook URL</label>
<input type="url" id="slackUrl" placeholder="https://hooks.slack.com/services/...">
<div id="slackMsg"></div>
<div class="nav-btns">
<div></div>
<div style="display:flex;gap:8px">
<button class="btn btn-secondary btn-sm" onclick="testSlack()">Test Connection</button>
<button class="btn btn-primary" id="slackNext" onclick="goStep(2)" disabled>Next</button>
</div>
</div>
</div>

<!-- Step 2: Competitors -->
<div class="panel" id="panel2">
<h2>Add Competitors</h2>
<div class="tier-info" id="tierInfo"></div>
<div id="compList"></div>
<button class="btn btn-secondary btn-sm" onclick="addCompetitor()" id="addCompBtn">+ Add Competitor</button>
<div class="nav-btns">
<button class="btn btn-secondary" onclick="goStep(1)">Back</button>
<button class="btn btn-primary" id="compNext" onclick="goStep(3)">Next</button>
</div>
</div>

<!-- Step 3: Review & Launch -->
<div class="panel" id="panel3">
<h2>Review & Launch</h2>
<p class="subtitle">Confirm your setup and launch your first scan.</p>
<div id="reviewSummary"></div>
<div id="launchMsg"></div>
<div class="nav-btns">
<button class="btn btn-secondary" onclick="goStep(2)">Back</button>
<button class="btn btn-primary" id="launchBtn" onclick="launch()">Save & Launch First Scan</button>
</div>
</div>
</div>
<script>
let currentStep=1,slackVerified=false,competitors=[];
async function loadUserInfo(){
  try{const r=await fetch("/api/user/profile");if(r.ok){const u=await r.json();
  const t=u.tier||"recon";const limits={recon:{c:3,p:6},operator:{c:15,p:60},commander:{c:25,p:100},strategic:{c:50,p:200}};
  const l=limits[t]||limits.recon;
  document.getElementById("tierInfo").innerHTML="You can add up to <strong>"+l.c+" competitors</strong> on your "+t.charAt(0).toUpperCase()+t.slice(1)+" plan.";
  window._tierLimits=l;window._tier=t;}}catch(e){}
}
function goStep(n){
  if(n===2&&!slackVerified){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">Please test your Slack connection first.</div>';return;}
  if(n===3&&competitors.length===0){alert("Add at least one competitor.");return;}
  currentStep=n;
  document.querySelectorAll(".panel").forEach((p,i)=>{p.classList.toggle("active",i===n-1);});
  document.querySelectorAll(".step-tab").forEach((t,i)=>{t.className="step-tab"+(i===n-1?" active":i<n-1?" done":"");});
  if(n===3)renderReview();
}
async function testSlack(){
  const u=document.getElementById("slackUrl").value.trim();
  if(!u){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">Enter a webhook URL.</div>';return;}
  document.getElementById("slackMsg").innerHTML='<div class="msg">Testing...</div>';
  try{const r=await fetch("/api/config/test-slack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({webhookUrl:u})});
  const d=await r.json();
  if(d.success){slackVerified=true;document.getElementById("slackNext").disabled=false;
  document.getElementById("slackMsg").innerHTML='<div class="msg msg-ok">Connected! Check your Slack channel.</div>';}
  else{document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">'+(d.error||"Failed to connect.")+'</div>';}
  }catch(e){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">'+e.message+'</div>';}
}
function addCompetitor(){
  const lim=window._tierLimits;
  if(lim&&competitors.length>=lim.c){alert("You've reached your plan limit of "+lim.c+" competitors.");return;}
  const idx=competitors.length;
  competitors.push({name:"",website:"",pages:[],blogRss:null});
  renderCompetitors();
}
function removeCompetitor(idx){competitors.splice(idx,1);renderCompetitors();}
function renderCompetitors(){
  const el=document.getElementById("compList");
  el.innerHTML="";
  competitors.forEach((c,i)=>{
    const div=document.createElement("div");div.className="comp-card";
    div.innerHTML='<button class="remove" onclick="removeCompetitor('+i+')">&times;</button>'
      +'<label>Company Name</label><input type="text" value="'+(c.name||"")+'" onchange="competitors['+i+'].name=this.value" placeholder="Acme Inc">'
      +'<label>Website URL</label><div style="display:flex;gap:8px"><input type="url" value="'+(c.website||"")+'" id="url'+i+'" onchange="competitors['+i+'].website=this.value" placeholder="https://acme.com" style="flex:1;margin:0"><button class="btn btn-secondary btn-sm" onclick="scanSite('+i+')">Scan</button></div>'
      +'<div id="pages'+i+'" class="pages-list">'+(c.pages.length?renderPageCheckboxes(i):'<p class="scanning" style="margin-top:8px;font-style:normal;color:#6b7280">Enter URL and click Scan to discover pages.</p>')+'</div>'
      +'<div class="custom-page"><input type="url" id="custom'+i+'" placeholder="Add custom page URL"><button class="btn btn-secondary btn-sm" onclick="addCustomPage('+i+')">Add</button></div>';
    el.appendChild(div);
  });
  const lim=window._tierLimits;
  document.getElementById("addCompBtn").style.display=(lim&&competitors.length>=lim.c)?"none":"inline-block";
}
function renderPageCheckboxes(idx){
  const c=competitors[idx];if(!c._discovered)return"";
  return c._discovered.map((p,pi)=>{
    const checked=c.pages.find(x=>x.url===p.url)?"checked":"";
    return '<label><input type="checkbox" '+checked+' onchange="togglePage('+idx+','+pi+',this.checked)"> '+p.label+' <span class="page-url">'+p.url+'</span></label>';
  }).join("");
}
function togglePage(ci,pi,on){
  const disc=competitors[ci]._discovered[pi];
  if(on){
    if(!competitors[ci].pages.find(x=>x.url===disc.url)){
      const entry={id:disc.type+"-"+competitors[ci].pages.length,url:disc.url,type:disc.type,label:disc.label};
      if(disc.rss)competitors[ci].blogRss=disc.rss;
      competitors[ci].pages.push(entry);
    }
  }else{
    competitors[ci].pages=competitors[ci].pages.filter(x=>x.url!==disc.url);
  }
}
async function scanSite(idx){
  const u=document.getElementById("url"+idx).value.trim();
  if(!u){alert("Enter a URL first.");return;}
  competitors[idx].website=u;
  document.getElementById("pages"+idx).innerHTML='<p class="scanning" style="margin-top:8px">Scanning '+u+'...</p>';
  try{const r=await fetch("/api/config/discover-pages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u})});
  const d=await r.json();
  if(d.pages){
    competitors[idx]._discovered=d.pages;
    competitors[idx].pages=d.pages.map((p,i)=>({id:p.type+"-"+i,url:p.url,type:p.type,label:p.label}));
    if(d.pages.find(p=>p.rss))competitors[idx].blogRss=d.pages.find(p=>p.rss).rss;
    document.getElementById("pages"+idx).innerHTML=renderPageCheckboxes(idx);
  }else{document.getElementById("pages"+idx).innerHTML='<p class="msg msg-err">Could not scan site.</p>';}
  }catch(e){document.getElementById("pages"+idx).innerHTML='<p class="msg msg-err">'+e.message+'</p>';}
}
function addCustomPage(idx){
  const input=document.getElementById("custom"+idx);
  const u=input.value.trim();if(!u)return;
  const entry={id:"custom-"+competitors[idx].pages.length,url:u,type:"general",label:"Custom"};
  competitors[idx].pages.push(entry);
  if(!competitors[idx]._discovered)competitors[idx]._discovered=[];
  competitors[idx]._discovered.push({url:u,type:"general",label:"Custom"});
  input.value="";
  document.getElementById("pages"+idx).innerHTML=renderPageCheckboxes(idx);
}
function renderReview(){
  const totalPages=competitors.reduce((s,c)=>s+c.pages.length,0);
  document.getElementById("reviewSummary").innerHTML=
    '<div class="review-item"><span class="review-label">Slack</span><span>Connected</span></div>'
    +'<div class="review-item"><span class="review-label">Competitors</span><span>'+competitors.length+'</span></div>'
    +'<div class="review-item"><span class="review-label">Pages monitored</span><span>'+totalPages+'</span></div>'
    +'<div class="review-item"><span class="review-label">Plan</span><span>'+(window._tier||"recon").charAt(0).toUpperCase()+(window._tier||"recon").slice(1)+'</span></div>'
    +'<div class="review-item"><span class="review-label">Schedule</span><span>Daily at 9am UTC</span></div>';
}
async function launch(){
  const btn=document.getElementById("launchBtn");btn.disabled=true;btn.textContent="Saving...";
  const msgEl=document.getElementById("launchMsg");
  try{
    const comps=competitors.map(c=>({name:c.name,website:c.website,blogRss:c.blogRss||null,pages:c.pages.map(p=>({id:p.id,url:p.url,type:p.type,label:p.label}))}));
    // Save competitors
    let r=await fetch("/api/config/competitors",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({competitors:comps})});
    let d=await r.json();if(!r.ok){throw new Error(d.error||"Failed to save competitors");}
    // Save settings
    r=await fetch("/api/config/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slackWebhookUrl:document.getElementById("slackUrl").value.trim()})});
    d=await r.json();if(!r.ok){throw new Error(d.error||"Failed to save settings");}
    // Trigger scan
    btn.textContent="Launching scan...";
    r=await fetch("/api/config/trigger-scan",{method:"POST",headers:{"Content-Type":"application/json"}});
    d=await r.json();
    msgEl.innerHTML='<div class="msg msg-ok">Setup complete! Redirecting to dashboard...</div>';
    setTimeout(()=>{window.location.href="/dashboard";},1500);
  }catch(e){
    msgEl.innerHTML='<div class="msg msg-err">'+e.message+'</div>';
    btn.disabled=false;btn.textContent="Save & Launch First Scan";
  }
}
loadUserInfo();
addCompetitor();
</script>
</body>
</html>`;

// ─── PARTNER APPLICATION HTML (hosted mode) ──────────────────────────────────

const PARTNER_APPLY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Partner Program</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52}
.wrap{max-width:520px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:8px}
.highlight{color:#c4a747;font-size:18px;font-weight:700;margin-bottom:24px}
.panel{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:24px;margin-bottom:16px}
label{display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:6px}
input,textarea{width:100%;background:#0a0c0e;border:1px solid #2a3038;color:#d4d8de;padding:10px 12px;font-size:14px;border-radius:2px;outline:none;font-family:inherit}
input:focus,textarea:focus{border-color:#5c6b3c}
textarea{resize:vertical;min-height:60px}
.field{margin-bottom:16px}
.btn{display:inline-block;padding:12px 24px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;border:none;border-radius:2px;background:#c4a747;color:#0a0c0e}
.btn:hover{background:#d4b857}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-top:12px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
.msg-err{background:#c2303022;border:1px solid #c23030;color:#c23030}
</style>
</head>
<body>
<div class="wrap">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Partner Program</p>
<p class="highlight">Earn 50% recurring for 24 months</p>
<div class="panel">
<div class="field"><label>Your Name</label><input type="text" id="pName" required></div>
<div class="field"><label>Email</label><input type="email" id="pEmail" required></div>
<div class="field"><label>Website or Social Profile</label><input type="url" id="pWebsite" placeholder="https://"></div>
<div class="field"><label>PayPal Email (for payouts)</label><input type="email" id="pPaypal" required></div>
<div class="field"><label>How will you promote ScopeHound?</label><textarea id="pHow" placeholder="Blog, newsletter, YouTube, Twitter, etc."></textarea></div>
<button class="btn" onclick="apply()">Apply Now</button>
<div id="applyMsg"></div>
</div>
</div>
<script>
async function apply(){
  const body={name:document.getElementById("pName").value,email:document.getElementById("pEmail").value,website:document.getElementById("pWebsite").value,paypalEmail:document.getElementById("pPaypal").value,promotionPlan:document.getElementById("pHow").value};
  if(!body.name||!body.email||!body.paypalEmail){document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">Name, email, and PayPal email are required.</div>';return;}
  try{const r=await fetch("/api/partner/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();
  if(d.success)document.getElementById("applyMsg").innerHTML='<div class="msg msg-ok">Application submitted! Your referral code: <strong>'+d.code+'</strong>. We will review and activate your account shortly.</div>';
  else document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">'+(d.error||"Failed")+'</div>';
  }catch(e){document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">'+e.message+'</div>';}
}
</script>
</body>
</html>`;

// ─── PARTNER DASHBOARD HTML (hosted mode) ────────────────────────────────────

const PARTNER_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Partner Dashboard</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52}
.wrap{max-width:800px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:24px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.stat{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px}
.stat-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px}
.stat-value{font-size:22px;font-weight:700;color:#c4a747}
.link-box{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:24px;display:flex;gap:8px;align-items:center}
.link-box input{flex:1;background:#0a0c0e;border:1px solid #2a3038;color:#d4d8de;padding:8px 12px;font-size:13px;border-radius:2px}
.link-box button{padding:8px 16px;background:#5c6b3c;color:#d4d8de;border:none;border-radius:2px;font-size:12px;font-weight:600;text-transform:uppercase;cursor:pointer}
table{width:100%;border-collapse:collapse;background:#12161a;border:1px solid #2a3038;border-radius:2px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1a1f25;font-size:13px}
th{color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em}
.empty{text-align:center;padding:32px;color:#6b7280}
@media(max-width:600px){.stats{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="wrap">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Partner Dashboard</p>
<div class="stats">
<div class="stat"><div class="stat-label">Referrals</div><div class="stat-value" id="sReferrals">-</div></div>
<div class="stat"><div class="stat-label">Active Subs</div><div class="stat-value" id="sActive">-</div></div>
<div class="stat"><div class="stat-label">Monthly Earnings</div><div class="stat-value" id="sMonthly">-</div></div>
<div class="stat"><div class="stat-label">Total Earned</div><div class="stat-value" id="sTotal">-</div></div>
</div>
<div class="link-box"><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;white-space:nowrap">Referral Link</label><input type="text" id="refLink" readonly><button onclick="navigator.clipboard.writeText(document.getElementById('refLink').value)">Copy</button></div>
<h2 style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:12px">Referrals</h2>
<table><thead><tr><th>Email</th><th>Date</th><th>Tier</th><th>Commission</th><th>Status</th></tr></thead><tbody id="refTable"><tr><td colspan="5" class="empty">Loading...</td></tr></tbody></table>
</div>
<script>
const params=new URLSearchParams(location.search);
const code=params.get("code"),email=params.get("email");
if(!code||!email){document.querySelector(".wrap").innerHTML='<p style="color:#c23030;padding:40px;text-align:center">Missing code or email parameter.</p>';}
else{fetch("/api/partner/stats?code="+code+"&email="+email).then(r=>r.json()).then(d=>{
  if(d.error){document.querySelector(".wrap").innerHTML='<p style="color:#c23030;padding:40px;text-align:center">'+d.error+'</p>';return;}
  document.getElementById("sReferrals").textContent=d.referralCount||0;
  document.getElementById("sActive").textContent=(d.referrals||[]).filter(r=>r.status==="active").length;
  document.getElementById("sMonthly").textContent="$"+((d.referrals||[]).reduce((s,r)=>s+(r.status==="active"?r.monthlyCommission:0),0)/100).toFixed(2);
  document.getElementById("sTotal").textContent="$"+((d.totalEarnings||0)/100).toFixed(2);
  document.getElementById("refLink").value=location.origin+"/?ref="+code;
  const tbody=document.getElementById("refTable");
  if(!d.referrals||d.referrals.length===0){tbody.innerHTML='<tr><td colspan="5" class="empty">No referrals yet</td></tr>';return;}
  tbody.innerHTML=d.referrals.map(r=>'<tr><td>'+r.email+'</td><td>'+new Date(r.signedUpAt).toLocaleDateString()+'</td><td>'+r.tier+'</td><td>$'+(r.monthlyCommission/100).toFixed(2)+'/mo</td><td>'+r.status+'</td></tr>').join("");
}).catch(()=>{});}
</script>
</body>
</html>`;

// ─── WORKER ENTRY POINT ─────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    if (isHostedMode(env)) {
      ctx.waitUntil((async () => {
        const raw = await env.STATE.get("active_subscribers");
        const list = raw ? JSON.parse(raw) : [];
        for (const userId of list) {
          try {
            const uRaw = await env.STATE.get("user:" + userId);
            if (!uRaw) continue;
            const user = JSON.parse(uRaw);
            if (user.subscriptionStatus !== "active") continue;
            console.log(`Running scan for user ${user.email} (${user.tier})`);
            await runMonitor(env, null, userId);
          } catch (e) {
            console.log(`Scan failed for user ${userId}: ${e.message}`);
          }
        }
      })());
    } else {
      ctx.waitUntil(runMonitor(env));
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-Admin-Token" },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // HOSTED MODE ROUTES — only active when Google/Stripe/JWT secrets are set
    // ══════════════════════════════════════════════════════════════════════════

    if (isHostedMode(env)) {
      // ── Sign-in page ──
      if (path === "/signin" || path === "/signin/") {
        return new Response(SIGNIN_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
      }

      // ── Google OAuth: start ──
      if (path === "/auth/google") {
        const nonce = crypto.randomUUID();
        const ref = url.searchParams.get("ref") || "";
        const state = JSON.stringify({ nonce, ref });
        await env.STATE.put("csrf:" + nonce, "1", { expirationTtl: 600 });
        return Response.redirect(getGoogleAuthUrl(env, url.origin, state), 302);
      }

      // ── Google OAuth: callback ──
      if (path === "/auth/google/callback") {
        try {
          const code = url.searchParams.get("code");
          const stateRaw = url.searchParams.get("state");
          if (!code || !stateRaw) return new Response("Missing code or state", { status: 400 });
          const state = JSON.parse(stateRaw);
          const csrfValid = await env.STATE.get("csrf:" + state.nonce);
          if (!csrfValid) return new Response("Invalid or expired state", { status: 400 });
          await env.STATE.delete("csrf:" + state.nonce);
          const tokens = await exchangeGoogleCode(code, url.origin + "/auth/google/callback", env);
          if (!tokens || !tokens.access_token) return new Response("Token exchange failed", { status: 400 });
          const profile = await getGoogleUserInfo(tokens.access_token);
          if (!profile || !profile.email) return new Response("Failed to get user info", { status: 400 });
          const user = await findOrCreateUser(env, "google", profile, state.ref || null);
          const token = await createSession(env, user.id);
          // Smart redirect: billing → setup → dashboard
          let dest = "/dashboard";
          if (user.subscriptionStatus !== "active") {
            dest = "/billing";
          } else {
            const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
            if (!comps || comps === "[]") dest = "/setup";
          }
          const headers = new Headers({ Location: url.origin + dest });
          setSessionCookie(headers, token);
          return new Response(null, { status: 302, headers });
        } catch (e) {
          return new Response("Auth error: " + e.message, { status: 500 });
        }
      }

      // ── Logout ──
      if (path === "/auth/logout") {
        const headers = new Headers({ Location: url.origin + "/" });
        clearSessionCookie(headers);
        return new Response(null, { status: 302, headers });
      }

      // ── User profile ──
      if (path === "/api/user/profile") {
        const { user, response } = await resolveAuth(request, env);
        if (response) return response;
        return jsonResponse({ id: user.id, email: user.email, name: user.name, tier: user.tier, subscriptionStatus: user.subscriptionStatus, stripeCustomerId: user.stripeCustomerId });
      }

      // ── Stripe webhook (no user auth — signature verified) ──
      if (path === "/api/stripe/webhook" && request.method === "POST") {
        const rawBody = await request.text();
        const sigHeader = request.headers.get("Stripe-Signature");
        if (!sigHeader) return new Response("Missing signature", { status: 400 });
        const event = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
        if (!event) return new Response("Invalid signature", { status: 400 });
        const result = await handleStripeWebhook(event, env);
        return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      // ── Checkout ──
      if (path === "/api/checkout" && request.method === "POST") {
        const { user, response } = await resolveAuth(request, env);
        if (response) return response;
        try {
          const body = await request.json();
          const tier = body.tier;
          if (!tier || !TIERS[tier]) return jsonResponse({ error: "Invalid tier" }, 400);
          const session = await createCheckoutSession(env, user, tier, url.origin);
          if (!session || !session.url) return jsonResponse({ error: session?.error?.message || "Failed to create checkout" }, 400);
          return jsonResponse({ url: session.url });
        } catch (e) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      // ── Billing page ──
      if (path === "/billing" || path === "/billing/") {
        const user = await getSessionUser(request, env);
        if (!user) return Response.redirect(url.origin + "/signin", 302);
        return new Response(BILLING_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
      }

      // ── Billing portal ──
      if (path === "/api/billing/portal" && request.method === "POST") {
        const { user, response } = await resolveAuth(request, env);
        if (response) return response;
        if (!user.stripeCustomerId) return jsonResponse({ error: "No subscription found" }, 400);
        const session = await stripeAPI("/billing_portal/sessions", "POST", { customer: user.stripeCustomerId, return_url: url.origin + "/billing" }, env);
        if (!session || !session.url) return jsonResponse({ error: "Failed to create portal" }, 400);
        return jsonResponse({ url: session.url });
      }

      // ── Partner: apply page ──
      if (path === "/partner/apply" || path === "/partner/apply/") {
        return new Response(PARTNER_APPLY_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
      }

      // ── Partner: submit application ──
      if (path === "/api/partner/apply" && request.method === "POST") {
        try {
          const body = await request.json();
          if (!body.name || !body.email || !body.paypalEmail) return jsonResponse({ error: "Name, email, and PayPal email required" }, 400);
          const existing = await env.STATE.get("affiliate_email:" + body.email);
          if (existing) return jsonResponse({ error: "Application already submitted" }, 400);
          const code = generateAffiliateCode();
          const affiliate = {
            code,
            email: body.email,
            name: body.name,
            website: body.website || null,
            paypalEmail: body.paypalEmail,
            promotionPlan: body.promotionPlan || null,
            status: "approved",
            commissionRate: 0.5,
            commissionMonths: 24,
            referralCount: 0,
            totalEarnings: 0,
            pendingEarnings: 0,
            createdAt: new Date().toISOString(),
            approvedAt: new Date().toISOString(),
          };
          await Promise.all([
            env.STATE.put("affiliate:" + code, JSON.stringify(affiliate)),
            env.STATE.put("affiliate_email:" + body.email, code),
          ]);
          return jsonResponse({ success: true, code });
        } catch (e) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      // ── Partner: dashboard ──
      if (path === "/partner/dashboard" || path === "/partner/dashboard/") {
        return new Response(PARTNER_DASHBOARD_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
      }

      // ── Partner: stats API ──
      if (path === "/api/partner/stats") {
        const code = url.searchParams.get("code");
        const email = url.searchParams.get("email");
        if (!code || !email) return jsonResponse({ error: "code and email required" }, 400);
        const raw = await env.STATE.get("affiliate:" + code);
        if (!raw) return jsonResponse({ error: "Affiliate not found" }, 404);
        const affiliate = JSON.parse(raw);
        if (affiliate.email !== email) return jsonResponse({ error: "Invalid credentials" }, 401);
        const refsRaw = await env.STATE.get("affiliate:" + code + ":referrals");
        const referrals = refsRaw ? JSON.parse(refsRaw) : [];
        return jsonResponse({
          code: affiliate.code,
          status: affiliate.status,
          referralCount: affiliate.referralCount,
          totalEarnings: affiliate.totalEarnings,
          pendingEarnings: affiliate.pendingEarnings,
          referrals,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SHARED ROUTES — work in both self-hosted and hosted mode
    // ══════════════════════════════════════════════════════════════════════════

    // ── Setup wizard ──
    if (path === "/setup" || path === "/setup/") {
      if (isHostedMode(env)) {
        const user = await getSessionUser(request, env);
        if (!user) return Response.redirect(url.origin + "/signin", 302);
        if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
        return new Response(HOSTED_SETUP_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
      }
      return new Response(SETUP_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    // ── Dashboard ──
    if (path === "/dashboard" || path === "/dashboard/") {
      if (isHostedMode(env)) {
        const user = await getSessionUser(request, env);
        if (!user) return Response.redirect(url.origin + "/signin", 302);
        if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
        const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
        if (!comps || comps === "[]") return Response.redirect(url.origin + "/setup", 302);
      }
      return new Response(DASHBOARD_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    // ── Dashboard API ──
    if (path === "/api/dashboard-data" || path === "/dashboard/api/dashboard-data") {
      let cacheKey = "dashboard_cache";
      if (isHostedMode(env)) {
        const user = await getSessionUser(request, env);
        if (!user) return jsonResponse({ error: "Not authenticated" }, 401);
        if (user.subscriptionStatus !== "active") return jsonResponse({ error: "Subscription required" }, 402);
        cacheKey = "user_state:" + user.id + ":dashboard";
      }
      const cache = await env.STATE.get(cacheKey);
      return new Response(cache || '{"competitors":[],"recentChanges":[]}', {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // ── Config API: Read ──
    if (path === "/api/config" && request.method === "GET") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      const userId = isHostedMode(env) ? user.id : null;
      const config = await loadConfig(env, userId);
      return jsonResponse({ competitors: config.competitors, settings: config.settings });
    }

    // ── Config API: Save competitors ──
    if (path === "/api/config/competitors" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      try {
        const body = await request.json();
        const comps = body.competitors;
        if (!Array.isArray(comps)) return jsonResponse({ error: "competitors must be an array" }, 400);
        // Enforce tier limits in hosted mode
        if (isHostedMode(env)) {
          const tierErr = enforceTierLimits(user, comps);
          if (tierErr) return jsonResponse(tierErr, 400);
        } else {
          if (comps.length > 25) return jsonResponse({ error: "Maximum 25 competitors" }, 400);
        }
        for (const c of comps) {
          if (!c.name || !c.website) return jsonResponse({ error: "Competitor missing name or website" }, 400);
          if (!c.pages || c.pages.length === 0) return jsonResponse({ error: `${c.name}: needs at least one page` }, 400);
          if (c.pages.length > 4) return jsonResponse({ error: `${c.name}: maximum 4 pages per competitor` }, 400);
        }
        const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
        await env.STATE.put(prefix + "competitors", JSON.stringify(comps));
        if (!isHostedMode(env)) await env.STATE.put("config:setup_complete", "true");
        return jsonResponse({ success: true, count: comps.length });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Save settings ──
    if (path === "/api/config/settings" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      try {
        const body = await request.json();
        const settings = {
          slackWebhookUrl: body.slackWebhookUrl || null,
          productHuntToken: body.productHuntToken || null,
          productHuntTopics: body.productHuntTopics || [],
          announcementKeywords: body.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS,
          phMinVotes: body.phMinVotes ?? 0,
        };
        const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
        await env.STATE.put(prefix + "settings", JSON.stringify(settings));
        return jsonResponse({ success: true });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Test Slack ──
    if (path === "/api/config/test-slack" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      try {
        const body = await request.json();
        const webhookUrl = body.webhookUrl;
        if (!webhookUrl) return jsonResponse({ error: "webhookUrl required" }, 400);
        await sendSlack(webhookUrl, "ScopeHound is connected. Setup wizard test successful.");
        return jsonResponse({ success: true });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Trigger scan ──
    if (path === "/api/config/trigger-scan" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      const userId = isHostedMode(env) ? user.id : null;
      const config = await loadConfig(env, userId);
      const alerts = await runMonitor(env, config, userId);
      return jsonResponse({ success: true, alertsSent: alerts.length });
    }

    // ── Config API: Detect RSS ──
    if (path === "/api/config/detect-rss" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      try {
        const body = await request.json();
        if (!body.url) return jsonResponse({ error: "url required" }, 400);
        const feedUrl = await detectRssFeed(body.url);
        return jsonResponse({ found: !!feedUrl, feedUrl });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Discover Pages ──
    if (path === "/api/config/discover-pages" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      try {
        const body = await request.json();
        if (!body.url) return jsonResponse({ error: "url required" }, 400);
        const pages = await discoverPages(body.url);
        return jsonResponse({ pages });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Manual run ──
    if (path === "/test" || path === "/run") {
      const alerts = await runMonitor(env);
      return new Response(
        JSON.stringify({ success: true, alertsSent: alerts.length, alerts: alerts.map((a) => a.text || a) }, null, 2),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Raw state ──
    if (path === "/state") {
      const state = await env.STATE.get("monitor_state");
      return new Response(state || "{}", { headers: { "Content-Type": "application/json" } });
    }

    // ── History ──
    if (path === "/history") {
      const history = await env.STATE.get("change_history");
      return new Response(history || "[]", { headers: { "Content-Type": "application/json" } });
    }

    // ── Test Slack (legacy, uses env secret) ──
    if (path === "/test-slack") {
      const config = await loadConfig(env);
      await sendSlack(config.settings.slackWebhookUrl,
        "ScopeHound v3 is connected!\n\nDashboard: " + url.origin + "/dashboard"
      );
      return jsonResponse({ success: true, message: "Test sent to Slack" });
    }

    // ── Reset all ──
    if (path === "/reset") {
      await env.STATE.delete("monitor_state");
      await env.STATE.delete("dashboard_cache");
      return jsonResponse({ success: true, message: "State reset. Run /test to re-index." });
    }

    // ── Reset pricing ──
    if (path === "/reset-pricing") {
      try {
        const config = await loadConfig(env);
        const raw = await env.STATE.get("monitor_state");
        if (raw) {
          const state = JSON.parse(raw);
          for (const comp of config.competitors) {
            const cs = state.competitors?.[comp.name];
            if (cs) {
              cs.pricing = null;
              for (const page of (comp.pages || [])) {
                if (page.type === "pricing" && cs.pages[page.id]) {
                  cs.pages[page.id].hash = null;
                  cs.pages[page.id].textSnapshot = null;
                }
              }
            }
          }
          await env.STATE.put("monitor_state", JSON.stringify(state));
        }
      } catch (e) {}
      return jsonResponse({ success: true, message: "Pricing reset. Run /test to re-extract." });
    }

    // ── Home ──
    if (isHostedMode(env)) {
      const user = await getSessionUser(request, env);
      if (user) return Response.redirect(url.origin + "/dashboard", 302);
      return Response.redirect(url.origin + "/signin", 302);
    }
    const config = await loadConfig(env);
    const setupDone = await env.STATE.get("config:setup_complete");
    if (!setupDone && config.competitors.length === 0) {
      return Response.redirect(url.origin + "/setup", 302);
    }

    return new Response(
      `ScopeHound v3 — AI Competitive Intelligence Agent

Endpoints:
  /dashboard       — Web dashboard
  /setup           — Configuration wizard
  /test            — Run monitor manually
  /state           — View current state
  /history         — View change history
  /test-slack      — Send test message to Slack
  /reset           — Reset all state and re-index
  /reset-pricing   — Reset pricing data only

Monitoring ${config.competitors.length} competitors across ${config.competitors.reduce((n, c) => n + (c.pages?.length || 0), 0)} pages.`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
