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
  scout:     { name: "Scout",     competitors: 3,  pages: 6,   scansPerDay: 0, historyDays: 30 },
  operator:  { name: "Operator",  competitors: 15, pages: 60,  scansPerDay: 2, historyDays: 365 },
  command:   { name: "Command",   competitors: 50, pages: 200, scansPerDay: 4, historyDays: -1 },
  // Legacy aliases (pre-migration user records may still reference old tier names)
  recon:     { name: "Scout",     competitors: 3,  pages: 6,   scansPerDay: 0, historyDays: 30 },
  strategic: { name: "Command",   competitors: 50, pages: 200, scansPerDay: 4, historyDays: -1 },
};

const FEATURE_GATES = {
  ai_discovery:       ["operator", "command", "strategic"],
  seed_discovery:     ["operator", "command", "strategic"],
  slash_scan:         ["operator", "command", "strategic"],
  slash_ads:          ["operator", "command", "strategic"],
  rss_monitoring:     ["operator", "command", "strategic"],
  scheduled_scans:    ["operator", "command", "strategic"],
  competitor_radar:   ["command", "strategic"],
  priority_scan_queue: ["command", "strategic"],
};

function getTierLimits(tier) {
  return TIERS[tier] || TIERS.scout;
}

function hasFeature(tier, feature) {
  const allowed = FEATURE_GATES[feature];
  return allowed ? allowed.includes(tier) : false;
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
      productHuntTopics: settings.productHuntTopics || [],
      announcementKeywords: settings.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS,
      phMinVotes: settings.phMinVotes ?? 0,
      radarSubreddits: settings.radarSubreddits || [],
      slackMinPriority: settings.slackMinPriority || "low",
      _productMeta: settings._productMeta || null,
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

// Subrequest tracking — Cloudflare Workers Standard plan allows 1000 per invocation.
// Reserve slots for Slack delivery at the end of each scan.
let _subrequestCount = 0;
const SUBREQUEST_LIMIT = 1000;
const SLACK_RESERVED = 5;

function resetSubrequestCounter() { _subrequestCount = 0; }
function canSubrequest() { return _subrequestCount < (SUBREQUEST_LIMIT - SLACK_RESERVED); }
function trackSubrequest() { _subrequestCount++; }

// SSRF protection — block private/reserved IPs and non-HTTP schemes
function isUrlSafe(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname;
    // Block private/reserved IP ranges and localhost
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.|169\.254\.|fc|fd|fe80|::1|localhost|0\.0\.0\.0)/i.test(host)) return false;
    // Block metadata endpoints
    if (host === "metadata.google.internal" || host === "169.254.169.254") return false;
    return true;
  } catch { return false; }
}

async function fetchUrl(url) {
  if (!canSubrequest()) { console.log(`  Skipped (subrequest budget: ${_subrequestCount}/${SUBREQUEST_LIMIT})`); return null; }
  if (!isUrlSafe(url)) { console.log(`  Blocked (SSRF protection): ${url}`); return null; }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    trackSubrequest();
    let response = await fetch(url, {
      headers: { "User-Agent": "Scopehound/3.0 (Competitive Intelligence)" },
      signal: controller.signal,
      redirect: "manual",
    });
    // Follow at most 1 redirect (saves subrequests vs automatic redirect chains)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.get("location");
      if (loc && canSubrequest()) {
        const redirectUrl = loc.startsWith("http") ? loc : new URL(loc, url).href;
        if (isUrlSafe(redirectUrl)) {
          trackSubrequest();
          response = await fetch(redirectUrl, {
            headers: { "User-Agent": "Scopehound/3.0 (Competitive Intelligence)" },
            signal: controller.signal,
            redirect: "manual",
          });
        }
      }
    }
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

// Claude API helper — works in Workers without any SDK
// ─── Workers AI (free, no subrequest cost) — used for daily scan analysis ───
async function callWorkersAI(env, prompt, { maxTokens = 500 } = {}) {
  if (!env.AI) return null;
  try {
    const result = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    const text = result?.response;
    if (!text) return null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (error) {
    console.log(`[Workers AI] ${error.message}`);
    return null;
  }
}

// ─── Claude API (paid, uses subrequest) — used only for competitor discovery ──
async function callClaude(env, prompt, { model = "claude-haiku-4-5-20251001", maxTokens = 1000, system } = {}) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey || !canSubrequest()) return null;
  trackSubrequest();
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = system;
  const response = await withTimeout(fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }), 30000);
  if (!response.ok) {
    console.log(`[Claude API] ${response.status}`);
    return null;
  }
  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) return null;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
}

async function extractPricingWithLLM(html, env) {
  if (!env.AI) return null;
  const text = htmlToText(html);
  try {
    return await callWorkersAI(env, `Extract all pricing information from this webpage text. Return a JSON object with this structure:
{"plans":[{"name":"Plan Name","price":"$X/mo or $X/year or Custom or Free","features":["key feature 1","key feature 2"]}],"notes":"Any important pricing notes like discounts, trials, etc."}
If no pricing is found, return {"plans":[],"notes":"No pricing found"}.
Only return valid JSON, no other text.
Webpage text:
${text}`);
  } catch (error) {
    console.log(`  AI pricing error: ${error.message}`);
    return null;
  }
}

async function analyzePageChange(env, competitorName, pageLabel, pageType, diff) {
  if (!env.AI) return null;
  if (diff.changeRatio > 0.8) {
    return {
      summary: "Page significantly redesigned",
      analysis: "The page content changed substantially, likely a full redesign or replatform.",
      priority: pageType === "pricing" ? "high" : "medium",
      recommendation: "Review the page manually to assess the changes.",
    };
  }
  try {
    return await callWorkersAI(env, `You are a competitive intelligence analyst. A competitor's web page has changed.
Competitor: ${competitorName}
Page: ${pageLabel}
REMOVED content: ${diff.beforeExcerpt || "(none)"}
ADDED content: ${diff.afterExcerpt || "(none)"}
Respond with ONLY valid JSON:
{"summary":"One sentence: what specifically changed","analysis":"2-3 sentences: why this matters competitively","priority":"high or medium or low","recommendation":"One sentence: what action to take"}
Priority guide: high = pricing/product changes, major positioning shifts. medium = feature updates, messaging changes. low = minor copy edits, date changes, trivial updates.
IMPORTANT: Focus on what ACTUALLY changed in the content above. If the removed/added content is trivial (dates, timestamps, minor formatting), set priority to "low" and keep analysis brief. Do NOT speculate about what a lack of changes might mean.
Return ONLY the JSON object.`, { maxTokens: 500 });
  } catch (error) {
    console.log(`  AI analysis error: ${error.message}`);
    return null;
  }
}

async function classifyAnnouncement(env, competitorName, postTitle, matchedCategory) {
  if (!env.AI) return { category: matchedCategory, priority: "medium", summary: postTitle };
  try {
    const result = await callWorkersAI(env, `Classify this blog post from competitor "${competitorName}".
Title: "${postTitle}"
Detected category: ${matchedCategory}
Respond with ONLY valid JSON:
{"category":"funding or partnership or acquisition or event or hiring or product or other","priority":"high or medium or low","summary":"One sentence explanation"}
Return ONLY the JSON object.`, { maxTokens: 200 });
    return result || { category: matchedCategory, priority: "medium", summary: postTitle };
  } catch (error) {
    return { category: matchedCategory, priority: "medium", summary: postTitle };
  }
}

// ─── AI COMPETITOR DISCOVERY ────────────────────────────────────────────────

async function searchDDG(query) {
  if (!canSubrequest()) return [];
  // Try DuckDuckGo HTML with browser-like UA
  try {
    trackSubrequest();
    const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
    });
    if (!r.ok) { console.log(`[Search] DDG HTTP ${r.status}`); return []; }
    const html = await r.text();
    // Extract structured results: title, URL, snippet
    const resultRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const titles = [];
    const urls = [];
    const snippets = [];
    let m;
    while ((m = resultRegex.exec(html)) !== null) {
      urls.push(m[1]);
      titles.push(m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    }
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    }
    if (titles.length > 0) {
      const results = [];
      for (let i = 0; i < Math.min(titles.length, 10); i++) {
        results.push({ title: titles[i] || "", url: urls[i] || "", snippet: snippets[i] || "" });
      }
      return results;
    }
    console.log(`[Search] DDG returned HTML but 0 results (likely blocked), trying DuckDuckGo lite...`);
  } catch (e) { console.log(`[Search] DDG error: ${e.message}`); }

  // Fallback: DuckDuckGo lite endpoint
  if (!canSubrequest()) return [];
  try {
    trackSubrequest();
    const r = await fetch("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
    });
    if (!r.ok) return [];
    const html = await r.text();
    const results = [];
    // Lite format uses table rows with class "result-link" or simple <a> tags
    const linkRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let lm;
    while ((lm = linkRegex.exec(html)) !== null && results.length < 10) {
      results.push({ title: lm[2].replace(/<[^>]+>/g, "").trim(), url: lm[1], snippet: "" });
    }
    // Also try extracting from td.result-snippet
    if (results.length === 0) {
      // Broader extraction: any link that looks like a result
      const broadRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const seen = new Set();
      while ((lm = broadRegex.exec(html)) !== null && results.length < 10) {
        const url = lm[1];
        const title = lm[2].replace(/<[^>]+>/g, "").trim();
        if (url.includes("duckduckgo.com") || !title || title.length < 5 || seen.has(url)) continue;
        seen.add(url);
        results.push({ title, url, snippet: "" });
      }
    }
    console.log(`[Search] DDG lite: ${results.length} results`);
    return results;
  } catch (e) { console.log(`[Search] DDG lite error: ${e.message}`); return []; }
}

// ─── BRAVE SEARCH API ─────────────────────────────────────────────────────────
async function braveSearch(env, query) {
  if (!env.BRAVE_SEARCH_API_KEY || !canSubrequest()) return [];
  trackSubrequest();
  try {
    const r = await withTimeout(fetch(
      "https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(query) + "&count=10",
      { headers: { "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY, Accept: "application/json" } }
    ), 10000);
    if (!r.ok) { console.log(`[Brave] HTTP ${r.status}`); return []; }
    const data = await r.json();
    return (data.web?.results || []).map(item => ({
      title: item.title || "",
      url: item.url || "",
      snippet: item.description || "",
    }));
  } catch (e) { console.log(`[Brave] Error: ${e.message}`); return []; }
}

function extractPageMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
  const metaDesc = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) || [])[1] || "";
  const ogDesc = (html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i) || [])[1] || "";
  const headings = [];
  const hRegex = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  let hMatch;
  while ((hMatch = hRegex.exec(html)) !== null && headings.length < 6) {
    const h = hMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (h.length > 3 && h.length < 200) headings.push(h);
  }
  return { title, metaDesc, ogDesc, headings };
}

function extractBodyText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
}

// Sites that should never be added as competitors (profile/social/review sites)
const SITE_BLOCKLIST = ["crunchbase.com", "g2.com", "linkedin.com", "twitter.com", "x.com", "facebook.com", "wikipedia.org", "youtube.com", "github.com", "producthunt.com", "trustpilot.com", "capterra.com", "getapp.com", "softwareadvice.com", "reddit.com", "quora.com", "medium.com", "forbes.com", "techcrunch.com"];
// Subset: sites with NO useful competitor mentions in search snippets (filter from search results)
// Reddit, Product Hunt, Medium, listicle sites are KEPT — they mention competitor names Claude can extract
const SEARCH_FILTER = ["linkedin.com", "twitter.com", "x.com", "facebook.com", "wikipedia.org", "youtube.com", "github.com", "trustpilot.com"];

async function discoverCompetitors(env, companyUrl, seedCompetitors) {
  // ── Step 1: Fetch and extract site content ──
  const html = await fetchUrl(companyUrl);
  if (!html) throw new Error("Could not fetch your website. Check the URL and try again.");
  const meta = extractPageMeta(html);
  const bodyText = extractBodyText(html);
  const domain = new URL(companyUrl).hostname.replace(/^www\./, "");

  // Try fetching /pricing or /features for richer context (max 2 extra pages)
  const extraContent = [];
  for (const subpath of ["/pricing", "/features"]) {
    try {
      const extraHtml = await fetchUrl(`https://${domain}${subpath}`);
      if (extraHtml && extraHtml.length > 500) {
        extraContent.push(extractBodyText(extraHtml).slice(0, 1500));
      }
    } catch {}
  }

  const siteContent = [
    meta.title && `Page title: ${meta.title}`,
    meta.metaDesc && `Meta description: ${meta.metaDesc}`,
    meta.ogDesc && meta.ogDesc !== meta.metaDesc && `OG description: ${meta.ogDesc}`,
    meta.headings.length && `Key headings: ${meta.headings.join(" | ")}`,
    `\nHomepage content:\n${bodyText}`,
    ...extraContent.map((c, i) => `\n${i === 0 ? "Pricing" : "Features"} page content:\n${c}`),
  ].filter(Boolean).join("\n");

  // ── Step 2: LLM call — extract product metadata ──
  const metadataPrompt = `Analyze the following website content and extract:

1. product_name: The name of the product or service
2. category: The broad software/service category (e.g. "affiliate marketing platform", "project management tool", "CRM")
3. subcategory: A more specific niche if applicable
4. value_props: An array of 3-5 core value propositions, each as a short phrase
5. target_audience: Who this product is for
6. keywords: An array of 5-10 keywords/phrases a potential customer might search when looking for this type of tool

Respond in JSON only. No markdown, no preamble.

---

SITE CONTENT:
${siteContent.slice(0, 4000)}`;

  let productMeta;
  try {
    productMeta = await callClaude(env, metadataPrompt, { maxTokens: 800 });
    console.log(`[Discovery] Step 2 metadata: ${productMeta ? "ok" : "null (API key missing or call failed)"}`);
  } catch (e) { console.log(`[Discovery] Step 2 error: ${e.message}`); productMeta = null; }

  // Fallback if metadata extraction fails
  if (!productMeta || !productMeta.product_name) {
    productMeta = {
      product_name: meta.title.split(/[|\-–—]/)[0].trim() || domain.split(".")[0],
      category: "software",
      subcategory: "",
      value_props: meta.headings.slice(0, 3),
      target_audience: "",
      keywords: [domain.split(".")[0]],
    };
  }

  // ── Step 3: Generate search queries from metadata ──
  const seeds = (seedCompetitors || []).filter(Boolean);
  const seedDomains = seeds.map(s => {
    try { return new URL(s.startsWith("http") ? s : "https://" + s).hostname.replace(/^www\./, ""); } catch { return s; }
  });
  const allDomains = [domain, ...seedDomains];

  // Prioritize value-prop and category queries, plus Reddit/PH/listicle sources
  const keywords = productMeta.keywords || [];
  const searchQueries = [
    `best ${productMeta.subcategory || productMeta.category} software ${new Date().getFullYear()}`,
    (productMeta.value_props || []).slice(0, 3).join(" ") + " tool",
    `"${productMeta.product_name}" ${productMeta.category} competitors alternatives`,
    `site:reddit.com ${productMeta.subcategory || productMeta.category} tools recommendations`,
    `site:producthunt.com ${productMeta.subcategory || productMeta.category}`,
    keywords.slice(0, 2).join(" ") + " alternatives",
  ];
  // Add seed-based queries
  for (const sd of seedDomains.slice(0, 2)) {
    searchQueries.push(`${sd} alternatives competitors`);
  }

  // ── Step 4: Run searches (up to 6 queries) ──
  const allSearchResults = [];
  for (const q of searchQueries.slice(0, 6)) {
    const results = await searchDDG(q);
    console.log(`[Discovery] Step 4 search "${q.slice(0, 60)}": ${results.length} results`);
    allSearchResults.push(...results);
  }

  // Deduplicate search results by URL domain
  const seenDomains = new Set();
  const dedupedResults = allSearchResults.filter(r => {
    try {
      const d = new URL(r.url).hostname.replace(/^www\./, "");
      if (seenDomains.has(d) || SEARCH_FILTER.some(b => d.includes(b)) || allDomains.includes(d)) return false;
      seenDomains.add(d);
      return true;
    } catch { return true; } // Keep results without parseable URLs
  });

  console.log(`[Discovery] Step 4 total: ${allSearchResults.length} raw, ${dedupedResults.length} deduped`);

  // Format search results for LLM
  const searchContext = dedupedResults.slice(0, 20).map((r, i) =>
    `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
  ).join("\n\n");

  // ── Step 5: LLM call — analyze competitors ──
  const seedSection = seedDomains.length > 0
    ? `\nKnown competitors (user-provided): ${seedDomains.join(", ")}\nFind MORE companies like these.\n`
    : "";

  const hasSearchResults = dedupedResults.length > 0;

  // Build a detailed product fingerprint for better matching
  const productFingerprint = `
- Name: ${productMeta.product_name}
- Domain: ${domain}
- Category: ${productMeta.category}
- Specific niche: ${productMeta.subcategory || productMeta.category}
- Core capabilities: ${(productMeta.value_props || []).join("; ")}
- Target customer: ${productMeta.target_audience || "not specified"}
- Keywords: ${(productMeta.keywords || []).join(", ")}`;

  const matchScoreInstructions = `
## Match Scoring (CRITICAL)
For each competitor, calculate a match_score from 0-100 based on these weighted dimensions:
- Same core use case / job-to-be-done (40 points): Do they solve the exact same problem?
- Same target customer (25 points): Do they sell to the same buyer persona / company size?
- Similar business model (15 points): SaaS vs marketplace vs agency, pricing range, self-serve vs enterprise
- Feature overlap (10 points): Do they have similar feature sets?
- Similar company stage/size (10 points): Startup vs growth vs enterprise incumbent

A direct niche competitor solving the same problem for the same customer = 80-95%.
A broader platform that includes this as a sub-feature = 30-50%.
An adjacent tool in a related space = 40-65%.

Sort the results by match_score descending (highest match first).`;

  const analysisPrompt = hasSearchResults
    ? `You are a competitive intelligence analyst. From the search results below, extract every company/product that competes with the target product.

## Target Product
${productFingerprint}
${seedSection}
${matchScoreInstructions}

## Search Results
${searchContext}

## Instructions
List every competing product mentioned in the search results. For each:
- name: Product name
- url: Homepage URL (https://)
- reason: What they do and why they compete (one sentence)
- overlap: "direct" | "adjacent" | "broader_platform"
- match_score: 0-100 (see scoring above)

Rules:
- Extract ALL products from the results — especially smaller/niche tools
- Enterprise giants = "broader_platform", usually match_score 30-50
- Do NOT include: ${allDomains.join(", ")}
- Do NOT include review sites (G2, Capterra, etc.)
- Do NOT invent companies not in the results
- Max 15, sorted by match_score descending

JSON only:
{"industry":"${productMeta.category}","market_summary":"2-3 sentences","competitors":[{"name":"","url":"","reason":"","overlap":"","match_score":0}]}`
    : `You are a competitive intelligence analyst. Based on your knowledge, identify the top competitors for this product.

## Target Product
${productFingerprint}
${seedSection}
## Website Content (excerpt)
${siteContent.slice(0, 2000)}

${matchScoreInstructions}

## Instructions
Identify the top competitors based on your knowledge. Think step by step:
1. What is the SPECIFIC job-to-be-done this product solves? (not the broad category)
2. Who are the small, niche startups solving that exact same problem?
3. Who are the adjacent tools that overlap significantly?
4. Who are the broader platforms that include this as a feature?

For each competitor provide:
- name: Product name
- url: Homepage URL (https://) — use the real URL you know
- reason: What they do and specifically why they compete with this product (one sentence)
- overlap: "direct" | "adjacent" | "broader_platform"
- match_score: 0-100 (see scoring above)

Rules:
- Only include REAL companies with REAL URLs — do not make up companies or URLs
- Start with the closest niche competitors (match_score 80+), then work outward
- Prioritize startups and indie tools that solve the EXACT same problem over big platforms
- Think about AI-native tools, newer entrants, and bootstrapped competitors
- Do NOT include: ${allDomains.join(", ")}
- Max 15, sorted by match_score descending

JSON only:
{"industry":"${productMeta.category}","market_summary":"2-3 sentences about this competitive landscape","competitors":[{"name":"","url":"","reason":"","overlap":"","match_score":0}]}`;

  let parsed;
  try {
    parsed = await callClaude(env, analysisPrompt, { model: "claude-sonnet-4-5-20250929", maxTokens: 2000 });
    console.log(`[Discovery] Step 5 analysis: ${parsed ? parsed.competitors?.length + " competitors" : "null (API key missing or call failed)"}`);
  } catch (e) {
    console.log(`[Discovery] Step 5 error: ${e.message}`);
    return { industry: productMeta.category, competitors: [], market_summary: "" };
  }
  if (!parsed) return { industry: productMeta.category, competitors: [], market_summary: "", _debug: "claude_returned_null" };

  // Post-process: filter out blocklisted domains, self-references, and invalid URLs
  parsed.competitors = (parsed.competitors || []).filter(c => {
    if (!c.name || !c.url) return false;
    try {
      const u = new URL(c.url);
      const d = u.hostname.replace(/^www\./, "");
      if (SITE_BLOCKLIST.some(b => d.includes(b))) return false;
      if (allDomains.includes(d)) return false;
      return true;
    } catch { return false; }
  });

  // Sort by match_score descending (highest match first)
  if (parsed.competitors) {
    parsed.competitors.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
  }

  // Ensure the response has the fields the UI expects
  parsed.industry = parsed.industry || productMeta.category;
  parsed.market_summary = parsed.market_summary || "";
  parsed._productMeta = { name: productMeta.product_name, category: productMeta.category, subcategory: productMeta.subcategory };
  parsed._debug = { searchResults: allSearchResults.length, deduped: dedupedResults.length, hasApiKey: !!env.ANTHROPIC_API_KEY };

  return parsed;
}

// ─── COMPETITOR RADAR: REDDIT RSS ────────────────────────────────────────────

async function suggestSubreddits(env, productMeta) {
  const prompt = `Based on this product, suggest 3-5 Reddit subreddits where competitors or alternative tools are most likely to be discussed.

Product: ${productMeta.product_name}
Category: ${productMeta.category}
Niche: ${productMeta.subcategory || productMeta.category}
Keywords: ${(productMeta.keywords || []).join(", ")}
Audience: ${productMeta.target_audience || "not specified"}

Rules:
- Only suggest REAL subreddits that actually exist on Reddit
- Prioritize active subreddits where people ask "what tools do you use for X?" or share tool recommendations
- Include both broad category subs and niche-specific subs
- Do NOT suggest generic subs like r/technology or r/startups unless highly relevant

JSON only:
{"subreddits":[{"name":"subredditname","reason":"Why this sub is relevant (one sentence)"}]}`;

  try {
    return await callClaude(env, prompt, { maxTokens: 500 });
  } catch { return null; }
}

async function fetchRedditRSS(subreddit) {
  if (!canSubrequest()) return [];
  try {
    trackSubrequest();
    const r = await fetch(`https://www.reddit.com/r/${subreddit}/new.json?limit=25`, {
      headers: { "User-Agent": "ScopeHound/1.0 competitive-intel-bot" },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.data?.children || []).map(c => ({
      id: c.data.id,
      title: c.data.title,
      selftext: (c.data.selftext || "").slice(0, 500),
      url: `https://reddit.com${c.data.permalink}`,
      author: c.data.author,
      created: c.data.created_utc,
      score: c.data.score,
    }));
  } catch { return []; }
}

async function radarScanReddit(env, settings, state, productMeta, existingCompetitors) {
  const subs = settings.radarSubreddits || [];
  if (subs.length === 0) return [];
  const keywords = (productMeta?.keywords || []).concat([
    productMeta?.category, productMeta?.subcategory,
  ]).filter(Boolean).map(k => k.toLowerCase());
  if (keywords.length === 0) return [];

  const radarState = state.radar || { seenPostIds: [] };
  const seenIds = new Set(radarState.seenPostIds || []);
  const existingDomains = existingCompetitors.map(c => {
    try { return new URL(c.website.startsWith("http") ? c.website : "https://" + c.website).hostname.replace(/^www\./, ""); } catch { return ""; }
  }).filter(Boolean);

  const newPosts = [];
  for (const sub of subs) {
    const subName = typeof sub === "string" ? sub : sub.name;
    console.log(`  Radar: r/${subName}...`);
    const posts = await fetchRedditRSS(subName);
    for (const p of posts) {
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      // Keyword match on title + body
      const text = (p.title + " " + p.selftext).toLowerCase();
      if (keywords.some(k => text.includes(k))) {
        newPosts.push({ ...p, subreddit: subName });
      }
    }
  }

  // Update seen IDs (keep last 500 to avoid unbounded growth)
  state.radar = { seenPostIds: [...seenIds].slice(-500) };

  if (newPosts.length === 0) return [];

  // Use Claude to extract actual competitor mentions from matched posts
  const postSummaries = newPosts.slice(0, 10).map((p, i) =>
    `${i + 1}. [r/${p.subreddit}] "${p.title}"\n   ${p.selftext.slice(0, 200)}\n   ${p.url}`
  ).join("\n\n");

  try {
    const result = await callClaude(env, `You are a competitive intelligence analyst. These Reddit posts were flagged as relevant to ${productMeta.product_name} (${productMeta.subcategory || productMeta.category}).

Extract any competitor products or tools mentioned in these posts that compete with ${productMeta.product_name}.

## Posts
${postSummaries}

## Already Monitoring
${existingDomains.join(", ") || "(none)"}

## Instructions
- Only extract REAL products/tools with identifiable names and URLs
- Skip posts that are just general discussion with no specific tools mentioned
- Skip any products already in the "Already Monitoring" list
- For each competitor, include which post mentioned it

JSON only:
{"competitors":[{"name":"","url":"","reason":"Why it competes","source_post":"Post title","subreddit":"","match_score":0}]}
If no competitors found, return: {"competitors":[]}`, { maxTokens: 1000 });

    return (result?.competitors || []).filter(c => c.name && c.url);
  } catch { return []; }
}

function formatRadarAlert(radarFinds) {
  let text = `🔭 *Competitor Radar* — ${radarFinds.length} new competitor${radarFinds.length > 1 ? "s" : ""} spotted\n`;
  for (const c of radarFinds) {
    const score = c.match_score ? ` · ${c.match_score}% match` : "";
    text += `\n>*${c.name}* (${c.url})${score}\n>${c.reason}\n>_Found in r/${c.subreddit}: "${c.source_post}"_\n`;
  }
  text += `\n_Add these via /setup or reply with_ \`/scopehound add <url>\``;
  return text;
}

// ─── WEEKLY COMPETITOR SUGGESTIONS (Sonnet, runs every Friday) ───────────────

async function suggestNewCompetitors(env, productMeta, existingCompetitors, previousSuggestions) {
  if (!productMeta || !(productMeta.product_name || productMeta.name)) return null;

  const existingNames = existingCompetitors.map(c => c.name.toLowerCase());
  const existingDomains = existingCompetitors.map(c => {
    try { return new URL(c.website.startsWith("http") ? c.website : "https://" + c.website).hostname.replace(/^www\./, ""); }
    catch { return ""; }
  }).filter(Boolean);
  const previousNames = (previousSuggestions || []).map(s => s.toLowerCase());
  const allExcluded = [...new Set([...existingNames, ...existingDomains, ...previousNames])];

  const result = await callClaude(env,
    `You are a competitive intelligence analyst. Suggest 5 real companies that compete with this product.

## Target Product
- Name: ${productMeta.product_name || productMeta.name}
- Category: ${productMeta.category}
- Niche: ${productMeta.subcategory || productMeta.category}
- Keywords: ${(productMeta.keywords || []).join(", ")}
- Target customer: ${productMeta.target_audience || "not specified"}

## Already Known (do NOT suggest these)
${allExcluded.join(", ") || "(none)"}

## Instructions
- Suggest 5 REAL companies/products that compete with ${productMeta.product_name || productMeta.name}
- Include their actual website URL (must be a real, working domain)
- Include a one-sentence description of what the company does
- Prioritize niche direct competitors and newer/bootstrapped players — not just big incumbents
- Include companies you'd find discussed on Reddit, Product Hunt, Hacker News, or niche forums
- Do NOT include any company from the "Already Known" list
- Do NOT include generic platforms (AWS, Google Cloud) unless they have a directly competing product

Return JSON only:
{"suggestions":[{"name":"Company Name","url":"https://example.com","description":"One sentence describing what they do","overlap":"direct or adjacent or broader"}]}
If you cannot think of any real competitors, return: {"suggestions":[]}`,
    { model: "claude-sonnet-4-5-20250929", maxTokens: 800 }
  );

  if (!result?.suggestions) return null;

  // Post-filter: remove any that match existing competitors
  const filtered = result.suggestions.filter(s => {
    const lowerName = s.name.toLowerCase();
    let domain = "";
    try { domain = new URL(s.url).hostname.replace(/^www\./, ""); } catch {}
    return !allExcluded.some(ex => lowerName.includes(ex) || ex.includes(lowerName) || (domain && ex === domain));
  });

  return filtered.slice(0, 5);
}

// ─── DEEP COMPETITOR DISCOVERY (1st Friday of month, Brave Search + Sonnet) ──

// Helper: extract registrable domain (strips subdomains except known platforms)
const PLATFORM_SUFFIXES = ["github.io", "netlify.app", "vercel.app", "herokuapp.com", "pages.dev", "workers.dev", "fly.dev"];
function getRegistrableDomain(hostname) {
  const h = hostname.replace(/^www\./, "");
  if (PLATFORM_SUFFIXES.some(s => h.endsWith(s))) return h;
  const parts = h.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : h;
}

async function enrichProductMeta(env, productMeta, productUrl) {
  if (!productMeta || !(productMeta.product_name || productMeta.name)) return productMeta;

  // Fetch homepage live
  let pageTitle = "";
  let pageMetaDesc = "";
  let homepageContext = "";
  if (productUrl) {
    const html = await fetchUrl(productUrl);
    if (html && html.length > 200) {
      const meta = extractPageMeta(html);
      pageTitle = meta.title;
      pageMetaDesc = meta.metaDesc;
      // Diff check: if title + meta desc unchanged, reuse cached enrichment
      if (productMeta.adjacent_categories &&
          productMeta._lastTitle === pageTitle &&
          productMeta._lastMetaDesc === pageMetaDesc) {
        console.log("[Enrich] Site unchanged, reusing cached enrichment");
        return productMeta;
      }
      homepageContext = [
        meta.title && `Page title: ${meta.title}`,
        meta.metaDesc && `Meta description: ${meta.metaDesc}`,
        meta.ogDesc && `OG description: ${meta.ogDesc}`,
        meta.headings.length && `Key headings: ${meta.headings.join(" | ")}`,
        `\nHomepage excerpt:\n${extractBodyText(html).slice(0, 2000)}`,
      ].filter(Boolean).join("\n");
    } else {
      console.log("[Enrich] Homepage fetch failed or too short, falling back to cached data");
      if (productMeta.adjacent_categories) return productMeta;
    }
  }

  // Sonnet call: product decomposition
  const productName = productMeta.product_name || productMeta.name;
  const prompt = `You are a product analyst. Decompose this product into its functional building blocks.

## Product
- Name: ${productName}
- Category: ${productMeta.category || "unknown"}
- Subcategory: ${productMeta.subcategory || productMeta.category || "unknown"}
${homepageContext ? `\n## Homepage Content\n${homepageContext}` : ""}

Return a JSON object with these fields:
{
  "adjacent_categories": ["related categories a competitor might use instead — e.g. if this is 'affiliate marketing', include 'influencer platform', 'creator outreach', 'partnership automation'. Be expansive — 5-8 labels"],
  "core_workflow": ["step 1 the user takes", "step 2", "step 3", "step 4"],
  "delivery_model": "self-serve SaaS | managed service | marketplace | API | hybrid",
  "partner_types": ["affiliates", "influencers", "creators", etc.],
  "category_labels": ["how they describe themselves — e.g. 'affiliate marketing platform'"]
}

IMPORTANT: The "adjacent_categories" field is critical. Think about what OTHER labels a product with the same core workflow might use. A tool that automates partner outreach might call itself an affiliate recruitment tool, an influencer marketing platform, a creator partnership platform, an AI outreach agent, or a partner discovery tool. Be expansive.

Return JSON only, no markdown.`;

  const result = await callClaude(env, prompt, { model: "claude-sonnet-4-5-20250929", maxTokens: 600 });
  if (!result) {
    console.log("[Enrich] Sonnet call failed, keeping existing productMeta");
    return productMeta;
  }

  // Merge enriched fields into existing productMeta
  const enriched = {
    ...productMeta,
    adjacent_categories: result.adjacent_categories || [],
    core_workflow: result.core_workflow || [],
    delivery_model: result.delivery_model || "",
    partner_types: result.partner_types || [],
    category_labels: result.category_labels || [],
    _lastTitle: pageTitle,
    _lastMetaDesc: pageMetaDesc,
    _lastEnriched: new Date().toISOString(),
  };
  console.log(`[Enrich] Product decomposed: ${(enriched.adjacent_categories || []).length} adjacent categories, ${(enriched.core_workflow || []).length} workflow steps`);
  return enriched;
}

async function deepCompetitorDiscovery(env, productMeta, existingCompetitors, previousSuggestions) {
  const productName = productMeta.product_name || productMeta.name;
  if (!productName) return null;

  // ── a) Build exclusion list ──
  const existingNames = existingCompetitors.map(c => c.name.toLowerCase());
  const existingDomains = existingCompetitors.map(c => {
    try { return getRegistrableDomain(new URL(c.website.startsWith("http") ? c.website : "https://" + c.website).hostname); }
    catch { return ""; }
  }).filter(Boolean);
  const previousNames = (previousSuggestions || []).map(s => s.toLowerCase());
  const allExcluded = [...new Set([...existingNames, ...existingDomains, ...previousNames])];

  // ── b) Sonnet call #1: Generate 15 search queries ──
  const landscapeContext = existingCompetitors.slice(0, 10).map(c => c.name).join(", ");
  const adjacentCats = (productMeta.adjacent_categories || []).join(", ");
  const coreWorkflow = (productMeta.core_workflow || []).join(" → ");
  const categoryLabels = (productMeta.category_labels || [productMeta.category]).join(", ");
  const partnerTypes = (productMeta.partner_types || []).join(", ");

  const queryResult = await callClaude(env,
    `You are a competitive intelligence researcher. Generate search queries to find competitors — especially smaller, adjacent, or differently-labeled ones.

## Target Product
- Name: ${productName}
- Category: ${productMeta.category || "unknown"}
- Adjacent categories: ${adjacentCats || "unknown"}
- Core workflow: ${coreWorkflow || "unknown"}
- Partner types: ${partnerTypes || "unknown"}
- Known competitors: ${landscapeContext || "(none)"}

Generate exactly 15 search queries across these 5 categories (3 each):

A. Direct category searches — using category labels and adjacent categories
B. Workflow-match searches — describe WHAT the product does functionally, no category labels
C. Startup discovery searches — target Product Hunt, "[competitor] alternatives", "best new [category] startups 2025 2026"
D. Buyer-perspective searches — what a potential buyer would search
E. Anti-incumbent searches — "[big player] alternative for [smaller use case]"

RULES:
- Keep queries short: 2-6 words perform best
- Every query must be meaningfully different
- Prioritize queries that surface STARTUPS and SMALL TOOLS
- Include at least 2 queries that don't use any standard category term
- Do not use quotes or boolean operators except in category C (site: is OK)

Return JSON only, no markdown:
{"queries":[{"query":"the search query","category":"A|B|C|D|E"}]}`,
    { model: "claude-sonnet-4-5-20250929", maxTokens: 800 }
  );

  if (!queryResult?.queries || queryResult.queries.length === 0) {
    console.log("[Deep] Query generation failed, aborting");
    return null;
  }
  console.log(`[Deep] Generated ${queryResult.queries.length} search queries`);

  // ── c) Execute searches via Brave API ──
  const allSearchResults = [];
  for (const q of queryResult.queries.slice(0, 15)) {
    if (!canSubrequest()) { console.log("[Deep] Subrequest budget low, stopping searches"); break; }
    const results = await braveSearch(env, q.query);
    for (const r of results) {
      r._queryCategory = q.category;
    }
    allSearchResults.push(...results);
  }
  console.log(`[Deep] Search returned ${allSearchResults.length} raw results`);

  // ── d) JS dedup + filter ──
  const seenDomains = new Set();
  const keywordPool = [
    ...(productMeta.category_labels || [productMeta.category]),
    ...(productMeta.adjacent_categories || []),
    ...(productMeta.keywords || []),
  ].map(k => k.toLowerCase()).filter(Boolean);

  const dedupedCandidates = allSearchResults.filter(r => {
    try {
      const hostname = new URL(r.url).hostname.replace(/^www\./, "");
      const regDomain = getRegistrableDomain(hostname);
      if (seenDomains.has(regDomain)) return false;
      if (SEARCH_FILTER.some(b => hostname.includes(b))) return false;
      if (allExcluded.some(ex => regDomain === ex || regDomain.includes(ex))) return false;
      seenDomains.add(regDomain);
      return true;
    } catch { return false; }
  });

  // Pre-filter: check keyword overlap in snippet (drop zero-overlap candidates)
  const filteredCandidates = dedupedCandidates.filter(r => {
    if (keywordPool.length === 0) return true;
    const snippetLower = (r.title + " " + r.snippet).toLowerCase();
    return keywordPool.some(kw => snippetLower.includes(kw));
  }).slice(0, 15);

  console.log(`[Deep] After dedup + keyword filter: ${filteredCandidates.length} candidates (from ${dedupedCandidates.length} deduped)`);
  if (filteredCandidates.length === 0) return null;

  // ── e) Fetch top 10 candidate homepages in parallel ──
  const toFetch = filteredCandidates.slice(0, 10);
  const fetchPromises = toFetch.map(c => fetchUrl(c.url).catch(() => null));
  const fetchResults = await Promise.allSettled(fetchPromises);

  for (let i = 0; i < toFetch.length; i++) {
    const result = fetchResults[i];
    if (result.status === "fulfilled" && result.value) {
      const bodyText = extractBodyText(result.value).slice(0, 800);
      toFetch[i]._homepageText = bodyText.length >= 100 ? bodyText : null;
    }
    // Fallback: if homepage text is empty/short, use Brave snippet
    if (!toFetch[i]._homepageText) {
      toFetch[i]._homepageText = null; // will use snippet in prompt
    }
  }

  // ── f) Sonnet call #2: Score + rank candidates ──
  const candidateDescriptions = toFetch.map((c, i) => {
    const context = c._homepageText || `(Homepage unavailable. Search snippet: ${c.snippet})`;
    const discoveryLabel = { A: "direct search", B: "workflow match", C: "startup discovery", D: "buyer search", E: "anti-incumbent" };
    return `${i + 1}. ${c.title}\n   URL: ${c.url}\n   Found via: ${discoveryLabel[c._queryCategory] || "search"}\n   Context: ${context}`;
  }).join("\n\n");

  const scoringResult = await callClaude(env,
    `You are a competitive analyst. Score each candidate product on how much they compete with the target.

## Target Product
- Name: ${productName}
- Category: ${categoryLabels}
- Core workflow: ${coreWorkflow}
- Partner types: ${partnerTypes}
- Target customer: ${productMeta.target_audience || "not specified"}

## Candidates
${candidateDescriptions}

## Scoring (0-3 each, max 18)
1. workflow_overlap: Same core workflow automated? (3=both discovery+outreach, 0=different workflow)
2. ai_depth: AI as core differentiator? (3=AI-first, 0=manual tool)
3. buyer_overlap: Same buyer persona? (3=same persona+size, 0=different buyer)
4. partner_type_overlap: Same partner types? (3=same, 0=different ecosystem)
5. price_scale_match: Similar pricing/scale? (3=similar, 0=completely different tier)
6. substitutability: Could a buyer choose this INSTEAD? (3=direct substitute, 0=not a substitute)

## Classification
- direct (14-18): Nearly identical value prop and buyer
- adjacent (9-13): Overlapping workflow, different angle or category label
- tangential (5-8): Related space, weak substitutability
- not_competitor (0-4): Different product, exclude

IMPORTANT: "Adjacent" competitors (9-13) are the MOST VALUABLE output. Do NOT penalize for using a different category label.

Return JSON only, no markdown:
{"candidates":[{"name":"Product Name","url":"https://...","total_score":0,"competitor_type":"direct|adjacent|tangential|not_competitor","description":"What they do, one sentence","differentiator":"How they differ from ${productName}, one sentence","discovery_method":"direct search|workflow match|startup discovery|buyer search|anti-incumbent"}]}`,
    { model: "claude-sonnet-4-5-20250929", maxTokens: 1500 }
  );

  if (!scoringResult?.candidates) {
    console.log("[Deep] Scoring failed");
    return null;
  }

  // ── g) Post-filter + return ──
  const scored = scoringResult.candidates.filter(c => {
    if (!c.name || !c.url || c.total_score < 9) return false;
    const lowerName = c.name.toLowerCase();
    let domain = "";
    try { domain = getRegistrableDomain(new URL(c.url).hostname); } catch {}
    return !allExcluded.some(ex => lowerName.includes(ex) || ex.includes(lowerName) || (domain && ex === domain));
  });

  scored.sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
  const topResults = scored.slice(0, 5).map(c => ({
    name: c.name,
    url: c.url,
    description: c.description || "",
    overlap: c.competitor_type === "direct" ? "direct" : c.competitor_type === "adjacent" ? "adjacent" : "broader",
    score: c.total_score,
    differentiator: c.differentiator || "",
    discovery_method: c.discovery_method || "",
  }));

  console.log(`[Deep] Final: ${topResults.length} competitors (from ${scoringResult.candidates.length} scored)`);
  return topResults.length > 0 ? topResults : null;
}

function formatWeeklySuggestions(suggestions, productMeta, tier) {
  const productName = productMeta.product_name || productMeta.name || "your product";
  const overlapEmoji = { direct: "\u{1F534}", adjacent: "\u{1F7E1}", broader: "\u{1F535}" };
  let text = `\u{1F50D} *Weekly Competitor Discovery*\n_New competitors to consider for ${productName}_\n`;
  for (const s of suggestions) {
    const emoji = overlapEmoji[s.overlap] || "\u{1F7E1}";
    let domain = "";
    try { domain = new URL(s.url).hostname.replace(/^www\./, ""); } catch { domain = s.url; }
    text += `\n>${emoji} *${s.name}* \u2014 ${domain}\n>${s.description}`;
    if (s.differentiator) text += `\n>_${s.differentiator}_`;
    if (s.discovery_method) text += `\n>_(found via ${s.discovery_method})_`;
    text += `\n>\`/scopehound add ${s.url}\`\n`;
  }
  if (tier === "scout" || tier === "recon") {
    text += `\n_\u2B50 Upgrade to Operator for daily automated monitoring \u2192 /billing_\n`;
  }
  text += `\n_Suggestions powered by AI_`;
  return text;
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
  if (!analysis?.summary) {
    if (diff?.beforeExcerpt) lines.push(`\n_Before:_ ${diff.beforeExcerpt}`);
    if (diff?.afterExcerpt) lines.push(`_After:_ ${diff.afterExcerpt}`);
  }
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
  return `🐺 *ScopeHound Daily Report* — ${date}\n\n${alerts.length} change(s) detected: ${parts.join(", ")}`;
}

// ─── SLACK NOTIFICATION ─────────────────────────────────────────────────────

async function sendSlack(webhookUrl, message) {
  if (!webhookUrl) { console.log(`[SLACK skip] ${message.slice(0, 80)}`); return { ok: false, error: "no_webhook_url" }; }
  if (!isUrlSafe(webhookUrl)) { return { ok: false, error: "invalid_webhook_url" }; }
  try {
    trackSubrequest();
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!r.ok) { console.log(`[SLACK ERROR] ${r.status}`); return { ok: false, error: `slack_http_${r.status}` }; }
    return { ok: true };
  } catch (e) { console.log(`[SLACK ERROR] ${e.message}`); return { ok: false, error: e.message }; }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout after " + ms + "ms")), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

// ─── PRODUCT HUNT (public page scraping — no API token needed) ──────────────

async function fetchProductHuntPosts(topicSlug) {
  const html = await fetchUrl(`https://www.producthunt.com/topics/${topicSlug}`);
  if (!html) return [];
  try {
    // PH is a Next.js app — extract __NEXT_DATA__ JSON for structured product data
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      const nextData = JSON.parse(nextDataMatch[1]);
      // Navigate the Next.js page props to find posts
      const posts = extractPHPostsFromNextData(nextData);
      if (posts.length > 0) return posts;
    }
    // Fallback: extract from HTML links + text
    return extractPHPostsFromHTML(html);
  } catch (e) { console.log(`  PH parse error: ${e.message}`); return extractPHPostsFromHTML(html); }
}

function extractPHPostsFromNextData(nextData) {
  const posts = [];
  try {
    // Traverse the Next.js data tree to find product nodes
    const json = JSON.stringify(nextData);
    // Look for product-like objects with name, tagline, url patterns
    const postRegex = /"name"\s*:\s*"([^"]+)"[^}]*"tagline"\s*:\s*"([^"]+)"[^}]*"slug"\s*:\s*"([^"]+)"/g;
    let m;
    const seen = new Set();
    while ((m = postRegex.exec(json)) !== null && posts.length < 20) {
      const name = m[1], tagline = m[2], slug = m[3];
      if (seen.has(slug) || name.length < 2 || tagline.length < 5) continue;
      seen.add(slug);
      // Extract votesCount near this match if available
      const ctx = json.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200);
      const votesMatch = ctx.match(/"votesCount"\s*:\s*(\d+)/);
      posts.push({
        id: slug, name, tagline,
        url: `https://www.producthunt.com/posts/${slug}`,
        votesCount: votesMatch ? parseInt(votesMatch[1]) : 0,
      });
    }
  } catch {}
  return posts;
}

function extractPHPostsFromHTML(html) {
  const posts = [];
  const seen = new Set();
  // Match links to /posts/slug with nearby text
  const linkRegex = /<a[^>]*href=["']\/posts\/([^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRegex.exec(html)) !== null && posts.length < 20) {
    const slug = m[1];
    if (seen.has(slug) || slug.includes("/")) continue;
    seen.add(slug);
    const name = m[2].replace(/<[^>]+>/g, "").trim();
    if (name.length < 2 || name.length > 100) continue;
    posts.push({
      id: slug, name, tagline: "",
      url: `https://www.producthunt.com/posts/${slug}`,
      votesCount: 0,
    });
  }
  return posts;
}

async function suggestPHTopics(env, productMeta) {
  const prompt = `Based on this product, suggest 3-5 Product Hunt topic slugs where competitors or similar tools would be listed.

Product: ${productMeta.product_name || productMeta.name || "unknown"}
Category: ${productMeta.category}
Niche: ${productMeta.subcategory || productMeta.category}
Keywords: ${(productMeta.keywords || []).join(", ")}
Audience: ${productMeta.target_audience || "not specified"}

Rules:
- Only suggest REAL Product Hunt topic slugs (lowercase, hyphenated, e.g. "affiliate-marketing", "developer-tools", "email-marketing")
- Check that the slug matches PH's actual topic taxonomy
- Prioritize topics where competing products would be launched
- Include both broad and niche-specific topics

JSON only:
{"topics":[{"slug":"topic-slug","name":"Human Readable Name","reason":"Why this topic is relevant (one sentence)"}]}`;

  try {
    return await callClaude(env, prompt, { maxTokens: 500 });
  } catch { return null; }
}

// ─── AD LIBRARY LOOKUP ──────────────────────────────────────────────────────

async function fetchMetaAds(domain, companyName, metaToken, env) {
  // Check cache first (6 hour TTL)
  const cacheKey = "ads:meta:" + (domain || companyName);
  const cached = await env.STATE.get(cacheKey);
  if (cached) return JSON.parse(cached);

  if (!metaToken || !canSubrequest()) return null;
  trackSubrequest();

  // Search Meta Ad Library by company name
  const searchName = companyName || domain.split(".")[0];
  const params = new URLSearchParams({
    access_token: metaToken,
    search_terms: searchName,
    ad_reached_countries: "US",
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    fields: "ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_snapshot_url,page_name",
    limit: "25",
  });

  try {
    const r = await fetch("https://graph.facebook.com/v19.0/ads_archive?" + params.toString());
    if (!r.ok) {
      console.log(`Meta Ad Library error: ${r.status}`);
      return null;
    }
    const data = await r.json();
    const ads = (data.data || []).map(ad => ({
      title: (ad.ad_creative_link_titles || [])[0] || (ad.ad_creative_bodies || [])[0]?.slice(0, 80) || "Untitled",
      body: (ad.ad_creative_bodies || [])[0]?.slice(0, 120) || "",
      startDate: ad.ad_delivery_start_time || null,
      snapshotUrl: ad.ad_snapshot_url || null,
      pageName: ad.page_name || searchName,
    }));

    // Count ads started in last 7 days
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newThisWeek = ads.filter(a => a.startDate && new Date(a.startDate).getTime() > weekAgo).length;

    const result = { totalActive: ads.length, newThisWeek, ads: ads.slice(0, 5), pageName: ads[0]?.pageName || searchName };

    // Cache for 6 hours
    await env.STATE.put(cacheKey, JSON.stringify(result), { expirationTtl: 21600 });
    return result;
  } catch (e) {
    console.log(`Meta Ad Library error: ${e.message}`);
    return null;
  }
}

function formatAdsBlocks(domain, companyName, metaData) {
  const name = metaData?.pageName || companyName || domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
  const now = new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const blocks = [];

  // Header
  blocks.push({ type: "header", text: { type: "plain_text", text: `🔎 Ads Report: ${name}`, emoji: true } });

  // Meta section
  if (metaData) {
    let metaText = `*📘 Meta (Facebook/Instagram)* — ${metaData.totalActive} active ad${metaData.totalActive !== 1 ? "s" : ""}`;
    if (metaData.newThisWeek > 0) metaText += ` (${metaData.newThisWeek} new this week)`;
    metaText += "\n";
    for (const ad of metaData.ads.slice(0, 3)) {
      const date = ad.startDate ? new Date(ad.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      metaText += `• "${ad.title}"${date ? ` (${date})` : ""}\n`;
    }
    if (metaData.totalActive > 3) metaText += `_...and ${metaData.totalActive - 3} more_`;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: metaText },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "View All", emoji: true },
        url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(name)}`,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*📘 Meta* — Search the Ad Library" },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Search", emoji: true },
        url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(name)}`,
      },
    });
  }

  // Google section
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: domain ? "*🔍 Google Ads* — Check transparency center" : `*🔍 Google Ads* — Search for "${name}" on the transparency center` },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: domain ? "View" : "Open", emoji: true },
      url: domain ? `https://adstransparency.google.com/?domain=${encodeURIComponent(domain)}` : `https://adstransparency.google.com/`,
    },
  });

  // LinkedIn section
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*💼 LinkedIn* — Search ad library" },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: "View", emoji: true },
      url: `https://www.linkedin.com/ad-library/search?companyName=${encodeURIComponent(name)}`,
    },
  });

  // Footer
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Last checked: ${now} • ${metaData ? "Data cached for 6h" : "Set META_APP_TOKEN for live Meta data"}` }],
  });

  return blocks;
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
  resetSubrequestCounter();
  const config = configOverride || await loadConfig(env, userId);
  const { competitors, settings } = config;

  // Resolve user tier for feature gating
  let userTier = "command"; // default for self-hosted (full access)
  if (userId) {
    try {
      const uRaw = await env.STATE.get("user:" + userId);
      if (uRaw) userTier = JSON.parse(uRaw).tier || "scout";
    } catch {}
  }

  if (competitors.length === 0) {
    console.log("No competitors configured. Visit /setup to add competitors.");
    return [];
  }

  console.log(`ScopeHound v3 running at ${new Date().toISOString()}`);
  console.log(`Monitoring ${competitors.length} competitors (tier: ${userTier})`);
  console.log("=".repeat(50));

  const alerts = [];
  const historyEvents = [];
  const slackUrl = settings.slackWebhookUrl;
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
          const pricing = await extractPricingWithLLM(content, env);
          if (pricing) { cs.pricing = pricing; console.log(`    ${pricing.plans?.length || 0} plans extracted`); }
        }
        ps.hash = newHash;
        ps.textSnapshot = newText;
        ps.lastChecked = new Date().toISOString();
      } else if (newHash !== ps.hash) {
        const oldText = ps.textSnapshot || "";
        const diff = computeTextDiff(oldText, newText);

        // Skip alert if diff is trivial (hash changed but no meaningful text diff)
        const hasMeaningfulDiff = diff.added.length > 0 || diff.removed.length > 0;
        if (!hasMeaningfulDiff) {
          console.log(`    Hash changed but no meaningful text diff — skipping alert`);
          ps.hash = newHash;
          ps.textSnapshot = newText;
          ps.lastChecked = new Date().toISOString();
        } else {
          console.log(`    CHANGED (${diff.added.length} added, ${diff.removed.length} removed)`);
          let analysis = null;
          let pricingChanges = null;

          if (page.type === "pricing") {
            const newPricing = await extractPricingWithLLM(content, env);
            if (newPricing && cs.pricing) pricingChanges = comparePricing(cs.pricing, newPricing);
            if (newPricing) cs.pricing = newPricing;
            analysis = await analyzePageChange(env, competitor.name, page.label, page.type, diff);
            if (!analysis) analysis = { summary: "Pricing page changed", priority: "high", analysis: "", recommendation: "Review pricing page." };
          } else {
            analysis = await analyzePageChange(env, competitor.name, page.label, page.type, diff);
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
        }
      } else {
        console.log(`    Unchanged`);
        ps.lastChecked = new Date().toISOString();
      }
      cs.pages[page.id] = ps;
    }

    if (competitor.blogRss && hasFeature(userTier, "rss_monitoring")) {
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
                const cl = await classifyAnnouncement(env, competitor.name, post.title, cat);
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
      const posts = await fetchProductHuntPosts(topic.slug);
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

  // ── COMPETITOR RADAR (Reddit) ──
  if (hasFeature(userTier, "competitor_radar") && (settings.radarSubreddits || []).length > 0) {
    console.log(`\n── Competitor Radar ──`);
    const productMeta = settings._productMeta || null;
    const radarFinds = await radarScanReddit(env, settings, state, productMeta, competitors);
    if (radarFinds.length > 0) {
      console.log(`  ${radarFinds.length} new competitor(s) spotted`);
      alerts.push({ priority: "medium", text: formatRadarAlert(radarFinds) });
      for (const c of radarFinds) {
        historyEvents.push({
          date: new Date().toISOString(), type: "radar", priority: "medium",
          summary: `New competitor spotted: ${c.name}`, url: c.url,
          analysis: c.reason, source: `r/${c.subreddit}`,
        });
      }
    } else {
      console.log(`  No new competitors found`);
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

  // ── SEND ALERTS (batched into single Slack message to conserve subrequests) ──
  const slackResults = [];
  console.log(`\nSlack URL: ${slackUrl ? "configured" : "MISSING"}`);
  if (alerts.length > 0) {
    // Filter alerts by user's minimum priority preference
    const minPriority = settings.slackMinPriority || "low";
    const priorityRank = { high: 3, medium: 2, low: 1 };
    const minRank = priorityRank[minPriority] || 1;
    const filtered = alerts.filter(a => (priorityRank[a.priority] || 1) >= minRank);
    const skipped = alerts.length - filtered.length;
    if (skipped > 0) console.log(`Filtered ${skipped} alert(s) below ${minPriority} priority`);
    if (filtered.length === 0) {
      console.log("All alerts filtered out by priority preference — skipping Slack message.");
    } else {
    console.log(`Sending ${filtered.length} alert(s) to Slack (batched)...`);
    const parts = [formatDigestHeader(filtered)];
    if (skipped > 0) parts[0] += ` _(${skipped} lower-priority update${skipped > 1 ? "s" : ""} filtered)_`;
    const high = filtered.filter((a) => a.priority === "high");
    const medium = filtered.filter((a) => a.priority === "medium");
    const low = filtered.filter((a) => a.priority === "low");
    for (const a of high) parts.push(a.text);
    for (const a of medium) parts.push(a.text);
    if (low.length > 0) parts.push(low.map((a) => a.text).join("\n\n---\n\n"));
    // Slack has a ~40KB message limit; truncate if needed
    let message = parts.join("\n\n───────────────────\n\n");
    if (message.length > 38000) message = message.slice(0, 38000) + "\n\n_(message truncated — view full details on your dashboard)_";
    slackResults.push(await sendSlack(slackUrl, message));
    }
  } else {
    console.log("\nNo changes detected.");
    const totalPages = competitors.reduce((n, c) => n + (c.pages?.length || 0), 0);
    const totalBlogs = competitors.filter(c => c.blogRss).length;
    // Next scan messaging
    const hasScheduled = userTier && userTier !== "scout" && userTier !== "recon";
    var nextScanText = hasScheduled ? "Next scan tomorrow at 9:00 AM UTC." : "Manual scan available once per 24h.";
    // Build itemized source list
    const sources = [`${competitors.length} competitors (${totalPages} pages)`];
    if (totalBlogs > 0) sources.push(`${totalBlogs} blog RSS feed${totalBlogs > 1 ? "s" : ""}`);
    if (phTopics.length > 0) sources.push(`Product Hunt (${phTopics.map(t => t.name).join(", ")})`);
    // Reddit will be added here when radar is live
    const radarSubs = settings.radarSubreddits || [];
    if (radarSubs.length > 0) sources.push(`Reddit (${radarSubs.length} subreddit${radarSubs.length > 1 ? "s" : ""})`);
    slackResults.push(await sendSlack(slackUrl, `🐺 *ScopeHound* — Checked ${sources.join(" · ")}. Nothing to report. ${nextScanText}`));
  }

  const slackOk = slackResults.filter(r => r.ok).length;
  const slackFail = slackResults.filter(r => !r.ok);
  console.log(`Slack delivery: ${slackOk}/${slackResults.length} succeeded${slackFail.length ? ", errors: " + slackFail.map(r => r.error).join(", ") : ""}`);
  console.log(`Subrequests used: ${_subrequestCount}/${SUBREQUEST_LIMIT}`);
  console.log("Done!");
  return { alerts, slackResults, slackUrl: slackUrl ? "set" : "missing", subrequests: _subrequestCount };
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

// ─── ADMIN KPI AGGREGATION ───────────────────────────────────────────────────

async function aggregateKPIs(env) {
  const TIER_PRICES = { scout: 29, operator: 79, command: 199, recon: 29, strategic: 199 };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(now - 7 * 86400000);
  const fourteenDaysAgo = new Date(now - 14 * 86400000);
  const thirtyDaysAgo = new Date(now - 30 * 86400000);

  const kpis = {
    generatedAt: now.toISOString(),
    users: { total: 0, active: 0, churned: 0, churnRate: "0%", byTier: {}, recentSignups: [] },
    revenue: { estimatedMRR: 0, estimatedARR: 0, planDistribution: {} },
    engagement: { dau: 0, wau: 0, nurr: "0%", curr: "0%" },
    acquisition: { bySource: {}, byMedium: {}, byCampaign: {} },
  };

  // Helper counters for NURR/CURR
  let newUsersLast30d = 0, newUsersActiveLast7d = 0;
  let activeThisWeek = 0, activeBothWeeks = 0, activeLastWeekOnly = 0;

  // ── Scan all user records (paginated for >1000 users) ──
  let cursor = undefined;
  do {
    const listResult = await env.STATE.list({ prefix: "user:", cursor });
    for (const key of listResult.keys) {
      if (key.name.includes("_")) continue; // Skip user_email:, user_config:, user_state:
      try {
        const raw = await env.STATE.get(key.name);
        if (!raw) continue;
        const u = JSON.parse(raw);
        kpis.users.total++;

        const tier = u.tier || "none";
        kpis.users.byTier[tier] = (kpis.users.byTier[tier] || 0) + 1;

        if (u.subscriptionStatus === "active") {
          kpis.users.active++;
          if (TIER_PRICES[tier]) {
            kpis.revenue.estimatedMRR += TIER_PRICES[tier];
            kpis.revenue.planDistribution[tier] = (kpis.revenue.planDistribution[tier] || 0) + 1;
          }
        } else if (u.subscriptionStatus === "canceled") {
          kpis.users.churned++;
        }

        // DAU / WAU
        if (u.lastActive) {
          if (u.lastActive === today) kpis.engagement.dau++;
          if (new Date(u.lastActive) >= sevenDaysAgo) {
            kpis.engagement.wau++;
            activeThisWeek++;
          }
          // Active in both this week and last week (for CURR)
          const lastActiveDate = new Date(u.lastActive);
          if (lastActiveDate >= fourteenDaysAgo && lastActiveDate < sevenDaysAgo) {
            activeLastWeekOnly++;
          }
          if (lastActiveDate >= sevenDaysAgo) {
            // Check if they were also active last week by looking at lastActive history
            // Since we only store latest lastActive, approximate: if user was active this week,
            // count them for the "both weeks" bucket if they signed up before this week
            if (u.createdAt && new Date(u.createdAt) < sevenDaysAgo) {
              activeBothWeeks++;
            }
          }
        }

        // NURR: new users (≤30d) who were active in last 7d
        if (u.createdAt && new Date(u.createdAt) >= thirtyDaysAgo) {
          newUsersLast30d++;
          if (u.lastActive && new Date(u.lastActive) >= sevenDaysAgo) {
            newUsersActiveLast7d++;
          }
        }

        // UTM acquisition
        if (u.utmSource) kpis.acquisition.bySource[u.utmSource] = (kpis.acquisition.bySource[u.utmSource] || 0) + 1;
        if (u.utmMedium) kpis.acquisition.byMedium[u.utmMedium] = (kpis.acquisition.byMedium[u.utmMedium] || 0) + 1;
        if (u.utmCampaign) kpis.acquisition.byCampaign[u.utmCampaign] = (kpis.acquisition.byCampaign[u.utmCampaign] || 0) + 1;

        // Recent signups (last 30 days)
        if (u.createdAt && new Date(u.createdAt) >= thirtyDaysAgo) {
          kpis.users.recentSignups.push({
            email: u.email,
            tier: u.tier,
            status: u.subscriptionStatus,
            source: u.utmSource || null,
            createdAt: u.createdAt,
          });
        }
      } catch (e) { /* skip malformed records */ }
    }
    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  // Compute derived metrics
  kpis.users.churnRate = kpis.users.total > 0 ? ((kpis.users.churned / kpis.users.total) * 100).toFixed(1) + "%" : "0%";
  kpis.revenue.estimatedARR = kpis.revenue.estimatedMRR * 12;
  kpis.engagement.nurr = newUsersLast30d > 0 ? ((newUsersActiveLast7d / newUsersLast30d) * 100).toFixed(1) + "%" : "N/A";
  const lastWeekTotal = activeLastWeekOnly + activeBothWeeks;
  kpis.engagement.curr = lastWeekTotal > 0 ? ((activeBothWeeks / lastWeekTotal) * 100).toFixed(1) + "%" : "N/A";

  // Sort UTM tables descending by count
  const sortObj = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  kpis.acquisition.bySource = sortObj(kpis.acquisition.bySource);
  kpis.acquisition.byMedium = sortObj(kpis.acquisition.byMedium);
  kpis.acquisition.byCampaign = sortObj(kpis.acquisition.byCampaign);

  // Sort recent signups newest first, limit to 20
  kpis.users.recentSignups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  kpis.users.recentSignups = kpis.users.recentSignups.slice(0, 20);

  return kpis;
}

// ─── RSS AUTO-DETECTION ─────────────────────────────────────────────────────

async function detectRssFeed(websiteUrl) {
  const base = websiteUrl.replace(/\/+$/, "");
  const paths = ["/feed/", "/blog/feed/", "/rss.xml", "/blog/rss.xml", "/feed.xml", "/atom.xml"];
  for (const path of paths) {
    if (!canSubrequest()) break;
    try {
      trackSubrequest();
      const r = await fetch(base + path, {
        headers: { "User-Agent": "Scopehound/3.0" },
        redirect: "manual",
      });
      if ([301, 302, 303, 307, 308].includes(r.status)) continue;
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
      { match: ["pricing", "plans", "plan", "price"], type: "pricing", label: "Pricing" },
      { match: ["blog", "news", "updates", "changelog", "articles"], type: "blog", label: "Blog" },
      { match: ["careers", "jobs", "hiring", "join", "work-with-us"], type: "careers", label: "Careers" },
      { match: ["features", "product", "solutions"], type: "general", label: "Features" },
    ];
    for (const p of patterns) {
      let bestLink = null;
      let bestDepth = Infinity;
      for (const link of links) {
        const segments = link.path.split("/").filter(Boolean);
        // Use exact segment or hyphenated-word match (not substring) to avoid
        // false positives like "financial-planning-budgeting" matching "plan"
        if (p.match.some(m => segments.some(s => s === m || s.split("-").includes(m)))) {
          if (!seen.has(link.href) && segments.length < bestDepth) {
            bestLink = link;
            bestDepth = segments.length;
          }
        }
      }
      if (bestLink) {
        const entry = { url: bestLink.href, type: p.type, label: p.label };
        if (p.type === "blog" && rssUrl) entry.rss = rssUrl;
        pages.push(entry);
        seen.add(bestLink.href);
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
      for (const tryPath of ["/pricing", "/plans", "/plans-pricing", "/pricing-plans"]) {
        if (!canSubrequest()) break;
        try {
          trackSubrequest();
          const r = await fetch(origin + tryPath, { headers: { "User-Agent": "Scopehound/3.0" }, redirect: "manual" });
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
  const token = request.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "ADMIN_TOKEN secret not set. Add it in Cloudflare dashboard → Settings → Variables." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized. Provide X-Admin-Token header." }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
  });
}

function htmlResponse(html) {
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8", ...SECURITY_HEADERS } });
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
    // Track daily activity for DAU/WAU metrics (1 KV write per user per day)
    const today = new Date().toISOString().slice(0, 10);
    if (user.lastActive !== today) {
      user.lastActive = today;
      env.STATE.put("user:" + user.id, JSON.stringify(user)).catch(() => {});
    }
    return { user, response: null };
  }
  const authErr = requireAuth(request, env);
  if (authErr) return { user: null, response: authErr };
  return { user: { id: "admin", tier: "command", email: "admin" }, response: null };
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

// ─── ADMIN SESSION MANAGEMENT ───────────────────────────────────────────────

async function verifyAdminPassword(password, expectedHash) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (hashHex.length !== expectedHash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hashHex.length; i++) mismatch |= hashHex.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return mismatch === 0;
}

async function createAdminSession(env) {
  const secret = env.JWT_SECRET || env.ADMIN_TOKEN;
  if (!secret) return null;
  return await generateJWT({
    sub: "platform_admin",
    role: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 8 * 3600,
  }, secret);
}

async function getAdminSession(request, env) {
  const secret = env.JWT_SECRET || env.ADMIN_TOKEN;
  if (!secret) return null;
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/sh_admin=([^;]+)/);
  if (!match) return null;
  const payload = await verifyJWT(match[1], secret);
  if (!payload || payload.role !== "admin") return null;
  return payload;
}

function setAdminSessionCookie(headers, token) {
  headers.append("Set-Cookie", `sh_admin=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
}

function clearAdminSessionCookie(headers) {
  headers.append("Set-Cookie", "sh_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}

async function checkAdminLoginRateLimit(env, ip) {
  const raw = await env.STATE.get("admin_login_attempts:" + ip);
  return !raw || parseInt(raw) < 5;
}

async function recordAdminLoginAttempt(env, ip, success) {
  const key = "admin_login_attempts:" + ip;
  if (success) {
    await env.STATE.delete(key);
  } else {
    const raw = await env.STATE.get(key);
    await env.STATE.put(key, String((raw ? parseInt(raw) : 0) + 1), { expirationTtl: 900 });
  }
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

async function findOrCreateUser(env, provider, profile, refCode, utm) {
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
    tier: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    referredBy: refCode || null,
    utmSource: utm?.source || null,
    utmMedium: utm?.medium || null,
    utmCampaign: utm?.campaign || null,
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

async function createCheckoutSession(env, user, tier, origin, period) {
  const tierDef = TIERS[tier];
  if (!tierDef) return null;
  const priceIds = env.STRIPE_PRICE_IDS ? JSON.parse(env.STRIPE_PRICE_IDS) : {};
  const priceKey = tier + "_" + (period === "annual" ? "annual" : "monthly");
  const priceId = priceIds[priceKey] || priceIds[tier]; // fallback to old format
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
        const tierPrices = { scout: 2900, operator: 7900, command: 19900, recon: 2900, strategic: 19900 };
        await recordAffiliateCommission(env, affCode, userId, tierPrices[tier] || 0, tier);
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
      user.tier = null;
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
  const limits = getTierLimits(user?.tier || "scout");
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
<div style="display:flex;align-items:center;gap:16px"><span class="subtitle" id="lastUpdated">Loading...</span><span id="userBar" style="font-size:12px;color:#6b7280"></span></div>
</header>
<nav>
<button class="active" data-tab="overview">Overview</button>
<button data-tab="changes">Recent Changes</button>
<button data-tab="pricing">Pricing</button>
<button data-tab="seo">SEO Signals</button>
<div style="margin-left:auto;display:flex;align-items:center;gap:8px">
<button id="scanBtn" onclick="triggerScan()" style="font-size:12px;padding:8px 16px;background:#5c6b3c;color:#d4d8de;border:none;border-radius:2px;cursor:pointer;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:none">Scan Now</button>
<span id="scanCooldown" style="font-size:11px;color:#6b7280;display:none"></span>
<a href="/setup" style="font-size:12px;color:#6b7280;padding:8px 12px;border:1px solid #2a3038;border-radius:2px;text-decoration:none;display:flex;align-items:center;gap:4px">+ Manage Competitors</a>
</div>
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
fetch("./api/user/profile").then(r=>r.ok?r.json():null).then(u=>{if(u&&u.email){$("userBar").innerHTML=esc(u.email)+' &middot; <a href="/auth/logout" style="color:#c23030;text-decoration:none">Sign out</a>';}}).catch(()=>{});
// ── Scan Now button with cooldown ──
function updateScanButton(status){
  const btn=$("scanBtn"),cd=$("scanCooldown");
  if(!status){btn.style.display="none";cd.style.display="none";return;}
  if(status.canScan){
    btn.style.display="inline-block";btn.disabled=false;btn.style.opacity="1";btn.textContent="Scan Now";
    cd.style.display="none";
  } else {
    btn.style.display="inline-block";btn.disabled=true;btn.style.opacity="0.4";btn.textContent="Scan Now";
    cd.style.display="inline";
    const h=status.hoursRemaining||0;
    cd.textContent=h>1?"Next scan in "+h+"h":"Next scan in <1h";
    // Auto-refresh countdown every minute
    if(!window._scanTimer)window._scanTimer=setInterval(()=>{checkScanStatus();},60000);
  }
}
function checkScanStatus(){
  fetch("./api/scan/status").then(r=>r.ok?r.json():null).then(s=>{if(s)updateScanButton(s);}).catch(()=>{});
}
async function triggerScan(){
  const btn=$("scanBtn");
  btn.disabled=true;btn.textContent="Scanning...";btn.style.opacity="0.6";
  try{
    const r=await fetch("./api/config/trigger-scan",{method:"POST"});
    const d=await r.json();
    if(d.cooldown){updateScanButton(d);return;}
    if(d.error){btn.textContent="Error";setTimeout(()=>{checkScanStatus();},2000);return;}
    btn.textContent=d.alertsDetected+" alert"+(d.alertsDetected===1?"":"s")+" found";
    btn.style.opacity="1";
    // Refresh dashboard data
    fetch("./api/dashboard-data").then(r=>r.json()).then(d2=>{DATA=d2;$("lastUpdated").textContent="Last scan: just now";const active=document.querySelector("nav button.active");if(active&&tabs[active.dataset.tab])tabs[active.dataset.tab]();});
    // Re-check cooldown status after scan
    setTimeout(()=>{checkScanStatus();},3000);
  }catch(e){btn.textContent="Scan failed";setTimeout(()=>{checkScanStatus();},3000);}
}
checkScanStatus();
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
<div class="field"><label>Topics to Monitor (comma-separated slugs)</label><input type="text" id="phTopicsSelf" placeholder="e.g. affiliate-marketing, developer-tools, email-marketing"></div>
<p style="font-size:12px;color:#6b7280;margin-top:4px">Lowercase, hyphenated PH topic slugs. No API token needed.</p>
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
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML;}
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
    h+='<div class="row"><div class="field"><label>Name</label><input type="text" value="'+escAttr(c.name)+'" onchange="comps['+i+'].name=this.value"></div><div class="field"><label>Website</label><input type="url" value="'+escAttr(c.website)+'" onchange="comps['+i+'].website=this.value;autoFill('+i+',this.value)" placeholder="https://example.com"></div></div>';
    h+='<div class="row"><div class="field"><label>Pricing URL</label><input type="url" id="pricing'+i+'" value="'+escAttr(c.pricingUrl)+'" onchange="comps['+i+'].pricingUrl=this.value"></div><div class="field"><label>Blog RSS</label><div style="display:flex;gap:6px"><input type="url" id="rss'+i+'" value="'+escAttr(c.blogRss)+'" onchange="comps['+i+'].blogRss=this.value" style="flex:1" placeholder="Optional"><button class="btn btn-secondary btn-sm" onclick="detectRss('+i+')">Detect</button></div></div></div></div>';
  }
  $("compList").innerHTML=h;
}

function escAttr(s){return(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}

function autoFill(i,url){
  if(!url)return;
  const u=url.replace(/\/+$/,"");
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
    $("slackMsg").innerHTML=d.success?'<div class="msg msg-ok">Connected! Check your Slack channel.</div>':'<div class="msg msg-err">'+esc(d.error||"Failed")+'</div>';
  }catch(e){$("slackMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
}

function renderSummary(){
  let h='<div class="summary-item"><div class="summary-label">Competitors</div>'+comps.length+' configured</div>';
  h+='<div class="summary-item"><div class="summary-label">Slack</div>'+($("slackUrl").value?"Connected":"Not set")+'</div>';
  h+='<div class="summary-item"><div class="summary-label">Product Hunt</div>'+($("phTopicsSelf").value?$("phTopicsSelf").value:"Not configured")+'</div>';
  h+='<div class="summary-item"><div class="summary-label">Schedule</div>Daily at 9am UTC</div>';
  $("summaryPanel").innerHTML=h;
}

function buildCompetitors(){
  return comps.filter(c=>c.name&&c.website).map(c=>{
    const pages=[];
    const site=c.website.replace(/\/+$/,"");
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
    const phTopicStr=$("phTopicsSelf").value;
    const topics=phTopicStr?phTopicStr.split(",").map(s=>s.trim()).filter(Boolean).map(s=>({slug:s,name:s.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" ")})):[];
    const settings={slackWebhookUrl:$("slackUrl").value||null,productHuntTopics:topics};
    const h={"Content-Type":"application/json","X-Admin-Token":tok};
    const [r1,r2]=await Promise.all([fetch(base+"/api/config/competitors",{method:"POST",headers:h,body:JSON.stringify({competitors})}),fetch(base+"/api/config/settings",{method:"POST",headers:h,body:JSON.stringify(settings)})]);
    const d1=await r1.json(),d2=await r2.json();
    if(!d1.success||!d2.success){$("launchMsg").innerHTML='<div class="msg msg-err">Save failed: '+esc(d1.error||d2.error||"unknown")+'</div>';$("launchBtn").disabled=false;$("launchBtn").textContent="Save & Run First Scan";return;}
    $("launchBtn").textContent="Running first scan...";
    $("launchMsg").innerHTML='<div class="msg msg-info">Config saved. Running first scan (this may take a minute)...</div>';
    const r3=await fetch(base+"/api/config/trigger-scan",{method:"POST",headers:h});
    const d3=await r3.json();
    $("launchMsg").innerHTML='<div class="msg msg-ok">Done! Indexed '+competitors.length+' competitors. Redirecting to dashboard...</div>';
    setTimeout(()=>location.href=base+"/dashboard",2000);
  }catch(e){$("launchMsg").innerHTML='<div class="msg msg-err">Error: '+esc(e.message)+'</div>';$("launchBtn").disabled=false;$("launchBtn").textContent="Save & Run First Scan";}
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
      if(d.settings.productHuntTopics&&d.settings.productHuntTopics.length)$("phTopicsSelf").value=d.settings.productHuntTopics.map(t=>t.slug).join(", ");
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
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
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
@media(max-width:700px){.grid{grid-template-columns:1fr 1fr !important}.current{flex-direction:column;align-items:flex-start}}
@media(max-width:480px){.grid{grid-template-columns:1fr !important}}
</style>
</head>
<body>
<header><h1>Scope<span>Hound</span></h1><div style="display:flex;align-items:center;gap:16px"><span id="userBar" style="font-size:12px;color:#6b7280"></span><a href="/dashboard" style="font-size:12px">Dashboard</a></div></header>
<div id="activatingOverlay" style="display:none;position:fixed;inset:0;background:#0a0c0e;z-index:9999;align-items:center;justify-content:center;flex-direction:column">
<div style="font-size:24px;font-weight:700;color:#d4d8de;margin-bottom:12px">Activating your subscription<span id="loadDots"></span></div>
<div style="font-size:14px;color:#6b7280;margin-bottom:24px" id="activatingStatus">Confirming payment with Stripe...</div>
<div style="width:200px;height:4px;background:#1e2328;border-radius:2px;overflow:hidden"><div id="activatingBar" style="width:0%;height:100%;background:#5c6b3c;border-radius:2px;transition:width 0.5s ease"></div></div>
</div>
<div class="wrap">
<div id="successMsg"></div>
<div class="current" id="currentPlan"><div><div class="current-plan" id="planName">Loading...</div><div class="current-status" id="planStatus"></div></div></div>
<h2>Plans</h2>
<div style="text-align:center;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:12px"><span id="monthlyLabel" style="font-size:12px;font-weight:600;color:#d4d8de;cursor:pointer" onclick="document.getElementById('billingToggle').checked=false;toggleBilling()">Monthly</span><label style="display:inline-block;vertical-align:middle;width:40px;height:22px;position:relative;cursor:pointer" onclick="var cb=document.getElementById('billingToggle');cb.checked=!cb.checked;toggleBilling()"><input type="checkbox" id="billingToggle" style="opacity:0;position:absolute;width:0;height:0;pointer-events:none"><span style="position:absolute;inset:0;background:#2a3038;border-radius:11px;transition:0.3s"></span><span id="toggleDot" style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#d4d8de;border-radius:50%;transition:0.3s"></span></label><span id="annualLabel" style="font-size:12px;color:#6b7280;cursor:pointer" onclick="document.getElementById('billingToggle').checked=true;toggleBilling()">Annual <span style="color:#5c6b3c;font-weight:700">Save 17%</span></span></div>
<div class="grid" style="grid-template-columns:repeat(3,1fr)">
<div class="plan" data-tier="scout"><div class="plan-name">Scout</div><div class="plan-price" data-monthly="29" data-annual="290">$29<span class="mo">/mo</span></div><ul class="plan-features"><li>3 competitors</li><li>6 pages</li><li>Manual scans only</li><li>30-day history</li><li>Dashboard + Slack alerts</li></ul><button class="btn btn-primary" id="btn-scout" onclick="checkout('scout')">Subscribe</button></div>
<div class="plan" data-tier="operator" style="border-color:#5c6b3c;position:relative"><div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#5c6b3c;color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding:2px 10px;border-radius:2px">Recommended</div><div class="plan-name">Operator</div><div class="plan-price" data-monthly="79" data-annual="790">$79<span class="mo">/mo</span></div><ul class="plan-features"><li>15 competitors</li><li>60 pages</li><li>Daily automated scans</li><li>1-year history</li><li>AI competitor discovery</li><li>RSS/blog monitoring</li><li>/scan + /ads commands</li></ul><button class="btn btn-primary" id="btn-operator" onclick="checkout('operator')">Subscribe</button></div>
<div class="plan" data-tier="command"><div class="plan-name">Command</div><div class="plan-price" data-monthly="199" data-annual="1990">$199<span class="mo">/mo</span></div><ul class="plan-features"><li>50 competitors</li><li>200 pages</li><li>Daily automated scans</li><li>Unlimited history</li><li>Everything in Operator</li><li>Priority scan queue</li><li>Competitor Radar (soon)</li></ul><button class="btn btn-primary" id="btn-command" onclick="checkout('command')">Subscribe</button></div>
</div>
<div class="manage" id="manageSection" style="display:none"><a href="#" onclick="manageSubscription();return false">Manage subscription on Stripe</a></div>
</div>
<script>
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML;}
let billingPeriod="monthly";
function toggleBilling(){
  const on=document.getElementById("billingToggle").checked;
  billingPeriod=on?"annual":"monthly";
  document.getElementById("toggleDot").style.left=on?"21px":"3px";
  const track=document.getElementById("toggleDot").parentElement.querySelector("span");
  if(track)track.style.background=on?"#5c6b3c":"#2a3038";
  document.getElementById("monthlyLabel").style.color=on?"#6b7280":"#d4d8de";
  document.getElementById("monthlyLabel").style.fontWeight=on?"400":"600";
  document.getElementById("annualLabel").style.color=on?"#d4d8de":"#6b7280";
  document.getElementById("annualLabel").style.fontWeight=on?"600":"400";
  document.querySelectorAll(".plan-price").forEach(el=>{
    const m=el.dataset.monthly,a=el.dataset.annual;
    if(on){el.innerHTML="$"+a+'<span class="mo">/yr</span>';}
    else{el.innerHTML="$"+m+'<span class="mo">/mo</span>';}
  });
}
async function loadProfile(){
  try{const r=await fetch("/api/user/profile");if(!r.ok)return;const u=await r.json();
  if(u.email){document.getElementById("userBar").innerHTML=esc(u.email)+' &middot; <a href="/auth/logout" style="color:#c23030;text-decoration:none">Sign out</a>';}
  document.getElementById("planName").textContent=u.tier?u.tier.toUpperCase()+" PLAN":"NO PLAN";
  document.getElementById("planStatus").textContent=u.subscriptionStatus==="active"?"Active":u.subscriptionStatus||"Choose a plan to get started";
  const tier=u.tier;
  const tierOrder=["scout","recon","operator","command","strategic"];
  document.querySelectorAll(".plan").forEach(p=>{const t=p.dataset.tier;const btn=p.querySelector("button");
  if(!tier){btn.textContent="Subscribe";btn.className="btn btn-primary";btn.onclick=function(){checkout(t);};}
  else if(t===tier){p.classList.add("active");btn.className="btn btn-current";btn.textContent="Current Plan";btn.onclick=null;}
  else if(tierOrder.indexOf(t)>tierOrder.indexOf(tier)){btn.textContent="Upgrade";btn.className="btn btn-primary";}
  else{btn.textContent="Downgrade";btn.className="btn btn-secondary";}});
  if(u.stripeCustomerId)document.getElementById("manageSection").style.display="block";
  }catch(e){}
  if(new URLSearchParams(location.search).get("success")){waitForSubscription();return;}
}
async function waitForSubscription(){
  const overlay=document.getElementById("activatingOverlay");
  overlay.style.display="flex";
  const bar=document.getElementById("activatingBar");
  const status=document.getElementById("activatingStatus");
  const dots=document.getElementById("loadDots");
  let dotCount=0;
  const dotInterval=setInterval(()=>{dotCount=(dotCount+1)%4;dots.textContent=".".repeat(dotCount);},400);
  const steps=["Confirming payment with Stripe...","Setting up your account...","Almost ready..."];
  for(let i=0;i<20;i++){
    bar.style.width=Math.min(5+i*4.5,95)+"%";
    if(i<steps.length)status.textContent=steps[i];
    else if(i>=6)status.textContent="Still working, hang tight...";
    await new Promise(r=>setTimeout(r,1500));
    try{const r=await fetch("/api/user/profile");if(!r.ok)continue;const u=await r.json();
    if(u.subscriptionStatus==="active"){bar.style.width="100%";status.textContent="You're all set!";clearInterval(dotInterval);dots.textContent="";await new Promise(r=>setTimeout(r,600));window.location.href="/setup";return;}}catch(e){}
  }
  clearInterval(dotInterval);dots.textContent="";
  bar.style.width="100%";bar.style.background="#c44";
  status.textContent="Taking longer than expected. Please refresh the page.";
}
async function checkout(tier){try{const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tier,period:billingPeriod})});const d=await r.json();if(d.url)location.href=d.url;else alert(d.error||"Failed");}catch(e){alert(e.message);}}
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
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.scan-progress{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-top:12px}
.scan-progress .scan-step{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;color:#6b7280;transition:color .3s}
.scan-progress .scan-step.active{color:#7a8c52}
.scan-progress .scan-step.done{color:#5c6b3c}
.scan-progress .scan-step .dot{width:6px;height:6px;border-radius:50%;background:#2a3038;flex-shrink:0;transition:background .3s}
.scan-progress .scan-step.active .dot{background:#7a8c52;animation:pulse 1.2s infinite}
.scan-progress .scan-step.done .dot{background:#5c6b3c}
.ai-discover{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:20px}
.ai-discover h3{font-size:14px;margin-bottom:4px;color:#d4d8de}
.ai-discover .ai-desc{font-size:12px;color:#6b7280;margin-bottom:12px}
.ai-discover .ai-input{display:flex;gap:8px}
.ai-discover .ai-input input{flex:1;margin:0}
.ai-results{margin-top:12px}
.ai-result{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #2a3038;border-radius:2px;margin-bottom:6px;cursor:pointer;transition:border-color .2s}
.ai-result:hover{border-color:#5c6b3c}
.ai-result.selected{border-color:#7a8c52;background:#5c6b3c11}
.ai-result input[type="checkbox"]{margin-top:3px;accent-color:#5c6b3c}
.ai-result .ai-name{font-size:14px;font-weight:600;color:#d4d8de}
.ai-result .ai-url{font-size:11px;color:#6b7280}
.ai-result .ai-reason{font-size:12px;color:#6b7280;margin-top:2px}
.ai-or{text-align:center;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin:16px 0;position:relative}
.ai-or::before,.ai-or::after{content:"";position:absolute;top:50%;width:calc(50% - 20px);height:1px;background:#2a3038}
.ai-or::before{left:0}
.ai-or::after{right:0}
@keyframes aiThink{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ai-thinking{padding:24px;text-align:center}
.ai-thinking .ai-brain{font-size:13px;color:#7a8c52;margin-bottom:8px}
.ai-thinking .ai-bar{height:3px;border-radius:2px;background:linear-gradient(90deg,#12161a 0%,#5c6b3c 50%,#12161a 100%);background-size:200% 100%;animation:aiThink 1.5s ease-in-out infinite}
.ai-thinking .ai-status{font-size:12px;color:#6b7280;margin-top:8px}
@media(max-width:600px){.steps{flex-direction:column}}
</style>
</head>
<body>
<header><h1>Scope<span>Hound</span></h1><div style="display:flex;align-items:center;gap:16px"><span id="userBar" style="font-size:12px;color:#6b7280"></span><a href="/billing" style="font-size:12px">Billing</a></div></header>
<div class="wrap">
<div class="steps">
<div class="step-tab active" id="tab1">1. Slack</div>
<div class="step-tab" id="tab2">2. Competitors</div>
<div class="step-tab" id="tab3">3. Launch</div>
</div>

<!-- Step 1: Slack -->
<div class="panel active" id="panel1">
<h2>Connect Slack</h2>
<p class="subtitle">ScopeHound delivers your daily competitive intel briefing to Slack. One click to connect.</p>
<div id="slackMsg"></div>
<div id="slackConnected" style="display:none">
<div class="msg msg-ok" id="slackStatus">Connected to Slack!</div>
<div style="margin-top:8px"><a href="/auth/slack" style="font-size:12px;color:#6b7280">Change channel or reconnect</a></div>
</div>
<div id="slackNotConnected">
<div style="margin:24px 0;text-align:center">
<a href="/auth/slack" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:10px;padding:14px 28px;font-size:14px">
<svg width="20" height="20" viewBox="0 0 123 123" fill="none"><path d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9v12.9zm6.5 0a12.9 12.9 0 1 1 25.8 0v32.3a12.9 12.9 0 1 1-25.8 0V77.6z" fill="#E01E5A"/><path d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9H45.2zm0 6.5a12.9 12.9 0 1 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8h32.3z" fill="#36C5F0"/><path d="M97.2 45.2a12.9 12.9 0 1 1 12.9 12.9H97.2V45.2zm-6.5 0a12.9 12.9 0 1 1-25.8 0V12.9a12.9 12.9 0 1 1 25.8 0v32.3z" fill="#2EB67D"/><path d="M77.8 97.2a12.9 12.9 0 1 1-12.9 12.9V97.2h12.9zm0-6.5a12.9 12.9 0 1 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8H77.8z" fill="#ECB22E"/></svg>
Add to Slack
</a>
</div>
<details style="margin-top:16px">
<summary style="font-size:12px;color:#6b7280;cursor:pointer">I already have a webhook URL</summary>
<div style="margin-top:8px">
<input type="url" id="slackUrl" placeholder="https://hooks.slack.com/services/...">
<button class="btn btn-secondary btn-sm" onclick="testSlack()" style="margin-top:4px">Test & Connect</button>
</div>
</details>
</div>
<div class="nav-btns">
<div></div>
<div style="display:flex;gap:8px;align-items:center">
<button type="button" onclick="skipSlack()" style="font-size:12px;color:#6b7280;cursor:pointer;background:none;border:none;padding:0;font-family:inherit" id="skipLink">Skip for now</button>
<button class="btn btn-primary" id="slackNext" onclick="goStep(2)">Next</button>
</div>
</div>
</div>

<!-- Step 2: Competitors -->
<div class="panel" id="panel2">
<h2>Add Competitors</h2>
<div class="tier-info" id="tierInfo"></div>
<div class="ai-discover" id="aiDiscover">
<h3>Find My Competitors</h3>
<p class="ai-desc">Enter your company URL and our AI will identify your competitors automatically.</p>
<div class="ai-input">
<input type="url" id="myCompanyUrl" placeholder="yourcompany.com">
<button class="btn btn-primary btn-sm" onclick="findCompetitors()">Find Competitors</button>
</div>
<details style="margin-top:12px;cursor:pointer">
<summary style="font-size:13px;color:#7a8c52;font-weight:600">Know your competitors? Add them for better results</summary>
<p style="font-size:12px;color:#6b7280;margin:8px 0 6px">Providing 1-2 known competitors helps our AI find more relevant matches in your niche.</p>
<div style="display:flex;gap:8px;margin-bottom:8px">
<input type="url" id="seedComp1" placeholder="competitor1.com" style="flex:1;padding:8px 12px;border:1px solid #374151;border-radius:8px;background:#1a1a2e;color:#e5e7eb;font-size:13px">
<input type="url" id="seedComp2" placeholder="competitor2.com" style="flex:1;padding:8px 12px;border:1px solid #374151;border-radius:8px;background:#1a1a2e;color:#e5e7eb;font-size:13px">
</div>
</details>
<div id="aiResults"></div>
</div>
<div class="ai-or">or add manually</div>
<div id="compList"></div>
<button class="btn btn-secondary btn-sm" onclick="addCompetitor()" id="addCompBtn">+ Add Competitor</button>
<div id="radarSection" style="margin-top:24px;display:none">
<h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;color:#d4d8de">Product Hunt Monitoring</h3>
<p class="subtitle" style="margin-bottom:12px">Monitor PH topics for new product launches in your space.</p>
<div id="phTopics" style="margin-bottom:12px"></div>
<button class="btn btn-secondary btn-sm" id="suggestPHBtn" onclick="suggestPH()" style="display:none">Suggest Topics</button>
<div id="phMsg"></div>
<h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin:20px 0 8px;color:#d4d8de">Reddit Radar</h3>
<p class="subtitle" style="margin-bottom:12px">Monitor subreddits for new competitor mentions.</p>
<div id="radarSubs" style="margin-bottom:12px"></div>
<button class="btn btn-secondary btn-sm" id="suggestSubsBtn" onclick="suggestSubs()" style="display:none">Suggest Subreddits</button>
<div id="radarMsg"></div>
</div>
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
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML;}
let currentStep=1,slackVerified=false,slackSkipped=false,competitors=[];
async function loadUserInfo(){
  try{const r=await fetch("/api/user/profile");if(r.ok){const u=await r.json();
  const t=u.tier||"scout";const limits={scout:{c:3,p:6},recon:{c:3,p:6},operator:{c:15,p:60},command:{c:50,p:200},strategic:{c:50,p:200}};
  const l=limits[t]||limits.scout;
  document.getElementById("tierInfo").innerHTML="You can add up to <strong>"+l.c+" competitors</strong> on your "+t.charAt(0).toUpperCase()+t.slice(1)+" plan.";
  window._tierLimits=l;window._tier=t;
  // Hide AI discovery for Scout (not available on their plan)
  if(t==="scout"||t==="recon"){const ai=document.getElementById("aiDiscover");if(ai){ai.innerHTML='<div style="padding:16px;text-align:center"><p style="font-size:13px;color:#6b7280;margin-bottom:8px">AI competitor discovery is available on the Operator plan.</p><a href="/billing" style="font-size:12px">Upgrade to unlock</a></div>';}}
  if(u.email){document.getElementById("userBar").innerHTML=esc(u.email)+' &middot; <a href="/auth/logout" style="color:#c23030;text-decoration:none">Sign out</a>';}}}catch(e){}
  // Check if Slack was just connected via OAuth
  if(new URLSearchParams(location.search).get("slack")==="connected"){
    slackVerified=true;
    document.getElementById("slackConnected").style.display="block";
    document.getElementById("slackNotConnected").style.display="none";
    document.getElementById("slackNext").disabled=false;
    document.getElementById("skipLink").style.display="none";
    document.getElementById("slackStatus").textContent="Connected to Slack!";
    setTimeout(function(){goStep(2);},100);
  }
  // Load existing config (Slack + competitors)
  try{const r=await fetch("/api/config");if(r.ok){const c=await r.json();
  if(c.settings&&c.settings.slackWebhookUrl){
    slackVerified=true;
    document.getElementById("slackConnected").style.display="block";
    document.getElementById("slackNotConnected").style.display="none";
    document.getElementById("slackNext").disabled=false;
    document.getElementById("skipLink").style.display="none";
    const ch=c.settings.slackChannel;
    document.getElementById("slackStatus").textContent="Connected to Slack"+(ch?" (#"+ch+")":"")+"!";
  }
  if(c.competitors&&c.competitors.length>0){
    competitors=c.competitors.map(comp=>({name:comp.name,website:comp.website,blogRss:comp.blogRss||null,pages:comp.pages||[],_discovered:comp.pages?comp.pages.map(p=>({url:p.url,type:p.type,label:p.label})):[]
    }));renderCompetitors();
  }
  if(c.settings&&c.settings.productHuntTopics&&c.settings.productHuntTopics.length>0){
    window._phTopics=c.settings.productHuntTopics;
    renderPHTopics(c.settings.productHuntTopics.map(t=>({slug:t.slug,name:t.name,reason:t.slug})));
  }
  if(c.settings&&c.settings.radarSubreddits&&c.settings.radarSubreddits.length>0){
    window._radarSubreddits=c.settings.radarSubreddits;
    renderRadarSubs(c.settings.radarSubreddits.map(s=>({name:s,reason:"Configured"})));
  }
  // Show PH/Reddit section if any data exists or competitors are loaded
  if(window._phTopics.length>0||window._radarSubreddits.length>0||(c.competitors&&c.competitors.length>0)){
    showRadarSection();
  }
  // Auto-advance past Slack if already connected
  if(slackVerified)goStep(2);
  }}catch(e){}
}
function goStep(n){
  if(n===2&&!slackVerified&&!slackSkipped){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">Connect Slack or click Skip for now.</div>';return;}
  if(n===3&&competitors.length===0){alert("Add at least one competitor.");return;}
  currentStep=n;
  document.querySelectorAll(".panel").forEach((p,i)=>{p.classList.toggle("active",i===n-1);});
  document.querySelectorAll(".step-tab").forEach((t,i)=>{t.className="step-tab"+(i===n-1?" active":i<n-1?" done":"");});
  if(n===3){document.getElementById("launchMsg").innerHTML="";renderReview();}
}
function skipSlack(){slackSkipped=true;goStep(2);}
async function testSlack(){
  const u=document.getElementById("slackUrl").value.trim();
  if(!u){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">Enter a webhook URL.</div>';return;}
  document.getElementById("slackMsg").innerHTML='<div class="msg">Testing...</div>';
  try{const r=await fetch("/api/config/test-slack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({webhookUrl:u})});
  const d=await r.json();
  if(d.success){slackVerified=true;document.getElementById("slackNext").disabled=false;
  document.getElementById("slackConnected").style.display="block";document.getElementById("slackNotConnected").style.display="none";
  document.getElementById("slackStatus").textContent="Connected! Check your Slack channel.";
  document.getElementById("skipLink").style.display="none";
  // Save webhook URL
  await fetch("/api/config/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slackWebhookUrl:u})});
  }else{document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">'+esc(d.error||"Failed to connect.")+'</div>';}
  }catch(e){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
}
let aiSuggestions=[];
async function findCompetitors(){
  const el=document.getElementById("aiResults");
  let u=document.getElementById("myCompanyUrl").value.trim();
  if(!u){el.innerHTML='<div class="msg msg-err">Enter your company URL.</div>';return;}
  if(!u.match(/^https?:/i))u="https://"+u;
  document.getElementById("myCompanyUrl").value=u;
  el.innerHTML='<div class="ai-thinking"><div class="ai-brain">Analyzing your website...</div><div class="ai-bar"></div><div class="ai-status">Identifying industry and finding competitors</div></div>';
  // Animate status text
  const seeds=[(document.getElementById("seedComp1")||{}).value,(document.getElementById("seedComp2")||{}).value].filter(s=>s&&s.trim());
  const statuses=["Reading your homepage...","Checking pricing and features pages...","Extracting product metadata...","Generating search queries...","Searching the web for competitors...","Analyzing and categorizing results...","Ranking by relevance..."];
  let si=0;
  const statusInterval=setInterval(()=>{
    si=(si+1)%statuses.length;
    const s=el.querySelector(".ai-status");if(s)s.textContent=statuses[si];
  },2000);
  try{
    const seeds=[(document.getElementById("seedComp1")||{}).value,(document.getElementById("seedComp2")||{}).value].map(s=>(s||"").trim()).filter(Boolean);
    const r=await fetch("/api/config/discover-competitors",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u,seeds:seeds})});
    clearInterval(statusInterval);
    const d=await r.json();
    if(d.error){el.innerHTML='<div class="msg msg-err">'+esc(d.error)+'</div>';return;}
    aiSuggestions=d.competitors||[];
    // Store product meta for radar use
    if(d._productMeta)window._productMeta=d._productMeta;
    if(aiSuggestions.length===0){el.innerHTML='<div class="msg">No competitors found. Try adding them manually below.</div>';return;}
    const overlapColors={direct:"#7a8c52",adjacent:"#c9952e",broader_platform:"#6b7280"};
    const overlapLabels={direct:"Direct",adjacent:"Adjacent",broader_platform:"Broader Platform"};
    const ind=esc((d.industry||"").charAt(0).toUpperCase()+(d.industry||"").slice(1));
    let html='<div style="font-size:12px;color:#6b7280;margin:12px 0 8px">Industry: <strong style="color:#7a8c52">'+ind+'</strong></div>';
    if(d.market_summary)html+='<div style="font-size:12px;color:#9ca3af;margin:0 0 12px;line-height:1.5">'+esc(d.market_summary)+'</div>';
    html+='<div style="font-size:12px;color:#6b7280;margin:0 0 8px">Select competitors to add:</div>';
    html+=aiSuggestions.map((c,i)=>{
      const badge=c.overlap&&overlapLabels[c.overlap]?'<span style="font-size:10px;background:'+overlapColors[c.overlap]+'22;color:'+overlapColors[c.overlap]+';padding:2px 6px;border-radius:4px;margin-left:8px">'+overlapLabels[c.overlap]+'</span>':"";
      const score=typeof c.match_score==="number"?c.match_score:0;
      const scoreColor=score>=75?"#7a8c52":score>=50?"#c9952e":"#6b7280";
      const scoreBadge=score>0?'<span style="font-size:11px;font-weight:600;color:'+scoreColor+';margin-left:8px" title="Competitive overlap score">'+score+'%</span>':"";
      return '<div class="ai-result" onclick="toggleAiResult(event,this,'+i+')"><input type="checkbox" id="aicheck'+i+'" onchange="onAiCheck('+i+')"><div><div class="ai-name">'+esc(c.name)+scoreBadge+badge+'</div><div class="ai-url">'+esc(c.url)+'</div><div class="ai-reason">'+esc(c.reason||c.description||"")+'</div></div></div>';
    }).join("");
    html+='<button class="btn btn-primary btn-sm" onclick="addSelectedAi()" style="margin-top:12px" id="addAiBtn" disabled>Add Selected Competitors</button>';
    el.innerHTML=html;
    // Trigger radar subreddit suggestions for Command users
    showRadarSection();
  }catch(e){clearInterval(statusInterval);el.innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
}
function toggleAiResult(ev,el,idx){
  if(ev.target.tagName==="INPUT")return;
  const cb=document.getElementById("aicheck"+idx);cb.checked=!cb.checked;
  el.classList.toggle("selected",cb.checked);
  const any=aiSuggestions.some((_,i)=>document.getElementById("aicheck"+i)?.checked);
  document.getElementById("addAiBtn").disabled=!any;
}
function onAiCheck(idx){
  const cb=document.getElementById("aicheck"+idx);
  cb.closest(".ai-result").classList.toggle("selected",cb.checked);
  const any=aiSuggestions.some((_,i)=>document.getElementById("aicheck"+i)?.checked);
  document.getElementById("addAiBtn").disabled=!any;
}
async function addSelectedAi(){
  const selected=aiSuggestions.filter((_,i)=>document.getElementById("aicheck"+i)?.checked);
  const lim=window._tierLimits;
  const remaining=lim?(lim.c-competitors.length):99;
  if(selected.length>remaining){alert("You can only add "+remaining+" more competitor"+(remaining===1?"":"s")+" on your plan.");return;}
  const btn=document.getElementById("addAiBtn");
  btn.disabled=true;btn.textContent="Scanning pages...";
  for(const s of selected){
    const idx=competitors.length;
    competitors.push({name:s.name,website:s.url,pages:[],blogRss:null,_discovered:[]});
    renderCompetitors();
    // Auto-scan each
    try{
      const r=await fetch("/api/config/discover-pages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:s.url})});
      const d=await r.json();
      if(d.pages){
        competitors[idx]._discovered=d.pages;
        competitors[idx].pages=d.pages.map((p,pi)=>({id:p.type+"-"+pi,url:p.url,type:p.type,label:p.label}));
        if(d.pages.find(p=>p.rss))competitors[idx].blogRss=d.pages.find(p=>p.rss).rss;
      }
    }catch(e){}
    renderCompetitors();
  }
  btn.textContent="Added!";
  document.getElementById("aiDiscover").style.display="none";
  document.querySelector(".ai-or").style.display="none";
}
function addCompetitor(){
  const lim=window._tierLimits;
  if(lim&&competitors.length>=lim.c){alert("You've reached your plan limit of "+lim.c+" competitors.");return;}
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
      +'<label>Company Name</label><input type="text" value="'+esc(c.name||"")+'" onchange="competitors['+i+'].name=this.value" placeholder="Acme Inc">'
      +'<label>Website URL</label><div style="display:flex;gap:8px"><input type="url" value="'+esc(c.website||"")+'" id="url'+i+'" onchange="competitors['+i+'].website=this.value" placeholder="https://acme.com" style="flex:1;margin:0"><button class="btn btn-secondary btn-sm" onclick="scanSite('+i+')">Scan</button></div>'
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
    return '<label><input type="checkbox" '+checked+' onchange="togglePage('+idx+','+pi+',this.checked)"> '+esc(p.label)+' <span class="page-url">'+esc(p.url)+'</span></label>';
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
function normalizeUrl(u){
  u=u.trim();if(!u)return u;
  if(!u.match(/^https?:/i))u="https://"+u;
  return u;
}
async function scanSite(idx){
  let u=normalizeUrl(document.getElementById("url"+idx).value);
  if(!u){alert("Enter a URL first.");return;}
  document.getElementById("url"+idx).value=u;
  competitors[idx].website=u;
  document.getElementById("pages"+idx).innerHTML='<p class="scanning" style="margin-top:8px">Scanning '+esc(u)+'...</p>';
  try{const r=await fetch("/api/config/discover-pages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u})});
  const d=await r.json();
  if(d.pages){
    competitors[idx]._discovered=d.pages;
    competitors[idx].pages=d.pages.map((p,i)=>({id:p.type+"-"+i,url:p.url,type:p.type,label:p.label}));
    if(d.pages.find(p=>p.rss))competitors[idx].blogRss=d.pages.find(p=>p.rss).rss;
    document.getElementById("pages"+idx).innerHTML=renderPageCheckboxes(idx);
  }else{document.getElementById("pages"+idx).innerHTML='<p class="msg msg-err">Could not scan site.</p>';}
  }catch(e){document.getElementById("pages"+idx).innerHTML='<p class="msg msg-err">'+esc(e.message)+'</p>';}
}
function detectPageType(u){
  try{const p=new URL(u).pathname.toLowerCase();}catch(e){return{type:"general",label:"Custom"};}
  const p=new URL(u).pathname.toLowerCase();
  if(/(pricing|plans|price|plans-pricing)/.test(p))return{type:"pricing",label:"Pricing"};
  if(/(blog|news|updates|changelog|articles)/.test(p))return{type:"blog",label:"Blog"};
  if(/(careers|jobs|hiring|join)/.test(p))return{type:"careers",label:"Careers"};
  if(/(features|product|solutions)/.test(p))return{type:"general",label:"Features"};
  if(/(about|company|team)/.test(p))return{type:"general",label:"About"};
  if(/(docs|documentation|support|help)/.test(p))return{type:"general",label:"Docs"};
  return{type:"general",label:"Custom"};
}
function addCustomPage(idx){
  const input=document.getElementById("custom"+idx);
  const u=normalizeUrl(input.value);if(!u)return;
  const detected=detectPageType(u);
  const entry={id:"custom-"+competitors[idx].pages.length,url:u,type:detected.type,label:detected.label};
  competitors[idx].pages.push(entry);
  if(!competitors[idx]._discovered)competitors[idx]._discovered=[];
  competitors[idx]._discovered.push({url:u,type:detected.type,label:detected.label});
  input.value="";
  document.getElementById("pages"+idx).innerHTML=renderPageCheckboxes(idx);
}
function renderReview(){
  const ready=competitors.filter(c=>c.name&&c.website);
  const totalPages=ready.reduce((s,c)=>s+c.pages.length,0);
  document.getElementById("reviewSummary").innerHTML=
    '<div class="review-item"><span class="review-label">Slack</span><span>'+(slackVerified?"Connected":"<span style='color:#c4a747'>Skipped — configure later in Settings</span>")+'</span></div>'
    +'<div class="review-item"><span class="review-label">Competitors</span><span>'+ready.length+'</span></div>'
    +'<div class="review-item"><span class="review-label">Pages monitored</span><span>'+totalPages+'</span></div>'
    +'<div class="review-item"><span class="review-label">Product Hunt</span><span>'+(window._phTopics.length>0?window._phTopics.map(t=>t.name).join(", "):"Not configured")+'</span></div>'
    +'<div class="review-item"><span class="review-label">Reddit Radar</span><span>'+(window._radarSubreddits.length>0?window._radarSubreddits.map(s=>"r/"+s).join(", "):"Not configured")+'</span></div>'
    +'<div class="review-item"><span class="review-label">Plan</span><span>'+(window._tier||"scout").charAt(0).toUpperCase()+(window._tier||"scout").slice(1)+'</span></div>'
    +'<div class="review-item"><span class="review-label">Schedule</span><span>Daily at 9am UTC</span></div>';
}
// ── Product Hunt + Reddit Radar ──
window._radarSubreddits=[];
window._phTopics=[];
function showRadarSection(){
  document.getElementById("radarSection").style.display="block";
  document.getElementById("suggestPHBtn").style.display="inline-block";
  if(window._tier==="command"){
    document.getElementById("suggestSubsBtn").style.display="inline-block";
  }else{
    document.getElementById("radarMsg").innerHTML='<div style="font-size:12px;color:#6b7280;padding:8px 0">Auto-suggest available on the <a href="/billing" style="color:#7a8c52">Command plan</a>. You can still add subreddits manually below.</div>';
  }
  // Always show manual add input if no subs rendered yet
  if(window._radarSubreddits.length===0){
    document.getElementById("radarSubs").innerHTML='<div style="margin-top:4px;display:flex;align-items:center;gap:8px"><span style="color:#6b7280;font-size:14px;white-space:nowrap">r /</span><input type="text" id="customSubreddit" placeholder="affiliatemarketing" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="addCustomSub()">Add</button></div>'+'<div style="font-size:11px;color:#6b7280;margin-top:4px">Just the subreddit name (we strip r/ and full URLs automatically)</div>';
  }
  // Auto-suggest if we have product meta
  if(window._productMeta){
    if(window._phTopics.length===0)suggestPH();
    if(window._tier==="command"&&window._radarSubreddits.length===0)suggestSubs();
  }
}
async function suggestPH(){
  if(!window._productMeta){document.getElementById("phMsg").innerHTML='<div class="msg msg-info">Run AI discovery first.</div>';return;}
  const btn=document.getElementById("suggestPHBtn");
  btn.disabled=true;btn.textContent="Finding topics...";
  try{
    const r=await fetch("/api/config/suggest-ph-topics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productMeta:window._productMeta})});
    const d=await r.json();
    if(d.error){document.getElementById("phMsg").innerHTML='<div class="msg msg-err">'+esc(d.error)+'</div>';btn.disabled=false;btn.textContent="Suggest Topics";return;}
    const topics=d.topics||[];
    if(topics.length===0){document.getElementById("phMsg").innerHTML='<div class="msg">No relevant PH topics found.</div>';btn.disabled=false;btn.textContent="Suggest Topics";return;}
    window._phTopics=topics.map(t=>({slug:t.slug,name:t.name}));
    renderPHTopics(topics);
    btn.style.display="none";
  }catch(e){document.getElementById("phMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';btn.disabled=false;btn.textContent="Suggest Topics";}
}
function renderPHTopics(topics){
  const el=document.getElementById("phTopics");
  el.innerHTML=topics.map((t,i)=>{
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038">'
      +'<input type="checkbox" checked id="phCheck'+i+'" onchange="updatePHSelection()">'
      +'<div><strong style="color:#c4a747">'+esc(t.name)+'</strong>'
      +'<div style="font-size:12px;color:#6b7280">'+esc(t.reason||t.slug)+'</div></div></div>';
  }).join("") +
  '<div style="margin-top:12px;display:flex;align-items:center;gap:8px"><input type="text" id="customPHTopic" placeholder="e.g. developer-tools" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="addCustomPH()">Add</button></div>' +
  '<div style="font-size:11px;color:#6b7280;margin-top:4px">PH topic slug (lowercase, hyphenated)</div>';
}
function updatePHSelection(){
  const checks=document.querySelectorAll("[id^=phCheck]");
  const labels=document.querySelectorAll("#phTopics strong");
  window._phTopics=[];
  checks.forEach((cb,i)=>{if(cb.checked&&labels[i]){const name=labels[i].textContent;window._phTopics.push({slug:name.toLowerCase().replace(/\\s+/g,"-"),name});}});
}
function addCustomPH(){
  const inp=document.getElementById("customPHTopic");
  let slug=inp.value.trim().toLowerCase().replace(/\\s+/g,"-").replace(/[^a-z0-9-]/g,"");
  if(!slug)return;
  const name=slug.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" ");
  window._phTopics.push({slug,name});
  const el=document.getElementById("phTopics");
  const idx=document.querySelectorAll("[id^=phCheck]").length;
  const div=document.createElement("div");
  div.style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038";
  div.innerHTML='<input type="checkbox" checked id="phCheck'+idx+'" onchange="updatePHSelection()"><div><strong style="color:#c4a747">'+esc(name)+'</strong><div style="font-size:12px;color:#6b7280">Custom topic</div></div>';
  const addRow=el.querySelector("div:last-child");
  if(addRow)el.insertBefore(div,addRow);else el.appendChild(div);
  inp.value="";
}
async function suggestSubs(){
  if(!window._productMeta){document.getElementById("radarMsg").innerHTML='<div class="msg msg-info">Run AI discovery first to enable radar.</div>';return;}
  const btn=document.getElementById("suggestSubsBtn");
  btn.disabled=true;btn.textContent="Finding subreddits...";
  try{
    const r=await fetch("/api/config/suggest-subreddits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productMeta:window._productMeta})});
    const d=await r.json();
    if(d.error){document.getElementById("radarMsg").innerHTML='<div class="msg msg-err">'+esc(d.error)+'</div>';btn.disabled=false;btn.textContent="Suggest Subreddits";return;}
    const subs=(d.subreddits||[]).map(s=>({...s,name:s.name.replace(/^r\\//i,"")}));
    if(subs.length===0){document.getElementById("radarMsg").innerHTML='<div class="msg">No relevant subreddits found.</div>';btn.disabled=false;btn.textContent="Suggest Subreddits";return;}
    window._radarSubreddits=subs.map(s=>s.name);
    renderRadarSubs(subs);
    btn.style.display="none";
  }catch(e){document.getElementById("radarMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';btn.disabled=false;btn.textContent="Suggest Subreddits";}
}
function renderRadarSubs(subs){
  const el=document.getElementById("radarSubs");
  el.innerHTML=subs.map((s,i)=>{
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038">'
      +'<input type="checkbox" checked id="radarCheck'+i+'" onchange="updateRadarSelection()">'
      +'<div><strong style="color:#7a8c52">r/'+esc(s.name)+'</strong>'
      +'<div style="font-size:12px;color:#6b7280">'+esc(s.reason)+'</div></div></div>';
  }).join("") +
  '<div style="margin-top:12px;display:flex;align-items:center;gap:8px"><span style="color:#6b7280;font-size:14px;white-space:nowrap">r /</span><input type="text" id="customSubreddit" placeholder="affiliatemarketing" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="addCustomSub()">Add</button></div>' +
  '<div style="font-size:11px;color:#6b7280;margin-top:4px">Just the subreddit name (we strip r/ and full URLs automatically)</div>';
}
function updateRadarSelection(){
  const allSubs=document.querySelectorAll("[id^=radarCheck]");
  const labels=document.querySelectorAll("#radarSubs strong");
  window._radarSubreddits=[];
  allSubs.forEach((cb,i)=>{if(cb.checked&&labels[i])window._radarSubreddits.push(labels[i].textContent.replace("r/",""));});
}
function addCustomSub(){
  const inp=document.getElementById("customSubreddit");
  let name=inp.value.trim();
  // Accept: "affiliatemarketing", "r/affiliatemarketing", "https://reddit.com/r/affiliatemarketing", etc.
  name=name.replace(/^https?:\\/\\/(www\\.)?reddit\\.com\\/r\\//i,"").replace(/^r\\//i,"").replace(/\\/.*$/,"").trim();
  if(!name)return;
  window._radarSubreddits.push(name);
  const el=document.getElementById("radarSubs");
  const idx=document.querySelectorAll("[id^=radarCheck]").length;
  const div=document.createElement("div");
  div.style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038";
  div.innerHTML='<input type="checkbox" checked id="radarCheck'+idx+'" onchange="updateRadarSelection()"><div><strong style="color:#7a8c52">r/'+esc(name)+'</strong><div style="font-size:12px;color:#6b7280">Custom subreddit</div></div>';
  // Insert before the "Add custom" input row
  const addRow=el.querySelector("div:last-child");
  el.insertBefore(div,addRow);
  inp.value="";
}
function scanProgress(steps){
  return '<div class="scan-progress">'+steps.map((s,i)=>
    '<div class="scan-step'+s.state+'" id="scanStep'+i+'"><span class="dot"></span>'+s.text+'</div>'
  ).join("")+'</div>';
}
function setScanStep(idx,state){
  const el=document.getElementById("scanStep"+idx);if(!el)return;
  el.className="scan-step"+(state==="active"?" active":state==="done"?" done":"");
}
async function launch(){
  const btn=document.getElementById("launchBtn");btn.disabled=true;btn.textContent="Launching...";
  const msgEl=document.getElementById("launchMsg");
  const steps=[
    {text:"Saving competitor config...",state:""},
    {text:"Saving Slack settings...",state:""},
    {text:"Scanning competitor pages...",state:""},
    {text:"Analyzing with AI...",state:""},
    {text:"Preparing dashboard...",state:""}
  ];
  msgEl.innerHTML=scanProgress(steps);
  setScanStep(0,"active");
  try{
    const comps=competitors.filter(c=>c.name&&c.website).map(c=>({name:c.name,website:c.website,blogRss:c.blogRss||null,pages:c.pages.map(p=>({id:p.id,url:p.url,type:p.type,label:p.label}))}));
    if(comps.length===0){throw new Error("Add at least one competitor with a name and URL");}
    let r=await fetch("/api/config/competitors",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({competitors:comps})});
    let d=await r.json();if(!r.ok){throw new Error(d.error||"Failed to save competitors");}
    setScanStep(0,"done");setScanStep(1,"active");
    const slackUrlVal=document.getElementById("slackUrl").value.trim();
    const settingsPayload=slackUrlVal?{slackWebhookUrl:slackUrlVal}:{};
    if(window._productMeta)settingsPayload._productMeta=window._productMeta;
    if(window._phTopics&&window._phTopics.length>0)settingsPayload.productHuntTopics=window._phTopics;
    if(window._radarSubreddits&&window._radarSubreddits.length>0)settingsPayload.radarSubreddits=window._radarSubreddits;
    r=await fetch("/api/config/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(settingsPayload)});
    d=await r.json();if(!r.ok){throw new Error(d.error||"Failed to save settings");}
    setScanStep(1,"done");setScanStep(2,"active");
    btn.textContent="Scanning...";
    r=await fetch("/api/config/trigger-scan",{method:"POST",headers:{"Content-Type":"application/json"}});
    d=await r.json();
    setScanStep(2,"done");setScanStep(3,"done");setScanStep(4,"done");
    msgEl.innerHTML='<div class="msg msg-ok">Setup complete! Redirecting to dashboard...</div>';
    setTimeout(()=>{window.location.href="/dashboard";},1500);
  }catch(e){
    msgEl.innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';
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
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML;}
async function apply(){
  const body={name:document.getElementById("pName").value,email:document.getElementById("pEmail").value,website:document.getElementById("pWebsite").value,paypalEmail:document.getElementById("pPaypal").value,promotionPlan:document.getElementById("pHow").value};
  if(!body.name||!body.email||!body.paypalEmail){document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">Name, email, and PayPal email are required.</div>';return;}
  try{const r=await fetch("/api/partner/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();
  if(d.success)document.getElementById("applyMsg").innerHTML='<div class="msg msg-ok">Application submitted! Your referral code: <strong>'+esc(d.code)+'</strong>. We will review and activate your account shortly.</div>';
  else document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">'+esc(d.error||"Failed")+'</div>';
  }catch(e){document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
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
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML;}
const params=new URLSearchParams(location.search);
const code=params.get("code"),email=params.get("email");
if(!code||!email){document.querySelector(".wrap").innerHTML='<p style="color:#c23030;padding:40px;text-align:center">Missing code or email parameter.</p>';}
else{fetch("/api/partner/stats?code="+code+"&email="+email).then(r=>r.json()).then(d=>{
  if(d.error){document.querySelector(".wrap").innerHTML='<p style="color:#c23030;padding:40px;text-align:center">'+esc(d.error)+'</p>';return;}
  document.getElementById("sReferrals").textContent=d.referralCount||0;
  document.getElementById("sActive").textContent=(d.referrals||[]).filter(r=>r.status==="active").length;
  document.getElementById("sMonthly").textContent="$"+((d.referrals||[]).reduce((s,r)=>s+(r.status==="active"?r.monthlyCommission:0),0)/100).toFixed(2);
  document.getElementById("sTotal").textContent="$"+((d.totalEarnings||0)/100).toFixed(2);
  document.getElementById("refLink").value=location.origin+"/?ref="+code;
  const tbody=document.getElementById("refTable");
  if(!d.referrals||d.referrals.length===0){tbody.innerHTML='<tr><td colspan="5" class="empty">No referrals yet</td></tr>';return;}
  tbody.innerHTML=d.referrals.map(r=>'<tr><td>'+esc(r.email)+'</td><td>'+new Date(r.signedUpAt).toLocaleDateString()+'</td><td>'+esc(r.tier)+'</td><td>$'+(r.monthlyCommission/100).toFixed(2)+'/mo</td><td>'+esc(r.status)+'</td></tr>').join("");
}).catch(()=>{});}
</script>
</body>
</html>`;

// ─── ADMIN LOGIN HTML ────────────────────────────────────────────────────────

const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Admin Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:40px 32px;width:100%;max-width:380px}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;text-align:center}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:24px;text-align:center}
.error{background:#c2303022;border:1px solid #c23030;color:#c23030;padding:8px 12px;border-radius:2px;font-size:13px;margin-bottom:16px}
label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px}
input{width:100%;padding:10px 12px;background:#0a0c0e;border:1px solid #2a3038;border-radius:2px;color:#d4d8de;font-size:14px;margin-bottom:16px}
input:focus{outline:none;border-color:#5c6b3c}
.btn{display:block;width:100%;padding:12px;background:#5c6b3c;color:#d4d8de;border:none;border-radius:2px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer}
.btn:hover{background:#7a8c52}
</style>
</head>
<body>
<div class="card">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Admin Console</p>
{{ERROR_BLOCK}}
<form method="POST" action="/admin/login">
<label for="username">Username</label>
<input type="text" id="username" name="username" required autocomplete="username">
<label for="password">Password</label>
<input type="password" id="password" name="password" required autocomplete="current-password">
<button type="submit" class="btn">Sign In</button>
</form>
</div>
</body>
</html>`;

// ─── ADMIN DASHBOARD HTML ────────────────────────────────────────────────────

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScopeHound — Admin Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.5}
a{color:#7a8c52;text-decoration:none}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.admin-badge{font-size:10px;background:#c4a74722;color:#c4a747;border:1px solid #c4a74766;padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700}
main{max-width:1100px;margin:0 auto;padding:24px}
h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:24px 0 12px}
h2:first-child{margin-top:0}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.kpi{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px}
.kpi .label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:4px}
.kpi .value{font-size:28px;font-weight:700;color:#d4d8de}
.kpi .value.green{color:#7a8c52}
.kpi .value.yellow{color:#c4a747}
.kpi .value.red{color:#c23030}
.table-wrap{background:#12161a;border:1px solid #2a3038;border-radius:2px;overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1a1f25;font-size:13px}
th{color:#6b7280;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.06em}
.tier-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:2px;text-transform:uppercase}
.tier-scout,.tier-recon{background:#2a303844;color:#6b7280;border:1px solid #2a3038}
.tier-operator{background:#5c6b3c22;color:#7a8c52;border:1px solid #5c6b3c66}
.tier-command,.tier-strategic{background:#c4a74722;color:#c4a747;border:1px solid #c4a74766}
.tier-none{background:#c2303022;color:#c23030;border:1px solid #c2303066}
.status-active{color:#7a8c52}
.status-canceled{color:#c23030}
.loading{text-align:center;padding:48px;color:#6b7280}
.refresh-btn{background:none;border:1px solid #2a3038;color:#6b7280;padding:6px 12px;border-radius:2px;font-size:11px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em}
.refresh-btn:hover{border-color:#5c6b3c;color:#d4d8de}
.utm-table{margin-top:4px}
.utm-table td:last-child{text-align:right;font-weight:700;color:#d4d8de}
.utm-table td:first-child{color:#9ca3af}
.tabs{display:flex;gap:0;border-bottom:1px solid #2a3038;margin-bottom:24px}
.tab{background:none;border:none;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:12px 20px;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s}
.tab:hover{color:#d4d8de}
.tab.active{color:#7a8c52;border-bottom-color:#7a8c52}
.tab .badge{font-size:9px;background:#c4a74733;color:#c4a747;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:700}
.contact-msg{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px;margin-bottom:12px}
.contact-msg.unread{border-left:3px solid #c4a747}
.contact-meta{display:flex;gap:16px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.contact-meta .name{font-weight:700;color:#d4d8de}
.contact-meta .email{color:#7a8c52;font-size:13px}
.contact-meta .time{color:#6b7280;font-size:11px;margin-left:auto}
.contact-body{color:#9ca3af;font-size:14px;line-height:1.7;white-space:pre-wrap}
.contact-actions{margin-top:12px;display:flex;gap:8px}
.contact-actions button{background:none;border:1px solid #2a3038;color:#6b7280;padding:4px 10px;border-radius:2px;font-size:10px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em}
.contact-actions button:hover{border-color:#5c6b3c;color:#d4d8de}
.contact-actions button.del:hover{border-color:#c23030;color:#c23030}
.empty-state{text-align:center;padding:48px;color:#6b7280;font-size:13px}
</style>
</head>
<body>
<header>
<div style="display:flex;align-items:center;gap:12px">
  <h1>Scope<span>Hound</span></h1>
  <span class="admin-badge">Admin</span>
</div>
<div style="display:flex;align-items:center;gap:12px">
  <button class="refresh-btn" onclick="currentTab==='contacts'?loadContacts():loadKPIs()">Refresh</button>
  <a href="/admin/logout" style="font-size:12px;color:#c23030">Sign Out</a>
</div>
</header>
<main>
<div class="tabs">
  <button class="tab active" onclick="showTab('kpis')">KPIs</button>
  <button class="tab" onclick="showTab('contacts')">Messages <span class="badge" id="msgCount" style="display:none">0</span></button>
</div>
<div id="kpis-tab"><div class="loading">Loading KPIs...</div></div>
<div id="contacts-tab" style="display:none"><div class="loading">Loading messages...</div></div>
</main>
<script>
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function fmt$(n){return"$"+Number(n).toLocaleString()}
function timeAgo(d){if(!d)return"never";const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";}

let currentTab='kpis';
function showTab(tab){
  currentTab=tab;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('[onclick="showTab(\\''+tab+'\\')"]').classList.add('active');
  document.getElementById('kpis-tab').style.display=tab==='kpis'?'':'none';
  document.getElementById('contacts-tab').style.display=tab==='contacts'?'':'none';
  if(tab==='contacts')loadContacts();
}

async function loadKPIs(){
  document.getElementById("kpis-tab").innerHTML='<div class="loading">Loading KPIs...</div>';
  try{
    const r=await fetch("/api/admin/kpis");
    if(r.status===401){window.location.href="/admin/login";return;}
    if(!r.ok)throw new Error("Failed to load");
    renderDashboard(await r.json());
  }catch(e){
    document.getElementById("kpis-tab").innerHTML='<div class="loading">Failed to load KPIs. '+esc(e.message)+'</div>';
  }
}

async function loadContacts(){
  document.getElementById("contacts-tab").innerHTML='<div class="loading">Loading messages...</div>';
  try{
    const r=await fetch("/api/admin/contacts");
    if(r.status===401){window.location.href="/admin/login";return;}
    if(!r.ok)throw new Error("Failed to load");
    const data=await r.json();
    renderContacts(data.contacts||[]);
  }catch(e){
    document.getElementById("contacts-tab").innerHTML='<div class="loading">Failed to load messages. '+esc(e.message)+'</div>';
  }
}

async function markRead(id){
  await fetch("/api/admin/contacts?id="+id,{method:"PATCH"});
  const el=document.getElementById("msg-"+id);
  if(el)el.classList.remove("unread");
}

async function deleteMsg(id){
  if(!confirm("Delete this message?"))return;
  await fetch("/api/admin/contacts?id="+id,{method:"DELETE"});
  const el=document.getElementById("msg-"+id);
  if(el)el.remove();
}

function renderContacts(contacts){
  const unread=contacts.filter(c=>!c.read).length;
  const badge=document.getElementById("msgCount");
  if(unread>0){badge.textContent=unread;badge.style.display="";}else{badge.style.display="none";}
  if(contacts.length===0){
    document.getElementById("contacts-tab").innerHTML='<div class="empty-state">No messages yet.</div>';
    return;
  }
  let h='';
  for(const c of contacts){
    h+='<div class="contact-msg'+(c.read?'':' unread')+'" id="msg-'+esc(c.id)+'">';
    h+='<div class="contact-meta"><span class="name">'+esc(c.name)+'</span><span class="email">'+esc(c.email)+'</span><span class="time">'+timeAgo(c.createdAt)+'</span></div>';
    h+='<div class="contact-body">'+esc(c.message)+'</div>';
    h+='<div class="contact-actions">';
    if(!c.read)h+='<button onclick="markRead(\\''+c.id+'\\')">Mark Read</button>';
    h+='<button class="del" onclick="deleteMsg(\\''+c.id+'\\')">Delete</button>';
    h+='</div></div>';
  }
  document.getElementById("contacts-tab").innerHTML=h;
}

function kpi(label,value,color){
  return '<div class="kpi"><div class="label">'+esc(label)+'</div><div class="value'+(color?" "+color:"")+'">'+esc(String(value))+'</div></div>';
}

function utmTable(entries){
  if(!entries||entries.length===0)return'<div style="font-size:12px;color:#6b7280;padding:8px 0">No data yet</div>';
  let h='<div class="table-wrap utm-table"><table><tbody>';
  for(const[k,v]of entries)h+='<tr><td>'+esc(k)+'</td><td>'+v+'</td></tr>';
  h+='</tbody></table></div>';
  return h;
}

function renderDashboard(d){
  let h='';

  // ── User Metrics ──
  h+='<h2>User Metrics</h2><div class="kpi-grid">';
  h+=kpi("Total Users",d.users.total);
  h+=kpi("Active Subscribers",d.users.active,"green");
  h+=kpi("Churned",d.users.churned,"red");
  h+=kpi("Churn Rate",d.users.churnRate,"yellow");
  h+='</div>';

  // ── Revenue ──
  h+='<h2>Revenue</h2><div class="kpi-grid">';
  h+=kpi("Estimated MRR",fmt$(d.revenue.estimatedMRR),"green");
  h+=kpi("Estimated ARR",fmt$(d.revenue.estimatedARR),"green");
  const dist=d.revenue.planDistribution||{};
  h+=kpi("Scout Plans",dist.scout||0);
  h+=kpi("Operator Plans",dist.operator||0);
  h+=kpi("Command Plans",dist.command||0);
  h+='</div>';

  // ── Engagement ──
  h+='<h2>Engagement</h2><div class="kpi-grid">';
  h+=kpi("DAU (Today)",d.engagement.dau);
  h+=kpi("WAU (7 Days)",d.engagement.wau);
  h+=kpi("NURR (New User Retention)",d.engagement.nurr,"green");
  h+=kpi("CURR (Current Retention)",d.engagement.curr,"green");
  h+='</div>';

  // ── Acquisition ──
  h+='<h2>Acquisition — Source</h2>';
  h+=utmTable(d.acquisition.bySource);
  h+='<h2>Acquisition — Medium</h2>';
  h+=utmTable(d.acquisition.byMedium);
  if(d.acquisition.byCampaign&&d.acquisition.byCampaign.length>0){
    h+='<h2>Acquisition — Campaign</h2>';
    h+=utmTable(d.acquisition.byCampaign);
  }

  // ── Users by Tier ──
  if(d.users.byTier&&Object.keys(d.users.byTier).length>0){
    h+='<h2>Users by Tier</h2><div class="kpi-grid">';
    for(const[tier,count]of Object.entries(d.users.byTier)){
      h+=kpi(tier==="none"?"No Plan":tier.charAt(0).toUpperCase()+tier.slice(1),count);
    }
    h+='</div>';
  }

  // ── Recent Signups ──
  if(d.users.recentSignups&&d.users.recentSignups.length>0){
    h+='<h2>Recent Signups (30d)</h2><div class="table-wrap"><table><thead><tr><th>Email</th><th>Tier</th><th>Status</th><th>Source</th><th>Signed Up</th></tr></thead><tbody>';
    for(const u of d.users.recentSignups){
      const tc=u.tier?"tier-"+u.tier:"tier-none";
      const sc=u.status==="active"?"status-active":u.status==="canceled"?"status-canceled":"";
      h+='<tr><td>'+esc(u.email)+'</td><td><span class="tier-badge '+tc+'">'+(u.tier||"none")+'</span></td><td class="'+sc+'">'+(u.status||"—")+'</td><td>'+(esc(u.source)||"—")+'</td><td>'+timeAgo(u.createdAt)+'</td></tr>';
    }
    h+='</tbody></table></div>';
  }

  // ── Timestamp ──
  h+='<div style="text-align:center;padding:24px 0;font-size:11px;color:#6b7280">Generated: '+esc(d.generatedAt)+'</div>';

  document.getElementById("kpis-tab").innerHTML=h;
}

loadKPIs();
// Pre-fetch contact count for badge
fetch("/api/admin/contacts").then(r=>r.json()).then(d=>{
  const unread=(d.contacts||[]).filter(c=>!c.read).length;
  const badge=document.getElementById("msgCount");
  if(unread>0){badge.textContent=unread;badge.style.display="";}
}).catch(()=>{});
</script>
</body>
</html>`;

// ─── WORKER ENTRY POINT ─────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    // Cron runs once daily at 9am UTC for all paying tiers (Scout: manual only)

    if (isHostedMode(env)) {
      ctx.waitUntil((async () => {
        const raw = await env.STATE.get("active_subscribers");
        let list = raw ? JSON.parse(raw) : [];

        // Self-repair: find users with config who aren't in the subscribers list
        try {
          const configKeys = await env.STATE.list({ prefix: "user_config:" });
          const userIdsWithConfig = [...new Set(configKeys.keys.map(k => k.name.split(":")[1]).filter(Boolean))];
          const missing = userIdsWithConfig.filter(id => !list.includes(id));
          for (const id of missing) {
            const uRaw = await env.STATE.get("user:" + id);
            if (!uRaw) continue;
            const user = JSON.parse(uRaw);
            if (user.subscriptionStatus !== "active") continue;
            list.push(id);
            console.log(`[self-repair] Re-added ${user.email} to active_subscribers`);
            const cfg = await loadConfig(env, id);
            if (cfg.settings.slackWebhookUrl) {
              await sendSlack(cfg.settings.slackWebhookUrl, "🐺 *ScopeHound Notice*\n\nYour account was missing from the daily scan list and has been automatically repaired. Scans will now run normally.");
            }
          }
          if (missing.length > 0) {
            await env.STATE.put("active_subscribers", JSON.stringify(list));
          }
        } catch (e) {
          console.log(`[self-repair] Error: ${e.message}`);
        }

        // Always run global config scan (admin/owner data from self-hosted setup)
        try {
          const globalConfig = await loadConfig(env);
          if (globalConfig.competitors.length > 0) {
            console.log(`Running global config scan (${globalConfig.competitors.length} competitors)`);
            await runMonitor(env);
          }
        } catch (e) {
          console.log(`Global scan failed: ${e.message}`);
        }

        const isFriday = new Date().getUTCDay() === 5;
        const isFirstFriday = isFriday && new Date().getUTCDate() <= 7;

        for (const userId of list) {
          try {
            const uRaw = await env.STATE.get("user:" + userId);
            if (!uRaw) continue;
            const user = JSON.parse(uRaw);
            if (user.subscriptionStatus !== "active") continue;
            const tier = user.tier || "scout";

            // ── Weekly Competitor Suggestions (every Friday, ALL tiers) ──
            if (isFriday) {
              try {
                const config = await loadConfig(env, userId);
                const { competitors, settings } = config;
                if (settings._productMeta && settings.slackWebhookUrl) {
                  const suggestKey = `user_state:${userId}:weekly_suggestions`;
                  const prevRaw = await env.STATE.get(suggestKey);
                  const prevData = prevRaw ? JSON.parse(prevRaw) : { suggested: [], lastRun: null };
                  // Rolling 3-month window: only exclude suggestions from last 90 days
                  const now = Date.now();
                  const recentSuggested = (prevData.suggested || []).filter(s => {
                    if (typeof s === "string") return true; // legacy format, keep
                    return s.date && (now - new Date(s.date).getTime()) < 90 * 24 * 60 * 60 * 1000;
                  }).map(s => typeof s === "string" ? s : s.name);

                  let suggestions;
                  if (isFirstFriday && env.BRAVE_SEARCH_API_KEY) {
                    // Deep chain: enrich + Brave search + scoring (1st Friday of month)
                    console.log(`Running deep competitor discovery for ${user.email}`);
                    const productUrl = competitors[0]?.website ? null : null; // user's own product URL not stored; enrich from metadata
                    const enriched = await enrichProductMeta(env, settings._productMeta, productUrl);
                    if (enriched !== settings._productMeta) {
                      // Save enriched productMeta back to KV
                      const settingsKey = `user_config:${userId}:settings`;
                      const settRaw = await env.STATE.get(settingsKey);
                      const fullSettings = settRaw ? JSON.parse(settRaw) : {};
                      fullSettings._productMeta = enriched;
                      await env.STATE.put(settingsKey, JSON.stringify(fullSettings));
                    }
                    suggestions = await deepCompetitorDiscovery(env, enriched, competitors, recentSuggested);
                  } else {
                    // Light mode: single Sonnet call (other Fridays or no Brave key)
                    suggestions = await suggestNewCompetitors(env, settings._productMeta, competitors, recentSuggested);
                  }

                  if (suggestions && suggestions.length > 0) {
                    const message = formatWeeklySuggestions(suggestions, settings._productMeta, tier);
                    await sendSlack(settings.slackWebhookUrl, message);
                    const newEntries = suggestions.map(s => ({ name: s.name, date: new Date().toISOString() }));
                    const updatedSuggested = [...(prevData.suggested || []).filter(s => {
                      const d = typeof s === "string" ? null : s.date;
                      return d && (now - new Date(d).getTime()) < 90 * 24 * 60 * 60 * 1000;
                    }), ...newEntries];
                    await env.STATE.put(suggestKey, JSON.stringify({
                      suggested: updatedSuggested,
                      lastRun: new Date().toISOString(),
                    }));
                    console.log(`Weekly suggestions sent for ${user.email}: ${suggestions.length} suggestions${isFirstFriday ? " (deep)" : ""}`);
                  }
                } else {
                  console.log(`Skipping weekly suggestions for ${user.email}: ${!settings._productMeta ? "no productMeta" : "no Slack"}`);
                }
              } catch (e) {
                console.log(`Weekly suggestions failed for ${user.email}: ${e.message}`);
              }
            }

            // Scout: no scheduled scans (manual only)
            if (!hasFeature(tier, "scheduled_scans")) {
              console.log(`Skipping ${user.email} (${tier}) — manual scans only`);
              continue;
            }
            // Operator and Command both run the daily scan
            console.log(`Running daily scan for ${user.email} (${tier})`);
            await runMonitor(env, null, userId);
          } catch (e) {
            console.log(`Scan failed for user ${userId}: ${e.message}`);
          }
        }
      })());
    } else {
      ctx.waitUntil((async () => {
        // Weekly competitor suggestions for self-hosted mode (Fridays)
        const selfFriday = new Date().getUTCDay() === 5;
        const selfFirstFriday = selfFriday && new Date().getUTCDate() <= 7;
        if (selfFriday) {
          try {
            const config = await loadConfig(env);
            const { competitors, settings } = config;
            if (settings._productMeta && settings.slackWebhookUrl) {
              const suggestKey = "weekly_suggestions";
              const prevRaw = await env.STATE.get(suggestKey);
              const prevData = prevRaw ? JSON.parse(prevRaw) : { suggested: [], lastRun: null };
              const now = Date.now();
              const recentSuggested = (prevData.suggested || []).filter(s => {
                if (typeof s === "string") return true;
                return s.date && (now - new Date(s.date).getTime()) < 90 * 24 * 60 * 60 * 1000;
              }).map(s => typeof s === "string" ? s : s.name);

              let suggestions;
              if (selfFirstFriday && env.BRAVE_SEARCH_API_KEY) {
                const enriched = await enrichProductMeta(env, settings._productMeta, null);
                if (enriched !== settings._productMeta) {
                  const settRaw = await env.STATE.get("config:settings");
                  const fullSettings = settRaw ? JSON.parse(settRaw) : {};
                  fullSettings._productMeta = enriched;
                  await env.STATE.put("config:settings", JSON.stringify(fullSettings));
                }
                suggestions = await deepCompetitorDiscovery(env, enriched, competitors, recentSuggested);
              } else {
                suggestions = await suggestNewCompetitors(env, settings._productMeta, competitors, recentSuggested);
              }

              if (suggestions && suggestions.length > 0) {
                const message = formatWeeklySuggestions(suggestions, settings._productMeta, "command");
                await sendSlack(settings.slackWebhookUrl, message);
                const newEntries = suggestions.map(s => ({ name: s.name, date: new Date().toISOString() }));
                const updatedSuggested = [...(prevData.suggested || []).filter(s => {
                  const d = typeof s === "string" ? null : s.date;
                  return d && (now - new Date(d).getTime()) < 90 * 24 * 60 * 60 * 1000;
                }), ...newEntries];
                await env.STATE.put(suggestKey, JSON.stringify({ suggested: updatedSuggested, lastRun: new Date().toISOString() }));
              }
            }
          } catch (e) {
            console.log(`Weekly suggestions failed: ${e.message}`);
          }
        }
        await runMonitor(env);
      })());
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const reqOrigin = request.headers.get("Origin");
    const isSameHost = reqOrigin && new URL(reqOrigin).hostname === url.hostname;
    const isScopeHoundApp = reqOrigin && /^https:\/\/(www\.)?scopehound\.app$/.test(reqOrigin);
    const allowedOrigin = (isSameHost || isScopeHoundApp) ? reqOrigin : url.origin;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-Admin-Token" },
      });
    }

    // ── Bot / vulnerability scanner blocker ──
    const lp = path.toLowerCase();
    // Block requests with suspicious file extensions (PHP, ASP, JSP, CGI, env files, etc.)
    if (/\.(php|asp|aspx|jsp|cgi|env|ini|bak|sql|xml|yml|yaml|log|gz|zip|tar|rar|7z|exe|dll|sh|bat|cmd|ps1|config|htaccess|htpasswd|git|svn|DS_Store)$/i.test(lp)) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }
    // Block common vulnerability scanner paths
    if (/^\/(wp-|wordpress|cgi-bin|phpmyadmin|mysql|cpanel|webmail|autodiscover|remote|telescope|debug|actuator|console|manager|jmx|\.well-known\/security|vendor\/phpunit|_profiler|elmah|trace\.axd|owa\/|ecp\/|exchange|aspnet)/i.test(lp)) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }
    // Block single-segment company-name slug probing (e.g. /moonpay, /lenovo)
    // Valid ScopeHound paths all match known prefixes
    const validPrefixes = ["/", "/signin", "/auth/", "/api/", "/setup", "/dashboard", "/billing", "/partner/", "/privacy", "/support", "/test", "/state", "/history", "/reset", "/run", "/robots.txt", "/admin"];
    if (path !== "/" && !validPrefixes.some(p => p === "/" ? false : lp.startsWith(p.toLowerCase()))) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }

    // ── robots.txt ──
    if (path === "/robots.txt") {
      return new Response(
        `User-agent: *\nAllow: /signin\nAllow: /privacy\nAllow: /support\nAllow: /partner/apply\nDisallow: /dashboard\nDisallow: /setup\nDisallow: /billing\nDisallow: /api/\nDisallow: /auth/\nDisallow: /admin\nDisallow: /test\nDisallow: /state\nDisallow: /history\nDisallow: /reset\n\nSitemap: https://scopehound.app/sitemap.xml`,
        { headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" } }
      );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // HOSTED MODE ROUTES — only active when Google/Stripe/JWT secrets are set
    // ══════════════════════════════════════════════════════════════════════════

    if (isHostedMode(env)) {
      // ── Root redirect ──
      if (path === "/" || path === "") {
        const user = await getSessionUser(request, env);
        if (user) {
          if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
          const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
          if (!comps || comps === "[]") return Response.redirect(url.origin + "/setup", 302);
          return Response.redirect(url.origin + "/dashboard", 302);
        }
        return Response.redirect(url.origin + "/signin", 302);
      }

      // ── Sign-in page ──
      if (path === "/signin" || path === "/signin/") {
        const user = await getSessionUser(request, env);
        if (user) {
          if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
          const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
          if (!comps || comps === "[]") return Response.redirect(url.origin + "/setup", 302);
          return Response.redirect(url.origin + "/dashboard", 302);
        }
        return htmlResponse(SIGNIN_HTML);
      }

      // ── Google OAuth: start ──
      if (path === "/auth/google") {
        const nonce = crypto.randomUUID();
        const ref = url.searchParams.get("ref") || "";
        const utm = {
          source: url.searchParams.get("utm_source") || "",
          medium: url.searchParams.get("utm_medium") || "",
          campaign: url.searchParams.get("utm_campaign") || "",
        };
        const state = JSON.stringify({ nonce, ref, utm });
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
          const user = await findOrCreateUser(env, "google", profile, state.ref || null, state.utm || null);
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

      // ── Slack OAuth: initiate ──
      if (path === "/auth/slack") {
        if (!env.SLACK_CLIENT_ID) return new Response("Slack integration not configured", { status: 500 });
        const user = await getSessionUser(request, env);
        if (!user) return Response.redirect(url.origin + "/signin", 302);
        const nonce = crypto.randomUUID();
        await env.STATE.put("csrf:" + nonce, "1", { expirationTtl: 600 });
        const slackUrl = "https://slack.com/oauth/v2/authorize?" + new URLSearchParams({
          client_id: env.SLACK_CLIENT_ID,
          scope: "incoming-webhook,commands",
          redirect_uri: url.origin + "/auth/slack/callback",
          state: JSON.stringify({ nonce, userId: user.id }),
        }).toString();
        return Response.redirect(slackUrl, 302);
      }

      // ── Slack OAuth: callback ──
      if (path === "/auth/slack/callback") {
        try {
          const code = url.searchParams.get("code");
          const stateRaw = url.searchParams.get("state");
          if (!code || !stateRaw) return new Response("Missing code or state", { status: 400 });
          const state = JSON.parse(stateRaw);
          const csrfValid = await env.STATE.get("csrf:" + state.nonce);
          if (!csrfValid) return new Response("Invalid or expired state", { status: 400 });
          await env.STATE.delete("csrf:" + state.nonce);
          // Exchange code for webhook
          const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: env.SLACK_CLIENT_ID,
              client_secret: env.SLACK_CLIENT_SECRET,
              code,
              redirect_uri: url.origin + "/auth/slack/callback",
            }).toString(),
          });
          const tokenData = await tokenRes.json();
          if (!tokenData.ok || !tokenData.incoming_webhook?.url) {
            return new Response("Slack authorization failed: " + (tokenData.error || "unknown"), { status: 400 });
          }
          // Save webhook URL to user settings
          const userId = state.userId;
          const prefix = "user_config:" + userId + ":";
          const existingRaw = await env.STATE.get(prefix + "settings");
          const settings = existingRaw ? JSON.parse(existingRaw) : {};
          settings.slackWebhookUrl = tokenData.incoming_webhook.url;
          settings.slackChannel = tokenData.incoming_webhook.channel;
          settings.slackTeam = tokenData.team?.name || null;
          settings.slackTeamId = tokenData.team?.id || null;
          await env.STATE.put(prefix + "settings", JSON.stringify(settings));
          // Map Slack team → ScopeHound user for slash commands
          if (tokenData.team?.id) {
            await env.STATE.put("slack_team:" + tokenData.team.id, userId);
          }
          // Send test message
          await sendSlack(tokenData.incoming_webhook.url, "ScopeHound is connected to #" + (tokenData.incoming_webhook.channel || "your channel") + ". You're all set!");
          // Redirect back to setup
          return Response.redirect(url.origin + "/setup?slack=connected", 302);
        } catch (e) {
          return new Response("Slack auth error: " + e.message, { status: 500 });
        }
      }

      // ── Slack slash commands ──
      if (path === "/api/slack/commands" && request.method === "POST") {
        if (!env.SLACK_SIGNING_SECRET) return new Response("Not configured", { status: 500 });
        const rawBody = await request.text();
        const timestamp = request.headers.get("x-slack-request-timestamp");
        const slackSig = request.headers.get("x-slack-signature");
        if (!timestamp || !slackSig) return new Response("Unauthorized", { status: 401 });
        if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return new Response("Expired", { status: 401 });
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", enc.encode(env.SLACK_SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const mac = await crypto.subtle.sign("HMAC", key, enc.encode("v0:" + timestamp + ":" + rawBody));
        const expected = "v0=" + Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
        if (expected.length !== slackSig.length) return new Response("Invalid signature", { status: 401 });
        let mismatch = 0;
        for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ slackSig.charCodeAt(i);
        if (mismatch !== 0) return new Response("Invalid signature", { status: 401 });

        const params = new URLSearchParams(rawBody);
        const command = (params.get("command") || "").trim();
        const text = (params.get("text") || "").trim();
        const teamId = params.get("team_id");
        const responseUrl = params.get("response_url");

        // Find the ScopeHound user for this Slack team
        const userId = await env.STATE.get("slack_team:" + teamId);
        if (!userId) {
          return jsonResponse({ response_type: "ephemeral", text: "This Slack workspace isn't linked to a ScopeHound account. Visit worker.scopehound.app/setup to connect." });
        }
        const userRaw = await env.STATE.get("user:" + userId);
        if (!userRaw) return jsonResponse({ response_type: "ephemeral", text: "Account not found." });
        const user = JSON.parse(userRaw);

        // ── /ads command ──
        if (command === "/ads") {
          if (!hasFeature(user.tier, "slash_ads")) {
            return jsonResponse({ response_type: "ephemeral", text: "The `/ads` command is available on Operator and Command plans. Upgrade at worker.scopehound.app/billing" });
          }
          if (!text) return jsonResponse({ response_type: "ephemeral", text: "Usage: `/ads <domain or company name>` — e.g. `/ads acme.com` or `/ads Acme Corp`" });

          // Look up competitor from user's config (match by domain or name)
          const prefix = "user_config:" + userId + ":";
          const compsRaw = await env.STATE.get(prefix + "competitors");
          const comps = compsRaw ? JSON.parse(compsRaw) : [];

          let input = text.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
          let domain = null;
          let companyName = null;

          if (input.includes(".")) {
            // Input looks like a domain
            domain = input.toLowerCase();
            const match = comps.find(c => {
              try { return new URL(c.website).hostname.replace(/^www\./, "") === domain; } catch { return false; }
            });
            companyName = match ? match.name : domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
          } else {
            // Input is a company name — try to find their domain from config
            companyName = input;
            const match = comps.find(c => c.name.toLowerCase() === input.toLowerCase());
            if (match) {
              try { domain = new URL(match.website).hostname.replace(/^www\./, ""); } catch {}
              companyName = match.name;
            }
          }

          // Respond immediately, then fetch ad data in background
          const immediate = jsonResponse({ response_type: "ephemeral", text: `🔎 Looking up ads for ${companyName}...` });

          ctx.waitUntil((async () => {
            try {
              const metaData = await fetchMetaAds(domain, companyName, env.META_APP_TOKEN, env);
              const blocks = formatAdsBlocks(domain, companyName, metaData);
              await fetch(responseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response_type: "ephemeral", blocks }),
              });
            } catch (e) {
              await fetch(responseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response_type: "ephemeral", text: "Error fetching ads: " + e.message }),
              });
            }
          })());
          return immediate;
        }

        // ── /scopehound commands ──
        if (!text || text === "help") {
          return jsonResponse({ response_type: "ephemeral", text: "*ScopeHound Commands*\n`/scopehound add <url>` — Add a competitor\n`/scopehound list` — List your competitors\n`/scopehound remove <name>` — Remove a competitor\n`/scopehound scan` — Trigger a manual scan\n`/scopehound set priority <high|medium|low>` — Filter alert priority\n`/ads <domain or name>` — Look up competitor ads" });
        }

        const prefix = "user_config:" + userId + ":";
        const compsRaw = await env.STATE.get(prefix + "competitors");
        let comps = compsRaw ? JSON.parse(compsRaw) : [];

        if (text === "list") {
          if (comps.length === 0) return jsonResponse({ response_type: "ephemeral", text: "No competitors configured. Use `/scopehound add <url>` to add one." });
          const list = comps.map((c, i) => `${i + 1}. *${c.name}* — ${c.website} (${c.pages.length} pages)`).join("\n");
          return jsonResponse({ response_type: "ephemeral", text: "*Your Competitors*\n" + list });
        }

        if (text.startsWith("add ")) {
          let compUrl = text.slice(4).trim();
          if (!/^https?:\/\//i.test(compUrl)) compUrl = "https://" + compUrl;
          const limits = getTierLimits(user.tier || "scout");
          if (comps.length >= limits.competitors) {
            return jsonResponse({ response_type: "ephemeral", text: `You've reached your ${limits.name} plan limit of ${limits.competitors} competitors. Upgrade at worker.scopehound.app/billing` });
          }
          // Respond immediately, then process async
          const immediate = jsonResponse({ response_type: "ephemeral", text: `Scanning ${compUrl}... I'll update you in a moment.` });

          // Process in background
                    ctx.waitUntil((async () => {
            try {
              const pages = await discoverPages(compUrl);
              const totalPages = comps.reduce((n, c) => n + (c.pages?.length || 0), 0) + pages.length;
              if (totalPages > limits.pages) {
                await fetch(responseUrl, { method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ response_type: "ephemeral", text: `Adding ${compUrl} would put you at ${totalPages} pages (limit: ${limits.pages}). Remove some pages or upgrade.` }) });
                return;
              }
              let hostname;
              try { hostname = new URL(compUrl).hostname.replace(/^www\./, ""); } catch { hostname = compUrl; }
              const name = hostname.split(".")[0].charAt(0).toUpperCase() + hostname.split(".")[0].slice(1);
              const newComp = { name, website: compUrl, blogRss: pages.find(p => p.rss)?.rss || null,
                pages: pages.map((p, i) => ({ id: p.type + "-" + i, url: p.url, type: p.type, label: p.label })) };
              comps.push(newComp);
              await env.STATE.put(prefix + "competitors", JSON.stringify(comps));
              const pageList = newComp.pages.map(p => `  • ${p.label}: ${p.url}`).join("\n");
              await fetch(responseUrl, { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response_type: "ephemeral", text: `Added *${name}* with ${newComp.pages.length} pages:\n${pageList}` }) });
            } catch (e) {
              await fetch(responseUrl, { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response_type: "ephemeral", text: "Error adding competitor: " + e.message }) });
            }
          })());
          return immediate;
        }

        if (text.startsWith("remove ")) {
          const name = text.slice(7).trim().toLowerCase();
          const idx = comps.findIndex(c => c.name.toLowerCase() === name || c.website.toLowerCase().includes(name));
          if (idx === -1) return jsonResponse({ response_type: "ephemeral", text: `Competitor "${text.slice(7).trim()}" not found. Use \`/scopehound list\` to see your competitors.` });
          const removed = comps.splice(idx, 1)[0];
          await env.STATE.put(prefix + "competitors", JSON.stringify(comps));
          return jsonResponse({ response_type: "ephemeral", text: `Removed *${removed.name}* (${removed.website}).` });
        }

        if (text.startsWith("set ")) {
          const args = text.slice(4).trim();
          const settingsKey = "user_config:" + userId + ":settings";
          const settRaw = await env.STATE.get(settingsKey);
          const sett = settRaw ? JSON.parse(settRaw) : {};
          if (args.startsWith("priority ")) {
            const level = args.slice(9).trim().toLowerCase();
            if (!["high", "medium", "low"].includes(level)) {
              return jsonResponse({ response_type: "ephemeral", text: "Invalid priority. Use `high`, `medium`, or `low`.\n• `high` — only pricing/product changes and major shifts\n• `medium` — feature updates and messaging changes (+ high)\n• `low` — everything including minor copy edits (default)" });
            }
            sett.slackMinPriority = level;
            await env.STATE.put(settingsKey, JSON.stringify(sett));
            const desc = { high: "only high-priority alerts (pricing/product changes, major shifts)", medium: "medium and high-priority alerts", low: "all alerts (default)" };
            return jsonResponse({ response_type: "ephemeral", text: `Alert filter updated. You'll now receive ${desc[level]}.` });
          }
          return jsonResponse({ response_type: "ephemeral", text: "Available settings:\n`/scopehound set priority <high|medium|low>` — Filter Slack alerts by priority" });
        }

        if (text === "scan") {
          if (!hasFeature(user.tier, "slash_scan")) {
            return jsonResponse({ response_type: "ephemeral", text: "The `/scopehound scan` command is available on Operator and Command plans. You can still trigger scans from your dashboard. Upgrade at worker.scopehound.app/billing" });
          }
          const config = await loadConfig(env, userId);
          ctx.waitUntil((async () => {
            await runMonitor(env, config, userId);
          })());
          return jsonResponse({ response_type: "ephemeral", text: "Scan triggered. Results will appear shortly." });
        }

        return jsonResponse({ response_type: "ephemeral", text: "Unknown command. Try `/scopehound help`." });
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
          const period = body.period === "annual" ? "annual" : "monthly";
          if (!tier || !TIERS[tier]) return jsonResponse({ error: "Invalid tier" }, 400);
          const session = await createCheckoutSession(env, user, tier, url.origin, period);
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
        return htmlResponse(BILLING_HTML);
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
        return htmlResponse(PARTNER_APPLY_HTML);
      }

      // ── Partner: submit application ──
      if (path === "/api/partner/apply" && request.method === "POST") {
        try {
          // Rate limit: 3 applications per IP per hour
          const ip = request.headers.get("CF-Connecting-IP") || "unknown";
          const rlKey = "partner_apply_rl:" + ip;
          const rlData = JSON.parse(await env.STATE.get(rlKey) || "null");
          const now = Date.now();
          if (rlData && rlData.count >= 3 && (now - rlData.first) < 3600000) {
            return jsonResponse({ error: "Too many requests. Please try again later." }, 429);
          }
          if (!rlData || (now - rlData.first) >= 3600000) {
            await env.STATE.put(rlKey, JSON.stringify({ count: 1, first: now }), { expirationTtl: 3600 });
          } else {
            await env.STATE.put(rlKey, JSON.stringify({ count: rlData.count + 1, first: rlData.first }), { expirationTtl: 3600 });
          }
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
            status: "pending",
            commissionRate: 0.5,
            commissionMonths: 24,
            referralCount: 0,
            totalEarnings: 0,
            pendingEarnings: 0,
            createdAt: new Date().toISOString(),
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
        return htmlResponse(PARTNER_DASHBOARD_HTML);
      }

      // ── Partner: stats API ──
      if (path === "/api/partner/stats") {
        // Rate limit: 20 requests per IP per 15 minutes
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const rlKey = "partner_stats_rl:" + ip;
        const rlData = JSON.parse(await env.STATE.get(rlKey) || "null");
        const now = Date.now();
        if (rlData && rlData.count >= 20 && (now - rlData.first) < 900000) {
          return jsonResponse({ error: "Too many requests. Please try again later." }, 429);
        }
        if (!rlData || (now - rlData.first) >= 900000) {
          await env.STATE.put(rlKey, JSON.stringify({ count: 1, first: now }), { expirationTtl: 900 });
        } else {
          await env.STATE.put(rlKey, JSON.stringify({ count: rlData.count + 1, first: rlData.first }), { expirationTtl: 900 });
        }
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

      // ── Partner: admin approve/reject ──
      if (path === "/api/admin/partner/approve" && request.method === "POST") {
        const adminSession = await getAdminSession(request, env);
        const authErr = requireAuth(request, env);
        if (!adminSession && authErr) return authErr;
        const body = await request.json();
        if (!body.code) return jsonResponse({ error: "code required" }, 400);
        const raw = await env.STATE.get("affiliate:" + body.code);
        if (!raw) return jsonResponse({ error: "Affiliate not found" }, 404);
        const affiliate = JSON.parse(raw);
        affiliate.status = body.reject ? "rejected" : "approved";
        if (!body.reject) affiliate.approvedAt = new Date().toISOString();
        await env.STATE.put("affiliate:" + body.code, JSON.stringify(affiliate));
        return jsonResponse({ success: true, status: affiliate.status });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN ROUTES — platform operator dashboard (works in both modes)
    // ══════════════════════════════════════════════════════════════════════════

    // ── Admin: login page ──
    if (path === "/admin/login" || path === "/admin/login/") {
      const adminSession = await getAdminSession(request, env);
      if (adminSession) return Response.redirect(url.origin + "/admin", 302);

      if (request.method === "POST") {
        if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH) {
          return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Admin credentials not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH secrets.</div>'));
        }
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const allowed = await checkAdminLoginRateLimit(env, ip);
        if (!allowed) {
          return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Too many attempts. Try again in 15 minutes.</div>'));
        }
        const formData = await request.formData();
        const username = formData.get("username") || "";
        const password = formData.get("password") || "";
        if (username !== env.ADMIN_USERNAME || !(await verifyAdminPassword(password, env.ADMIN_PASSWORD_HASH.toLowerCase()))) {
          await recordAdminLoginAttempt(env, ip, false);
          return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Invalid username or password.</div>'));
        }
        await recordAdminLoginAttempt(env, ip, true);
        const token = await createAdminSession(env);
        if (!token) {
          return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Session signing secret not available. Set JWT_SECRET or ADMIN_TOKEN.</div>'));
        }
        const headers = new Headers({ Location: url.origin + "/admin" });
        setAdminSessionCookie(headers, token);
        return new Response(null, { status: 302, headers });
      }

      return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", ""));
    }

    // ── Admin: logout ──
    if (path === "/admin/logout") {
      const headers = new Headers({ Location: url.origin + "/admin/login" });
      clearAdminSessionCookie(headers);
      return new Response(null, { status: 302, headers });
    }

    // ── Admin: dashboard ──
    if (path === "/admin" || path === "/admin/") {
      const adminSession = await getAdminSession(request, env);
      if (!adminSession) return Response.redirect(url.origin + "/admin/login", 302);
      return htmlResponse(ADMIN_DASHBOARD_HTML);
    }

    // ── Admin: KPI API ──
    if (path === "/api/admin/kpis") {
      const adminSession = await getAdminSession(request, env);
      if (!adminSession) return jsonResponse({ error: "Admin auth required" }, 401);
      const kpis = await aggregateKPIs(env);
      return jsonResponse(kpis);
    }

    // ── Contact form (public POST, admin GET) ──
    if (path === "/api/contact" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = (body.name || "").trim().slice(0, 200);
        const email = (body.email || "").trim().slice(0, 200);
        const message = (body.message || "").trim().slice(0, 2000);
        if (!name || !email || !message) return jsonResponse({ error: "Name, email, and message are required" }, 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Invalid email address" }, 400);
        // Rate limit: 5 submissions per IP per hour
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const rlKey = "contact_rl:" + ip;
        const rlData = JSON.parse(await env.STATE.get(rlKey) || "null");
        const now = Date.now();
        if (rlData && rlData.count >= 5 && (now - rlData.first) < 3600000) {
          return jsonResponse({ error: "Too many messages. Please try again later." }, 429);
        }
        if (!rlData || (now - rlData.first) >= 3600000) {
          await env.STATE.put(rlKey, JSON.stringify({ count: 1, first: now }), { expirationTtl: 3600 });
        } else {
          await env.STATE.put(rlKey, JSON.stringify({ count: rlData.count + 1, first: rlData.first }), { expirationTtl: 3600 });
        }
        const id = crypto.randomUUID();
        const entry = { id, name, email, message, ip, createdAt: new Date().toISOString(), read: false };
        await env.STATE.put("contact:" + id, JSON.stringify(entry));
        const headers = new Headers(SECURITY_HEADERS);
        headers.set("Access-Control-Allow-Origin", allowedOrigin);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...Object.fromEntries(headers), "Content-Type": "application/json" } });
      } catch (e) {
        return jsonResponse({ error: "Invalid request" }, 400);
      }
    }

    if (path === "/api/admin/contacts") {
      const adminSession = await getAdminSession(request, env);
      if (!adminSession) return jsonResponse({ error: "Admin auth required" }, 401);
      if (request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (id) await env.STATE.delete("contact:" + id);
        return jsonResponse({ success: true });
      }
      // Mark as read
      if (request.method === "PATCH") {
        const id = url.searchParams.get("id");
        if (id) {
          const raw = await env.STATE.get("contact:" + id);
          if (raw) {
            const entry = JSON.parse(raw);
            entry.read = true;
            await env.STATE.put("contact:" + id, JSON.stringify(entry));
          }
        }
        return jsonResponse({ success: true });
      }
      // List all contacts
      const contacts = [];
      let cursor = null;
      do {
        const list = await env.STATE.list({ prefix: "contact:", cursor, limit: 100 });
        for (const key of list.keys) {
          const raw = await env.STATE.get(key.name);
          if (raw) contacts.push(JSON.parse(raw));
        }
        cursor = list.list_complete ? null : list.cursor;
      } while (cursor);
      contacts.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return jsonResponse({ contacts });
    }

    // ── Admin: Manual cron trigger (for testing) ──
    if (path === "/api/admin/trigger-cron" && request.method === "POST") {
      const adminSession = await getAdminSession(request, env);
      const authErr = requireAuth(request, env);
      if (!adminSession && authErr) return authErr;

      const userId = url.searchParams.get("user") || null;
      const dryRun = url.searchParams.get("dry_run") === "true";
      const forceMode = url.searchParams.get("mode") || null; // "light" forces light mode, default = deep
      const logs = [];
      const origLog = console.log;
      console.log = (...args) => { logs.push(args.join(" ")); origLog(...args); };

      try {
        if (userId) {
          // Test a single user
          const uRaw = await env.STATE.get("user:" + userId);
          if (!uRaw) return jsonResponse({ error: "User not found" }, 404);
          const user = JSON.parse(uRaw);
          const tier = user.tier || "scout";
          const cfg = await loadConfig(env, userId);
          const info = {
            userId, email: user.email, tier,
            subscriptionStatus: user.subscriptionStatus,
            hasScheduledScans: hasFeature(tier, "scheduled_scans"),
            competitorCount: cfg.competitors.length,
            slackWebhookConfigured: !!cfg.settings.slackWebhookUrl,
            slackOAuthConfigured: !!cfg.settings.slackAccessToken,
          };
          if (!dryRun) {
            await runMonitor(env, null, userId);
          }
          return jsonResponse({ mode: dryRun ? "dry_run" : "executed", user: info, logs });
        }

        // Full cron simulation
        const raw = await env.STATE.get("active_subscribers");
        const list = raw ? JSON.parse(raw) : [];
        const results = [];

        for (const uid of list) {
          const uRaw = await env.STATE.get("user:" + uid);
          if (!uRaw) { results.push({ userId: uid, status: "not_found" }); continue; }
          const user = JSON.parse(uRaw);
          const tier = user.tier || "scout";
          const cfg = await loadConfig(env, uid);
          const info = {
            userId: uid, email: user.email, tier,
            subscriptionStatus: user.subscriptionStatus,
            competitorCount: cfg.competitors.length,
            slackWebhookConfigured: !!cfg.settings.slackWebhookUrl,
          };

          if (user.subscriptionStatus !== "active") { results.push({ ...info, status: "skipped_inactive" }); continue; }

          // Weekly suggestions (always runs on manual trigger for testing)
          // Use ?mode=light to force light mode (single Sonnet call) for testing fallback
          if (!dryRun) {
            try {
              if (cfg.settings._productMeta && cfg.settings.slackWebhookUrl) {
                const suggestKey = `user_state:${uid}:weekly_suggestions`;
                const prevRaw = await env.STATE.get(suggestKey);
                const prevData = prevRaw ? JSON.parse(prevRaw) : { suggested: [], lastRun: null };
                const now = Date.now();
                const recentSuggested = (prevData.suggested || []).filter(s => {
                  if (typeof s === "string") return true;
                  return s.date && (now - new Date(s.date).getTime()) < 90 * 24 * 60 * 60 * 1000;
                }).map(s => typeof s === "string" ? s : s.name);

                let suggestions;
                if (forceMode !== "light" && env.BRAVE_SEARCH_API_KEY) {
                  // Deep chain (default for trigger-cron, unless ?mode=light)
                  console.log(`Running deep competitor discovery for ${user.email}`);
                  const enriched = await enrichProductMeta(env, cfg.settings._productMeta, null);
                  if (enriched !== cfg.settings._productMeta) {
                    const settingsKey = `user_config:${uid}:settings`;
                    const settRaw = await env.STATE.get(settingsKey);
                    const fullSettings = settRaw ? JSON.parse(settRaw) : {};
                    fullSettings._productMeta = enriched;
                    await env.STATE.put(settingsKey, JSON.stringify(fullSettings));
                  }
                  suggestions = await deepCompetitorDiscovery(env, enriched, cfg.competitors, recentSuggested);
                } else {
                  suggestions = await suggestNewCompetitors(env, cfg.settings._productMeta, cfg.competitors, recentSuggested);
                }

                if (suggestions && suggestions.length > 0) {
                  const message = formatWeeklySuggestions(suggestions, cfg.settings._productMeta, tier);
                  await sendSlack(cfg.settings.slackWebhookUrl, message);
                  const newEntries = suggestions.map(s => ({ name: s.name, date: new Date().toISOString() }));
                  const updatedSuggested = [...(prevData.suggested || []).filter(s => {
                    const d = typeof s === "string" ? null : s.date;
                    return d && (now - new Date(d).getTime()) < 90 * 24 * 60 * 60 * 1000;
                  }), ...newEntries];
                  await env.STATE.put(suggestKey, JSON.stringify({ suggested: updatedSuggested, lastRun: new Date().toISOString() }));
                  console.log(`Weekly suggestions sent for ${user.email}: ${suggestions.length} suggestions (${forceMode === "light" ? "light" : "deep"})`);
                }
              } else {
                console.log(`Skipping weekly suggestions for ${user.email}: ${!cfg.settings._productMeta ? "no productMeta" : "no Slack"}`);
              }
            } catch (e) {
              console.log(`Weekly suggestions failed for ${user.email}: ${e.message}`);
            }
          }

          if (!hasFeature(tier, "scheduled_scans")) { results.push({ ...info, status: "skipped_no_scheduled_scans" }); continue; }

          if (!dryRun) {
            try { await runMonitor(env, null, uid); results.push({ ...info, status: "executed" }); }
            catch (e) { results.push({ ...info, status: "error", error: e.message }); }
          } else {
            results.push({ ...info, status: "would_run" });
          }
        }

        return jsonResponse({ mode: dryRun ? "dry_run" : "executed", subscriberCount: list.length, results, logs });
      } finally {
        console.log = origLog;
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
        return htmlResponse(HOSTED_SETUP_HTML);
      }
      return htmlResponse(SETUP_HTML);
    }

    // ── Admin: Migrate tier names (one-time: recon→scout, strategic→command) ──
    if (path === "/api/admin/migrate-tiers" && request.method === "POST") {
      const adminSession = await getAdminSession(request, env);
      const authErr = requireAuth(request, env);
      if (!adminSession && authErr) return authErr;
      const dryRun = url.searchParams.get("dry_run") === "true";
      const tierMap = { recon: "scout", strategic: "command" };
      const results = [];
      let cursor = null;
      do {
        const list = await env.STATE.list({ prefix: "user:", cursor });
        for (const key of list.keys) {
          const raw = await env.STATE.get(key.name);
          if (!raw) continue;
          try {
            const user = JSON.parse(raw);
            const oldTier = user.tier;
            const newTier = tierMap[oldTier];
            if (newTier) {
              if (!dryRun) {
                user.tier = newTier;
                await env.STATE.put(key.name, JSON.stringify(user));
              }
              results.push({ key: key.name, email: user.email, from: oldTier, to: newTier, migrated: !dryRun });
            }
          } catch {}
        }
        cursor = list.list_complete ? null : list.cursor;
      } while (cursor);
      return jsonResponse({ dryRun, migrated: results.length, results });
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
      return htmlResponse(DASHBOARD_HTML);
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
        headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
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
        const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
        const existingRaw = await env.STATE.get(prefix + "settings");
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        const settings = {
          ...existing,
          slackWebhookUrl: body.slackWebhookUrl !== undefined ? (body.slackWebhookUrl || null) : (existing.slackWebhookUrl || null),
          productHuntTopics: body.productHuntTopics !== undefined ? body.productHuntTopics : (existing.productHuntTopics || []),
          announcementKeywords: body.announcementKeywords !== undefined ? body.announcementKeywords : (existing.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS),
          phMinVotes: body.phMinVotes !== undefined ? body.phMinVotes : (existing.phMinVotes ?? 0),
          radarSubreddits: body.radarSubreddits !== undefined ? body.radarSubreddits : (existing.radarSubreddits || []),
          _productMeta: body._productMeta !== undefined ? body._productMeta : (existing._productMeta || null),
        };
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

      // Scout tier: enforce 24hr cooldown on manual scans
      if (userId) {
        const tier = (user.tier || "scout").toLowerCase();
        if (tier === "scout" || tier === "recon") {
          const cooldownKey = `user_state:${userId}:lastManualScan`;
          const lastScanRaw = await env.STATE.get(cooldownKey);
          if (lastScanRaw) {
            const hoursSince = (Date.now() - new Date(lastScanRaw).getTime()) / (1000 * 60 * 60);
            if (hoursSince < 24) {
              const nextScanAt = new Date(new Date(lastScanRaw).getTime() + 24 * 60 * 60 * 1000).toISOString();
              return jsonResponse({ error: "Scan cooldown active", cooldown: true, nextScanAt, hoursRemaining: Math.ceil(24 - hoursSince) }, 429);
            }
          }
        }
      }

      const config = await loadConfig(env, userId);
      const result = await runMonitor(env, config, userId);

      // Record scan timestamp for cooldown tracking
      if (userId) {
        await env.STATE.put(`user_state:${userId}:lastManualScan`, new Date().toISOString());
      }

      const slackOk = result.slackResults.filter(r => r.ok).length;
      const slackErrors = result.slackResults.filter(r => !r.ok).map(r => r.error);
      return jsonResponse({
        success: true,
        alertsDetected: result.alerts.length,
        slackUrl: result.slackUrl,
        slackMessages: { sent: slackOk, failed: slackErrors.length, errors: slackErrors },
        subrequests: result.subrequests,
      });
    }

    // ── Scan status (cooldown check for dashboard) ──
    if (path === "/api/scan/status") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      const userId = isHostedMode(env) ? user.id : null;
      const tier = (user.tier || "scout").toLowerCase();
      const isScout = tier === "scout" || tier === "recon";
      if (!isScout || !userId) return jsonResponse({ canScan: true, cooldown: false, tier });
      const lastScanRaw = await env.STATE.get(`user_state:${userId}:lastManualScan`);
      if (!lastScanRaw) return jsonResponse({ canScan: true, cooldown: false, tier, lastScan: null });
      const hoursSince = (Date.now() - new Date(lastScanRaw).getTime()) / (1000 * 60 * 60);
      if (hoursSince >= 24) return jsonResponse({ canScan: true, cooldown: false, tier, lastScan: lastScanRaw });
      const nextScanAt = new Date(new Date(lastScanRaw).getTime() + 24 * 60 * 60 * 1000).toISOString();
      return jsonResponse({ canScan: false, cooldown: true, tier, lastScan: lastScanRaw, nextScanAt, hoursRemaining: Math.ceil(24 - hoursSince) });
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

    // ── Config API: Discover Competitors (AI) ──
    if (path === "/api/config/discover-competitors" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      if (!hasFeature(user.tier || "scout", "ai_discovery")) {
        return jsonResponse({ error: "AI competitor discovery is available on the Operator plan. Upgrade to let ScopeHound automatically find and track your competitors." }, 403);
      }
      try {
        const body = await request.json();
        if (!body.url) return jsonResponse({ error: "url required" }, 400);
        let compUrl = body.url.trim();
        if (!/^https?:\/\//i.test(compUrl)) compUrl = "https://" + compUrl;
        const seeds = Array.isArray(body.seeds) ? body.seeds.map(s => s.trim()).filter(Boolean) : [];
        const result = await discoverCompetitors(env, compUrl, seeds);
        return jsonResponse(result);
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Suggest Subreddits for Radar ──
    if (path === "/api/config/suggest-subreddits" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      if (!hasFeature(user.tier || "scout", "competitor_radar")) {
        return jsonResponse({ error: "Competitor Radar is available on the Command plan." }, 403);
      }
      try {
        const body = await request.json();
        if (!body.productMeta) return jsonResponse({ error: "productMeta required" }, 400);
        const result = await suggestSubreddits(env, body.productMeta);
        // Also save product meta to settings for radar to use later
        const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
        const existingRaw = await env.STATE.get(prefix + "settings");
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        existing._productMeta = { name: body.productMeta.product_name, category: body.productMeta.category, subcategory: body.productMeta.subcategory, keywords: body.productMeta.keywords, target_audience: body.productMeta.target_audience };
        await env.STATE.put(prefix + "settings", JSON.stringify(existing));
        return jsonResponse(result || { subreddits: [] });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Config API: Suggest PH Topics ──
    if (path === "/api/config/suggest-ph-topics" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      try {
        const body = await request.json();
        if (!body.productMeta) return jsonResponse({ error: "productMeta required" }, 400);
        const result = await suggestPHTopics(env, body.productMeta);
        return jsonResponse(result || { topics: [] });
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

    // ── Privacy Policy ──
    if (path === "/privacy" || path === "/privacy/") {
      return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy Policy — ScopeHound</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.7}
a{color:#7a8c52}.wrap{max-width:720px;margin:0 auto;padding:32px 24px}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}header h1 span{color:#5c6b3c}
h2{font-size:20px;margin:32px 0 12px;color:#7a8c52;font-weight:700}h3{font-size:15px;margin:20px 0 8px;color:#d4d8de}
p,li{font-size:14px;color:#b0b5bd;margin-bottom:8px}ul{margin-left:20px;margin-bottom:12px}
.updated{font-size:12px;color:#6b7280;margin-bottom:24px}</style></head><body>
<header><div><a href="/" style="text-decoration:none;color:inherit"><h1>Scope<span>Hound</span></h1></a></div><a href="/support" style="font-size:13px">Support</a></header>
<div class="wrap">
<h1 style="font-size:24px;margin-bottom:4px">Privacy Policy</h1>
<p class="updated">Last updated: February 10, 2026</p>

<h2>1. Who We Are</h2>
<p>ScopeHound ("we", "us", "our") is a competitive intelligence service operated as a sole proprietorship. For privacy inquiries, contact us at <a href="mailto:support@scopehound.app">support@scopehound.app</a>.</p>

<h2>2. Information We Collect</h2>
<h3>Account Information</h3>
<p>When you sign in with Google, we receive your name, email address, and profile picture from Google OAuth. We store this to identify your account.</p>
<h3>Payment Information</h3>
<p>Payments are processed by <a href="https://stripe.com/privacy">Stripe</a>. We do not store your credit card number. We store your Stripe customer ID and subscription status to manage your plan.</p>
<h3>Slack Integration</h3>
<p>When you connect Slack, we store your incoming webhook URL, channel name, and team name to deliver reports. We do not read your Slack messages.</p>
<h3>Competitor Data</h3>
<p>We store the competitor URLs, page configurations, and monitoring data you configure. We also store change history and AI-generated analysis of publicly available web pages.</p>
<h3>Usage Analytics</h3>
<p>We use <a href="https://clarity.microsoft.com/">Microsoft Clarity</a> to understand how users interact with our site. Clarity may collect anonymized usage data including clicks, scrolls, and session recordings. No personal data is shared with Clarity.</p>

<h2>3. How We Use Your Information</h2>
<ul>
<li>To provide the ScopeHound service (scanning competitors, generating reports, delivering Slack briefings)</li>
<li>To manage your subscription and billing</li>
<li>To communicate service updates or respond to support requests</li>
<li>To improve our product based on anonymized usage patterns</li>
</ul>

<h2>4. Data Sharing</h2>
<p>We do not sell your personal information. We share data only with:</p>
<ul>
<li><strong>Stripe</strong> — for payment processing</li>
<li><strong>Google</strong> — for authentication (OAuth)</li>
<li><strong>Slack</strong> — to deliver reports to your workspace</li>
<li><strong>Cloudflare</strong> — our infrastructure provider (hosting, Workers AI)</li>
<li><strong>Microsoft Clarity</strong> — anonymized usage analytics</li>
</ul>

<h2>5. Data Storage & Security</h2>
<p>Your data is stored on Cloudflare's global network using Workers KV. Sessions are secured with encrypted JWT tokens over HTTPS. We use HttpOnly, Secure cookies with a 30-day expiration.</p>

<h2>6. Data Retention</h2>
<p>Account data is retained while your account is active. Competitor monitoring history is retained based on your plan tier (30 days to unlimited). If you cancel your subscription, we retain your data for 30 days before deletion to allow reactivation.</p>

<h2>7. Your Rights</h2>
<p>You may:</p>
<ul>
<li>Request a copy of your stored data</li>
<li>Request deletion of your account and all associated data</li>
<li>Update your competitor configurations at any time</li>
<li>Disconnect Slack integration at any time</li>
</ul>
<p>To exercise these rights, email <a href="mailto:support@scopehound.app">support@scopehound.app</a>.</p>

<h2>8. Cookies</h2>
<p>We use a single session cookie (<code>sh_session</code>) to keep you logged in. It is HttpOnly, Secure, and expires after 30 days. We also use Microsoft Clarity which may set its own cookies for analytics purposes.</p>

<h2>9. Children's Privacy</h2>
<p>ScopeHound is not intended for use by individuals under 16. We do not knowingly collect data from children.</p>

<h2>10. Changes to This Policy</h2>
<p>We may update this policy from time to time. Material changes will be communicated via email or in-app notification. Continued use of the service after changes constitutes acceptance.</p>

<h2>11. Contact</h2>
<p>For questions about this privacy policy or your data, contact us at <a href="mailto:support@scopehound.app">support@scopehound.app</a>.</p>
</div></body></html>`, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    // ── Support / Contact ──
    if (path === "/support" || path === "/support/") {
      return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Support — ScopeHound</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.7}
a{color:#7a8c52}.wrap{max-width:720px;margin:0 auto;padding:32px 24px}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}header h1 span{color:#5c6b3c}
h2{font-size:20px;margin:32px 0 12px;color:#7a8c52;font-weight:700}
p{font-size:14px;color:#b0b5bd;margin-bottom:12px}
.contact-card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:24px;text-align:center;margin:24px 0}
.contact-card .email{font-size:20px;font-weight:700;color:#7a8c52;margin:8px 0}
.contact-card p{color:#6b7280;font-size:13px}
.btn{display:inline-block;padding:12px 24px;border-radius:2px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;text-decoration:none;margin-top:12px}
.btn-primary{background:#5c6b3c;color:#fff}
.faq{margin-top:32px}
.faq-item{background:#12161a;border:1px solid #2a3038;border-radius:2px;margin-bottom:8px}
.faq-item summary{padding:14px 16px;cursor:pointer;font-size:14px;font-weight:600;color:#d4d8de}
.faq-item summary:hover{color:#7a8c52}
.faq-item p{padding:0 16px 14px;font-size:13px;color:#b0b5bd;margin:0}
</style></head><body>
<header><div><a href="/" style="text-decoration:none;color:inherit"><h1>Scope<span>Hound</span></h1></a></div><a href="/privacy" style="font-size:13px">Privacy</a></header>
<div class="wrap">
<h1 style="font-size:24px;margin-bottom:4px">Support</h1>
<p>Need help with ScopeHound? We're here for you.</p>

<div class="contact-card">
<p style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7280;margin-bottom:4px">Email Us</p>
<div class="email">support@scopehound.app</div>
<p>We typically respond within 24 hours.</p>
<a href="mailto:support@scopehound.app?subject=ScopeHound%20Support%20Request" class="btn btn-primary">Send Email</a>
</div>

<div class="faq">
<h2>Frequently Asked Questions</h2>

<details class="faq-item"><summary>How do I add or remove competitors?</summary>
<p>Go to your dashboard and click "Manage Competitors" in the navigation bar. This takes you to the setup wizard where you can add, scan, or remove competitors. You can also use Slack commands: <code>/scopehound add url</code> or <code>/scopehound remove name</code>.</p></details>

<details class="faq-item"><summary>When do scans run?</summary>
<p>Scans run automatically once daily at 9:00 AM UTC for Operator and Command plans. Scout is manual-only. You can also trigger a manual scan from the setup wizard or via <code>/scopehound scan</code> in Slack.</p></details>

<details class="faq-item"><summary>How do I connect Slack?</summary>
<p>During setup, click "Add to Slack" to authorize ScopeHound to send reports to your workspace. You can also manually enter a webhook URL if you prefer. Visit /setup to reconfigure your Slack connection.</p></details>

<details class="faq-item"><summary>How do I change my plan?</summary>
<p>Go to <a href="/billing">/billing</a> to view your current plan and upgrade or downgrade. You can also manage your subscription directly through Stripe's customer portal.</p></details>

<details class="faq-item"><summary>How do I cancel my subscription?</summary>
<p>Go to <a href="/billing">/billing</a> and click "Manage subscription on Stripe" to cancel. Your data will be retained for 30 days after cancellation.</p></details>

<details class="faq-item"><summary>Can I self-host ScopeHound?</summary>
<p>Yes! ScopeHound is open source. Visit our <a href="https://github.com/ZeroLupo/scopehound">GitHub repository</a> to deploy your own instance on Cloudflare Workers for free.</p></details>

<details class="faq-item"><summary>How do I delete my account?</summary>
<p>Email <a href="mailto:support@scopehound.app?subject=Account%20Deletion%20Request">support@scopehound.app</a> with the subject "Account Deletion Request" and we'll process it within 48 hours.</p></details>
</div>
</div></body></html>`, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    // ── Manual run (auth required) ──
    if (path === "/test" || path === "/run") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      const result = await runMonitor(env);
      const slackOk = result.slackResults.filter(r => r.ok).length;
      const slackErrors = result.slackResults.filter(r => !r.ok).map(r => r.error);
      return new Response(
        JSON.stringify({ success: true, alertsDetected: result.alerts.length, slackUrl: result.slackUrl, slackMessages: { sent: slackOk, failed: slackErrors.length, errors: slackErrors }, alerts: result.alerts.map((a) => a.text || a) }, null, 2),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Raw state (auth required) ──
    if (path === "/state") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      const state = await env.STATE.get("monitor_state");
      return new Response(state || "{}", { headers: { "Content-Type": "application/json" } });
    }

    // ── History (auth required) ──
    if (path === "/history") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      const history = await env.STATE.get("change_history");
      return new Response(history || "[]", { headers: { "Content-Type": "application/json" } });
    }

    // ── Test Slack (auth required) ──
    if (path === "/test-slack") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      const config = await loadConfig(env);
      await sendSlack(config.settings.slackWebhookUrl,
        "ScopeHound v3 is connected!\n\nDashboard: " + url.origin + "/dashboard"
      );
      return jsonResponse({ success: true, message: "Test sent to Slack" });
    }

    // ── Reset all (auth required) ──
    if (path === "/reset") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
      await env.STATE.delete("monitor_state");
      await env.STATE.delete("dashboard_cache");
      return jsonResponse({ success: true, message: "State reset. Run /test to re-index." });
    }

    // ── Reset pricing (auth required) ──
    if (path === "/reset-pricing") {
      const authErr = requireAuth(request, env);
      if (authErr) return authErr;
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
      `ScopeHound v3\n\nMonitoring ${config.competitors.length} competitor(s). Visit /dashboard to get started.`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
