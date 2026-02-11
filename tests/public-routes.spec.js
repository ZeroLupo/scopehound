const { test, expect } = require("@playwright/test");

// ─── PUBLIC PAGES ──────────────────────────────────────────────────────────────
// These tests verify routes that should be accessible without authentication.

test.describe("Privacy Policy page", () => {
  test("returns 200 with correct content", async ({ page }) => {
    const resp = await page.goto("/privacy");
    expect(resp.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
    await expect(page).toHaveTitle(/Privacy Policy/);
  });

  test("contains required sections", async ({ page }) => {
    await page.goto("/privacy");
    const text = await page.textContent("body");
    expect(text).toContain("Who We Are");
    expect(text).toContain("Information We Collect");
    expect(text).toContain("support@scopehound.app");
  });

  test("has navigation links", async ({ page }) => {
    await page.goto("/privacy");
    const supportLink = page.locator('header a[href="/support"]');
    await expect(supportLink).toBeVisible();
  });
});

test.describe("Support page", () => {
  test("returns 200 with correct content", async ({ page }) => {
    const resp = await page.goto("/support");
    expect(resp.status()).toBe(200);
    await expect(page).toHaveTitle(/Support/);
  });

  test("contains contact info and FAQ", async ({ page }) => {
    await page.goto("/support");
    const text = await page.textContent("body");
    expect(text).toContain("support@scopehound.app");
    // Check FAQ items exist
    const faqItems = page.locator(".faq-item");
    const count = await faqItems.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("has mailto link", async ({ page }) => {
    await page.goto("/support");
    const mailto = page.locator('a[href^="mailto:support@scopehound.app"]');
    await expect(mailto.first()).toBeVisible();
  });

  test("has navigation links", async ({ page }) => {
    await page.goto("/support");
    const privacyLink = page.locator('header a[href="/privacy"]');
    await expect(privacyLink).toBeVisible();
  });
});

test.describe("Partner apply page", () => {
  test("returns 200", async ({ page }) => {
    const resp = await page.goto("/partner/apply");
    expect(resp.status()).toBe(200);
    await expect(page).toHaveTitle(/Partner|Affiliate/i);
  });
});
