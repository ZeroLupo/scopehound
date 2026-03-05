// Ads — Meta Ad Library lookup and Slack ad report formatting.

import { canSubrequest, trackSubrequest } from "./context.js";

// ─── AD LIBRARY LOOKUP ──────────────────────────────────────────────────────

export async function fetchMetaAds(ctx, domain, companyName, metaToken, env) {
  // Check cache first (6 hour TTL)
  const cacheKey = "ads:meta:" + (domain || companyName);
  const cached = await env.STATE.get(cacheKey);
  if (cached) return JSON.parse(cached);

  if (!metaToken || !canSubrequest(ctx)) return null;
  trackSubrequest(ctx);

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

export function formatAdsBlocks(domain, companyName, metaData) {
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
