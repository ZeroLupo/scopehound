// Utils — pure helper functions for HTML processing, hashing, fetching, SEO, etc.

import { canSubrequest, trackSubrequest, SUBREQUEST_LIMIT } from "./context.js";
import { isChallengeResponse, fetchWithBrowser, addBrowserDomain } from "./browser.js";

// ─── HTML HELPERS ────────────────────────────────────────────────────────────

export function htmlToText(html) {
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

export function normalizeForHash(html) {
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

export async function hashContent(content) {
  const normalized = normalizeForHash(content);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── SSRF PROTECTION ─────────────────────────────────────────────────────────

export function isUrlSafe(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname;
    // Block private/reserved IP ranges and localhost
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.|169\.254\.|fc|fd|fe80|::1|localhost|0\.0\.0\.0)/i.test(host)) return false;
    // Block metadata endpoints
    if (host === "metadata.google.internal" || host === "169.254.169.254") return false;
    return true;
  } catch {
    // Expected: urlStr may not be a valid URL
    return false;
  }
}

// ─── FETCH WITH SUBREQUEST TRACKING ──────────────────────────────────────────

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export async function fetchUrl(ctx, url, env, _browserDomains) {
  if (!canSubrequest(ctx)) { console.log(`  Skipped (subrequest budget: ${ctx.subrequestCount}/${SUBREQUEST_LIMIT})`); return null; }
  if (!isUrlSafe(url)) { console.log(`  Blocked (SSRF protection): ${url}`); return null; }

  // Skip straight to browser rendering for known-blocked domains
  let domain;
  try { domain = new URL(url).hostname; } catch { return null; } // Expected: malformed URL
  if (_browserDomains && _browserDomains.has(domain) && env && env.BROWSER) {
    console.log(`  Known browser-required domain: ${domain}`);
    const rendered = await fetchWithBrowser(ctx, env, url);
    if (rendered) return rendered;
    // Browser rendering failed (e.g. content too small) — domain may no longer need browser
    console.log(`  Browser rendering returned nothing for cached domain ${domain} — removing from cache`);
    _browserDomains.delete(domain);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    trackSubrequest(ctx);
    let response = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal, redirect: "manual" });
    // Follow up to 3 redirects manually (saves subrequests vs automatic chains)
    for (let redir = 0; redir < 3 && [301, 302, 303, 307, 308].includes(response.status); redir++) {
      const loc = response.headers.get("location");
      if (!loc || !canSubrequest(ctx)) break;
      const redirectUrl = loc.startsWith("http") ? loc : new URL(loc, url).href;
      if (!isUrlSafe(redirectUrl)) break;
      trackSubrequest(ctx);
      response = await fetch(redirectUrl, { headers: FETCH_HEADERS, signal: controller.signal, redirect: "manual" });
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      // Check for Cloudflare challenge — try browser rendering fallback
      if (env && env.BROWSER) {
        let body = null;
        try { body = await response.text(); } catch {} // Expected: body read may fail
        if (isChallengeResponse(response.status, body)) {
          console.log(`  Challenge detected (${response.status}) — trying browser rendering`);
          const rendered = await fetchWithBrowser(ctx, env, url);
          if (rendered && _browserDomains) { await addBrowserDomain(env, domain, _browserDomains); }
          if (rendered) return rendered;
        }
      }
      console.log(`  Fetch error ${url}: ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.log(`  Fetch error ${url}: ${error.message}`);
    return null;
  }
}

// ─── RSS PARSING ─────────────────────────────────────────────────────────────

export function parseRssFeed(xml) {
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

// ─── SEO EXTRACTION ──────────────────────────────────────────────────────────

export function extractSeoSignals(html) {
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
      get(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      get(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i),
    ogTitle:
      get(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ||
      get(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i),
    ogDescription:
      get(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ||
      get(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i),
    h1s: getAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi),
  };
}

export function compareSeoSignals(oldSeo, newSeo) {
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

// ─── PAGE CONTENT PREVIEW ────────────────────────────────────────────────────

export function previewPageContent(html) {
  if (!html) return null;

  // 1. Try to extract structured product data (Shopify variants, JSON-LD, etc.)
  const products = [];
  const seen = new Set();

  // Shopify variant format: "price":79999,"name":"Product Name"
  const variantRegex = /"price"\s*:\s*(\d{3,})\s*,\s*"name"\s*:\s*"([^"]{3,80})"/g;
  let m;
  while ((m = variantRegex.exec(html)) !== null) {
    const cents = parseInt(m[1]);
    const name = m[2].replace(/\\[/\\]/g, "");
    if (cents >= 100 && !seen.has(name)) { // >= $1.00 in cents
      seen.add(name);
      products.push({ name, price: "$" + (cents / 100).toFixed(2) });
    }
  }

  // JSON-LD Product format: "name":"X"..."offers":{"price":"Y"}
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Product" && item.name && item.offers) {
          const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const price = offer?.price || offer?.lowPrice;
          if (price && !seen.has(item.name)) {
            seen.add(item.name);
            products.push({ name: item.name, price: "$" + parseFloat(price).toFixed(2) });
          }
        }
      }
    } catch (e) {
      // Expected: JSON-LD block may contain non-product or malformed data
    }
  }

  // Dedupe by base product name (strip variant suffixes like " - Stealth", " - 3.0mm / Charcoal")
  const deduped = [];
  const baseNames = new Set();
  for (const p of products) {
    const base = p.name.replace(/\s*[-–]\s*(Stealth|Charcoal|Bubblegum|Gold|Pop Pink|Gunmetal|Blade|Ruby|Black|White|Silver|Red|Blue|Green|\d+(\.\d+)?mm\s*\/?\s*\w*)$/i, "").trim();
    if (!baseNames.has(base)) {
      baseNames.add(base);
      deduped.push(p);
    }
  }

  if (deduped.length > 0) {
    const vals = deduped.map(p => parseFloat(p.price.replace(/[^0-9.]/g, ""))).filter(v => v > 0).sort((a, b) => a - b);
    const fmt = (v) => "$" + (v % 1 === 0 ? v.toLocaleString() : v.toFixed(2));
    return {
      itemCount: deduped.length,
      priceRange: vals.length > 1 ? fmt(vals[0]) + " – " + fmt(vals[vals.length - 1]) : fmt(vals[0]),
      products: deduped.slice(0, 20),
    };
  }

  // 2. Fallback: raw price regex for non-Shopify sites
  const priceRegex = /(?:\$|€|£)\s?[\d,]+(?:\.\d{2})?/g;
  const allMatches = html.match(priceRegex) || [];
  const prices = [...new Set(allMatches)].filter(p => {
    const v = parseFloat(p.replace(/[^0-9.]/g, ""));
    return v >= 5; // filter junk ($0, $1 from JS)
  });
  if (prices.length === 0) return null;
  const vals = prices.map(p => parseFloat(p.replace(/[^0-9.]/g, ""))).sort((a, b) => a - b);
  const fmt = (v) => "$" + (v % 1 === 0 ? v.toLocaleString() : v.toFixed(2));
  return {
    itemCount: prices.length,
    priceRange: vals.length > 1 ? fmt(vals[0]) + " – " + fmt(vals[vals.length - 1]) : fmt(vals[0]),
    products: prices.slice(0, 20).map(p => ({ name: null, price: p })),
  };
}

// ─── TEXT DIFF ───────────────────────────────────────────────────────────────

export function computeTextDiff(oldText, newText) {
  // Split on paragraph breaks, bullet markers, or sentence boundaries (not just .!?)
  const toChunks = (t) => t.split(/\n{2,}|(?<=[.!?])\s+|(?=[-•·▸])\s*/)
    .map(s => s.trim()).filter(s => s.length > 10);
  const oldSet = new Set(toChunks(oldText));
  const newSet = new Set(toChunks(newText));
  const added = [...newSet].filter(s => !oldSet.has(s)).slice(0, 15);
  const removed = [...oldSet].filter(s => !newSet.has(s)).slice(0, 15);
  return {
    added,
    removed,
    beforeExcerpt: removed.slice(0, 5).join("\n").slice(0, 800),
    afterExcerpt: added.slice(0, 5).join("\n").slice(0, 800),
    changeRatio: (added.length + removed.length) / Math.max(oldSet.size, 1),
  };
}

// ─── URL VERIFICATION ────────────────────────────────────────────────────────

export async function verifyUrl(ctx, url) {
  if (!canSubrequest(ctx)) {
    console.log(`  Cannot verify URL (subrequest budget exhausted): ${url}`);
    return false; // reject unverified — better to miss a real one than include a fake
  }
  trackSubrequest(ctx);
  try {
    const r = await withTimeout(fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Scopehound/3.0" },
      redirect: "follow",
    }), 5000);
    return r.ok || r.status === 403 || r.status === 405;
  } catch {
    // Expected: network errors, timeouts on HEAD requests
    return false;
  }
}

// ─── TIMEOUT HELPER ──────────────────────────────────────────────────────────

export function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout after " + ms + "ms")), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}
