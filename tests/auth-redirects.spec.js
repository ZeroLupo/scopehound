const { test, expect } = require("@playwright/test");

// ─── AUTH REDIRECTS ────────────────────────────────────────────────────────────
// These tests verify that unauthenticated users are redirected correctly.
// Since we can't simulate a real Google OAuth session, we test the redirect
// behavior for unauthenticated requests.

test.describe("Root / redirect (unauthenticated)", () => {
  test("redirects to /signin", async ({ page }) => {
    // Follow redirects and check final URL
    await page.goto("/");
    expect(page.url()).toContain("/signin");
  });
});

test.describe("Sign-in page (unauthenticated)", () => {
  test("renders sign-in page with Google OAuth button", async ({ page }) => {
    const resp = await page.goto("/signin");
    expect(resp.status()).toBe(200);
    // Check for Google sign-in link
    const googleLink = page.locator('a[href*="/auth/google"]');
    await expect(googleLink).toBeVisible();
  });

  test("contains ScopeHound branding", async ({ page }) => {
    await page.goto("/signin");
    const text = await page.textContent("body");
    expect(text).toMatch(/ScopeHound/i);
  });
});

test.describe("Protected routes redirect to /signin when unauthenticated", () => {
  test("/billing redirects to /signin", async ({ page }) => {
    await page.goto("/billing");
    expect(page.url()).toContain("/signin");
  });

  test("/setup redirects to /signin", async ({ page }) => {
    await page.goto("/setup");
    expect(page.url()).toContain("/signin");
  });

  test("/dashboard redirects to /signin", async ({ page }) => {
    await page.goto("/dashboard");
    expect(page.url()).toContain("/signin");
  });
});

test.describe("Google OAuth initiation", () => {
  test("/auth/google redirects to accounts.google.com", async ({ page }) => {
    // Don't follow redirects — use API request to check location header
    const resp = await page.request.get("/auth/google", {
      maxRedirects: 0,
    });
    expect(resp.status()).toBe(302);
    const location = resp.headers()["location"];
    expect(location).toContain("accounts.google.com");
    expect(location).toContain("client_id=");
    expect(location).toContain("redirect_uri=");
  });
});

test.describe("API routes return auth errors when unauthenticated", () => {
  test("/api/user/profile returns 401", async ({ request }) => {
    const resp = await request.get("/api/user/profile");
    expect(resp.status()).toBe(401);
  });

  test("/api/dashboard-data returns 401", async ({ request }) => {
    const resp = await request.get("/api/dashboard-data");
    expect(resp.status()).toBe(401);
  });

  test("POST /api/config/competitors requires auth", async ({ request }) => {
    const resp = await request.post("/api/config/competitors", {
      data: { competitors: [] },
    });
    expect(resp.status()).toBe(401);
  });
});
