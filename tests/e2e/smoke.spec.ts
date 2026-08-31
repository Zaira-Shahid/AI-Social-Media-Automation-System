import { expect, test } from "@playwright/test";

/**
 * Module 00 smoke test (spec §58): the shell renders and the keep-warm
 * health endpoint responds. Nothing feature-specific exists yet.
 */
test("application shell renders", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AI Social Media Command Center" })).toBeVisible();

  // Navigation from §34 is present but inert in this module.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByText("Dashboard")).toBeVisible();
  await expect(page.getByText("Social Accounts")).toBeVisible();
});

test("health endpoint returns ok for the keep-warm ping", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
