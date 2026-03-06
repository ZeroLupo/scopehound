// Slack — formatting helpers and webhook delivery.

import { trackSubrequest } from "./context.js";

// ─── SLACK FORMATTING ────────────────────────────────────────────────────────

export const PRIORITY_EMOJI = { high: "\u{1F534}", medium: "\u{1F7E1}", low: "\u{1F535}" };
export const CATEGORY_EMOJI = {
  funding: "\u{1F4B0}", partnership: "\u{1F91D}", acquisition: "\u{1F3E2}",
  events: "\u{1F4C5}", hiring: "\u{1F465}", product: "\u{1F680}", other: "\u{1F4F0}",
};

export function formatPageChangeAlert(compName, page, analysis, diff, pricingChanges) {
  const priority = analysis?.priority || "medium";
  const emoji = PRIORITY_EMOJI[priority] || "\u{1F7E1}";
  const lines = [`${emoji} *${priority.toUpperCase()}* | *${compName}* updated their ${page.label}`];
  if (analysis?.summary) lines.push(`\n*What changed:* ${analysis.summary}`);
  if (analysis?.analysis) lines.push(`*Why it matters:* ${analysis.analysis}`);
  if (analysis?.recommendation) lines.push(`*Action:* ${analysis.recommendation}`);
  if (pricingChanges && pricingChanges.length > 0) {
    lines.push("\n_Pricing details:_");
    for (const c of pricingChanges) lines.push(`  \u2022 ${c}`);
  }
  if (!analysis?.analysis && diff) {
    if (diff.beforeExcerpt) lines.push(`\n_Removed:_ ${diff.beforeExcerpt.slice(0, 300)}`);
    if (diff.afterExcerpt) lines.push(`_Added:_ ${diff.afterExcerpt.slice(0, 300)}`);
  }
  lines.push(`\n<${page.url}|View page>`);
  return { text: lines.join("\n"), priority };
}

export function formatBlogAlert(name, posts) {
  const lines = [`\u{1F535} *LOW* | *${name}* published new blog posts:`];
  for (const p of posts.slice(0, 5)) lines.push(`  \u2022 <${p.link}|${p.title}>`);
  return { text: lines.join("\n"), priority: "low" };
}

export function formatAnnouncementAlert(name, post, classification) {
  const priority = classification?.priority || "medium";
  const emoji = PRIORITY_EMOJI[priority] || "\u{1F7E1}";
  const catEmoji = CATEGORY_EMOJI[classification?.category] || "\u{1F4F0}";
  const lines = [
    `${emoji} *${priority.toUpperCase()}* | *${name}* made an announcement`,
    `${catEmoji} *Category:* ${classification?.category || "unknown"}`,
    `*"${post.title}"*`,
  ];
  if (classification?.summary && classification.summary !== post.title) lines.push(`_${classification.summary}_`);
  lines.push(`<${post.link}|Read post>`);
  return { text: lines.join("\n"), priority };
}

export function formatSeoAlert(compName, pageLabel, pageUrl, changes) {
  const lines = [`\u{1F535} *LOW* | *${compName}* changed SEO on ${pageLabel}`];
  const fieldNames = { title: "Title", metaDescription: "Meta Desc", ogTitle: "OG Title", ogDescription: "OG Desc", h1: "H1" };
  for (const c of changes.slice(0, 5)) {
    const fn = fieldNames[c.field] || c.field;
    if (c.old && c.new) lines.push(`  \u2022 *${fn}:* "${c.old}" \u2192 "${c.new}"`);
    else if (c.new) lines.push(`  \u2022 *${fn}:* Added "${c.new}"`);
    else lines.push(`  \u2022 *${fn}:* Removed "${c.old}"`);
  }
  lines.push(`<${pageUrl}|View page>`);
  return { text: lines.join("\n"), priority: "low" };
}

export function formatProductHuntAlert(topic, posts) {
  const lines = [`\u{1F7E1} *MEDIUM* | New launches in ${topic}:`];
  for (const p of posts.slice(0, 5)) {
    const votes = p.votesCount > 0 ? ` (${p.votesCount} votes)` : "";
    lines.push(`  \u2022 <${p.url}|${p.name}>${votes}`);
    lines.push(`    _${p.tagline}_`);
  }
  return { text: lines.join("\n"), priority: "medium" };
}

export function formatDigestHeader(alerts) {
  const h = alerts.filter((a) => a.priority === "high").length;
  const m = alerts.filter((a) => a.priority === "medium").length;
  const l = alerts.filter((a) => a.priority === "low").length;
  const parts = [];
  if (h) parts.push(`${h} high`);
  if (m) parts.push(`${m} medium`);
  if (l) parts.push(`${l} low`);
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `\u{1F43A} *ScopeHound Daily Report* \u2014 ${date}\n\n${alerts.length} change(s) detected: ${parts.join(", ")}`;
}

// ─── SLACK WEBHOOK VALIDATION ───────────────────────────────────────────────

function isValidSlackWebhook(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const h = u.hostname;
    return h === "hooks.slack.com" ||
      (h.endsWith(".slack-gov.com") && /^[a-z0-9-]+\.slack-gov\.com$/.test(h));
  } catch {
    return false;
  }
}

// ─── SLACK NOTIFICATION ─────────────────────────────────────────────────────

export async function sendSlack(ctx, webhookUrl, message) {
  if (!webhookUrl) { console.log(`[sendSlack] No webhook URL configured`); return { ok: false, error: "no_webhook_url" }; }
  if (!isValidSlackWebhook(webhookUrl)) {
    console.log(`[sendSlack] Rejected non-Slack webhook URL: ${webhookUrl}`);
    return { ok: false, error: "invalid_webhook_domain" };
  }
  try {
    trackSubrequest(ctx);
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!r.ok) { console.log(`[SLACK ERROR] ${r.status}`); return { ok: false, error: `slack_http_${r.status}` }; }
    return { ok: true };
  } catch (e) { console.log(`[SLACK ERROR] ${e.message}`); return { ok: false, error: e.message }; }
}
