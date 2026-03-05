// Auth — authentication, JWT sessions, OAuth, admin login.

// ─── CONSTANT-TIME STRING COMPARISON ────────────────────────────────────────

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

export function requireAuth(request, env) {
  const token = request.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "ADMIN_TOKEN secret not set. Add it in Cloudflare dashboard → Settings → Variables." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return new Response(JSON.stringify({ error: "Unauthorized. Provide X-Admin-Token header." }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
  });
}

export function htmlResponse(html) {
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8", ...SECURITY_HEADERS } });
}

// ─── MODE DETECTION ─────────────────────────────────────────────────────────

export function isHostedMode(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.STRIPE_SECRET_KEY && env.JWT_SECRET);
}

export async function resolveAuth(request, env) {
  if (isHostedMode(env)) {
    const user = await getSessionUser(request, env);
    if (!user) {
      return { user: null, response: new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      })};
    }
    // Track daily activity for DAU/WAU metrics (1 KV write per user per day)
    const today = new Date().toISOString().slice(0, 10);
    if (user.lastActive !== today) {
      user.lastActive = today;
      env.STATE.put("user:" + user.id, JSON.stringify(user)).catch(() => {});
    }
    return { user, response: null };
  }
  const authErr = requireAuth(request, env);
  if (authErr) return { user: null, response: authErr };
  return { user: { id: "admin", tier: "command", email: "admin" }, response: null };
}

// ─── JWT SESSION MANAGEMENT ─────────────────────────────────────────────────

function base64urlEncode(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function generateJWT(payload, secret) {
  const encoder = new TextEncoder();
  const header = base64urlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(header + "." + body));
  return header + "." + body + "." + base64urlEncode(sig);
}

export async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64urlDecode(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export async function createSession(env, userId) {
  const payload = { sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 86400 };
  return await generateJWT(payload, env.JWT_SECRET);
}

export async function getSessionUser(request, env) {
  if (!env.JWT_SECRET) return null;
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/sh_session=([^;]+)/);
  if (!match) return null;
  const payload = await verifyJWT(match[1], env.JWT_SECRET);
  if (!payload || !payload.sub) return null;
  try {
    const raw = await env.STATE.get("user:" + payload.sub);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function setSessionCookie(headers, token) {
  headers.append("Set-Cookie", `sh_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
}

export function clearSessionCookie(headers) {
  headers.append("Set-Cookie", "sh_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}

// ─── ADMIN SESSION MANAGEMENT ───────────────────────────────────────────────

export async function verifyAdminPassword(password, expectedHash) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (hashHex.length !== expectedHash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hashHex.length; i++) mismatch |= hashHex.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return mismatch === 0;
}

export async function createAdminSession(env) {
  const secret = env.JWT_SECRET || env.ADMIN_TOKEN;
  if (!secret) return null;
  return await generateJWT({
    sub: "platform_admin",
    role: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 8 * 3600,
  }, secret);
}

export async function getAdminSession(request, env) {
  const secret = env.JWT_SECRET || env.ADMIN_TOKEN;
  if (!secret) return null;
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/sh_admin=([^;]+)/);
  if (!match) return null;
  const payload = await verifyJWT(match[1], secret);
  if (!payload || payload.role !== "admin") return null;
  return payload;
}

export function setAdminSessionCookie(headers, token) {
  headers.append("Set-Cookie", `sh_admin=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
}

export function clearAdminSessionCookie(headers) {
  headers.append("Set-Cookie", "sh_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}

export async function checkAdminLoginRateLimit(env, ip) {
  const raw = await env.STATE.get("admin_login_attempts:" + ip);
  return !raw || parseInt(raw) < 5;
}

export async function recordAdminLoginAttempt(env, ip, success) {
  const key = "admin_login_attempts:" + ip;
  if (success) {
    await env.STATE.delete(key);
  } else {
    const raw = await env.STATE.get(key);
    await env.STATE.put(key, String((raw ? parseInt(raw) : 0) + 1), { expirationTtl: 900 });
  }
}

// ─── OAUTH PROVIDERS ────────────────────────────────────────────────────────

export function getGoogleAuthUrl(env, origin, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: origin + "/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state: state,
    prompt: "select_account",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

export async function exchangeGoogleCode(code, redirectUri, env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!r.ok) return null;
  return await r.json();
}

export async function getGoogleUserInfo(accessToken) {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!r.ok) return null;
  return await r.json();
}

export async function findOrCreateUser(env, provider, profile, refCode, utm, onReferred) {
  // Check if user exists by email
  const existingId = await env.STATE.get("user_email:" + profile.email);
  if (existingId) {
    const raw = await env.STATE.get("user:" + existingId);
    if (raw) return JSON.parse(raw);
  }
  // Create new user
  const id = crypto.randomUUID();
  const user = {
    id,
    email: profile.email,
    name: profile.name || profile.email.split("@")[0],
    picture: profile.picture || null,
    provider,
    providerId: profile.id,
    tier: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    referredBy: refCode || null,
    utmSource: utm?.source || null,
    utmMedium: utm?.medium || null,
    utmCampaign: utm?.campaign || null,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    env.STATE.put("user:" + id, JSON.stringify(user)),
    env.STATE.put("user_email:" + profile.email, id),
  ]);
  // Record affiliate signup if referred
  if (refCode && onReferred) {
    await onReferred(env, refCode, user);
  }
  return user;
}
