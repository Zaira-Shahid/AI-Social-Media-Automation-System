import { expect, test, type Page } from "@playwright/test";

import fixture from "../fixtures/e2e-user.json";

/**
 * Ranking and the shortlist (spec §7, §8, §21, §58).
 *
 * Runs under the emulators with `AI_PROVIDER` unset, so the mock provider
 * scores everything — no key, no network, and every result must be visibly
 * labelled as simulated.
 */
test.skip(
  !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "requires the Firebase emulators — run npm run test:e2e:auth",
);

// Ranking mutates the shared story list, so order matters.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("before ranking, the page says nothing has been scored yet", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await expect(page.getByText("No stories have been ranked yet.")).toBeVisible();
});

test("an ADMIN can rank, and the shortlist appears with every field §8 requires", async ({
  page,
}) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await page.getByRole("button", { name: "Rank now" }).click();

  const status = page.getByTestId("rank-status");
  await expect(status).toContainText("Considered 5");
  // §21: the run reports plainly that these scores were simulated.
  await expect(status).toContainText("Simulated");

  const rows = page.getByTestId("story-row");
  await expect(rows.first()).toBeVisible();

  const first = rows.first();
  // The headline link. Each row also carries a "Details" link (§36).
  await expect(first.getByRole("link").first()).toBeVisible();
  await expect(first).toContainText("Why it matters");
  await expect(first).toContainText("E2E Wire");
  await expect(first).toContainText("relevance");
});

test("simulated scores are labelled on every story, not just in the run message", async ({
  page,
}) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  const badges = page.getByTestId("mock-badge");
  await expect(badges.first()).toBeVisible();

  const rows = await page.getByTestId("story-row").count();
  await expect(badges).toHaveCount(rows);
});

test("the shortlist never exceeds the ten §8 allows", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  const heading = page.getByRole("heading", { name: /^Shortlist \(\d+\)/ });
  await expect(heading).toBeVisible();

  const count = Number((await heading.textContent())?.match(/\((\d+)\)/)?.[1] ?? "0");
  expect(count).toBeLessThanOrEqual(10);
});

test("the page says a human picks the final three", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await expect(
    page.getByText(/human picks the final three|human picks three/i).first(),
  ).toBeVisible();
});

test("re-ranking is safe: nothing is left to rank the second time", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await page.getByRole("button", { name: "Rank now" }).click();

  // Everything was scored by the previous run, so there is no backlog left.
  await expect(page.getByTestId("rank-status")).toContainText("Nothing new to rank.");
});

test("an ADMIN can send the shortlist to Slack, and the send is labelled simulated", async ({
  page,
}) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await page.getByRole("button", { name: "Send to Slack" }).click();

  // §67: the screen never claims a Slack notification was sent when the mock
  // notifier only logged it.
  const status = page.getByTestId("notify-status");
  await expect(status).toContainText("Simulated");
  await expect(status).toContainText("nothing was sent to Slack");
});

test("the delivery is recorded in the notification log, badged as simulated", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  const log = page.getByTestId("notification-log");
  await expect(log).toBeVisible();
  await expect(log.getByTestId("notification-mock-badge").first()).toBeVisible();
});

test("a SOCIAL_MANAGER can read the shortlist but cannot trigger ranking or notify", async ({
  page,
}) => {
  await signIn(page, fixture.socialManager);
  await page.goto("/news");

  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  // §27 puts automations under ADMIN and MANAGER only.
  await expect(page.getByRole("button", { name: "Rank now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send to Slack" })).toHaveCount(0);
});

test("an ADMIN sees the selection counter and cannot save fewer than three", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await expect(page.getByTestId("selection-count")).toContainText("0 of 3 selected");

  const save = page.getByRole("button", { name: "Select these 3" });
  await expect(save).toBeDisabled();

  await page.getByRole("checkbox").first().check();
  await expect(page.getByTestId("selection-count")).toContainText("1 of 3 selected");
  // §8 is exactly three, so two is not a partial success.
  await expect(save).toBeDisabled();
});

test("an ADMIN can select exactly three stories", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  const boxes = page.getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await boxes.nth(2).check();

  await expect(page.getByTestId("selection-count")).toContainText("3 of 3 selected");
  await page.getByRole("button", { name: "Select these 3" }).click();

  const status = page.getByTestId("selection-status");
  await expect(status).toContainText("selected");
  // §67: the screen does not imply a pipeline started that does not exist yet.
  await expect(status).toContainText("Content generation is not built yet");
});

test("the selection persists and the chosen stories are marked", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await expect(page.getByRole("heading", { name: /^Selected for today \(3 of 3\)/ })).toBeVisible();
  await expect(page.getByTestId("status-selected")).toHaveCount(3);
});

test("search filters the list and survives a reload", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news?q=definitely-not-a-real-headline");

  await expect(page.getByText("No stories match those filters.")).toBeVisible();
});

test("a story has a detail page showing its factor breakdown", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/news");

  await page.getByRole("link", { name: "Details" }).first().click();

  await expect(page).toHaveURL(/\/news\/.+/);
  await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the original article" })).toBeVisible();
});

test("a SOCIAL_MANAGER can read the news but cannot select", async ({ page }) => {
  await signIn(page, fixture.socialManager);
  await page.goto("/news");

  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  // §27 puts the day's agenda with ADMIN and MANAGER.
  await expect(page.getByTestId("selection-count")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

/*
 * Content generation (§12, §47) lives in this file rather than its own spec
 * because it depends on the selection made above. There is one live selection
 * per day (§46), so a second spec file selecting its own three stories would
 * race this one.
 */
test("an ADMIN can generate content for the selected stories", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/content");

  await page.getByRole("button", { name: "Generate today's content" }).click();

  const status = page.getByTestId("generate-status");
  await expect(status).toContainText("waiting for review", { timeout: 30_000 });
  // §21: the run says plainly that no AI provider was called.
  await expect(status).toContainText("Simulated");
});

test("every selected story gets a version for all three platforms", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/content");

  await expect(page.getByTestId("content-item")).toHaveCount(3);
  await expect(page.getByTestId("platform-post")).toHaveCount(9);

  const first = page.getByTestId("platform-post").first();
  await expect(first).toContainText("IN REVIEW");
  // §67: no image exists until Module 08 renders one, and the screen says so.
  await expect(first).toContainText("No image yet");
});

test("simulated copy is labelled on every generated story", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/content");

  await expect(page.getByTestId("mock-badge").first()).toBeVisible();
});

test("generating again does not produce a second set of posts", async ({ page }) => {
  await signIn(page, fixture.admin);
  await page.goto("/content");

  await page.getByRole("button", { name: "Generate today's content" }).click();

  await expect(page.getByTestId("generate-status")).toContainText("already been generated", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("platform-post")).toHaveCount(9);
});

test("a SOCIAL_MANAGER can regenerate a version but cannot start a run", async ({ page }) => {
  await signIn(page, fixture.socialManager);
  await page.goto("/content");

  // §27 gives SOCIAL_MANAGER regeneration explicitly, but not automations.
  await expect(page.getByRole("button", { name: "Generate today's content" })).toHaveCount(0);

  await page.getByRole("button", { name: "Regenerate" }).first().click();
  await expect(page.getByTestId("regenerate-status").first()).toContainText("version 2", {
    timeout: 30_000,
  });
});
