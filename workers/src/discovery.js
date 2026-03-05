// Discovery — RSS auto-detection and page discovery.

import { canSubrequest, trackSubrequest } from "./context.js";
import { fetchUrl, previewPageContent } from "./utils.js";

// ─── RSS AUTO-DETECTION ─────────────────────────────────────────────────────

export async function detectRssFeed(ctx, websiteUrl) {
  const base = websiteUrl.replace(/\/+$/, "");
  const paths = ["/feed/", "/blog/feed/", "/rss.xml", "/blog/rss.xml", "/feed.xml", "/atom.xml"];
  for (const path of paths) {
    if (!canSubrequest(ctx)) break;
    try {
      trackSubrequest(ctx);
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
    } catch (e) {
      // Expected: network errors probing common RSS paths
    }
  }
  try {
    const html = await fetchUrl(ctx, base);
    if (html) {
      const m = html.match(/<link[^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i);
      if (m) {
        const href = m[2];
        return href.startsWith("http") ? href : base + href;
      }
    }
  } catch (e) {
    console.log(`[detectRssFeed] Error fetching ${base}: ${e.message}`);
  }
  return null;
}

// ─── PAGE DISCOVERY ─────────────────────────────────────────────────────────

export async function discoverPages(ctx, websiteUrl) {
  const base = websiteUrl.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const pages = [{ url: base, type: "general", label: "Homepage" }];
  const seen = new Set([base, base + "/"]);
  const htmlCache = {};
  try {
    const html = await fetchUrl(ctx, base);
    if (!html) return pages;
    htmlCache[base] = html;
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
      try { if (new URL(href).origin !== origin) continue; } catch { continue; } // Expected: malformed hrefs
      const path = new URL(href).pathname.toLowerCase();
      links.push({ href: href.split("?")[0].split("#")[0], path });
    }
    // Match against known patterns
    const patterns = [
      { match: ["pricing", "plans", "plan", "price"], type: "pricing", label: "Pricing" },
      { match: ["products", "shop", "store", "catalog", "collections"], type: "general", label: "Products" },
      { match: ["blog", "news", "updates", "changelog", "articles"], type: "blog", label: "Blog" },
      { match: ["careers", "jobs", "hiring", "join", "work-with-us"], type: "careers", label: "Careers" },
      { match: ["features", "product", "solutions"], type: "general", label: "Features" },
    ];
    const productKeywords = new Set(["products", "shop", "store", "catalog", "collections"]);
    for (const p of patterns) {
      const isProductPattern = p.match.some(m => productKeywords.has(m));
      const matched = [];
      for (const link of links) {
        const segments = link.path.split("/").filter(Boolean);
        if (p.match.some(m => segments.some(s => s === m || s.split("-").includes(m)))) {
          if (!seen.has(link.href)) {
            matched.push({ link, depth: segments.length, segments });
          }
        }
      }
      if (matched.length === 0) continue;
      matched.sort((a, b) => a.depth - b.depth);
      if (isProductPattern) {
        // For products: include index page + up to 4 specific sub-pages (e.g. /collections/tattoo-machines)
        const limit = 5;
        for (const m of matched.slice(0, limit)) {
          const sublabel = m.depth > 1 ? m.segments[m.segments.length - 1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "All Products";
          const entry = { url: m.link.href, type: p.type, label: "Products: " + sublabel };
          pages.push(entry);
          seen.add(m.link.href);
        }
      } else {
        const best = matched[0];
        const entry = { url: best.link.href, type: p.type, label: p.label };
        if (p.type === "blog" && rssUrl) entry.rss = rssUrl;
        pages.push(entry);
        seen.add(best.link.href);
      }
    }
    // If no blog found but RSS detected, try to detect blog via RSS
    if (!pages.find(p => p.type === "blog") && !rssUrl) {
      rssUrl = await detectRssFeed(ctx, base);
    }
    if (!pages.find(p => p.type === "blog") && rssUrl) {
      pages.push({ url: base + "/blog", type: "blog", label: "Blog", rss: rssUrl });
    }
    // Attach product previews from cached HTML (no extra network calls)
    for (const page of pages) {
      if (htmlCache[page.url]) {
        const preview = previewPageContent(htmlCache[page.url]);
        if (preview) page.preview = preview;
      }
    }
  } catch (e) {
    console.log("discoverPages error: " + e.message);
  }
  return pages;
}
