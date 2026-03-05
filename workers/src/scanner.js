// Scanner — main monitoring loop (runMonitor) and dashboard cache builder.

import { createContext, SUBREQUEST_LIMIT } from "./context.js";
import { DEFAULT_ANNOUNCEMENT_KEYWORDS, TIERS, hasFeature, loadConfig } from "./config.js";
import { htmlToText, hashContent, fetchUrl, parseRssFeed, extractSeoSignals, compareSeoSignals, computeTextDiff } from "./utils.js";
import { extractPricingText, extractPricingWithLLM, analyzePageChange, classifyAnnouncement, radarScanReddit, comparePricing, detectAnnouncement, formatRadarAlert } from "./ai.js";
import { formatPageChangeAlert, formatBlogAlert, formatAnnouncementAlert, formatSeoAlert, formatProductHuntAlert, formatDigestHeader, sendSlack } from "./slack.js";
import { loadHistory, saveHistory, migrateState } from "./state.js";
import { fetchProductHuntPosts } from "./producthunt.js";
import { loadBrowserDomains } from "./browser.js";

// ─── MAIN MONITORING LOGIC ──────────────────────────────────────────────────

export async function runMonitor(ctx, env, configOverride, userId) {
  const config = configOverride || await loadConfig(env, userId);
  const { competitors, settings } = config;
  const browserDomains = env.BROWSER ? await loadBrowserDomains(env) : new Set();

  // Resolve user tier for feature gating
  let userTier = "command"; // default for self-hosted (full access)
  if (userId) {
    try {
      const uRaw = await env.STATE.get("user:" + userId);
      if (uRaw) userTier = JSON.parse(uRaw).tier || "scout";
    } catch (e) {
      console.log(`[runMonitor] Failed to parse user tier for ${userId}: ${e.message}`);
    }
  }

  if (competitors.length === 0) {
    console.log("No competitors configured. Visit /setup to add competitors.");
    return { alerts: [], slackResults: [], slackUrl: "missing", subrequests: 0 };
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
      const content = await fetchUrl(ctx, page.url, env, browserDomains);
      if (!content) continue;

      const ps = cs.pages[page.id] || { hash: null, textSnapshot: null, lastChecked: null, lastChanged: null };
      const newHash = await hashContent(content);
      const newText = page.type === "pricing" ? extractPricingText(content) : htmlToText(content);
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
          const pricing = await extractPricingWithLLM(ctx, content, env);
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
            const newPricing = await extractPricingWithLLM(ctx, content, env);
            if (newPricing && cs.pricing) pricingChanges = comparePricing(cs.pricing, newPricing);
            if (newPricing) cs.pricing = newPricing;
            analysis = await analyzePageChange(ctx, env, competitor.name, page.label, page.type, diff);
            if (!analysis) analysis = {
              summary: "Pricing page updated" + (pricingChanges?.length ? ": " + pricingChanges[0] : ""),
              priority: "high", analysis: "", recommendation: "Compare current pricing against your own."
            };
          } else {
            analysis = await analyzePageChange(ctx, env, competitor.name, page.label, page.type, diff);
            if (!analysis) {
              const snippet = diff.afterExcerpt ? "Content updated: " + diff.afterExcerpt.slice(0, 120) : "Page content changed (diff unavailable)";
              analysis = { summary: snippet, priority: "medium", analysis: "", recommendation: "Review the page for strategic changes." };
            }
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
      const rssContent = await fetchUrl(ctx, competitor.blogRss, env, browserDomains);
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
                const cl = await classifyAnnouncement(ctx, env, competitor.name, post.title, cat);
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
      const posts = await fetchProductHuntPosts(ctx, topic.slug);
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
    const radarFinds = await radarScanReddit(ctx, env, settings, state, productMeta, competitors);
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
    } catch (e) {
      console.log(`[runMonitor] Failed to read history retention for ${userId}: ${e.message}`);
    }
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
    slackResults.push(await sendSlack(ctx, slackUrl, message));
    }
  } else {
    console.log("\nNo changes detected.");
    const totalPages = competitors.reduce((n, c) => n + (c.pages?.length || 0), 0);
    const totalBlogs = competitors.filter(c => c.blogRss).length;
    // Next scan messaging
    const hasScheduled = userTier && userTier !== "scout" && userTier !== "recon";
    const nextScanText = hasScheduled ? "Next scan tomorrow at 9:00 AM UTC." : "Manual scan available once per 24h.";
    // Build itemized source list
    const sources = [`${competitors.length} competitors (${totalPages} pages)`];
    if (totalBlogs > 0) sources.push(`${totalBlogs} blog RSS feed${totalBlogs > 1 ? "s" : ""}`);
    if (phTopics.length > 0) sources.push(`Product Hunt (${phTopics.map(t => t.name).join(", ")})`);
    // Reddit will be added here when radar is live
    const radarSubs = settings.radarSubreddits || [];
    if (radarSubs.length > 0) sources.push(`Reddit (${radarSubs.length} subreddit${radarSubs.length > 1 ? "s" : ""})`);
    slackResults.push(await sendSlack(ctx, slackUrl, `🐺 *ScopeHound* — Checked ${sources.join(" · ")}. Nothing to report. ${nextScanText}`));
  }

  const slackOk = slackResults.filter(r => r.ok).length;
  const slackFail = slackResults.filter(r => !r.ok);
  console.log(`Slack delivery: ${slackOk}/${slackResults.length} succeeded${slackFail.length ? ", errors: " + slackFail.map(r => r.error).join(", ") : ""}`);
  console.log(`Subrequests used: ${ctx.subrequestCount}/${SUBREQUEST_LIMIT}`);
  if (browserDomains.size > 0) console.log(`Browser rendering domains: ${[...browserDomains].join(", ")}`);
  console.log("Done!");
  return { alerts, slackResults, slackUrl: slackUrl ? "set" : "missing", subrequests: ctx.subrequestCount };
}

// ─── DASHBOARD CACHE ─────────────────────────────────────────────────────────

export async function buildDashboardCache(env, state, history, competitors, userId) {
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
