import { expect, test } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

const E2E_USER = fixture.admin;

/**
 * Credentialed login flow (spec §26, §58).
 *
 * Runs only under `npm run test:e2e:auth`, which starts the Auth and
 * Firestore emulators and seeds the user below. Tests must never touch the
 * live project.
 */
test.skip(
  !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "requires the Firebase emulators — run npm run test:e2e:auth",
);

test("a provisioned user can sign in, sees their role, and can sign out", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByText(E2E_USER.email, { exact: true })).toBeVisible();
  await expect(page.getByText("Admin", { exact: true })).toBeVisible();

  // The permission list is rendered from the role claim, so its presence
  // proves the claim survived the ID-token-to-session-cookie exchange.
  await expect(page.getByText("users:manage")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login/);

  // The session must be gone server-side, not just visually.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("a wrong password is rejected without revealing whether the account exists", async ({
  page,
}) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("login-error")).toHaveText("Email or password is incorrect.");
  await expect(page).toHaveURL(/\/login/);
});

test("an unknown account gives exactly the same message", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("whatever");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("login-error")).toHaveText("Email or password is incorrect.");
});

test("the user is returned to the page they originally asked for", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page).toHaveURL(/\/login\?next=%2Fanalytics/);

  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // /analytics has no page yet, so a 404 is the correct destination — what
  // matters is that the redirect target was honoured rather than dropped.
  await expect(page).toHaveURL("/analytics");
});
