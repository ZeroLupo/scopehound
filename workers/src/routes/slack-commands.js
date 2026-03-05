// Slack slash commands — /ads and /scopehound commands.

import { createContext } from "../context.js";
import { loadConfig, getTierLimits, hasFeature } from "../config.js";
import { jsonResponse } from "../auth.js";
import { sendSlack } from "../slack.js";
import { fetchMetaAds, formatAdsBlocks } from "../ads.js";
import { discoverPages } from "../discovery.js";
import { runMonitor } from "../scanner.js";

export async function handleSlackCommands(ctx, request, env, cfCtx, url) {
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

    const prefix = "user_config:" + userId + ":";
    const compsRaw = await env.STATE.get(prefix + "competitors");
    const comps = compsRaw ? JSON.parse(compsRaw) : [];

    let input = text.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
    let domain = null;
    let companyName = null;

    if (input.includes(".")) {
      domain = input.toLowerCase();
      const match = comps.find(c => {
        try { return new URL(c.website).hostname.replace(/^www\./, "") === domain; } catch { return false; } // Expected: malformed competitor URL
      });
      companyName = match ? match.name : domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
    } else {
      companyName = input;
      const match = comps.find(c => c.name.toLowerCase() === input.toLowerCase());
      if (match) {
        try { domain = new URL(match.website).hostname.replace(/^www\./, ""); } catch {} // Expected: malformed competitor URL
        companyName = match.name;
      }
    }

    const immediate = jsonResponse({ response_type: "ephemeral", text: `🔎 Looking up ads for ${companyName}...` });

    cfCtx.waitUntil((async () => {
      try {
        const metaData = await fetchMetaAds(ctx, domain, companyName, env.META_APP_TOKEN, env);
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
    const immediate = jsonResponse({ response_type: "ephemeral", text: `Scanning ${compUrl}... I'll update you in a moment.` });

    cfCtx.waitUntil((async () => {
      try {
        const pages = await discoverPages(ctx, compUrl);
        const totalPages = comps.reduce((n, c) => n + (c.pages?.length || 0), 0) + pages.length;
        if (totalPages > limits.pages) {
          await fetch(responseUrl, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response_type: "ephemeral", text: `Adding ${compUrl} would put you at ${totalPages} pages (limit: ${limits.pages}). Remove some pages or upgrade.` }) });
          return;
        }
        let hostname;
        try { hostname = new URL(compUrl).hostname.replace(/^www\./, ""); } catch { hostname = compUrl; } // Expected: fallback for malformed URLs
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
    cfCtx.waitUntil((async () => {
      const scanCtx = createContext();
      await runMonitor(scanCtx, env, config, userId);
    })());
    return jsonResponse({ response_type: "ephemeral", text: "Scan triggered. Results will appear shortly." });
  }

  return jsonResponse({ response_type: "ephemeral", text: "Unknown command. Try `/scopehound help`." });
}
