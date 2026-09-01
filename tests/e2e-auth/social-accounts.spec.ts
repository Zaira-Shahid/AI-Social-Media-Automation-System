import { expect, test, type Page } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

/**
 * Social accounts (spec §19, §21, §42, §66).
 *
 * Runs only under `npm run test:e2e:auth`. `FACEBOOK_PROVIDER` is left at its
 * default of `mock` throughout, so nothing here can reach a real Page (§58) —
 * and what these check is that the screen says exactly that rather than
 * implying a connection nobody made.
 */
test.skip(
  !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "requires the Firebase emulators — run npm run test:e2e:auth",
);

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("the screen is reachable from the navigation", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Social Accounts" })
    .click();

  await expect(page).toHaveURL(/\/social-accounts/);
  await expect(page.getByRole("heading", { name: "Social Accounts", level: 1 })).toBeVisible();
});

test("every platform in §13 has a row", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  await expect(page.getByTestId("social-account")).toHaveCount(3);
});

test("a simulated integration says MOCK, not Connected (§21, §66)", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const facebook = page.getByTestId("social-account").filter({ hasText: "Facebook" });

  await expect(facebook.getByTestId("adapter-mode")).toHaveText("MOCK");
  await expect(facebook.getByTestId("connection-state")).toHaveText("Not connected");
});

test("a platform nobody has built says which module builds it", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const instagram = page.getByTestId("social-account").filter({ hasText: "Instagram" });

  await expect(instagram.getByTestId("limitation")).toContainText("Module 13");
});

test("an ADMIN is offered the Facebook connect form", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  await expect(page.getByLabel("Meta user access token")).toBeVisible();
});

test("the token field is a password field, so it is never on screen", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  await expect(page.getByLabel("Meta user access token")).toHaveAttribute("type", "password");
});

test("connecting without app credentials fails loudly rather than half-working", async ({
  page,
}) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  await page.getByLabel("Meta user access token").fill("not-a-real-token");
  await page.getByRole("button", { name: "Connect Page" }).click();

  // FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are unset in this run, so the
  // exchange cannot happen — and storing the pasted token instead would be a
  // credential that dies in an hour (§67).
  await expect(page.getByTestId("connect-status")).toContainText("FACEBOOK_APP_ID");
});

test("a SOCIAL_MANAGER can see the screen but cannot connect an account (§27)", async ({
  page,
}) => {
  await signIn(page, fixture.socialManager);
  await page.goto("/social-accounts");

  await expect(page.getByTestId("social-account")).toHaveCount(3);
  await expect(page.getByLabel("Meta user access token")).toHaveCount(0);
});
