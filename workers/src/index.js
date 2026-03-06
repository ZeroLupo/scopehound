/**
 * ScopeHound v3 — AI-Powered Competitive Intelligence Agent
 * Cloudflare Worker · Free tier · Slack delivery · Web dashboard
 *
 * Monitors: pages (pricing, homepage, features), blogs (RSS + announcement detection),
 * SEO signals, and Product Hunt launches.
 * Delivers prioritized, AI-analyzed alerts to Slack.
 *
 * Config is stored in KV — use /setup to configure, or set via API.
 */
import { createContext } from "./context.js";
import { isHostedMode } from "./auth.js";
import { handleScheduled } from "./routes/scheduled.js";
import { handleSlackCommands } from "./routes/slack-commands.js";
import { handleApi } from "./routes/api.js";
import { handlePages } from "./routes/pages.js";

// ─── WORKER ENTRY POINT ─────────────────────────────────────────────────────

export default {
  async scheduled(event, env, cfCtx) {
    cfCtx.waitUntil(handleScheduled(env, event.cron));
  },

  async fetch(request, env, cfCtx) {
    const ctx = createContext();
    const url = new URL(request.url);
    const path = url.pathname;
    const reqOrigin = request.headers.get("Origin");
    let allowedOrigin = null;
    if (reqOrigin) {
      try {
        const originHost = new URL(reqOrigin).hostname;
        // Strict allowlist: same host, scopehound.app, or configured custom origins
        if (originHost === url.hostname ||
            /^(www\.)?scopehound\.app$/.test(originHost)) {
          allowedOrigin = reqOrigin;
        } else if (env.ALLOWED_ORIGINS) {
          // Self-hosted deployments can configure custom origins
          const custom = env.ALLOWED_ORIGINS.split(",").map(s => s.trim());
          if (custom.includes(reqOrigin)) allowedOrigin = reqOrigin;
        }
      } catch {} // Expected: malformed Origin header
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return new Response(null, { status: 403 });
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
      });
    }

    // ── Bot / vulnerability scanner blocker ──
    const lp = path.toLowerCase();
    if (/\.(php|asp|aspx|jsp|cgi|env|ini|bak|sql|xml|yml|yaml|log|gz|zip|tar|rar|7z|exe|dll|sh|bat|cmd|ps1|config|htaccess|htpasswd|git|svn|DS_Store)$/i.test(lp)) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }
    if (/^\/(wp-|wordpress|cgi-bin|phpmyadmin|mysql|cpanel|webmail|autodiscover|remote|telescope|debug|actuator|console|manager|jmx|\.well-known\/security|vendor\/phpunit|_profiler|elmah|trace\.axd|owa\/|ecp\/|exchange|aspnet)/i.test(lp)) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }
    const validPrefixes = ["/", "/signin", "/auth/", "/api/", "/setup", "/dashboard", "/billing", "/partner/", "/privacy", "/support", "/test", "/state", "/history", "/reset", "/run", "/robots.txt", "/admin"];
    if (path !== "/" && !validPrefixes.some(p => p === "/" ? false : lp.startsWith(p.toLowerCase()))) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }

    // ── robots.txt ──
    if (path === "/robots.txt") {
      return new Response(
        `User-agent: *\nAllow: /signin\nAllow: /privacy\nAllow: /support\nAllow: /partner/apply\nDisallow: /dashboard\nDisallow: /setup\nDisallow: /billing\nDisallow: /api/\nDisallow: /auth/\nDisallow: /admin\nDisallow: /test\nDisallow: /state\nDisallow: /history\nDisallow: /reset\n\nSitemap: https://scopehound.app/sitemap.xml`,
        { headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" } }
      );
    }

    // ── Slack slash commands (needs cfCtx for waitUntil) ──
    if (isHostedMode(env) && path === "/api/slack/commands" && request.method === "POST") {
      return handleSlackCommands(ctx, request, env, cfCtx, url);
    }

    // ── API + auth routes ──
    if (path.startsWith("/api/") || path.startsWith("/auth/")) {
      const response = await handleApi(ctx, request, env, url, path, allowedOrigin);
      if (response) return response;
    }

    // ── Page routes (HTML pages, admin, self-hosted endpoints, fallback) ──
    return handlePages(ctx, request, env, url, path);
  },
};
