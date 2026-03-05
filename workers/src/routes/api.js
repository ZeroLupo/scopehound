// API routes — auth, billing, config, admin, partner, contact, scan.

import { createContext } from "../context.js";
import { DEFAULT_ANNOUNCEMENT_KEYWORDS, TIERS, getTierLimits, hasFeature, loadConfig } from "../config.js";
import { fetchUrl, previewPageContent } from "../utils.js";
import {
  discoverCompetitors, suggestSubreddits,
  suggestNewCompetitors, enrichProductMeta,
  deepCompetitorDiscovery, formatWeeklySuggestions,
} from "../ai.js";
import { sendSlack } from "../slack.js";
import {
  requireAuth, SECURITY_HEADERS, jsonResponse, htmlResponse,
  isHostedMode, resolveAuth, generateJWT, verifyJWT,
  createSession, getSessionUser, setSessionCookie, clearSessionCookie,
  verifyAdminPassword, createAdminSession, getAdminSession,
  setAdminSessionCookie, clearAdminSessionCookie,
  checkAdminLoginRateLimit, recordAdminLoginAttempt,
  getGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo, findOrCreateUser,
} from "../auth.js";
import {
  stripeAPI, verifyStripeSignature, createCheckoutSession,
  handleStripeWebhook, enforceTierLimits,
  generateAffiliateCode, recordAffiliateSignup,
} from "../billing.js";
import { suggestPHTopics } from "../producthunt.js";
import { fetchMetaAds, formatAdsBlocks } from "../ads.js";
import { detectRssFeed, discoverPages } from "../discovery.js";
import { runMonitor } from "../scanner.js";
import { aggregateKPIs } from "../admin.js";

export async function handleApi(ctx, request, env, url, path, allowedOrigin) {

  // ══════════════════════════════════════════════════════════════════════════
  // HOSTED MODE API ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  if (isHostedMode(env)) {
    // ── Google OAuth: start ──
    if (path === "/auth/google") {
      const nonce = crypto.randomUUID();
      const ref = url.searchParams.get("ref") || "";
      const utm = {
        source: url.searchParams.get("utm_source") || "",
        medium: url.searchParams.get("utm_medium") || "",
        campaign: url.searchParams.get("utm_campaign") || "",
      };
      const state = JSON.stringify({ nonce, ref, utm });
      await env.STATE.put("csrf:" + nonce, "1", { expirationTtl: 600 });
      return Response.redirect(getGoogleAuthUrl(env, url.origin, state), 302);
    }

    // ── Google OAuth: callback ──
    if (path === "/auth/google/callback") {
      try {
        const code = url.searchParams.get("code");
        const stateRaw = url.searchParams.get("state");
        if (!code || !stateRaw) return new Response("Missing code or state", { status: 400 });
        const state = JSON.parse(stateRaw);
        const csrfValid = await env.STATE.get("csrf:" + state.nonce);
        if (!csrfValid) return new Response("Invalid or expired state", { status: 400 });
        await env.STATE.delete("csrf:" + state.nonce);
        const tokens = await exchangeGoogleCode(code, url.origin + "/auth/google/callback", env);
        if (!tokens || !tokens.access_token) return new Response("Token exchange failed", { status: 400 });
        const profile = await getGoogleUserInfo(tokens.access_token);
        if (!profile || !profile.email) return new Response("Failed to get user info", { status: 400 });
        const user = await findOrCreateUser(env, "google", profile, state.ref || null, state.utm || null, recordAffiliateSignup);
        const token = await createSession(env, user.id);
        let dest = "/dashboard";
        if (user.subscriptionStatus !== "active") {
          dest = "/billing";
        } else {
          const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
          if (!comps || comps === "[]") dest = "/setup";
        }
        const headers = new Headers({ Location: url.origin + dest });
        setSessionCookie(headers, token);
        return new Response(null, { status: 302, headers });
      } catch (e) {
        return new Response("Auth error: " + e.message, { status: 500 });
      }
    }

    // ── Logout ──
    if (path === "/auth/logout") {
      const headers = new Headers({ Location: url.origin + "/" });
      clearSessionCookie(headers);
      return new Response(null, { status: 302, headers });
    }

    // ── Slack OAuth: initiate ──
    if (path === "/auth/slack") {
      if (!env.SLACK_CLIENT_ID) return new Response("Slack integration not configured", { status: 500 });
      const user = await getSessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/signin", 302);
      const nonce = crypto.randomUUID();
      await env.STATE.put("csrf:" + nonce, user.id, { expirationTtl: 600 });
      const slackUrl = "https://slack.com/oauth/v2/authorize?" + new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        scope: "incoming-webhook,commands",
        redirect_uri: url.origin + "/auth/slack/callback",
        state: JSON.stringify({ nonce, userId: user.id }),
      }).toString();
      return Response.redirect(slackUrl, 302);
    }

    // ── Slack OAuth: callback ──
    if (path === "/auth/slack/callback") {
      try {
        const code = url.searchParams.get("code");
        const stateRaw = url.searchParams.get("state");
        if (!code || !stateRaw) return new Response("Missing code or state", { status: 400 });
        const state = JSON.parse(stateRaw);
        const csrfUserId = await env.STATE.get("csrf:" + state.nonce);
        if (!csrfUserId) return new Response("Invalid or expired state", { status: 400 });
        if (state.userId !== csrfUserId) return new Response("State mismatch", { status: 400 });
        await env.STATE.delete("csrf:" + state.nonce);
        const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.SLACK_CLIENT_ID,
            client_secret: env.SLACK_CLIENT_SECRET,
            code,
            redirect_uri: url.origin + "/auth/slack/callback",
          }).toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.ok || !tokenData.incoming_webhook?.url) {
          return new Response("Slack authorization failed: " + (tokenData.error || "unknown"), { status: 400 });
        }
        const userId = csrfUserId;
        const prefix = "user_config:" + userId + ":";
        const existingRaw = await env.STATE.get(prefix + "settings");
        const settings = existingRaw ? JSON.parse(existingRaw) : {};
        settings.slackWebhookUrl = tokenData.incoming_webhook.url;
        settings.slackChannel = tokenData.incoming_webhook.channel;
        settings.slackTeam = tokenData.team?.name || null;
        settings.slackTeamId = tokenData.team?.id || null;
        await env.STATE.put(prefix + "settings", JSON.stringify(settings));
        if (tokenData.team?.id) {
          await env.STATE.put("slack_team:" + tokenData.team.id, userId);
        }
        await sendSlack(ctx, tokenData.incoming_webhook.url, "ScopeHound is connected to #" + (tokenData.incoming_webhook.channel || "your channel") + ". You're all set!");
        return Response.redirect(url.origin + "/setup?slack=connected", 302);
      } catch (e) {
        return new Response("Slack auth error: " + e.message, { status: 500 });
      }
    }

    // ── User profile ──
    if (path === "/api/user/profile") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      return jsonResponse({ id: user.id, email: user.email, name: user.name, tier: user.tier, subscriptionStatus: user.subscriptionStatus, stripeCustomerId: user.stripeCustomerId });
    }

    // ── Stripe webhook (no user auth — signature verified) ──
    if (path === "/api/stripe/webhook" && request.method === "POST") {
      const rawBody = await request.text();
      const sigHeader = request.headers.get("Stripe-Signature");
      if (!sigHeader) return new Response("Missing signature", { status: 400 });
      const event = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
      if (!event) return new Response("Invalid signature", { status: 400 });
      const result = await handleStripeWebhook(event, env);
      return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ── Checkout ──
    if (path === "/api/checkout" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      try {
        const body = await request.json();
        const tier = body.tier;
        const period = body.period === "annual" ? "annual" : "monthly";
        if (!tier || !TIERS[tier]) return jsonResponse({ error: "Invalid tier" }, 400);
        const session = await createCheckoutSession(env, user, tier, url.origin, period);
        if (!session || !session.url) return jsonResponse({ error: session?.error?.message || "Failed to create checkout" }, 400);
        return jsonResponse({ url: session.url });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Billing portal ──
    if (path === "/api/billing/portal" && request.method === "POST") {
      const { user, response } = await resolveAuth(request, env);
      if (response) return response;
      if (!user.stripeCustomerId) return jsonResponse({ error: "No subscription found" }, 400);
      const session = await stripeAPI("/billing_portal/sessions", "POST", { customer: user.stripeCustomerId, return_url: url.origin + "/billing" }, env);
      if (!session || !session.url) return jsonResponse({ error: "Failed to create portal" }, 400);
      return jsonResponse({ url: session.url });
    }

    // ── Partner: submit application ──
    if (path === "/api/partner/apply" && request.method === "POST") {
      try {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const rlKey = "partner_apply_rl:" + ip;
        const rlData = JSON.parse(await env.STATE.get(rlKey) || "null");
        const now = Date.now();
        if (rlData && rlData.count >= 3 && (now - rlData.first) < 3600000) {
          return jsonResponse({ error: "Too many requests. Please try again later." }, 429);
        }
        if (!rlData || (now - rlData.first) >= 3600000) {
          await env.STATE.put(rlKey, JSON.stringify({ count: 1, first: now }), { expirationTtl: 3600 });
        } else {
          await env.STATE.put(rlKey, JSON.stringify({ count: rlData.count + 1, first: rlData.first }), { expirationTtl: 3600 });
        }
        const body = await request.json();
        if (!body.name || !body.email || !body.paypalEmail) return jsonResponse({ error: "Name, email, and PayPal email required" }, 400);
        const existing = await env.STATE.get("affiliate_email:" + body.email);
        if (existing) return jsonResponse({ error: "Application already submitted" }, 400);
        const code = generateAffiliateCode();
        const affiliate = {
          code,
          email: body.email,
          name: body.name,
          website: body.website || null,
          paypalEmail: body.paypalEmail,
          promotionPlan: body.promotionPlan || null,
          status: "pending",
          commissionRate: 0.5,
          commissionMonths: 24,
          referralCount: 0,
          totalEarnings: 0,
          pendingEarnings: 0,
          createdAt: new Date().toISOString(),
        };
        await Promise.all([
          env.STATE.put("affiliate:" + code, JSON.stringify(affiliate)),
          env.STATE.put("affiliate_email:" + body.email, code),
        ]);
        return jsonResponse({ success: true, code });
      } catch (e) {
        return jsonResponse({ error: e.message }, 400);
      }
    }

    // ── Partner: stats API ──
    if (path === "/api/partner/stats") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = "partner_stats_rl:" + ip;
      const rlData = JSON.parse(await env.STATE.get(rlKey) || "null");
      const now = Date.now();
      if (rlData && rlData.count >= 20 && (now - rlData.first) < 900000) {
        return jsonResponse({ error: "Too many requests. Please try again later." }, 429);
      }
      if (!rlData || (now - rlData.first) >= 900000) {
        await env.STATE.put(rlKey, JSON.stringify({ count: 1, first: now }), { expirationTtl: 900 });
      } else {
        await env.STATE.put(rlKey, JSON.stringify({ count: rlData.count + 1, first: rlData.first }), { expirationTtl: 900 });
      }
      const code = url.searchParams.get("code");
      const email = url.searchParams.get("email");
      if (!code || !email) return jsonResponse({ error: "code and email required" }, 400);
      const raw = await env.STATE.get("affiliate:" + code);
      if (!raw) return jsonResponse({ error: "Affiliate not found" }, 404);
      const affiliate = JSON.parse(raw);
      if (affiliate.email !== email) return jsonResponse({ error: "Invalid credentials" }, 401);
      const refsRaw = await env.STATE.get("affiliate:" + code + ":referrals");
      const referrals = refsRaw ? JSON.parse(refsRaw) : [];
      return jsonResponse({
        code: affiliate.code,
        status: affiliate.status,
        referralCount: affiliate.referralCount,
        totalEarnings: affiliate.totalEarnings,
        pendingEarnings: affiliate.pendingEarnings,
        referrals,
      });
    }

    // ── Partner: admin approve/reject ──
    if (path === "/api/admin/partner/approve" && request.method === "POST") {
      const adminSession = await getAdminSession(request, env);
      const authErr = requireAuth(request, env);
      if (!adminSession && authErr) return authErr;
      const body = await request.json();
      if (!body.code) return jsonResponse({ error: "code required" }, 400);
      const raw = await env.STATE.get("affiliate:" + body.code);
      if (!raw) return jsonResponse({ error: "Affiliate not found" }, 404);
      const affiliate = JSON.parse(raw);
      affiliate.status = body.reject ? "rejected" : "approved";
      if (!body.reject) affiliate.approvedAt = new Date().toISOString();
      await env.STATE.put("affiliate:" + body.code, JSON.stringify(affiliate));
      return jsonResponse({ success: true, status: affiliate.status });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN ROUTES — platform operator dashboard (works in both modes)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Admin: KPI API ──
  if (path === "/api/admin/kpis") {
    const adminSession = await getAdminSession(request, env);
    if (!adminSession) return jsonResponse({ error: "Admin auth required" }, 401);
    const kpis = await aggregateKPIs(env);
    return jsonResponse(kpis);
  }

  // ── Contact form (public POST, admin GET) ──
  if (path === "/api/contact" && request.method === "POST") {
    try {
      const body = await request.json();
      const name = (body.name || "").trim().slice(0, 200);
      const email = (body.email || "").trim().slice(0, 200);
      const message = (body.message || "").trim().slice(0, 2000);
      if (!name || !email || !message) return jsonResponse({ error: "Name, email, and message are required" }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Invalid email address" }, 400);
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = "contact_rl:" + ip;
      const rlData = JSON.parse(await env.STATE.get(rlKey) || "null");
      const now = Date.now();
      if (rlData && rlData.count >= 5 && (now - rlData.first) < 3600000) {
        return jsonResponse({ error: "Too many messages. Please try again later." }, 429);
      }
      if (!rlData || (now - rlData.first) >= 3600000) {
        await env.STATE.put(rlKey, JSON.stringify({ count: 1, first: now }), { expirationTtl: 3600 });
      } else {
        await env.STATE.put(rlKey, JSON.stringify({ count: rlData.count + 1, first: rlData.first }), { expirationTtl: 3600 });
      }
      const id = crypto.randomUUID();
      const entry = { id, name, email, message, ip, createdAt: new Date().toISOString(), read: false };
      await env.STATE.put("contact:" + id, JSON.stringify(entry));
      const headers = new Headers(SECURITY_HEADERS);
      headers.set("Access-Control-Allow-Origin", allowedOrigin);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...Object.fromEntries(headers), "Content-Type": "application/json" } });
    } catch (e) {
      return jsonResponse({ error: "Invalid request" }, 400);
    }
  }

  if (path === "/api/admin/contacts") {
    const adminSession = await getAdminSession(request, env);
    if (!adminSession) return jsonResponse({ error: "Admin auth required" }, 401);
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (id) await env.STATE.delete("contact:" + id);
      return jsonResponse({ success: true });
    }
    if (request.method === "PATCH") {
      const id = url.searchParams.get("id");
      if (id) {
        const raw = await env.STATE.get("contact:" + id);
        if (raw) {
          const entry = JSON.parse(raw);
          entry.read = true;
          await env.STATE.put("contact:" + id, JSON.stringify(entry));
        }
      }
      return jsonResponse({ success: true });
    }
    const contacts = [];
    let cursor = null;
    do {
      const list = await env.STATE.list({ prefix: "contact:", cursor, limit: 100 });
      for (const key of list.keys) {
        const raw = await env.STATE.get(key.name);
        if (raw) contacts.push(JSON.parse(raw));
      }
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
    contacts.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return jsonResponse({ contacts });
  }

  // ── Admin: Create test session (staging/dev bypass for OAuth) ──
  if (path === "/api/admin/test-session" && request.method === "POST") {
    const adminSession = await getAdminSession(request, env);
    const authErr = requireAuth(request, env);
    if (!adminSession && authErr) return authErr;
    const testUserId = "test_admin";
    const testUser = {
      id: testUserId,
      email: "test@staging.local",
      name: "Test Admin",
      subscriptionStatus: "active",
      tier: "command",
      createdAt: new Date().toISOString(),
    };
    await env.STATE.put("user:" + testUserId, JSON.stringify(testUser));
    const token = await createSession(env, testUserId);
    const headers = new Headers({ Location: url.origin + "/setup" });
    setSessionCookie(headers, token);
    return new Response(null, { status: 302, headers });
  }

  // ── Admin: Manual cron trigger (for testing) ──
  if (path === "/api/admin/trigger-cron" && request.method === "POST") {
    const adminSession = await getAdminSession(request, env);
    const authErr = requireAuth(request, env);
    if (!adminSession && authErr) return authErr;

    const userId = url.searchParams.get("user") || null;
    const dryRun = url.searchParams.get("dry_run") === "true";
    const forceMode = url.searchParams.get("mode") || null;
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => { logs.push(args.join(" ")); origLog(...args); };

    try {
      if (userId) {
        const uRaw = await env.STATE.get("user:" + userId);
        if (!uRaw) return jsonResponse({ error: "User not found" }, 404);
        const user = JSON.parse(uRaw);
        const tier = user.tier || "scout";
        const cfg = await loadConfig(env, userId);
        const info = {
          userId, email: user.email, tier,
          subscriptionStatus: user.subscriptionStatus,
          hasScheduledScans: hasFeature(tier, "scheduled_scans"),
          competitorCount: cfg.competitors.length,
          slackWebhookConfigured: !!cfg.settings.slackWebhookUrl,
          slackOAuthConfigured: !!cfg.settings.slackAccessToken,
        };
        if (!dryRun) {
          const scanCtx = createContext();
          await runMonitor(scanCtx, env, null, userId);
        }
        return jsonResponse({ mode: dryRun ? "dry_run" : "executed", user: info, logs });
      }

      const raw = await env.STATE.get("active_subscribers");
      const list = raw ? JSON.parse(raw) : [];
      const results = [];

      for (const uid of list) {
        const uRaw = await env.STATE.get("user:" + uid);
        if (!uRaw) { results.push({ userId: uid, status: "not_found" }); continue; }
        const user = JSON.parse(uRaw);
        const tier = user.tier || "scout";
        const cfg = await loadConfig(env, uid);
        const info = {
          userId: uid, email: user.email, tier,
          subscriptionStatus: user.subscriptionStatus,
          competitorCount: cfg.competitors.length,
          slackWebhookConfigured: !!cfg.settings.slackWebhookUrl,
        };

        if (user.subscriptionStatus !== "active") { results.push({ ...info, status: "skipped_inactive" }); continue; }

        // Weekly suggestions (always runs on manual trigger for testing)
        if (!dryRun) {
          try {
            if (cfg.settings._productMeta && cfg.settings.slackWebhookUrl) {
              const suggestKey = `user_state:${uid}:weekly_suggestions`;
              const prevRaw = await env.STATE.get(suggestKey);
              const prevData = prevRaw ? JSON.parse(prevRaw) : { suggested: [], lastRun: null };
              const now = Date.now();
              const recentSuggested = (prevData.suggested || []).filter(s => {
                if (typeof s === "string") return true;
                return s.date && (now - new Date(s.date).getTime()) < 90 * 24 * 60 * 60 * 1000;
              }).map(s => typeof s === "string" ? s : s.name);

              const suggestCtx = createContext();
              let suggestions;
              if (forceMode !== "light" && env.BRAVE_SEARCH_API_KEY) {
                console.log(`Running deep competitor discovery for ${user.email}`);
                const enriched = await enrichProductMeta(suggestCtx, env, cfg.settings._productMeta, null);
                if (enriched !== cfg.settings._productMeta) {
                  const settingsKey = `user_config:${uid}:settings`;
                  const settRaw = await env.STATE.get(settingsKey);
                  const fullSettings = settRaw ? JSON.parse(settRaw) : {};
                  fullSettings._productMeta = enriched;
                  await env.STATE.put(settingsKey, JSON.stringify(fullSettings));
                }
                suggestions = await deepCompetitorDiscovery(suggestCtx, env, enriched, cfg.competitors, recentSuggested);
              } else {
                suggestions = await suggestNewCompetitors(suggestCtx, env, cfg.settings._productMeta, cfg.competitors, recentSuggested);
              }

              if (suggestions && suggestions.length > 0) {
                const message = formatWeeklySuggestions(suggestions, cfg.settings._productMeta, tier);
                await sendSlack(suggestCtx, cfg.settings.slackWebhookUrl, message);
                const newEntries = suggestions.map(s => ({ name: s.name, date: new Date().toISOString() }));
                const updatedSuggested = [...(prevData.suggested || []).filter(s => {
                  const d = typeof s === "string" ? null : s.date;
                  return d && (now - new Date(d).getTime()) < 90 * 24 * 60 * 60 * 1000;
                }), ...newEntries];
                await env.STATE.put(suggestKey, JSON.stringify({ suggested: updatedSuggested, lastRun: new Date().toISOString() }));
                console.log(`Weekly suggestions sent for ${user.email}: ${suggestions.length} suggestions (${forceMode === "light" ? "light" : "deep"})`);
              }
            } else {
              console.log(`Skipping weekly suggestions for ${user.email}: ${!cfg.settings._productMeta ? "no productMeta" : "no Slack"}`);
            }
          } catch (e) {
            console.log(`Weekly suggestions failed for ${user.email}: ${e.message}`);
          }
        }

        if (!hasFeature(tier, "scheduled_scans")) { results.push({ ...info, status: "skipped_no_scheduled_scans" }); continue; }

        if (!dryRun) {
          try {
            const scanCtx = createContext();
            await runMonitor(scanCtx, env, null, uid);
            results.push({ ...info, status: "executed" });
          } catch (e) { results.push({ ...info, status: "error", error: e.message }); }
        } else {
          results.push({ ...info, status: "would_run" });
        }
      }

      return jsonResponse({ mode: dryRun ? "dry_run" : "executed", subscriberCount: list.length, results, logs });
    } finally {
      console.log = origLog;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED API ROUTES — work in both self-hosted and hosted mode
  // ══════════════════════════════════════════════════════════════════════════

  // ── Admin: Migrate tier names ──
  if (path === "/api/admin/migrate-tiers" && request.method === "POST") {
    const adminSession = await getAdminSession(request, env);
    const authErr = requireAuth(request, env);
    if (!adminSession && authErr) return authErr;
    const dryRun = url.searchParams.get("dry_run") === "true";
    const tierMap = { recon: "scout", strategic: "command" };
    const results = [];
    let cursor = null;
    do {
      const list = await env.STATE.list({ prefix: "user:", cursor });
      for (const key of list.keys) {
        const raw = await env.STATE.get(key.name);
        if (!raw) continue;
        try {
          const user = JSON.parse(raw);
          const oldTier = user.tier;
          const newTier = tierMap[oldTier];
          if (newTier) {
            if (!dryRun) {
              user.tier = newTier;
              await env.STATE.put(key.name, JSON.stringify(user));
            }
            results.push({ key: key.name, email: user.email, from: oldTier, to: newTier, migrated: !dryRun });
          }
        } catch (e) {
          console.log(`[migrate-tiers] Failed to parse user ${key.name}: ${e.message}`);
        }
      }
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
    return jsonResponse({ dryRun, migrated: results.length, results });
  }

  // ── Dashboard API ──
  if (path === "/api/dashboard-data" || path === "/dashboard/api/dashboard-data") {
    let cacheKey = "dashboard_cache";
    if (isHostedMode(env)) {
      const user = await getSessionUser(request, env);
      if (!user) return jsonResponse({ error: "Not authenticated" }, 401);
      if (user.subscriptionStatus !== "active") return jsonResponse({ error: "Subscription required" }, 402);
      cacheKey = "user_state:" + user.id + ":dashboard";
    }
    const cache = await env.STATE.get(cacheKey);
    return new Response(cache || '{"competitors":[],"recentChanges":[]}', {
      headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
    });
  }

  // ── Config API: Read ──
  if (path === "/api/config" && request.method === "GET") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    const userId = isHostedMode(env) ? user.id : null;
    const config = await loadConfig(env, userId);
    return jsonResponse({ competitors: config.competitors, settings: config.settings });
  }

  // ── Config API: Save competitors ──
  if (path === "/api/config/competitors" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    try {
      const body = await request.json();
      const comps = body.competitors;
      if (!Array.isArray(comps)) return jsonResponse({ error: "competitors must be an array" }, 400);
      if (isHostedMode(env)) {
        const tierErr = enforceTierLimits(user, comps);
        if (tierErr) return jsonResponse(tierErr, 400);
      } else {
        if (comps.length > 25) return jsonResponse({ error: "Maximum 25 competitors" }, 400);
      }
      for (const c of comps) {
        if (!c.name || !c.website) return jsonResponse({ error: "Competitor missing name or website" }, 400);
        if (!c.pages || c.pages.length === 0) return jsonResponse({ error: `${c.name}: needs at least one page` }, 400);
        const maxPpc = (isHostedMode(env) && user?.tier) ? (TIERS[user.tier]?.pagesPerComp || 4) : 4;
        if (c.pages.length > maxPpc) return jsonResponse({ error: `${c.name}: maximum ${maxPpc} pages per competitor` }, 400);
      }
      const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
      await env.STATE.put(prefix + "competitors", JSON.stringify(comps));
      if (!isHostedMode(env)) await env.STATE.put("config:setup_complete", "true");
      return jsonResponse({ success: true, count: comps.length });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Save settings ──
  if (path === "/api/config/settings" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    try {
      const body = await request.json();
      const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
      const existingRaw = await env.STATE.get(prefix + "settings");
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const settings = {
        ...existing,
        slackWebhookUrl: body.slackWebhookUrl !== undefined ? (body.slackWebhookUrl || null) : (existing.slackWebhookUrl || null),
        productHuntTopics: body.productHuntTopics !== undefined ? body.productHuntTopics : (existing.productHuntTopics || []),
        announcementKeywords: body.announcementKeywords !== undefined ? body.announcementKeywords : (existing.announcementKeywords || DEFAULT_ANNOUNCEMENT_KEYWORDS),
        phMinVotes: body.phMinVotes !== undefined ? body.phMinVotes : (existing.phMinVotes ?? 0),
        radarSubreddits: body.radarSubreddits !== undefined ? body.radarSubreddits : (existing.radarSubreddits || []),
        _productMeta: body._productMeta !== undefined ? body._productMeta : (existing._productMeta || null),
      };
      await env.STATE.put(prefix + "settings", JSON.stringify(settings));
      return jsonResponse({ success: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Reset user data ──
  if (path === "/api/config/reset" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
    const statePrefix = isHostedMode(env) ? `user_state:${user.id}:` : "";
    await Promise.all([
      env.STATE.delete(prefix + "competitors"),
      env.STATE.delete(prefix + "settings"),
      statePrefix ? env.STATE.delete(statePrefix + "state") : env.STATE.delete("monitor_state"),
      statePrefix ? env.STATE.delete(statePrefix + "dashboard") : env.STATE.delete("dashboard_cache"),
      statePrefix ? env.STATE.delete(statePrefix + "history") : env.STATE.delete("change_history"),
    ]);
    return jsonResponse({ success: true, message: "Config and scan data reset. Visit /setup to start fresh." });
  }

  // ── Config API: Test Slack ──
  if (path === "/api/config/test-slack" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    try {
      const body = await request.json();
      const webhookUrl = body.webhookUrl;
      if (!webhookUrl) return jsonResponse({ error: "webhookUrl required" }, 400);
      await sendSlack(ctx, webhookUrl, "ScopeHound is connected. Setup wizard test successful.");
      return jsonResponse({ success: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Trigger scan ──
  if (path === "/api/config/trigger-scan" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    const userId = isHostedMode(env) ? user.id : null;

    if (userId) {
      const tier = (user.tier || "scout").toLowerCase();
      if (tier === "scout" || tier === "recon") {
        const cooldownKey = `user_state:${userId}:lastManualScan`;
        const lastScanRaw = await env.STATE.get(cooldownKey);
        if (lastScanRaw) {
          const hoursSince = (Date.now() - new Date(lastScanRaw).getTime()) / (1000 * 60 * 60);
          if (hoursSince < 24) {
            const nextScanAt = new Date(new Date(lastScanRaw).getTime() + 24 * 60 * 60 * 1000).toISOString();
            return jsonResponse({ error: "Scan cooldown active", cooldown: true, nextScanAt, hoursRemaining: Math.ceil(24 - hoursSince) }, 429);
          }
        }
      }
    }

    if (userId) {
      await env.STATE.put(`user_state:${userId}:lastManualScan`, new Date().toISOString());
    }

    const config = await loadConfig(env, userId);
    const scanCtx = createContext();
    const result = await runMonitor(scanCtx, env, config, userId);

    const slackOk = result.slackResults.filter(r => r.ok).length;
    const slackErrors = result.slackResults.filter(r => !r.ok).map(r => r.error);
    return jsonResponse({
      success: true,
      alertsDetected: result.alerts.length,
      slackUrl: result.slackUrl,
      slackMessages: { sent: slackOk, failed: slackErrors.length, errors: slackErrors },
      subrequests: result.subrequests,
    });
  }

  // ── Scan status (cooldown check) ──
  if (path === "/api/scan/status") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    const userId = isHostedMode(env) ? user.id : null;
    const tier = (user.tier || "scout").toLowerCase();
    const isScout = tier === "scout" || tier === "recon";
    if (!isScout || !userId) return jsonResponse({ canScan: true, cooldown: false, tier });
    const lastScanRaw = await env.STATE.get(`user_state:${userId}:lastManualScan`);
    if (!lastScanRaw) return jsonResponse({ canScan: true, cooldown: false, tier, lastScan: null });
    const hoursSince = (Date.now() - new Date(lastScanRaw).getTime()) / (1000 * 60 * 60);
    if (hoursSince >= 24) return jsonResponse({ canScan: true, cooldown: false, tier, lastScan: lastScanRaw });
    const nextScanAt = new Date(new Date(lastScanRaw).getTime() + 24 * 60 * 60 * 1000).toISOString();
    return jsonResponse({ canScan: false, cooldown: true, tier, lastScan: lastScanRaw, nextScanAt, hoursRemaining: Math.ceil(24 - hoursSince) });
  }

  // ── Config API: Detect RSS ──
  if (path === "/api/config/detect-rss" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    try {
      const body = await request.json();
      if (!body.url) return jsonResponse({ error: "url required" }, 400);
      const feedUrl = await detectRssFeed(ctx, body.url);
      return jsonResponse({ found: !!feedUrl, feedUrl });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Discover Competitors (AI) ──
  if (path === "/api/config/discover-competitors" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    if (!hasFeature(user.tier || "scout", "ai_discovery")) {
      return jsonResponse({ error: "AI competitor discovery is available on the Operator plan. Upgrade to let ScopeHound automatically find and track your competitors." }, 403);
    }
    try {
      const body = await request.json();
      if (!body.url) return jsonResponse({ error: "url required" }, 400);
      let compUrl = body.url.trim();
      if (!/^https?:\/\//i.test(compUrl)) compUrl = "https://" + compUrl;
      const seeds = Array.isArray(body.seeds) ? body.seeds.map(s => s.trim()).filter(Boolean) : [];
      const result = await discoverCompetitors(ctx, env, compUrl, seeds);
      return jsonResponse(result);
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Suggest Subreddits ──
  if (path === "/api/config/suggest-subreddits" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    if (!hasFeature(user.tier || "scout", "competitor_radar")) {
      return jsonResponse({ error: "Competitor Radar is available on the Command plan." }, 403);
    }
    try {
      const body = await request.json();
      if (!body.productMeta) return jsonResponse({ error: "productMeta required" }, 400);
      const result = await suggestSubreddits(ctx, env, body.productMeta);
      const prefix = isHostedMode(env) ? `user_config:${user.id}:` : "config:";
      const existingRaw = await env.STATE.get(prefix + "settings");
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      existing._productMeta = { name: body.productMeta.product_name, category: body.productMeta.category, subcategory: body.productMeta.subcategory, keywords: body.productMeta.keywords, target_audience: body.productMeta.target_audience };
      await env.STATE.put(prefix + "settings", JSON.stringify(existing));
      return jsonResponse(result || { subreddits: [] });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Suggest PH Topics ──
  if (path === "/api/config/suggest-ph-topics" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    try {
      const body = await request.json();
      if (!body.productMeta) return jsonResponse({ error: "productMeta required" }, 400);
      const result = await suggestPHTopics(ctx, env, body.productMeta);
      return jsonResponse(result || { topics: [] });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Discover Pages ──
  if (path === "/api/config/discover-pages" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    try {
      const body = await request.json();
      if (!body.url) return jsonResponse({ error: "url required" }, 400);
      const pages = await discoverPages(ctx, body.url);
      return jsonResponse({ pages });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // ── Config API: Preview Page Content ──
  if (path === "/api/config/preview-page" && request.method === "POST") {
    const { user, response } = await resolveAuth(request, env);
    if (response) return response;
    try {
      const body = await request.json();
      if (!body.url) return jsonResponse({ error: "url required" }, 400);
      const html = await fetchUrl(ctx, body.url);
      if (!html) return jsonResponse({ preview: null });
      const preview = previewPageContent(html);
      return jsonResponse({ preview });
    } catch (e) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  return null; // No API route matched
}
