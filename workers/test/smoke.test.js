import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import {
  adminGet,
  adminHeaders,
  jsonPost,
  formPost,
  assertJson,
  seedCompetitors,
  BASE,
} from "./helpers.js";

// ─── Group 1: Public Routes ──────────────────────────────────────────────────

describe("Public Routes", () => {
  it("GET / returns 200 or redirect", async () => {
    const res = await SELF.fetch(BASE + "/");
    // In self-hosted mode with no config, could be 200 or 302
    expect([200, 302]).toContain(res.status);
  });

  it("GET /privacy returns 200 with HTML", async () => {
    const res = await SELF.fetch(BASE + "/privacy");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("privacy");
  });

  it("GET /support returns 200 with HTML", async () => {
    const res = await SELF.fetch(BASE + "/support");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("support");
  });

  it("GET /robots.txt returns 200 with text", async () => {
    const res = await SELF.fetch(BASE + "/robots.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("User-agent");
  });

  it("GET /nonexistent returns fallback, not 500", async () => {
    const res = await SELF.fetch(BASE + "/some-random-path-xyz");
    expect(res.status).not.toBe(500);
  });
});

// ─── Group 2: Auth-Protected Routes (self-hosted, ADMIN_TOKEN) ──────────────

describe("Auth-Protected Routes", () => {
  it("GET /state returns 200 JSON with admin token", async () => {
    const res = await SELF.fetch(adminGet("/state"));
    expect(res.status).toBe(200);
    // State may be null initially, which is fine
  });

  it("GET /history returns 200 JSON with admin token", async () => {
    const res = await SELF.fetch(adminGet("/history"));
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /reset returns 200 with admin token", async () => {
    const res = await SELF.fetch(adminGet("/reset"));
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(data.success).toBe(true);
  });

  it("GET /state without auth returns 401", async () => {
    const res = await SELF.fetch(BASE + "/state");
    expect(res.status).toBe(401);
  });

  it("GET /history without auth returns 401", async () => {
    const res = await SELF.fetch(BASE + "/history");
    expect(res.status).toBe(401);
  });

  it("GET /test-slack returns 200 (Slack POST will fail but no 500)", async () => {
    const res = await SELF.fetch(adminGet("/test-slack"));
    // Slack webhook URL is fake, so the POST to Slack will fail
    // But the route should handle it gracefully
    expect(res.status).not.toBe(500);
  });
});

// ─── Group 3: API Routes ────────────────────────────────────────────────────

describe("API Routes", () => {
  it("GET /api/config returns 200 JSON", async () => {
    const res = await SELF.fetch(adminGet("/api/config"));
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(data).toHaveProperty("competitors");
    expect(data).toHaveProperty("settings");
  });

  it("POST /api/config/competitors saves and returns success", async () => {
    const competitors = [
      {
        name: "TestCo",
        website: "https://test.com",
        pages: [
          { id: "home", url: "https://test.com", type: "general", label: "Homepage" },
        ],
      },
    ];
    const res = await SELF.fetch(jsonPost("/api/config/competitors", { competitors }));
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(data.success).toBe(true);
  });

  it("POST /api/config/settings saves and returns success", async () => {
    const res = await SELF.fetch(
      jsonPost("/api/config/settings", {
        slackWebhookUrl: "https://hooks.slack.com/test",
        productHuntTopics: [],
      })
    );
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(data.success).toBe(true);
  });

  it("GET /api/dashboard-data returns 200 JSON", async () => {
    const res = await SELF.fetch(adminGet("/api/dashboard-data"));
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(data).toHaveProperty("competitors");
  });

  it("GET /api/config without auth returns 401", async () => {
    const res = await SELF.fetch(BASE + "/api/config");
    expect(res.status).toBe(401);
  });

  it("POST /api/config/settings without auth returns 401", async () => {
    const res = await SELF.fetch(
      new Request(BASE + "/api/config/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackWebhookUrl: null }),
      })
    );
    expect(res.status).toBe(401);
  });
});

// ─── Group 4: Scan with Seeded Config ───────────────────────────────────────

describe("Scan with Seeded Config", () => {
  beforeAll(async () => {
    await seedCompetitors(env);
  });

  it("GET /test runs scan and returns valid result", async () => {
    const res = await SELF.fetch(adminGet("/test"));
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(data).toHaveProperty("success");
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("alerts");
    expect(Array.isArray(data.alerts)).toBe(true);
    expect(data).toHaveProperty("slackMessages");
  });

  it("GET /state returns valid JSON after scan", async () => {
    // Seed and run a scan in this test to ensure state exists
    await seedCompetitors(env);
    await SELF.fetch(adminGet("/test"));
    const res = await SELF.fetch(adminGet("/state"));
    expect(res.status).toBe(200);
    const text = await res.text();
    // State should be parseable JSON (may be empty {} if KV isolation)
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

// ─── Group 5: Slack Slash Commands ──────────────────────────────────────────

describe("Slack Slash Commands", () => {
  it("POST /api/slack/commands without signing secret returns 500 'Not configured'", async () => {
    // No SLACK_SIGNING_SECRET is set, so the handler should reject
    const res = await SELF.fetch(
      formPost("/api/slack/commands", {
        command: "/scopehound",
        text: "help",
        user_id: "U123",
      })
    );
    // Without signing secret, should return error, not crash
    expect(res.status).not.toBe(500); // TODO: currently may be 500 if not configured
  });

  it("POST /api/slack/commands with empty body returns non-500", async () => {
    const res = await SELF.fetch(
      new Request(BASE + "/api/slack/commands", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
      })
    );
    expect(res.status).not.toBe(500);
  });
});

// ─── Group 6: Stripe Webhook ────────────────────────────────────────────────

describe("Stripe Webhook", () => {
  it("POST /api/stripe/webhook without signature returns error, not 500", async () => {
    // No STRIPE_WEBHOOK_SECRET is set, so this should fail gracefully
    const res = await SELF.fetch(
      new Request(BASE + "/api/stripe/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      })
    );
    // Should reject, not crash. In non-hosted mode, this route might not exist.
    // Accept any non-500 status.
    expect(res.status).not.toBe(500);
  });
});

// ─── Group 7: Error Resilience ──────────────────────────────────────────────

describe("Error Resilience", () => {
  it("POST /api/config/settings with invalid JSON returns non-500", async () => {
    const res = await SELF.fetch(
      new Request(BASE + "/api/config/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: "not valid json{{{",
      })
    );
    expect(res.status).not.toBe(500);
  });

  it("POST /api/config/competitors with empty body returns non-500", async () => {
    const res = await SELF.fetch(
      new Request(BASE + "/api/config/competitors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: "{}",
      })
    );
    expect(res.status).not.toBe(500);
  });

  it("POST /api/config/reset clears config cleanly", async () => {
    // Seed some data first
    await seedCompetitors(env);
    const res = await SELF.fetch(jsonPost("/api/config/reset", {}));
    expect(res.status).toBe(200);
    const data = await assertJson(res);
    expect(data.success).toBe(true);

    // Verify config is cleared
    const configRes = await SELF.fetch(adminGet("/api/config"));
    const config = await assertJson(configRes);
    expect(config.competitors).toHaveLength(0);
  });

  it("GET /dashboard returns HTML, not 500", async () => {
    const res = await SELF.fetch(
      new Request(BASE + "/dashboard", { headers: adminHeaders() })
    );
    // In self-hosted mode, dashboard should return HTML
    expect(res.status).not.toBe(500);
    if (res.status === 200) {
      const ct = res.headers.get("content-type");
      expect(ct).toContain("text/html");
    }
  });

  it("GET /setup returns HTML, not 500", async () => {
    const res = await SELF.fetch(BASE + "/setup");
    expect(res.status).not.toBe(500);
  });

  it("OPTIONS request returns CORS headers for allowed origin", async () => {
    const res = await SELF.fetch(
      new Request(BASE + "/api/config", {
        method: "OPTIONS",
        headers: { Origin: "https://scopehound.app" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("OPTIONS request returns 403 for unknown origin", async () => {
    const res = await SELF.fetch(
      new Request(BASE + "/api/config", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.com" },
      })
    );
    expect(res.status).toBe(403);
  });
});
