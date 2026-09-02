import { expect, test, type Page } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

/**
 * Social accounts (spec §19, §21, §42, §66).
 *
 * Runs only under `npm run test:e2e:auth`. Every provider switch is left at
 * its default of `mock` throughout, so nothing here can reach a real account
 * (§58) — and what these check is that the screen says exactly that rather
 * than implying a connection nobody made.
 */
test.skip(
  !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "requires the Firebase emulators — run npm run test:e2e:auth",
);

/** One platform's card. Two of them now carry a connect form, so nothing here
 * may address a field without saying which platform it belongs to. */
function card(page: Page, platform: string) {
  return page.getByTestId("social-account").filter({ hasText: platform });
}

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

  const facebook = card(page, "Facebook");

  await expect(facebook.getByTestId("adapter-mode")).toHaveText("MOCK");
  await expect(facebook.getByTestId("connection-state")).toHaveText("Not connected");
});

test("LinkedIn names what the self-serve tier cannot do, not a module (§66)", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const linkedin = card(page, "LinkedIn");

  await expect(linkedin.getByTestId("adapter-mode")).toHaveText("MOCK");
  await expect(linkedin.getByTestId("limitation")).toContainText("LINKEDIN_PROVIDER");
});

test("Instagram is built and simulated, not 'not built yet' (§21, §66)", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const instagram = card(page, "Instagram");

  await expect(instagram.getByTestId("adapter-mode")).toHaveText("MOCK");
  await expect(instagram.getByTestId("connection-state")).toHaveText("Not connected");
  // The limitation is now what the adapter cannot do, not which module owes it.
  await expect(instagram.getByTestId("limitation")).toContainText("INSTAGRAM_PROVIDER");
});

test("an ADMIN is offered a connect form for every platform", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  await expect(card(page, "Facebook").getByLabel("Meta user access token")).toBeVisible();
  await expect(card(page, "Instagram").getByLabel("Meta user access token")).toBeVisible();
  await expect(card(page, "LinkedIn").getByLabel("LinkedIn access token")).toBeVisible();
});

test("the LinkedIn form asks for the publishing scope by name", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  await expect(card(page, "LinkedIn")).toContainText("w_member_social");
});

test("connecting LinkedIn without client credentials fails loudly", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const linkedin = card(page, "LinkedIn");

  await linkedin.getByLabel("LinkedIn access token").fill("not-a-real-token");
  await linkedin.getByRole("button", { name: "Connect profile" }).click();

  /*
   * §19 requires the real expiry be tracked, and without the client
   * credentials it cannot be established — storing the token with a guessed
   * date would put a false countdown on this screen (§67).
   */
  await expect(linkedin.getByTestId("connect-status")).toContainText("LINKEDIN_CLIENT_ID");
});

test("the Instagram form asks for the publishing scope by name", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  await expect(card(page, "Instagram")).toContainText("instagram_content_publish");
});

test("every token field is a password field, so none is ever on screen", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const meta = page.getByLabel("Meta user access token");

  await expect(meta).toHaveCount(2);

  for (const field of [...(await meta.all()), page.getByLabel("LinkedIn access token")]) {
    await expect(field).toHaveAttribute("type", "password");
  }
});

test("connecting without app credentials fails loudly rather than half-working", async ({
  page,
}) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const facebook = card(page, "Facebook");

  await facebook.getByLabel("Meta user access token").fill("not-a-real-token");
  await facebook.getByRole("button", { name: "Connect Page" }).click();

  // FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are unset in this run, so the
  // exchange cannot happen — and storing the pasted token instead would be a
  // credential that dies in an hour (§67).
  await expect(facebook.getByTestId("connect-status")).toContainText("FACEBOOK_APP_ID");
});

test("connecting Instagram without app credentials fails the same way", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/social-accounts");

  const instagram = card(page, "Instagram");

  await instagram.getByLabel("Meta user access token").fill("not-a-real-token");
  await instagram.getByRole("button", { name: "Connect account" }).click();

  await expect(instagram.getByTestId("connect-status")).toContainText("FACEBOOK_APP_ID");
});

test("a SOCIAL_MANAGER can see the screen but cannot connect an account (§27)", async ({
  page,
}) => {
  await signIn(page, fixture.socialManager);
  await page.goto("/social-accounts");

  await expect(page.getByTestId("social-account")).toHaveCount(3);
  await expect(page.getByLabel("Meta user access token")).toHaveCount(0);
  await expect(page.getByLabel("LinkedIn access token")).toHaveCount(0);
});
