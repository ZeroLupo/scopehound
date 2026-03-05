// Billing — Stripe integration, checkout, webhooks, tier enforcement, affiliates.

import { TIERS, getTierLimits } from "./config.js";

// ─── STRIPE API ─────────────────────────────────────────────────────────────

export async function stripeAPI(path, method, body, env) {
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await r.json();
  if (!r.ok) {
    console.log(`[Stripe API] ${method} ${path} failed: ${r.status} - ${data.error?.message || "unknown"}`);
    return { error: data.error || { message: `Stripe API error ${r.status}` } };
  }
  return data;
}

export async function verifyStripeSignature(rawBody, sigHeader, secret) {
  try {
    const parts = {};
    for (const item of sigHeader.split(",")) {
      const [key, value] = item.split("=");
      parts[key.trim()] = value.trim();
    }
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return null;
    if (Math.floor(Date.now() / 1000) - parseInt(timestamp) > 300) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + rawBody));
    const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (expected.length !== signature.length) return null;
    let result = 0;
    for (let i = 0; i < expected.length; i++) result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    if (result !== 0) return null;
    return JSON.parse(rawBody);
  } catch (e) {
    return null;
  }
}

// ─── CHECKOUT & PORTAL ──────────────────────────────────────────────────────

export async function createCheckoutSession(env, user, tier, origin, period) {
  const tierDef = TIERS[tier];
  if (!tierDef) return null;
  const priceIds = env.STRIPE_PRICE_IDS ? JSON.parse(env.STRIPE_PRICE_IDS) : {};
  const priceKey = tier + "_" + (period === "annual" ? "annual" : "monthly");
  const priceId = priceIds[priceKey] || priceIds[tier]; // fallback to old format
  if (!priceId) return null;
  const params = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: origin + "/billing?success=1",
    cancel_url: origin + "/billing",
    "metadata[user_id]": user.id,
    "metadata[tier]": tier,
    "subscription_data[metadata][user_id]": user.id,
    "subscription_data[metadata][tier]": tier,
  };
  if (user.stripeCustomerId) {
    params.customer = user.stripeCustomerId;
  } else {
    params.customer_email = user.email;
  }
  if (user.referredBy) {
    params["subscription_data[metadata][affiliate_code]"] = user.referredBy;
  }
  return await stripeAPI("/checkout/sessions", "POST", params, env);
}

// ─── ACTIVE SUBSCRIBER TRACKING ─────────────────────────────────────────────

// Note: KV read-modify-write has inherent race condition with concurrent webhooks.
// Self-repair in cron job re-adds any lost subscribers, so this is acceptable.
async function addActiveSubscriber(env, userId) {
  const raw = await env.STATE.get("active_subscribers");
  let list;
  try {
    list = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.log(`[billing:addActiveSubscriber] Failed to parse active_subscribers: ${e.message}`);
    list = [];
  }
  if (!list.includes(userId)) {
    list.push(userId);
    await env.STATE.put("active_subscribers", JSON.stringify(list));
  }
}

async function removeActiveSubscriber(env, userId) {
  const raw = await env.STATE.get("active_subscribers");
  if (!raw) return;
  const list = JSON.parse(raw).filter(id => id !== userId);
  await env.STATE.put("active_subscribers", JSON.stringify(list));
}

// ─── WEBHOOK HANDLER ────────────────────────────────────────────────────────

export async function handleStripeWebhook(event, env) {
  // Idempotency check
  const eventKey = "processed_events:" + event.id;
  const already = await env.STATE.get(eventKey);
  if (already) return { status: "duplicate" };

  let processed = false;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const tier = session.metadata?.tier;
      if (!userId || !tier) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      user.tier = tier;
      user.stripeCustomerId = session.customer;
      user.stripeSubscriptionId = session.subscription;
      user.subscriptionStatus = "active";
      await Promise.all([
        env.STATE.put("user:" + userId, JSON.stringify(user)),
        env.STATE.put("sub:" + session.subscription, userId),
        env.STATE.put("stripe_customer:" + session.customer, userId),
        addActiveSubscriber(env, userId),
      ]);
      // Affiliate commission handled by invoice.payment_succeeded (fires for initial + recurring)
      processed = true;
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const userId = await env.STATE.get("sub:" + sub.id);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      const newTier = sub.metadata?.tier || user.tier;
      user.tier = newTier;
      user.subscriptionStatus = sub.status;
      await env.STATE.put("user:" + userId, JSON.stringify(user));
      if (sub.status === "active") await addActiveSubscriber(env, userId);
      else await removeActiveSubscriber(env, userId);
      processed = true;
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId = await env.STATE.get("sub:" + sub.id);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      user.tier = null;
      user.subscriptionStatus = "canceled";
      user.stripeSubscriptionId = null;
      await env.STATE.put("user:" + userId, JSON.stringify(user));
      await removeActiveSubscriber(env, userId);
      processed = true;
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      if (!subId) break;
      const userId = await env.STATE.get("sub:" + subId);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      if (user.referredBy) {
        await recordAffiliateCommission(env, user.referredBy, userId, invoice.amount_paid, user.tier);
      }
      processed = true;
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      if (!subId) break;
      const userId = await env.STATE.get("sub:" + subId);
      if (!userId) break;
      const raw = await env.STATE.get("user:" + userId);
      if (!raw) break;
      const user = JSON.parse(raw);
      user.subscriptionStatus = "past_due";
      await env.STATE.put("user:" + userId, JSON.stringify(user));
      processed = true;
      break;
    }
  }

  // Only mark as processed if we actually did something
  if (processed) {
    await env.STATE.put(eventKey, "1", { expirationTtl: 86400 });
  }
  return { status: processed ? "processed" : "skipped", type: event.type };
}

// ─── TIER ENFORCEMENT ───────────────────────────────────────────────────────

export function enforceTierLimits(user, competitors) {
  const limits = getTierLimits(user?.tier || "scout");
  if (competitors.length > limits.competitors) {
    return { error: `Your ${limits.name} plan allows ${limits.competitors} competitors. Upgrade at /billing.` };
  }
  const totalPages = competitors.reduce((n, c) => n + (c.pages?.length || 0), 0);
  if (totalPages > limits.pages) {
    return { error: `Your ${limits.name} plan allows ${limits.pages} pages. Upgrade at /billing.` };
  }
  return null;
}

// ─── AFFILIATE TRACKING ─────────────────────────────────────────────────────

export function generateAffiliateCode() {
  return crypto.randomUUID().slice(0, 8);
}

function maskEmail(email) {
  if (!email) return "***";
  const [local, domain] = email.split("@");
  return local[0] + "***@" + domain;
}

export async function recordAffiliateSignup(env, code, user) {
  try {
    const raw = await env.STATE.get("affiliate:" + code);
    if (!raw) return;
    const affiliate = JSON.parse(raw);
    if (affiliate.status !== "approved" && affiliate.status !== "active") return;
    affiliate.referralCount = (affiliate.referralCount || 0) + 1;
    affiliate.status = "active";
    await env.STATE.put("affiliate:" + code, JSON.stringify(affiliate));
    // Add to referrals list
    const refsRaw = await env.STATE.get("affiliate:" + code + ":referrals");
    const refs = refsRaw ? JSON.parse(refsRaw) : [];
    refs.push({
      userId: user.id,
      email: maskEmail(user.email),
      signedUpAt: new Date().toISOString(),
      tier: user.tier,
      monthlyCommission: 0,
      totalPaid: 0,
      monthsRemaining: 24,
      status: "active",
    });
    await env.STATE.put("affiliate:" + code + ":referrals", JSON.stringify(refs));
  } catch (e) {
    console.log("Affiliate signup error: " + e.message);
  }
}

async function recordAffiliateCommission(env, code, userId, amountCents, tier) {
  try {
    const raw = await env.STATE.get("affiliate:" + code);
    if (!raw) return;
    const affiliate = JSON.parse(raw);
    const commission = Math.round(amountCents * (affiliate.commissionRate || 0.5));
    affiliate.totalEarnings = (affiliate.totalEarnings || 0) + commission;
    affiliate.pendingEarnings = (affiliate.pendingEarnings || 0) + commission;
    await env.STATE.put("affiliate:" + code, JSON.stringify(affiliate));
    // Update referral entry
    const refsRaw = await env.STATE.get("affiliate:" + code + ":referrals");
    if (refsRaw) {
      const refs = JSON.parse(refsRaw);
      const ref = refs.find((r) => r.userId === userId);
      if (ref) {
        ref.monthlyCommission = commission;
        ref.totalPaid = (ref.totalPaid || 0) + commission;
        ref.monthsRemaining = Math.max(0, (ref.monthsRemaining || 24) - 1);
        ref.tier = tier;
        if (ref.monthsRemaining <= 0) ref.status = "completed";
      }
      await env.STATE.put("affiliate:" + code + ":referrals", JSON.stringify(refs));
    }
  } catch (e) {
    console.log("Affiliate commission error: " + e.message);
  }
}
