// State — history management and state migration helpers.

// ─── HISTORY ─────────────────────────────────────────────────────────────────

export async function loadHistory(env, userId) {
  try {
    const key = userId ? "user_state:" + userId + ":history" : "change_history";
    const data = await env.STATE.get(key);
    if (data) return JSON.parse(data);
  } catch (e) {
    console.log(`[loadHistory] Failed to parse history: ${e.message}`);
  }
  return [];
}

export async function saveHistory(env, history, userId, historyDays) {
  const days = historyDays || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const pruned = history.filter((e) => new Date(e.date) > cutoff).slice(-500);
  const key = userId ? "user_state:" + userId + ":history" : "change_history";
  await env.STATE.put(key, JSON.stringify(pruned));
}

// ─── STATE MIGRATION (v1 → v2) ──────────────────────────────────────────────

export async function migrateState(env, old, competitors, topics, userId) {
  const state = { _version: 2, competitors: {}, productHunt: {} };
  for (const comp of competitors) {
    const oc = old[comp.name];
    if (!oc) continue;
    state.competitors[comp.name] = {
      pages: {},
      blog: { postIds: oc.blogPostIds || [] },
      seo: {},
      pricing: oc.pricing || null,
    };
    if (oc.pricingHash) {
      const pp = comp.pages.find((p) => p.type === "pricing");
      if (pp) {
        state.competitors[comp.name].pages[pp.id] = {
          hash: oc.pricingHash, textSnapshot: null,
          lastChecked: new Date().toISOString(), lastChanged: null,
        };
      }
    }
  }
  for (const topic of topics) {
    const phKey = `ph_${topic.slug}`;
    if (old[phKey]) state.productHunt[topic.slug] = { postIds: old[phKey].postIds || [] };
  }
  const stateKey = userId ? "user_state:" + userId + ":monitor" : "monitor_state";
  await env.STATE.put(stateKey, JSON.stringify(state));
  console.log("State migrated v1 → v2");
  return state;
}
