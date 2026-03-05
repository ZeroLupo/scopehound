// Product Hunt — topic scraping and suggestion helpers.

import { fetchUrl } from "./utils.js";
import { callClaude } from "./ai.js";

// ─── PRODUCT HUNT (public page scraping — no API token needed) ──────────────

export async function fetchProductHuntPosts(ctx, topicSlug) {
  const html = await fetchUrl(ctx, `https://www.producthunt.com/topics/${topicSlug}`);
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
  } catch (e) {
    console.log(`[producthunt:extractPHPostsFromNextData] Parse error: ${e.message}`);
  }
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

export async function suggestPHTopics(ctx, env, productMeta) {
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
    return await callClaude(ctx, env, prompt, { maxTokens: 500 });
  } catch (e) {
    console.log(`[producthunt:suggestPHTopics] ${e.message}`);
    return null;
  }
}
