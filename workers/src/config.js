// Config — tier definitions, feature gates, and KV config loader.

// ─── DEFAULTS ────────────────────────────────────────────────────────────────

export const DEFAULT_ANNOUNCEMENT_KEYWORDS = {
  funding: ["funding", "raised", "series a", "series b", "series c", "seed round", "investment"],
  partnership: ["partnership", "partners with", "teaming up", "collaboration", "integrates with", "integration"],
  acquisition: ["acquires", "acquired", "acquisition", "merger", "merged with"],
  events: ["webinar", "conference", "summit", "event", "keynote", "workshop"],
  hiring: ["hiring", "we're growing", "join our team", "open positions", "careers"],
  product: ["launch", "launching", "introduces", "announcing", "new feature", "now available", "release"],
};

// ─── TIER DEFINITIONS ────────────────────────────────────────────────────────

export const TIERS = {
  scout:     { name: "Scout",     competitors: 3,  pages: 6,   pagesPerComp: 4, scansPerDay: 0, historyDays: 30 },
  operator:  { name: "Operator",  competitors: 15, pages: 60,  pagesPerComp: 4, scansPerDay: 2, historyDays: 365 },
  command:   { name: "Command",   competitors: 50, pages: 400, pagesPerComp: 8, scansPerDay: 4, historyDays: -1 },
  // Legacy aliases (pre-migration user records may still reference old tier names)
  recon:     { name: "Scout",     competitors: 3,  pages: 6,   pagesPerComp: 4, scansPerDay: 0, historyDays: 30 },
  strategic: { name: "Command",   competitors: 50, pages: 400, pagesPerComp: 8, scansPerDay: 4, historyDays: -1 },
};

export const FEATURE_GATES = {
  ai_discovery:       ["operator", "command", "strategic"],
  seed_discovery:     ["operator", "command", "strategic"],
  slash_scan:         ["operator", "command", "strategic"],
  slash_ads:          ["operator", "command", "strategic"],
  rss_monitoring:     ["operator", "command", "strategic"],
  scheduled_scans:    ["operator", "command", "strategic"],
  competitor_radar:   ["command", "strategic"],
  priority_scan_queue: ["command", "strategic"],
};

export function getTierLimits(tier) {
  return TIERS[tier] || TIERS.scout;
}

export function hasFeature(tier, feature) {
  const allowed = FEATURE_GATES[feature];
  return allowed ? allowed.includes(tier) : false;
}

// ─── CONFIG LOADER ───────────────────────────────────────────────────────────

export async function loadConfig(env, userId) {
  const prefix = userId ? `user_config:${userId}:` : "config:";
  const [compRaw, settRaw] = await Promise.all([
    env.STATE.get(prefix + "competitors"),
    env.STATE.get(prefix + "settings"),
  ]);
  let competitors, settings;
  try {
    competitors = compRaw ? JSON.parse(compRaw) : [];
  } catch (e) {
    console.log(`[loadConfig] Failed to parse competitors: ${e.message}`);
    competitors = [];
  }
  try {
    settings = settRaw ? JSON.parse(settRaw) : {};
  } catch (e) {
    console.log(`[loadConfig] Failed to parse settings: ${e.message}`);
    settings = {};
  }
  return {
    competitors,
    settings: {
      slackWebhookUrl: settings.slackWebhookUrl || (userId ? null : env.SLACK_WEBHOOK_URL) || null,
      productHuntTopics: settings.productHuntTopics || [],
      announcementKeywords: settings.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS,
      phMinVotes: settings.phMinVotes ?? 0,
      radarSubreddits: settings.radarSubreddits || [],
      slackMinPriority: settings.slackMinPriority || "low",
      _productMeta: settings._productMeta || null,
    },
  };
}
