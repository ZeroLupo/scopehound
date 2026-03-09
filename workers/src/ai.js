// AI — LLM calls, competitor discovery, radar, pricing analysis, announcements.

import { canSubrequest, trackSubrequest } from "./context.js";
import { htmlToText, fetchUrl, verifyUrl, withTimeout } from "./utils.js";

// ─── Workers AI (free, no subrequest cost) — used for daily scan analysis ───
export async function callWorkersAI(env, prompt, { maxTokens = 500 } = {}) {
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

// ─── Claude API (paid, uses subrequest) — used for analysis + discovery ──
export async function callClaude(ctx, env, prompt, { model = "claude-haiku-4-5-20251001", maxTokens = 1000, system } = {}) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey || !canSubrequest(ctx)) return null;
  trackSubrequest(ctx);
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = system;
  try {
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
    if (!jsonMatch) return null;
    try { return JSON.parse(jsonMatch[0]); } catch (e) { console.log(`[ai:callClaude] JSON parse failed: ${e.message}`); return null; }
  } catch (e) {
    console.log(`[Claude API] ${e.message}`);
    return null;
  }
}

export function extractPricingText(html) {
  // 1. Extract JSON-LD product data (common on Shopify, WooCommerce, etc.)
  const jsonLdParts = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      if (data["@type"] === "Product" || data["@type"] === "ItemList" || (Array.isArray(data) && data.some(d => d["@type"] === "Product"))) {
        jsonLdParts.push(m[1].slice(0, 3000));
      }
    } catch {} // Expected: JSON-LD block may contain non-product or malformed data
  }
  // 2. Extract price data from inline scripts (Shopify BOLD, product JSON, etc.)
  const scriptPriceRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  const priceParts = [];
  while ((m = scriptPriceRegex.exec(html)) !== null) {
    const script = m[1];
    // Only include scripts that contain price-like data
    if (/["']price["']\s*:|"amount"\s*:|"price_min"|"compare_at_price"/.test(script)) {
      // Extract just the lines with pricing info (not the whole script)
      const lines = script.split("\n").filter(l => /price|amount|variant/i.test(l) && /\d/.test(l));
      if (lines.length > 0) priceParts.push(lines.slice(0, 30).join("\n"));
    }
  }
  // 3. Visible text
  const visibleText = htmlToText(html);
  // Combine: JSON-LD first (most structured), then script prices, then visible text
  const parts = [];
  if (jsonLdParts.length) parts.push("STRUCTURED DATA:\n" + jsonLdParts.join("\n"));
  if (priceParts.length) parts.push("SCRIPT PRICING:\n" + priceParts.join("\n").slice(0, 3000));
  parts.push(visibleText);
  return parts.join("\n\n").slice(0, 10000);
}

export async function extractPricingWithLLM(ctx, html, env) {
  if (!env.AI && !env.ANTHROPIC_API_KEY) return null;
  const text = extractPricingText(html);
  const prompt = `Extract all pricing information from this webpage content. Return a JSON object with this structure:
{"plans":[{"name":"Product/Plan Name","price":"$X.XX or $X/mo or Custom or Free","features":["key feature 1","key feature 2"]}],"notes":"Any important pricing notes like discounts, trials, etc."}
If no pricing is found, return {"plans":[],"notes":"No pricing found"}.
Only return valid JSON, no other text.
Webpage content:
${text}`;
  try {
    if (env.ANTHROPIC_API_KEY) {
      const result = await callClaude(ctx, env, prompt, { maxTokens: 500 });
      if (result) return result;
    }
    if (env.AI) {
      return await callWorkersAI(env, prompt);
    }
    return null;
  } catch (error) {
    console.log(`  AI pricing error: ${error.message}`);
    return null;
  }
}

export async function analyzePageChange(ctx, env, competitorName, pageLabel, pageType, diff) {
  if (diff.changeRatio > 0.8) {
    return {
      summary: "Major page overhaul — most content replaced",
      analysis: "The page was substantially rewritten. This typically signals a rebrand, repositioning, or platform migration.",
      priority: pageType === "pricing" ? "high" : "medium",
      recommendation: "Compare the new page against cached version to identify strategic shifts.",
    };
  }

  const prompt = `You are a competitive intelligence analyst. A competitor's web page has changed.

Competitor: ${competitorName}
Page: ${pageLabel} (${pageType})

REMOVED content:
${diff.beforeExcerpt || "(none)"}

ADDED content:
${diff.afterExcerpt || "(none)"}

Respond with ONLY valid JSON:
{"summary":"One specific sentence about what changed (reference actual content)","analysis":"2-3 sentences: competitive implications — what this signals about their strategy, how it affects the market","priority":"high or medium or low","recommendation":"One specific, actionable sentence"}

Priority: high = pricing changes, new/removed products, major positioning shifts. medium = feature messaging, value prop changes, new integrations. low = copy edits, date updates, formatting.
IMPORTANT: Reference the ACTUAL content that changed. Never say generic things like "page content changed" or "review the page". If the diff is trivial, say so specifically.
CAREERS/HIRING PAGES: When job listings are removed, it almost always means the role was filled — NOT that they are "restructuring" or "shifting strategy". When new roles are added, that signals hiring/growth in that area. Frame careers changes around team growth and hiring velocity, not organizational pivots.`;

  // Prefer Claude Haiku for quality; fall back to Workers AI
  if (env.ANTHROPIC_API_KEY) {
    try {
      const result = await callClaude(ctx, env, prompt, { maxTokens: 300 });
      if (result) return result;
    } catch (error) {
      console.log(`  Claude analysis error: ${error.message}`);
    }
  }

  // Workers AI fallback (free tier / no API key)
  if (env.AI) {
    try {
      const result = await callWorkersAI(env, prompt, { maxTokens: 300 });
      if (result) return result;
    } catch (error) {
      console.log(`  Workers AI analysis error: ${error.message}`);
    }
  }

  return null;
}

export async function classifyAnnouncement(ctx, env, competitorName, postTitle, matchedCategory) {
  const fallback = { category: matchedCategory, priority: "medium", summary: postTitle };
  const prompt = `Classify this blog post from competitor "${competitorName}".
Title: "${postTitle}"
Detected category: ${matchedCategory}
Respond with ONLY valid JSON:
{"category":"funding or partnership or acquisition or event or hiring or product or other","priority":"high or medium or low","summary":"One sentence explanation"}
Return ONLY the JSON object.`;

  if (env.ANTHROPIC_API_KEY) {
    try {
      const result = await callClaude(ctx, env, prompt, { maxTokens: 200 });
      if (result) return result;
    } catch (error) {
      console.log(`  Claude classify error: ${error.message}`);
    }
  }
  if (env.AI) {
    try {
      const result = await callWorkersAI(env, prompt, { maxTokens: 200 });
      if (result) return result;
    } catch (error) {
      console.log(`  Workers AI classify error: ${error.message}`);
    }
  }
  return fallback;
}

// ─── AI COMPETITOR DISCOVERY ────────────────────────────────────────────────

export async function searchDDG(ctx, query) {
  if (!canSubrequest(ctx)) return [];
  // Try DuckDuckGo HTML with browser-like UA
  try {
    trackSubrequest(ctx);
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
  if (!canSubrequest(ctx)) return [];
  try {
    trackSubrequest(ctx);
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
export async function braveSearch(ctx, env, query) {
  if (!env.BRAVE_SEARCH_API_KEY || !canSubrequest(ctx)) return [];
  trackSubrequest(ctx);
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

export function extractPageMeta(html) {
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

export function extractBodyText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
}

// Sites that should never be added as competitors (profile/social/review sites)
export const SITE_BLOCKLIST = ["crunchbase.com", "g2.com", "linkedin.com", "twitter.com", "x.com", "facebook.com", "wikipedia.org", "youtube.com", "github.com", "producthunt.com", "trustpilot.com", "capterra.com", "getapp.com", "softwareadvice.com", "reddit.com", "quora.com", "medium.com", "forbes.com", "techcrunch.com"];
// Subset: sites with NO useful competitor mentions in search snippets (filter from search results)
// Reddit, Product Hunt, Medium, listicle sites are KEPT — they mention competitor names Claude can extract
export const SEARCH_FILTER = ["linkedin.com", "twitter.com", "x.com", "facebook.com", "wikipedia.org", "youtube.com", "github.com", "trustpilot.com"];

export async function discoverCompetitors(ctx, env, companyUrl, seedCompetitors) {
  // ── Step 1: Fetch and extract site content ──
  const html = await fetchUrl(ctx, companyUrl);
  if (!html) throw new Error("Could not fetch your website. Check the URL and try again.");
  const meta = extractPageMeta(html);
  const bodyText = extractBodyText(html);
  const domain = new URL(companyUrl).hostname.replace(/^www\./, "");

  // Try fetching /pricing or /features for richer context (max 2 extra pages)
  const extraContent = [];
  for (const subpath of ["/pricing", "/features"]) {
    try {
      const extraHtml = await fetchUrl(ctx, `https://${domain}${subpath}`);
      if (extraHtml && extraHtml.length > 500) {
        extraContent.push(extractBodyText(extraHtml).slice(0, 1500));
      }
    } catch {} // Expected: sub-page may not exist
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
    productMeta = await callClaude(ctx, env, metadataPrompt, { maxTokens: 800 });
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
    try { return new URL(s.startsWith("http") ? s : "https://" + s).hostname.replace(/^www\./, ""); } catch { return s; } // Expected: seed may not be a valid URL
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
    const results = await searchDDG(ctx, q);
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
    } catch { return true; } // Expected: results without parseable URLs
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
    parsed = await callClaude(ctx, env, analysisPrompt, { model: "claude-sonnet-4-5-20250929", maxTokens: 2000 });
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
    } catch { return false; } // Expected: malformed URL from AI response
  });

  // Verify URLs actually exist (filter out hallucinated domains)
  const verified = [];
  for (const c of parsed.competitors || []) {
    if (await verifyUrl(ctx, c.url)) {
      verified.push(c);
    } else {
      console.log(`  Filtered hallucinated competitor: ${c.name} (${c.url})`);
    }
  }
  parsed.competitors = verified;

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

export async function suggestSubreddits(ctx, env, productMeta) {
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
    return await callClaude(ctx, env, prompt, { maxTokens: 500 });
  } catch (e) { console.log(`[ai:suggestSubreddits] ${e.message}`); return null; }
}

export async function fetchRedditRSS(ctx, subreddit) {
  if (!canSubrequest(ctx)) return [];
  try {
    trackSubrequest(ctx);
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
  } catch (e) { console.log(`[ai:fetchRedditRSS] ${e.message}`); return []; }
}

export async function radarScanReddit(ctx, env, settings, state, productMeta, existingCompetitors) {
  const subs = settings.radarSubreddits || [];
  if (subs.length === 0) return [];
  const keywords = (productMeta?.keywords || []).concat([
    productMeta?.category, productMeta?.subcategory,
  ]).filter(Boolean).map(k => k.toLowerCase());
  if (keywords.length === 0) return [];

  const radarState = state.radar || { seenPostIds: [] };
  const seenIds = new Set(radarState.seenPostIds || []);
  const existingDomains = existingCompetitors.map(c => {
    try { return new URL(c.website.startsWith("http") ? c.website : "https://" + c.website).hostname.replace(/^www\./, ""); } catch { return ""; } // Expected: malformed competitor URL
  }).filter(Boolean);

  const newPosts = [];
  for (const sub of subs) {
    const subName = typeof sub === "string" ? sub : sub.name;
    console.log(`  Radar: r/${subName}...`);
    const posts = await fetchRedditRSS(ctx, subName);
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
    const result = await callClaude(ctx, env, `You are a competitive intelligence analyst. These Reddit posts were flagged as relevant to ${productMeta.product_name} (${productMeta.subcategory || productMeta.category}).

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
  } catch (e) { console.log(`[ai:radarScanReddit] ${e.message}`); return []; }
}

export function formatRadarAlert(radarFinds) {
  let text = `\u{1F52D} *Competitor Radar* \u2014 ${radarFinds.length} new competitor${radarFinds.length > 1 ? "s" : ""} spotted\n`;
  for (const c of radarFinds) {
    const score = c.match_score ? ` \u00B7 ${c.match_score}% match` : "";
    text += `\n>*${c.name}* (${c.url})${score}\n>${c.reason}\n>_Found in r/${c.subreddit}: "${c.source_post}"_\n`;
  }
  text += `\n_Add these via /setup or reply with_ \`/scopehound add <url>\``;
  return text;
}

// ─── WEEKLY COMPETITOR SUGGESTIONS (Sonnet, runs every Friday) ───────────────

export async function suggestNewCompetitors(ctx, env, productMeta, existingCompetitors, previousSuggestions) {
  if (!productMeta || !(productMeta.product_name || productMeta.name)) return null;

  const existingNames = existingCompetitors.map(c => c.name.toLowerCase());
  const existingDomains = existingCompetitors.map(c => {
    try { return new URL(c.website.startsWith("http") ? c.website : "https://" + c.website).hostname.replace(/^www\./, ""); }
    catch { return ""; } // Expected: malformed competitor URL
  }).filter(Boolean);
  const previousNames = (previousSuggestions || []).map(s => s.toLowerCase());
  const allExcluded = [...new Set([...existingNames, ...existingDomains, ...previousNames])];

  const result = await callClaude(ctx, env,
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
    try { domain = new URL(s.url).hostname.replace(/^www\./, ""); } catch {} // Expected: malformed URL from AI response
    return !allExcluded.some(ex => lowerName.includes(ex) || ex.includes(lowerName) || (domain && ex === domain));
  });

  // Verify URLs actually exist
  const verified = [];
  for (const s of filtered) {
    if (await verifyUrl(ctx, s.url)) verified.push(s);
    else console.log(`  Filtered hallucinated suggestion: ${s.name} (${s.url})`);
  }
  return verified.slice(0, 5);
}

// ─── DEEP COMPETITOR DISCOVERY (1st Friday of month, Brave Search + Sonnet) ──

// Helper: extract registrable domain (strips subdomains except known platforms)
export const PLATFORM_SUFFIXES = ["github.io", "netlify.app", "vercel.app", "herokuapp.com", "pages.dev", "workers.dev", "fly.dev"];
export function getRegistrableDomain(hostname) {
  const h = hostname.replace(/^www\./, "");
  if (PLATFORM_SUFFIXES.some(s => h.endsWith(s))) return h;
  const parts = h.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : h;
}

export async function enrichProductMeta(ctx, env, productMeta, productUrl) {
  if (!productMeta || !(productMeta.product_name || productMeta.name)) return productMeta;

  // Fetch homepage live
  let pageTitle = "";
  let pageMetaDesc = "";
  let homepageContext = "";
  if (productUrl) {
    const html = await fetchUrl(ctx, productUrl);
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

  const result = await callClaude(ctx, env, prompt, { model: "claude-sonnet-4-5-20250929", maxTokens: 600 });
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

export async function deepCompetitorDiscovery(ctx, env, productMeta, existingCompetitors, previousSuggestions) {
  const productName = productMeta.product_name || productMeta.name;
  if (!productName) return null;

  // ── a) Build exclusion list ──
  const existingNames = existingCompetitors.map(c => c.name.toLowerCase());
  const existingDomains = existingCompetitors.map(c => {
    try { return getRegistrableDomain(new URL(c.website.startsWith("http") ? c.website : "https://" + c.website).hostname); }
    catch { return ""; } // Expected: malformed competitor URL
  }).filter(Boolean);
  const previousNames = (previousSuggestions || []).map(s => s.toLowerCase());
  const allExcluded = [...new Set([...existingNames, ...existingDomains, ...previousNames])];

  // ── b) Sonnet call #1: Generate 15 search queries ──
  const landscapeContext = existingCompetitors.slice(0, 10).map(c => c.name).join(", ");
  const adjacentCats = (productMeta.adjacent_categories || []).join(", ");
  const coreWorkflow = (productMeta.core_workflow || []).join(" \u2192 ");
  const categoryLabels = (productMeta.category_labels || [productMeta.category]).join(", ");
  const partnerTypes = (productMeta.partner_types || []).join(", ");

  const queryResult = await callClaude(ctx, env,
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
    if (!canSubrequest(ctx)) { console.log("[Deep] Subrequest budget low, stopping searches"); break; }
    const results = await braveSearch(ctx, env, q.query);
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
    } catch { return false; } // Expected: malformed URL from search result
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
  const fetchPromises = toFetch.map(c => fetchUrl(ctx, c.url).catch(() => null));
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

  const scoringResult = await callClaude(ctx, env,
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
    try { domain = getRegistrableDomain(new URL(c.url).hostname); } catch {} // Expected: malformed URL from AI response
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

  // Verify URLs actually exist
  const verifiedResults = [];
  for (const c of topResults) {
    if (await verifyUrl(ctx, c.url)) verifiedResults.push(c);
    else console.log(`  [Deep] Filtered hallucinated: ${c.name} (${c.url})`);
  }

  console.log(`[Deep] Final: ${verifiedResults.length} competitors (from ${scoringResult.candidates.length} scored)`);
  return verifiedResults.length > 0 ? verifiedResults : null;
}

export function formatWeeklySuggestions(suggestions, productMeta, tier) {
  const productName = productMeta.product_name || productMeta.name || "your product";
  const overlapEmoji = { direct: "\u{1F534}", adjacent: "\u{1F7E1}", broader: "\u{1F535}" };
  let text = `\u{1F50D} *Weekly Competitor Discovery*\n_New competitors to consider for ${productName}_\n`;
  for (const s of suggestions) {
    const emoji = overlapEmoji[s.overlap] || "\u{1F7E1}";
    let domain = "";
    try { domain = new URL(s.url).hostname.replace(/^www\./, ""); } catch { domain = s.url; } // Expected: fallback for malformed URLs
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

export function comparePricing(oldPricing, newPricing) {
  if (!oldPricing || !newPricing || !oldPricing.plans || !newPricing.plans) return null;
  const changes = [];
  const oldPlans = new Map(oldPricing.plans.filter(p => p.name).map((p) => [p.name.toLowerCase(), p]));
  const newPlans = new Map(newPricing.plans.filter(p => p.name).map((p) => [p.name.toLowerCase(), p]));
  for (const [name, oldPlan] of oldPlans) {
    const newPlan = newPlans.get(name);
    if (!newPlan) changes.push(`Removed: *${oldPlan.name}* (was ${oldPlan.price})`);
    else if (oldPlan.price !== newPlan.price) changes.push(`*${oldPlan.name}*: ${oldPlan.price} \u2192 ${newPlan.price}`);
  }
  for (const [name, newPlan] of newPlans) {
    if (!oldPlans.has(name)) changes.push(`New plan: *${newPlan.name}* at ${newPlan.price}`);
  }
  return changes.length > 0 ? changes : null;
}

// ─── ANNOUNCEMENT DETECTION ─────────────────────────────────────────────────

export function detectAnnouncement(title, keywords) {
  const lower = title.toLowerCase();
  for (const [category, kws] of Object.entries(keywords)) {
    for (const kw of kws) {
      if (lower.includes(kw)) return category;
    }
  }
  return null;
}
