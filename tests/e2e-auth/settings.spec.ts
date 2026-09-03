import { expect, test, type Page } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

/**
 * The Settings screen (spec §34's nav list — the one item no module was
 * ever assigned to build; added here directly rather than through a
 * numbered module, since it closes a gap rather than extending one).
 *
 * Read-only by design (§26): nothing here creates, edits or disables an
 * account, so there is no write path to test — only that the right roles
 * see the right things.
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

test("an ADMIN sees the Settings link, reaches the screen, and sees every provisioned account", async ({
  page,
}) => {
  await signIn(page, fixture.admin);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL("/settings");

  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

  // Scoped to the table: the signed-in admin's own email also appears in
  // the sidebar's account footer, which would otherwise make a plain
  // page-wide text match ambiguous.
  const table = page.getByRole("table");
  await expect(table.getByText(fixture.admin.email, { exact: true })).toBeVisible();
  await expect(table.getByText(fixture.manager.email, { exact: true })).toBeVisible();
  await expect(table.getByText(fixture.socialManager.email, { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Application configuration" })).toBeVisible();
  await expect(page.getByText("APP_TIMEZONE")).toBeVisible();
});

test("a SOCIAL_MANAGER is not shown the Settings link and cannot reach the screen directly", async ({
  page,
}) => {
  await signIn(page, fixture.socialManager);

  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page).toHaveURL("/forbidden");
});

test("a MANAGER is also refused — settings:manage is ADMIN-only, not just non-SOCIAL_MANAGER", async ({
  page,
}) => {
  await signIn(page, fixture.manager);

  await page.goto("/settings");

  await expect(page).toHaveURL("/forbidden");
});
