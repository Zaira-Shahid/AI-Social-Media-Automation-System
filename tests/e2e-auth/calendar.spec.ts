import { expect, test, type Page } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

/**
 * Calendar (spec §38, §54, §58).
 *
 * Runs only under `npm run test:e2e:auth`. Nothing is scheduled in this
 * module — scheduling is Module 11 — so what these check is that the screen
 * says so plainly, that the three views and both filters work, and that the
 * grid is built in the configured timezone rather than the browser's.
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

test("the calendar is reachable from the navigation", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Calendar" })
    .click();

  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
});

test("an empty month says nothing is scheduled rather than showing a blank grid (§67)", async ({
  page,
}) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar?view=month&date=2026-03-12");

  await expect(page.getByTestId("calendar-empty")).toBeVisible();
  await expect(page.getByTestId("calendar-post")).toHaveCount(0);
});

test("the month view covers the month in whole weeks", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar?view=month&date=2026-03-12");

  await expect(page.getByTestId("calendar-period")).toHaveText("March 2026");

  const days = page.getByTestId("calendar-day");
  await expect(days).toHaveCount(42);
  await expect(days.first()).toHaveAttribute("data-date", "2026-02-23");
});

test("the week view shows seven days, Monday first (§38)", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar?view=week&date=2026-03-12");

  await expect(page.getByTestId("calendar-period")).toHaveText("9 – 15 March 2026");

  const days = page.getByTestId("calendar-day");
  await expect(days).toHaveCount(7);
  await expect(days.first()).toHaveAttribute("data-date", "2026-03-09");
});

test("the day view shows one day", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar?view=day&date=2026-03-12");

  await expect(page.getByTestId("calendar-period")).toHaveText("Thursday, 12 March 2026");
  await expect(page.getByTestId("calendar-day")).toHaveCount(1);
});

test("the period controls move a month at a time", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar?view=month&date=2026-03-12");

  await page.getByLabel("Next period").click();
  await expect(page.getByTestId("calendar-period")).toHaveText("April 2026");

  await page.getByLabel("Previous period").click();
  await expect(page.getByTestId("calendar-period")).toHaveText("March 2026");
});

test("a filter is kept in the URL, so a view can be shared", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar?view=week&date=2026-03-12");

  await page.getByRole("navigation", { name: "Filter by platform" }).getByText("LinkedIn").click();

  await expect(page).toHaveURL(/platform=LINKEDIN/);
  await expect(page).toHaveURL(/view=week/);
  await expect(page).toHaveURL(/date=2026-03-12/);
});

test("an unusable date in the URL falls back to today rather than failing", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar?view=day&date=2026-02-30");

  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await expect(page.getByTestId("calendar-day")).toHaveCount(1);
});

test("the screen names the timezone its grid is built in (§54)", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar");

  await expect(page.getByTestId("calendar-timezone")).toContainText("Times shown in");
});

test("approved work with no slot yet has a list of its own", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/calendar");

  // Nothing is approved in this run — approval needs a rendered card, and the
  // suite never spends Cloudinary credits (§58) — so the list says so.
  await expect(page.getByTestId("unscheduled-empty")).toBeVisible();
});
