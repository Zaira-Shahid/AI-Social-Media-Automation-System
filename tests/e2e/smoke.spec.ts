import { expect, test } from "@playwright/test";

/**
 * Smoke tests (spec §58). No credentials involved — these cover what an
 * unauthenticated visitor sees. The credentialed login flow lives in
 * `tests/e2e-auth`, which runs against the emulators.
 */
test("an unauthenticated visitor is redirected to login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "AI Social Media Command Center" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the requested path is carried through the redirect", async ({ page }) => {
  await page.goto("/analytics");

  await expect(page).toHaveURL(/\/login\?next=%2Fanalytics/);
});

test("no signup route is exposed", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByText(/no self-signup/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up|create account|register/i })).toHaveCount(0);
});

test("the application shell is not rendered to a signed-out visitor", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});

test("health endpoint stays public for the keep-warm ping", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("the session endpoint rejects a request with no token", async ({ request }) => {
  const response = await request.post("/api/auth/session", { data: {} });

  expect(response.status()).toBe(400);
});

test("the session endpoint rejects a forged token", async ({ request }) => {
  const response = await request.post("/api/auth/session", { data: { idToken: "not-a-token" } });

  expect(response.status()).toBe(401);
});

test("the brand screen is not reachable without a session", async ({ page }) => {
  await page.goto("/brand");

  await expect(page).toHaveURL(/\/login\?next=%2Fbrand/);
});

test("the news ingestion webhook rejects an unsigned request", async ({ request }) => {
  const response = await request.post("/api/webhooks/news/ingest", { data: { trigger: "daily" } });

  expect(response.status()).toBe(401);
});

test("the news ingestion webhook rejects a plausible but wrong signature", async ({ request }) => {
  const response = await request.post("/api/webhooks/news/ingest", {
    data: { trigger: "daily" },
    headers: {
      "x-timestamp": String(Date.now()),
      "x-signature": "a".repeat(64),
    },
  });

  expect(response.status()).toBe(401);
});

test("the source screen is not reachable without a session", async ({ page }) => {
  await page.goto("/news/sources");

  await expect(page).toHaveURL(/\/login\?next=%2Fnews%2Fsources/);
});

test("the news screen is not reachable without a session", async ({ page }) => {
  await page.goto("/news");

  await expect(page).toHaveURL(/\/login\?next=%2Fnews/);
});

test("the scheduler webhook rejects an unsigned request", async ({ request }) => {
  const response = await request.post("/api/webhooks/content/due", {
    data: { trigger: "schedule" },
  });

  expect(response.status()).toBe(401);
});

test("the social accounts screen is not reachable without a session", async ({ page }) => {
  await page.goto("/social-accounts");

  await expect(page).toHaveURL(/\/login\?next=%2Fsocial-accounts/);
});

test("the calendar is not reachable without a session", async ({ page }) => {
  await page.goto("/calendar");

  await expect(page).toHaveURL(/\/login\?next=%2Fcalendar/);
});

test("the ranking webhook rejects an unsigned request", async ({ request }) => {
  const response = await request.post("/api/webhooks/news/rank", { data: { trigger: "daily" } });

  expect(response.status()).toBe(401);
});
