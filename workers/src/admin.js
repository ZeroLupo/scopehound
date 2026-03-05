// Admin — KPI aggregation for the admin dashboard.

// ─── ADMIN KPI AGGREGATION ───────────────────────────────────────────────────

export async function aggregateKPIs(env) {
  const TIER_PRICES = { scout: 29, operator: 79, command: 199, recon: 29, strategic: 199 };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(now - 7 * 86400000);
  const fourteenDaysAgo = new Date(now - 14 * 86400000);
  const thirtyDaysAgo = new Date(now - 30 * 86400000);

  const kpis = {
    generatedAt: now.toISOString(),
    users: { total: 0, active: 0, churned: 0, churnRate: "0%", byTier: {}, recentSignups: [] },
    revenue: { estimatedMRR: 0, estimatedARR: 0, planDistribution: {} },
    engagement: { dau: 0, wau: 0, nurr: "0%", curr: "0%" },
    acquisition: { bySource: {}, byMedium: {}, byCampaign: {} },
  };

  // Helper counters for NURR/CURR
  let newUsersLast30d = 0, newUsersActiveLast7d = 0;
  let activeThisWeek = 0, activeBothWeeks = 0, activeLastWeekOnly = 0;

  // ── Scan all user records (paginated for >1000 users) ──
  let cursor = undefined;
  do {
    const listResult = await env.STATE.list({ prefix: "user:", cursor });
    for (const key of listResult.keys) {
      if (key.name.includes("_")) continue; // Skip user_email:, user_config:, user_state:
      try {
        const raw = await env.STATE.get(key.name);
        if (!raw) continue;
        const u = JSON.parse(raw);
        kpis.users.total++;

        const tier = u.tier || "none";
        kpis.users.byTier[tier] = (kpis.users.byTier[tier] || 0) + 1;

        if (u.subscriptionStatus === "active") {
          kpis.users.active++;
          if (TIER_PRICES[tier]) {
            kpis.revenue.estimatedMRR += TIER_PRICES[tier];
            kpis.revenue.planDistribution[tier] = (kpis.revenue.planDistribution[tier] || 0) + 1;
          }
        } else if (u.subscriptionStatus === "canceled") {
          kpis.users.churned++;
        }

        // DAU / WAU
        if (u.lastActive) {
          if (u.lastActive === today) kpis.engagement.dau++;
          if (new Date(u.lastActive) >= sevenDaysAgo) {
            kpis.engagement.wau++;
            activeThisWeek++;
          }
          // Active in both this week and last week (for CURR)
          const lastActiveDate = new Date(u.lastActive);
          if (lastActiveDate >= fourteenDaysAgo && lastActiveDate < sevenDaysAgo) {
            activeLastWeekOnly++;
          }
          if (lastActiveDate >= sevenDaysAgo) {
            // Check if they were also active last week by looking at lastActive history
            // Since we only store latest lastActive, approximate: if user was active this week,
            // count them for the "both weeks" bucket if they signed up before this week
            if (u.createdAt && new Date(u.createdAt) < sevenDaysAgo) {
              activeBothWeeks++;
            }
          }
        }

        // NURR: new users (≤30d) who were active in last 7d
        if (u.createdAt && new Date(u.createdAt) >= thirtyDaysAgo) {
          newUsersLast30d++;
          if (u.lastActive && new Date(u.lastActive) >= sevenDaysAgo) {
            newUsersActiveLast7d++;
          }
        }

        // UTM acquisition
        if (u.utmSource) kpis.acquisition.bySource[u.utmSource] = (kpis.acquisition.bySource[u.utmSource] || 0) + 1;
        if (u.utmMedium) kpis.acquisition.byMedium[u.utmMedium] = (kpis.acquisition.byMedium[u.utmMedium] || 0) + 1;
        if (u.utmCampaign) kpis.acquisition.byCampaign[u.utmCampaign] = (kpis.acquisition.byCampaign[u.utmCampaign] || 0) + 1;

        // Recent signups (last 30 days)
        if (u.createdAt && new Date(u.createdAt) >= thirtyDaysAgo) {
          kpis.users.recentSignups.push({
            email: u.email,
            tier: u.tier,
            status: u.subscriptionStatus,
            source: u.utmSource || null,
            createdAt: u.createdAt,
          });
        }
      } catch (e) { console.log(`[aggregateKPIs] Skipping malformed user record ${key.name}: ${e.message}`); }
    }
    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  // Compute derived metrics
  kpis.users.churnRate = kpis.users.total > 0 ? ((kpis.users.churned / kpis.users.total) * 100).toFixed(1) + "%" : "0%";
  kpis.revenue.estimatedARR = kpis.revenue.estimatedMRR * 12;
  kpis.engagement.nurr = newUsersLast30d > 0 ? ((newUsersActiveLast7d / newUsersLast30d) * 100).toFixed(1) + "%" : "N/A";
  const lastWeekTotal = activeLastWeekOnly + activeBothWeeks;
  kpis.engagement.curr = lastWeekTotal > 0 ? ((activeBothWeeks / lastWeekTotal) * 100).toFixed(1) + "%" : "N/A";

  // Sort UTM tables descending by count
  const sortObj = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  kpis.acquisition.bySource = sortObj(kpis.acquisition.bySource);
  kpis.acquisition.byMedium = sortObj(kpis.acquisition.byMedium);
  kpis.acquisition.byCampaign = sortObj(kpis.acquisition.byCampaign);

  // Sort recent signups newest first, limit to 20
  kpis.users.recentSignups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  kpis.users.recentSignups = kpis.users.recentSignups.slice(0, 20);

  return kpis;
}
