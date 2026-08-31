import { expect, test, type Page } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

/**
 * News source management (spec §5, §63, §58).
 *
 * Runs only under `npm run test:e2e:auth`. Feed URLs here are deliberately
 * unreachable example domains and nothing clicks Fetch — §58 keeps tests off
 * the network, and these cover the management surface, not ingestion.
 */
test.skip(
  !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "requires the Firebase emulators — run npm run test:e2e:auth",
);

// One shared source list, mutated in place.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function addSource(page: Page, name: string, feedUrl: string) {
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Feed URL").fill(feedUrl);
  await page.getByRole("button", { name: "Add source", exact: true }).last().click();
}

test("an empty list says discovery has nothing to read", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news/sources");

  await expect(page.getByText("No sources yet.")).toBeVisible();
});

test("an ADMIN can add a source and it appears in the list", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news/sources");

  await addSource(page, "Example AI", "https://feeds.example.test/ai.xml");

  await expect(page.getByTestId("source-form-status")).toHaveText("Source added.");
  await expect(page.getByText("https://feeds.example.test/ai.xml")).toBeVisible();

  // Never checked yet, and the UI should say so rather than imply health.
  await expect(page.getByText("Not checked")).toBeVisible();
});

test("a feed URL cannot be registered twice", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news/sources");

  await addSource(page, "Example AI Duplicate", "https://feeds.example.test/ai.xml");

  await expect(page.getByTestId("source-form-status")).toHaveText(
    "That feed is already registered.",
  );
  await expect(page.getByText("Another source already uses this feed URL.")).toBeVisible();
});

test("a feed URL that is not http(s) is rejected", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news/sources");

  // `ftp:` passes the browser's own url validation and is rejected by the
  // schema, which is the check being exercised — the server must not fetch
  // whatever scheme it is handed.
  await addSource(page, "Wrong scheme", "ftp://feeds.example.test/ai.xml");

  await expect(page.getByTestId("source-form-status")).toHaveText("Some fields need attention.");
});

test("an ADMIN can deactivate and reactivate a source", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news/sources");

  await page.getByRole("button", { name: "Deactivate" }).first().click();
  await expect(page.getByTestId("source-row-status")).toContainText("deactivated");
  await expect(page.getByText("Inactive")).toBeVisible();

  await page.getByRole("button", { name: "Activate" }).first().click();
  await expect(page.getByTestId("source-row-status")).toContainText("activated");
  await expect(page.getByText("Inactive")).toHaveCount(0);
});

test("an ADMIN can delete a source", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news/sources");

  const before = await page.getByTestId("source-row").count();
  await page.getByRole("button", { name: "Delete" }).first().click();

  await expect(page.getByTestId("source-row")).toHaveCount(before - 1);
});

test("a SOCIAL_MANAGER cannot reach source management and is not shown the link", async ({
  page,
}) => {
  await signIn(page, fixture.socialManager);

  await expect(page.getByRole("link", { name: "Sources" })).toHaveCount(0);

  await page.goto("/news/sources");
  await expect(page).toHaveURL(/\/forbidden/);
});

test("an ADMIN sees the Sources link nested under News", async ({ page }) => {
  await signIn(page, fixture.admin);

  await expect(page.getByRole("link", { name: "Sources" })).toBeVisible();

  await page.getByRole("link", { name: "Sources" }).click();
  await expect(page).toHaveURL("/news/sources");
  await expect(page.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
});
