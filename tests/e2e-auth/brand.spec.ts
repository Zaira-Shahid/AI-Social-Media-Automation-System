import { expect, test, type Page } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

/**
 * Brand screen (spec §11, §43, §58).
 *
 * Runs only under `npm run test:e2e:auth`, which starts the emulators and
 * seeds both accounts. The brand documents are cleared by that seed, so the
 * empty state below is asserted against a genuinely unconfigured profile.
 */
test.skip(
  !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "requires the Firebase emulators — run npm run test:e2e:auth",
);

// Saving mutates one shared brand profile, so these run in order.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("an unconfigured profile says what content generation is still missing", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/brand");

  const notice = page.getByTestId("brand-incomplete");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Company name");
  await expect(notice).toContainText("Tone of voice");
});

test("an ADMIN can save the profile and the values persist", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/brand");

  await page.getByLabel("Company name").fill("Acme Logistics");
  await page.getByLabel("Industry").fill("Freight");
  await page.getByLabel("Tone of voice").fill("Direct and practical");
  await page.getByLabel("Target audience").fill("Operations leads");
  await page.getByLabel("Preferred topics").fill("automation, logistics");
  await page.getByLabel("Topics to avoid").fill("politics");
  await page.getByLabel("Content rules").fill("Never promise delivery times");

  await page.getByRole("button", { name: "Save brand profile" }).click();

  await expect(page.getByTestId("brand-form-status")).toHaveText("Brand profile saved.");

  // Reload rather than trusting the message: the point is that it was stored.
  await page.reload();
  await expect(page.getByLabel("Company name")).toHaveValue("Acme Logistics");
  await expect(page.getByLabel("Tone of voice")).toHaveValue("Direct and practical");
  await expect(page.getByLabel("Preferred topics")).toHaveValue("automation, logistics");
});

test("a contradictory pair of topics is rejected with the conflict named", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/brand");

  await page.getByLabel("Preferred topics").fill("automation");
  await page.getByLabel("Topics to avoid").fill("automation");

  await page.getByRole("button", { name: "Save brand profile" }).click();

  await expect(page.getByTestId("brand-form-status")).toHaveText("Some fields need attention.");
  await expect(page.getByText("Also listed as a preferred topic: automation")).toBeVisible();
});

test("a non-hex colour is rejected, since the renderer resolves no colour names", async ({
  page,
}) => {
  await signIn(page, fixture.admin);
  await page.goto("/brand");

  await page.getByLabel("Primary").fill("rebeccapurple");
  await page.getByRole("button", { name: "Save brand profile" }).click();

  await expect(page.getByTestId("brand-form-status")).toHaveText("Some fields need attention.");
});

test("a SOCIAL_MANAGER cannot reach the brand screen and is not shown the link", async ({
  page,
}) => {
  await signIn(page, fixture.socialManager);

  // §34's Brand entry is hidden rather than shown and then refused.
  await expect(page.getByRole("link", { name: "Brand" })).toHaveCount(0);

  await page.goto("/brand");
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(page.getByRole("heading", { name: "Not authorized" })).toBeVisible();
});

test("an ADMIN is shown the Brand link and it marks itself active", async ({ page }) => {
  await signIn(page, fixture.admin);

  const link = page.getByRole("link", { name: "Brand" });
  await expect(link).toBeVisible();

  await link.click();
  await expect(page).toHaveURL("/brand");
  await expect(page.getByRole("link", { name: "Brand" })).toHaveAttribute("aria-current", "page");
});
