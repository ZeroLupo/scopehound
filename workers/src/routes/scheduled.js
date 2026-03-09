// Scheduled handler — cron-triggered scans and weekly suggestions.

import { createContext } from "../context.js";
import { loadConfig, hasFeature } from "../config.js";
import { isHostedMode } from "../auth.js";
import { sendSlack } from "../slack.js";
import {
  enrichProductMeta, deepCompetitorDiscovery,
  suggestNewCompetitors, formatWeeklySuggestions,
} from "../ai.js";
import { suggestPHTopics } from "../producthunt.js";
import { runMonitor } from "../scanner.js";

const CRON_WEEKLY = "0 15 * * 5";

export async function handleScheduled(env, cron) {
  const isWeeklyCron = cron === CRON_WEEKLY;

  if (isHostedMode(env)) {
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
        if (!isWeeklyCron) {
          const cfg = await loadConfig(env, id);
          if (cfg.settings.slackWebhookUrl) {
            const ctx = createContext();
            await sendSlack(ctx, cfg.settings.slackWebhookUrl, "🐺 *ScopeHound Notice*\n\nYour account was missing from the daily scan list and has been automatically repaired. Scans will now run normally.");
          }
        }
      }
      if (missing.length > 0) {
        await env.STATE.put("active_subscribers", JSON.stringify(list));
      }
    } catch (e) {
      console.log(`[self-repair] Error: ${e.message}`);
    }

    // Global config scan (daily cron only)
    if (!isWeeklyCron) {
      try {
        const globalConfig = await loadConfig(env);
        if (globalConfig.competitors.length > 0) {
          console.log(`Running global config scan (${globalConfig.competitors.length} competitors)`);
          const ctx = createContext();
          await runMonitor(ctx, env);
        }
      } catch (e) {
        console.log(`Global scan failed: ${e.message}`);
      }
    }

    const isFirstFriday = new Date().getUTCDate() <= 7;
    console.log(`[cron] ${isWeeklyCron ? "Weekly suggestions" : "Daily scan"} — ${list.length} subscriber(s)${isWeeklyCron && isFirstFriday ? " (first Friday — deep mode)" : ""}`);

    for (const userId of list) {
      try {
        const uRaw = await env.STATE.get("user:" + userId);
        if (!uRaw) continue;
        const user = JSON.parse(uRaw);
        if (user.subscriptionStatus !== "active") continue;
        const tier = user.tier || "scout";

        if (isWeeklyCron) {
          // ── Weekly Competitor Suggestions (Fridays at 15:00 UTC, ALL tiers) ──
          try {
            const config = await loadConfig(env, userId);
            const { competitors, settings } = config;
            if (settings._productMeta && settings.slackWebhookUrl) {
              const suggestKey = `user_state:${userId}:weekly_suggestions`;
              const prevRaw = await env.STATE.get(suggestKey);
              const prevData = prevRaw ? JSON.parse(prevRaw) : { suggested: [], lastRun: null };
              const now = Date.now();
              const recentSuggested = (prevData.suggested || []).filter(s => {
                if (typeof s === "string") return true;
                return s.date && (now - new Date(s.date).getTime()) < 90 * 24 * 60 * 60 * 1000;
              }).map(s => typeof s === "string" ? s : s.name);

              const ctx = createContext();
              let suggestions;
              if (isFirstFriday && env.BRAVE_SEARCH_API_KEY) {
                console.log(`Running deep competitor discovery for ${user.email}`);
                const enriched = await enrichProductMeta(ctx, env, settings._productMeta, null);
                if (enriched !== settings._productMeta) {
                  const settingsKey = `user_config:${userId}:settings`;
                  const settRaw = await env.STATE.get(settingsKey);
                  const fullSettings = settRaw ? JSON.parse(settRaw) : {};
                  fullSettings._productMeta = enriched;
                  await env.STATE.put(settingsKey, JSON.stringify(fullSettings));
                }
                suggestions = await deepCompetitorDiscovery(ctx, env, enriched, competitors, recentSuggested);
              } else {
                suggestions = await suggestNewCompetitors(ctx, env, settings._productMeta, competitors, recentSuggested);
              }

              if (suggestions && suggestions.length > 0) {
                const message = formatWeeklySuggestions(suggestions, settings._productMeta, tier);
                await sendSlack(ctx, settings.slackWebhookUrl, message);
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
        } else {
          // ── Daily scan (9am UTC) ──
          // Scout: no scheduled scans (manual only)
          if (!hasFeature(tier, "scheduled_scans")) {
            console.log(`Skipping ${user.email} (${tier}) — manual scans only`);
            continue;
          }
          console.log(`Running daily scan for ${user.email} (${tier})`);
          const scanCtx = createContext();
          await runMonitor(scanCtx, env, null, userId);
        }
      } catch (e) {
        console.log(`${isWeeklyCron ? "Weekly suggestions" : "Scan"} failed for user ${userId}: ${e.message}`);
      }
    }
  } else {
    // ── Self-hosted mode ──
    if (isWeeklyCron) {
      // Weekly suggestions (Fridays at 15:00 UTC)
      const isFirstFriday = new Date().getUTCDate() <= 7;
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

          const ctx = createContext();
          let suggestions;
          if (isFirstFriday && env.BRAVE_SEARCH_API_KEY) {
            const enriched = await enrichProductMeta(ctx, env, settings._productMeta, null);
            if (enriched !== settings._productMeta) {
              const settRaw = await env.STATE.get("config:settings");
              const fullSettings = settRaw ? JSON.parse(settRaw) : {};
              fullSettings._productMeta = enriched;
              await env.STATE.put("config:settings", JSON.stringify(fullSettings));
            }
            suggestions = await deepCompetitorDiscovery(ctx, env, enriched, competitors, recentSuggested);
          } else {
            suggestions = await suggestNewCompetitors(ctx, env, settings._productMeta, competitors, recentSuggested);
          }

          if (suggestions && suggestions.length > 0) {
            const message = formatWeeklySuggestions(suggestions, settings._productMeta, "command");
            await sendSlack(ctx, settings.slackWebhookUrl, message);
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
    } else {
      // Daily scan (9am UTC)
      const ctx = createContext();
      await runMonitor(ctx, env);
    }
  }
}
