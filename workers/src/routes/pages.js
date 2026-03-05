// Page routes — HTML pages, admin login, self-hosted endpoints, privacy, support.

import { createContext } from "../context.js";
import { loadConfig } from "../config.js";
import {
  requireAuth, SECURITY_HEADERS, jsonResponse, htmlResponse,
  isHostedMode, getSessionUser,
  verifyAdminPassword, createAdminSession, getAdminSession,
  setAdminSessionCookie, clearAdminSessionCookie,
  checkAdminLoginRateLimit, recordAdminLoginAttempt,
} from "../auth.js";
import { sendSlack } from "../slack.js";
import { runMonitor } from "../scanner.js";
import {
  FAVICON_LINK, DASHBOARD_HTML, SETUP_HTML, SIGNIN_HTML,
  BILLING_HTML, HOSTED_SETUP_HTML, PARTNER_APPLY_HTML,
  PARTNER_DASHBOARD_HTML, ADMIN_LOGIN_HTML, ADMIN_DASHBOARD_HTML,
} from "../templates.js";

export async function handlePages(ctx, request, env, url, path) {

  // ══════════════════════════════════════════════════════════════════════════
  // HOSTED MODE PAGE ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  if (isHostedMode(env)) {
    // ── Root redirect ──
    if (path === "/" || path === "") {
      const user = await getSessionUser(request, env);
      if (user) {
        if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
        const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
        if (!comps || comps === "[]") return Response.redirect(url.origin + "/setup", 302);
        return Response.redirect(url.origin + "/dashboard", 302);
      }
      return Response.redirect(url.origin + "/signin", 302);
    }

    // ── Sign-in page ──
    if (path === "/signin" || path === "/signin/") {
      const user = await getSessionUser(request, env);
      if (user) {
        if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
        const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
        if (!comps || comps === "[]") return Response.redirect(url.origin + "/setup", 302);
        return Response.redirect(url.origin + "/dashboard", 302);
      }
      return htmlResponse(SIGNIN_HTML);
    }

    // ── Billing page ──
    if (path === "/billing" || path === "/billing/") {
      const user = await getSessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/signin", 302);
      return htmlResponse(BILLING_HTML);
    }

    // ── Partner pages ──
    if (path === "/partner/apply" || path === "/partner/apply/") {
      return htmlResponse(PARTNER_APPLY_HTML);
    }
    if (path === "/partner/dashboard" || path === "/partner/dashboard/") {
      return htmlResponse(PARTNER_DASHBOARD_HTML);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN PAGES — work in both modes
  // ══════════════════════════════════════════════════════════════════════════

  // ── Admin: login page ──
  if (path === "/admin/login" || path === "/admin/login/") {
    const adminSession = await getAdminSession(request, env);
    if (adminSession) return Response.redirect(url.origin + "/admin", 302);

    if (request.method === "POST") {
      if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH) {
        return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Admin credentials not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH secrets.</div>'));
      }
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const allowed = await checkAdminLoginRateLimit(env, ip);
      if (!allowed) {
        return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Too many attempts. Try again in 15 minutes.</div>'));
      }
      const formData = await request.formData();
      const username = formData.get("username") || "";
      const password = formData.get("password") || "";
      if (username !== env.ADMIN_USERNAME || !(await verifyAdminPassword(password, env.ADMIN_PASSWORD_HASH.toLowerCase()))) {
        await recordAdminLoginAttempt(env, ip, false);
        return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Invalid username or password.</div>'));
      }
      await recordAdminLoginAttempt(env, ip, true);
      const token = await createAdminSession(env);
      if (!token) {
        return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", '<div class="error">Session signing secret not available. Set JWT_SECRET or ADMIN_TOKEN.</div>'));
      }
      const headers = new Headers({ Location: url.origin + "/admin" });
      setAdminSessionCookie(headers, token);
      return new Response(null, { status: 302, headers });
    }

    return htmlResponse(ADMIN_LOGIN_HTML.replace("{{ERROR_BLOCK}}", ""));
  }

  // ── Admin: logout ──
  if (path === "/admin/logout") {
    const headers = new Headers({ Location: url.origin + "/admin/login" });
    clearAdminSessionCookie(headers);
    return new Response(null, { status: 302, headers });
  }

  // ── Admin: dashboard ──
  if (path === "/admin" || path === "/admin/") {
    const adminSession = await getAdminSession(request, env);
    if (!adminSession) return Response.redirect(url.origin + "/admin/login", 302);
    return htmlResponse(ADMIN_DASHBOARD_HTML);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED PAGE ROUTES — work in both modes
  // ══════════════════════════════════════════════════════════════════════════

  // ── Setup wizard ──
  if (path === "/setup" || path === "/setup/") {
    if (isHostedMode(env)) {
      const user = await getSessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/signin", 302);
      if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
      return htmlResponse(HOSTED_SETUP_HTML);
    }
    return htmlResponse(SETUP_HTML);
  }

  // ── Dashboard ──
  if (path === "/dashboard" || path === "/dashboard/") {
    if (isHostedMode(env)) {
      const user = await getSessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/signin", 302);
      if (user.subscriptionStatus !== "active") return Response.redirect(url.origin + "/billing", 302);
      const comps = await env.STATE.get("user_config:" + user.id + ":competitors");
      if (!comps || comps === "[]") return Response.redirect(url.origin + "/setup", 302);
    }
    return htmlResponse(DASHBOARD_HTML);
  }

  // ── Privacy Policy ──
  if (path === "/privacy" || path === "/privacy/") {
    return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FAVICON_LINK}<title>Privacy Policy — ScopeHound</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.7}
a{color:#7a8c52}.wrap{max-width:720px;margin:0 auto;padding:32px 24px}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}header h1 span{color:#5c6b3c}
h2{font-size:20px;margin:32px 0 12px;color:#7a8c52;font-weight:700}h3{font-size:15px;margin:20px 0 8px;color:#d4d8de}
p,li{font-size:14px;color:#b0b5bd;margin-bottom:8px}ul{margin-left:20px;margin-bottom:12px}
.updated{font-size:12px;color:#6b7280;margin-bottom:24px}</style></head><body>
<header><div><a href="/" style="text-decoration:none;color:inherit"><h1>Scope<span>Hound</span></h1></a></div><a href="/support" style="font-size:13px">Support</a></header>
<div class="wrap">
<h1 style="font-size:24px;margin-bottom:4px">Privacy Policy</h1>
<p class="updated">Last updated: February 10, 2026</p>

<h2>1. Who We Are</h2>
<p>ScopeHound ("we", "us", "our") is a competitive intelligence service operated as a sole proprietorship. For privacy inquiries, contact us at <a href="mailto:support@scopehound.app">support@scopehound.app</a>.</p>

<h2>2. Information We Collect</h2>
<h3>Account Information</h3>
<p>When you sign in with Google, we receive your name, email address, and profile picture from Google OAuth. We store this to identify your account.</p>
<h3>Payment Information</h3>
<p>Payments are processed by <a href="https://stripe.com/privacy">Stripe</a>. We do not store your credit card number. We store your Stripe customer ID and subscription status to manage your plan.</p>
<h3>Slack Integration</h3>
<p>When you connect Slack, we store your incoming webhook URL, channel name, and team name to deliver reports. We do not read your Slack messages.</p>
<h3>Competitor Data</h3>
<p>We store the competitor URLs, page configurations, and monitoring data you configure. We also store change history and AI-generated analysis of publicly available web pages.</p>
<h3>Usage Analytics</h3>
<p>We use <a href="https://clarity.microsoft.com/">Microsoft Clarity</a> to understand how users interact with our site. Clarity may collect anonymized usage data including clicks, scrolls, and session recordings. No personal data is shared with Clarity.</p>

<h2>3. How We Use Your Information</h2>
<ul>
<li>To provide the ScopeHound service (scanning competitors, generating reports, delivering Slack briefings)</li>
<li>To manage your subscription and billing</li>
<li>To communicate service updates or respond to support requests</li>
<li>To improve our product based on anonymized usage patterns</li>
</ul>

<h2>4. Data Sharing</h2>
<p>We do not sell your personal information. We share data only with:</p>
<ul>
<li><strong>Stripe</strong> — for payment processing</li>
<li><strong>Google</strong> — for authentication (OAuth)</li>
<li><strong>Slack</strong> — to deliver reports to your workspace</li>
<li><strong>Cloudflare</strong> — our infrastructure provider (hosting, Workers AI)</li>
<li><strong>Microsoft Clarity</strong> — anonymized usage analytics</li>
</ul>

<h2>5. Data Storage & Security</h2>
<p>Your data is stored on Cloudflare's global network using Workers KV. Sessions are secured with encrypted JWT tokens over HTTPS. We use HttpOnly, Secure cookies with a 30-day expiration.</p>

<h2>6. Data Retention</h2>
<p>Account data is retained while your account is active. Competitor monitoring history is retained based on your plan tier (30 days to unlimited). If you cancel your subscription, we retain your data for 30 days before deletion to allow reactivation.</p>

<h2>7. Your Rights</h2>
<p>You may:</p>
<ul>
<li>Request a copy of your stored data</li>
<li>Request deletion of your account and all associated data</li>
<li>Update your competitor configurations at any time</li>
<li>Disconnect Slack integration at any time</li>
</ul>
<p>To exercise these rights, email <a href="mailto:support@scopehound.app">support@scopehound.app</a>.</p>

<h2>8. Cookies</h2>
<p>We use a single session cookie (<code>sh_session</code>) to keep you logged in. It is HttpOnly, Secure, and expires after 30 days. We also use Microsoft Clarity which may set its own cookies for analytics purposes.</p>

<h2>9. Children's Privacy</h2>
<p>ScopeHound is not intended for use by individuals under 16. We do not knowingly collect data from children.</p>

<h2>10. Changes to This Policy</h2>
<p>We may update this policy from time to time. Material changes will be communicated via email or in-app notification. Continued use of the service after changes constitutes acceptance.</p>

<h2>11. Contact</h2>
<p>For questions about this privacy policy or your data, contact us at <a href="mailto:support@scopehound.app">support@scopehound.app</a>.</p>
</div></body></html>`, { headers: { "Content-Type": "text/html;charset=utf-8" } });
  }

  // ── Support / Contact ──
  if (path === "/support" || path === "/support/") {
    return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FAVICON_LINK}<title>Support — ScopeHound</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.7}
a{color:#7a8c52}.wrap{max-width:720px;margin:0 auto;padding:32px 24px}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}header h1 span{color:#5c6b3c}
h2{font-size:20px;margin:32px 0 12px;color:#7a8c52;font-weight:700}
p{font-size:14px;color:#b0b5bd;margin-bottom:12px}
.contact-card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:24px;text-align:center;margin:24px 0}
.contact-card .email{font-size:20px;font-weight:700;color:#7a8c52;margin:8px 0}
.contact-card p{color:#6b7280;font-size:13px}
.btn{display:inline-block;padding:12px 24px;border-radius:2px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;text-decoration:none;margin-top:12px}
.btn-primary{background:#5c6b3c;color:#fff}
.faq{margin-top:32px}
.faq-item{background:#12161a;border:1px solid #2a3038;border-radius:2px;margin-bottom:8px}
.faq-item summary{padding:14px 16px;cursor:pointer;font-size:14px;font-weight:600;color:#d4d8de}
.faq-item summary:hover{color:#7a8c52}
.faq-item p{padding:0 16px 14px;font-size:13px;color:#b0b5bd;margin:0}
</style></head><body>
<header><div><a href="/" style="text-decoration:none;color:inherit"><h1>Scope<span>Hound</span></h1></a></div><a href="/privacy" style="font-size:13px">Privacy</a></header>
<div class="wrap">
<h1 style="font-size:24px;margin-bottom:4px">Support</h1>
<p>Need help with ScopeHound? We're here for you.</p>

<div class="contact-card">
<p style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6b7280;margin-bottom:4px">Email Us</p>
<div class="email">support@scopehound.app</div>
<p>We typically respond within 24 hours.</p>
<a href="mailto:support@scopehound.app?subject=ScopeHound%20Support%20Request" class="btn btn-primary">Send Email</a>
</div>

<div class="faq">
<h2>Frequently Asked Questions</h2>

<details class="faq-item"><summary>How do I add or remove competitors?</summary>
<p>Go to your dashboard and click "Manage Competitors" in the navigation bar. This takes you to the setup wizard where you can add, scan, or remove competitors. You can also use Slack commands: <code>/scopehound add url</code> or <code>/scopehound remove name</code>.</p></details>

<details class="faq-item"><summary>When do scans run?</summary>
<p>Scans run automatically once daily at 9:00 AM UTC for Operator and Command plans. Scout is manual-only. You can also trigger a manual scan from the setup wizard or via <code>/scopehound scan</code> in Slack.</p></details>

<details class="faq-item"><summary>How do I connect Slack?</summary>
<p>During setup, click "Add to Slack" to authorize ScopeHound to send reports to your workspace. You can also manually enter a webhook URL if you prefer. Visit /setup to reconfigure your Slack connection.</p></details>

<details class="faq-item"><summary>How do I change my plan?</summary>
<p>Go to <a href="/billing">/billing</a> to view your current plan and upgrade or downgrade. You can also manage your subscription directly through Stripe's customer portal.</p></details>

<details class="faq-item"><summary>How do I cancel my subscription?</summary>
<p>Go to <a href="/billing">/billing</a> and click "Manage subscription on Stripe" to cancel. Your data will be retained for 30 days after cancellation.</p></details>

<details class="faq-item"><summary>Can I self-host ScopeHound?</summary>
<p>Yes! ScopeHound is open source. Visit our <a href="https://github.com/ZeroLupo/scopehound">GitHub repository</a> to deploy your own instance on Cloudflare Workers for free.</p></details>

<details class="faq-item"><summary>How do I delete my account?</summary>
<p>Email <a href="mailto:support@scopehound.app?subject=Account%20Deletion%20Request">support@scopehound.app</a> with the subject "Account Deletion Request" and we'll process it within 48 hours.</p></details>
</div>
</div></body></html>`, { headers: { "Content-Type": "text/html;charset=utf-8" } });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SELF-HOSTED ROUTES — simple auth-gated endpoints
  // ══════════════════════════════════════════════════════════════════════════

  // ── Manual run (auth required) ──
  if (path === "/test" || path === "/run") {
    const authErr = requireAuth(request, env);
    if (authErr) return authErr;
    const scanCtx = createContext();
    const result = await runMonitor(scanCtx, env);
    const slackOk = result.slackResults.filter(r => r.ok).length;
    const slackErrors = result.slackResults.filter(r => !r.ok).map(r => r.error);
    return new Response(
      JSON.stringify({ success: true, alertsDetected: result.alerts.length, slackUrl: result.slackUrl, slackMessages: { sent: slackOk, failed: slackErrors.length, errors: slackErrors }, alerts: result.alerts.map((a) => a.text || a) }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Raw state (auth required) ──
  if (path === "/state") {
    const authErr = requireAuth(request, env);
    if (authErr) return authErr;
    const state = await env.STATE.get("monitor_state");
    return new Response(state || "{}", { headers: { "Content-Type": "application/json" } });
  }

  // ── History (auth required) ──
  if (path === "/history") {
    const authErr = requireAuth(request, env);
    if (authErr) return authErr;
    const history = await env.STATE.get("change_history");
    return new Response(history || "[]", { headers: { "Content-Type": "application/json" } });
  }

  // ── Test Slack (auth required) ──
  if (path === "/test-slack") {
    const authErr = requireAuth(request, env);
    if (authErr) return authErr;
    const config = await loadConfig(env);
    await sendSlack(ctx, config.settings.slackWebhookUrl,
      "ScopeHound v3 is connected!\n\nDashboard: " + url.origin + "/dashboard"
    );
    return jsonResponse({ success: true, message: "Test sent to Slack" });
  }

  // ── Reset all (auth required) ──
  if (path === "/reset") {
    const authErr = requireAuth(request, env);
    if (authErr) return authErr;
    await env.STATE.delete("monitor_state");
    await env.STATE.delete("dashboard_cache");
    return jsonResponse({ success: true, message: "State reset. Run /test to re-index." });
  }

  // ── Reset pricing (auth required) ──
  if (path === "/reset-pricing") {
    const authErr = requireAuth(request, env);
    if (authErr) return authErr;
    try {
      const config = await loadConfig(env);
      const raw = await env.STATE.get("monitor_state");
      if (raw) {
        const state = JSON.parse(raw);
        for (const comp of config.competitors) {
          const cs = state.competitors?.[comp.name];
          if (cs) {
            cs.pricing = null;
            for (const page of (comp.pages || [])) {
              if (page.type === "pricing" && cs.pages[page.id]) {
                cs.pages[page.id].hash = null;
                cs.pages[page.id].textSnapshot = null;
              }
            }
          }
        }
        await env.STATE.put("monitor_state", JSON.stringify(state));
      }
    } catch (e) {
      console.log(`[reset-pricing] ${e.message}`);
      return jsonResponse({ success: false, error: "Failed to reset pricing state" }, 500);
    }
    return jsonResponse({ success: true, message: "Pricing reset. Run /test to re-extract." });
  }

  // ── Home fallback ──
  if (isHostedMode(env)) {
    const user = await getSessionUser(request, env);
    if (user) return Response.redirect(url.origin + "/dashboard", 302);
    return Response.redirect(url.origin + "/signin", 302);
  }
  const config = await loadConfig(env);
  const setupDone = await env.STATE.get("config:setup_complete");
  if (!setupDone && config.competitors.length === 0) {
    return Response.redirect(url.origin + "/setup", 302);
  }

  return new Response(
    `ScopeHound v3\n\nMonitoring ${config.competitors.length} competitor(s). Visit /dashboard to get started.`,
    { headers: { "Content-Type": "text/plain" } },
  );
}
