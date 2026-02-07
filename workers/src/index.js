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

// ─── CONFIG LOADER ───────────────────────────────────────────────────────────

async function loadConfig(env) {
  const [compRaw, settRaw] = await Promise.all([
    env.STATE.get("config:competitors"),
    env.STATE.get("config:settings"),
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

async function loadHistory(env) {
  try {
    const data = await env.STATE.get("change_history");
    if (data) return JSON.parse(data);
  } catch (e) {}
  return [];
}

async function saveHistory(env, history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const pruned = history.filter((e) => new Date(e.date) > cutoff).slice(-500);
  await env.STATE.put("change_history", JSON.stringify(pruned));
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

async function migrateState(env, old, competitors, topics) {
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
  await env.STATE.put("monitor_state", JSON.stringify(state));
  console.log("State migrated v1 → v2");
  return state;
}

// ─── MAIN MONITORING LOGIC ──────────────────────────────────────────────────

async function runMonitor(env, configOverride) {
  const config = configOverride || await loadConfig(env);
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
  let state;
  try {
    const raw = await env.STATE.get("monitor_state");
    if (raw) {
      state = JSON.parse(raw);
      if (state._version !== 2) state = await migrateState(env, state, competitors, phTopics);
    }
  } catch (e) { console.log("State load error, starting fresh"); }
  if (!state) state = { _version: 2, competitors: {}, productHunt: {} };

  let history = await loadHistory(env);

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
  await env.STATE.put("monitor_state", JSON.stringify(state));
  if (historyEvents.length > 0) {
    history = history.concat(historyEvents);
    await saveHistory(env, history);
  }
  await buildDashboardCache(env, state, history, competitors);
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

async function buildDashboardCache(env, state, history, competitors) {
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
  await env.STATE.put("dashboard_cache", JSON.stringify(cache));
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

// ─── DASHBOARD HTML ──────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Competitive Intelligence</title>
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

// ─── WORKER ENTRY POINT ─────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
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

    // ── Setup wizard ──
    if (path === "/setup" || path === "/setup/") {
      return new Response(SETUP_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    // ── Dashboard ──
    if (path === "/dashboard" || path === "/dashboard/") {
      return new Response(DASHBOARD_HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    // ── Dashboard API ──
    if (path === "/api/dashboard-data" || path === "/dashboard/api/dashboard-data") {
      const cache = await env.STATE.get("dashboard_cache");
      return new Response(cache || '{"competitors":[],"recentChanges":[]}', {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // ── Config API: Read ──
    if (path === "/api/config" && request.method === "GET") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      const config = await loadConfig(env);
      return jsonResponse({ competitors: config.competitors, settings: config.settings });
    }

    // ── Config API: Save competitors ──
    if (path === "/api/config/competitors" && request.method === "POST") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      try {
        const body = await request.json();
        const comps = body.competitors;
        if (!Array.isArray(comps)) return jsonResponse({ error: "competitors must be an array" }, 400);
        if (comps.length > 25) return jsonResponse({ error: "Maximum 25 competitors" }, 400);
        for (const c of comps) {
          if (!c.name || !c.website) return jsonResponse({ error: `Competitor missing name or website` }, 400);
          if (!c.pages || c.pages.length === 0) return jsonResponse({ error: `${c.name}: needs at least one page` }, 400);
          if (c.pages.length > 4) return jsonResponse({ error: `${c.name}: maximum 4 pages per competitor` }, 400);
        }
        await env.STATE.put("config:competitors", JSON.stringify(comps));
        await env.STATE.put("config:setup_complete", "true");
        return jsonResponse({ success: true, count: comps.length });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Save settings ──
    if (path === "/api/config/settings" && request.method === "POST") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      try {
        const body = await request.json();
        const settings = {
          slackWebhookUrl: body.slackWebhookUrl || null,
          productHuntToken: body.productHuntToken || null,
          productHuntTopics: body.productHuntTopics || [],
          announcementKeywords: body.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS,
          phMinVotes: body.phMinVotes ?? 0,
        };
        await env.STATE.put("config:settings", JSON.stringify(settings));
        return jsonResponse({ success: true });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Test Slack ──
    if (path === "/api/config/test-slack" && request.method === "POST") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
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
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      const config = await loadConfig(env);
      const alerts = await runMonitor(env, config);
      return jsonResponse({ success: true, alertsSent: alerts.length });
    }

    // ── Config API: Detect RSS ──
    if (path === "/api/config/detect-rss" && request.method === "POST") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      try {
        const body = await request.json();
        if (!body.url) return jsonResponse({ error: "url required" }, 400);
        const feedUrl = await detectRssFeed(body.url);
        return jsonResponse({ found: !!feedUrl, feedUrl });
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
