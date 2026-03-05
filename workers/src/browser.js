// Browser Rendering — Puppeteer-based fallback for bot-blocked sites.

import puppeteer from "@cloudflare/puppeteer";
import { canSubrequest, trackSubrequest } from "./context.js";
import { isUrlSafe } from "./utils.js";

const BROWSER_SUBREQUEST_COST = 5;

const CHALLENGE_PATTERNS = [
  "cf-browser-verification",
  "cf-challenge",
  "Just a moment",
  "Checking your browser",
  "cf-turnstile",
  "challenge-platform",
];

export function isChallengeResponse(status, html) {
  // Any 403/503 from a competitor page is likely bot blocking — worth trying browser rendering
  if (status === 403 || status === 503) return true;
  // Also catch 200 responses that are actually challenge pages (some WAFs do this)
  if (html && CHALLENGE_PATTERNS.some((p) => html.includes(p))) return true;
  return false;
}

const MIN_CONTENT_LENGTH = 1000;

export async function fetchWithBrowser(ctx, env, url) {
  if (!env.BROWSER) return null;
  if (!isUrlSafe(url)) { console.log(`  Browser blocked (SSRF): ${url}`); return null; }
  if (ctx.subrequestCount + BROWSER_SUBREQUEST_COST > 995) {
    console.log(`  Browser skipped (subrequest budget: ${ctx.subrequestCount})`);
    return null;
  }
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    // Use networkidle2 (allows 2 inflight requests) — better for JS-heavy SPAs
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
    // Wait for JS frameworks to render meaningful content
    try {
      await page.waitForFunction(
        () => document.body && document.body.innerText.length > 200,
        { timeout: 5000 }
      );
    } catch {} // Expected: some pages may never reach 200 chars of text
    const content = await page.content();
    const finalUrl = page.url();
    for (let i = 0; i < BROWSER_SUBREQUEST_COST; i++) trackSubrequest(ctx);
    if (content.length < MIN_CONTENT_LENGTH) {
      console.log(`  Browser rendered ${url} but content too small (${content.length} chars) — treating as blocked`);
      console.log(`  Browser final URL: ${finalUrl}`);
      console.log(`  Browser content preview: ${content.slice(0, 300).replace(/\n/g, " ")}`);
      return null;
    }
    console.log(`  Browser rendered ${url} (${content.length} chars)`);
    if (finalUrl !== url) console.log(`  Browser followed redirect: ${finalUrl}`);
    return content;
  } catch (e) {
    console.log(`  Browser error ${url}: ${e.message}`);
    for (let i = 0; i < 2; i++) trackSubrequest(ctx);
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch {} } // Expected: browser may already be closed
  }
}

export async function loadBrowserDomains(env) {
  try {
    const raw = await env.STATE.get("browser_domains");
    if (raw) return new Set(JSON.parse(raw));
  } catch {} // Expected: key may not exist
  return new Set();
}

export async function addBrowserDomain(env, domain, existingSet) {
  existingSet.add(domain);
  await env.STATE.put("browser_domains", JSON.stringify([...existingSet]), { expirationTtl: 604800 });
}
