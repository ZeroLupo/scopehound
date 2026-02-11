const { test, expect } = require("@playwright/test");

// ─── API ENDPOINT TESTS ────────────────────────────────────────────────────────
// These tests verify API endpoints respond correctly (status codes, content types).

test.describe("Config API (unauthenticated in hosted mode)", () => {
  test("POST /api/config/detect-rss requires auth", async ({ request }) => {
    const resp = await request.post("/api/config/detect-rss", {
      data: { url: "https://example.com" },
    });
    expect(resp.status()).toBe(401);
  });

  test("POST /api/config/discover-pages requires auth", async ({ request }) => {
    const resp = await request.post("/api/config/discover-pages", {
      data: { url: "https://example.com" },
    });
    expect(resp.status()).toBe(401);
  });

  test("POST /api/config/discover-competitors requires auth", async ({ request }) => {
    const resp = await request.post("/api/config/discover-competitors", {
      data: { url: "https://example.com" },
    });
    expect(resp.status()).toBe(401);
  });

  test("POST /api/config/test-slack requires auth", async ({ request }) => {
    const resp = await request.post("/api/config/test-slack", {
      data: { webhookUrl: "https://hooks.slack.com/test" },
    });
    expect(resp.status()).toBe(401);
  });

  test("POST /api/config/trigger-scan requires auth", async ({ request }) => {
    const resp = await request.post("/api/config/trigger-scan");
    expect(resp.status()).toBe(401);
  });
});

test.describe("Billing API (unauthenticated)", () => {
  test("POST /api/checkout requires auth", async ({ request }) => {
    const resp = await request.post("/api/checkout", {
      data: { tier: "recon" },
    });
    expect(resp.status()).toBe(401);
  });

  test("POST /api/billing/portal requires auth", async ({ request }) => {
    const resp = await request.post("/api/billing/portal");
    expect(resp.status()).toBe(401);
  });
});

test.describe("Stripe webhook endpoint", () => {
  test("POST /api/stripe/webhook rejects unsigned request", async ({ request }) => {
    const resp = await request.post("/api/stripe/webhook", {
      data: { type: "test" },
      headers: { "stripe-signature": "invalid" },
    });
    // Should get 400 (bad signature) not 500
    expect([400, 401]).toContain(resp.status());
  });
});

test.describe("Slack commands endpoint", () => {
  test("POST /api/slack/commands returns 500 when signing secret not configured", async ({ request }) => {
    // SLACK_SIGNING_SECRET may not be set — returns 500 "Not configured"
    // If it IS set, unsigned requests return 401
    const resp = await request.post("/api/slack/commands", {
      data: "command=%2Fscopehound&text=help",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-signature": "v0=invalid",
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });
    expect([401, 500]).toContain(resp.status());
  });
});
