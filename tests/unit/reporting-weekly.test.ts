import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredPlatformPost } from "@/lib/content/store";
import type { StoredNewsItem } from "@/lib/news/store";
import type { AnalyticsRecord } from "@/lib/analytics/schema";

/**
 * The weekly analysis orchestration (spec §22, §23, §53, §67, §63 Module 18).
 *
 * Firestore and the AI provider are replaced. Under test: the window is the
 * trailing 7 complete days, a post with no measured analytics is excluded
 * rather than counted as zero, the AI narrative is skipped entirely when
 * nothing was measured (never fabricated), and one saved report carries
 * everything §23 asks a weekly report to identify.
 */
const listPublishedPostsBetween = vi.fn();
const getContentItemsByIds = vi.fn();
const getNewsItem = vi.fn<(id: string) => Promise<StoredNewsItem | null>>();
const getPostAnalytics = vi.fn();
const saveWeeklyReport = vi.fn();
const recordAudit = vi.fn();
const complete = vi.fn();

let providerMode: "REAL" | "MOCK" = "REAL";

const TZ = "UTC";

vi.mock("@/lib/content/store", () => ({
  listPublishedPostsBetween: (from: string, to: string) => listPublishedPostsBetween(from, to),
  getContentItemsByIds: (ids: string[]) => getContentItemsByIds(ids),
}));

vi.mock("@/lib/news/store", () => ({
  getNewsItem: (id: string) => getNewsItem(id),
}));

vi.mock("@/lib/analytics/store", () => ({
  getPostAnalytics: (id: string) => getPostAnalytics(id),
}));

vi.mock("@/lib/reporting/store", () => ({
  saveWeeklyReport: (id: string, report: unknown) => saveWeeklyReport(id, report),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (entry: unknown) => recordAudit(entry),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ APP_TIMEZONE: TZ }),
}));

vi.mock("@/lib/ai", () => ({
  getAIProvider: () => ({
    name: "test",
    model: "test-model",
    get mode() {
      return providerMode;
    },
    complete,
  }),
}));

const { currentWeekWindow, runWeeklyAnalysis } = await import("@/lib/reporting/weekly");

const NOW = new Date("2026-09-08T09:00:00.000Z"); // a Tuesday

function post(overrides: Partial<StoredPlatformPost> = {}): StoredPlatformPost {
  return {
    id: "post-1",
    contentItemId: "content-1",
    platform: "FACEBOOK",
    status: "PUBLISHED",
    caption: "Caption",
    hashtags: [],
    cta: "",
    visual: { template: "HEADLINE_CARD", headline: "H", supportingText: "", emphasis: "PRIMARY" },
    mediaUrl: "https://res.cloudinary.com/x/y.png",
    mediaPublicId: "y",
    lastError: null,
    version: 1,
    approvedBy: "uid-1",
    approvedAt: NOW.toISOString(),
    rejectionNote: null,
    scheduledAt: NOW.toISOString(),
    providerPostId: "1_1",
    permalink: "https://facebook.com/1_1",
    publishedAt: NOW.toISOString(),
    publishMode: "REAL",
    publishAttempts: 1,
    publishStartedAt: null,
    ...overrides,
  } as StoredPlatformPost;
}

function analyticsRecord(engagement: number): AnalyticsRecord {
  return {
    platformPostId: "post-1",
    platform: "FACEBOOK",
    providerPostId: "1_1",
    mode: "REAL",
    metrics: { engagement, likes: engagement, comments: 0, shares: 0 },
    syncError: null,
    syncedAt: NOW.toISOString(),
  };
}

beforeEach(() => {
  listPublishedPostsBetween.mockReset();
  getContentItemsByIds.mockReset().mockResolvedValue([]);
  getNewsItem.mockReset();
  getPostAnalytics.mockReset();
  saveWeeklyReport.mockReset();
  recordAudit.mockReset();
  complete.mockReset();
  providerMode = "REAL";
});

describe("currentWeekWindow", () => {
  it("is the trailing 7 complete days ending at the start of today", () => {
    const window = currentWeekWindow(NOW, TZ);

    expect(window.id).toBe("2026-09-01");
    expect(window.startInstant.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(window.endInstant.toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });
});

describe("runWeeklyAnalysis", () => {
  it("skips the AI narrative entirely when nothing was measured", async () => {
    listPublishedPostsBetween.mockResolvedValue([post({ id: "a" })]);
    getPostAnalytics.mockResolvedValue(null);

    const outcome = await runWeeklyAnalysis(NOW);

    expect(outcome.postsAnalyzed).toBe(0);
    expect(outcome.postsExcluded).toBe(1);
    expect(outcome.narrativeMode).toBeNull();
    expect(complete).not.toHaveBeenCalled();

    const [, saved] = saveWeeklyReport.mock.calls[0] as [string, { narrative: unknown }];
    expect(saved.narrative).toBeNull();
  });

  it("excludes a published post with no usable analytics rather than scoring it zero", async () => {
    listPublishedPostsBetween.mockResolvedValue([
      post({ id: "measured", providerPostId: "1_1" }),
      post({ id: "unmeasured", providerPostId: "1_2" }),
    ]);
    getPostAnalytics.mockImplementation((id: string) =>
      id === "measured" ? Promise.resolve(analyticsRecord(40)) : Promise.resolve(null),
    );
    complete.mockResolvedValue({
      data: { engagementPatterns: "x", recommendedChanges: [] },
      mode: "REAL",
      provider: "test",
      model: "test-model",
      inputTokens: null,
      outputTokens: null,
    });

    const outcome = await runWeeklyAnalysis(NOW);

    expect(outcome.postsAnalyzed).toBe(1);
    expect(outcome.postsExcluded).toBe(1);
  });

  it("computes best/weak posts and platform comparison, and calls the AI narrative once", async () => {
    listPublishedPostsBetween.mockResolvedValue([
      post({ id: "fb", platform: "FACEBOOK", providerPostId: "1_1", contentItemId: "c1" }),
      post({ id: "ig", platform: "INSTAGRAM", providerPostId: "1_2", contentItemId: "c2" }),
    ]);
    getContentItemsByIds.mockResolvedValue([
      { id: "c1", sourceNewsItemId: "n1", sourceTitle: "Story A" },
      { id: "c2", sourceNewsItemId: "n2", sourceTitle: "Story B" },
    ]);
    getNewsItem.mockImplementation((id: string) =>
      Promise.resolve({ id, category: id === "n1" ? "AI" : "Cloud" } as StoredNewsItem),
    );
    getPostAnalytics.mockImplementation((id: string) =>
      Promise.resolve(id === "fb" ? analyticsRecord(10) : analyticsRecord(90)),
    );
    complete.mockResolvedValue({
      data: {
        engagementPatterns: "Instagram outperformed Facebook this week.",
        recommendedChanges: ["Post more to Instagram."],
      },
      mode: "REAL",
      provider: "test",
      model: "test-model",
      inputTokens: null,
      outputTokens: null,
    });

    const outcome = await runWeeklyAnalysis(NOW);

    expect(outcome.postsAnalyzed).toBe(2);
    expect(outcome.narrativeMode).toBe("REAL");
    expect(complete).toHaveBeenCalledTimes(1);

    const [id, saved] = saveWeeklyReport.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe("2026-09-01");
    expect(saved.bestPlatform).toBe("INSTAGRAM");
    expect(saved.weakestPlatform).toBe("FACEBOOK");
    expect(saved.bestTopic).toBe("Cloud");
    expect((saved.bestPosts as unknown[])[0]).toMatchObject({
      platform: "INSTAGRAM",
      engagement: 90,
    });
    expect(saved.narrative).toMatchObject({
      engagementPatterns: "Instagram outperformed Facebook this week.",
    });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "WEEKLY_REPORT_GENERATED", status: "SUCCESS" }),
    );
  });

  it("still saves the real, computed numbers when the AI narrative step fails", async () => {
    listPublishedPostsBetween.mockResolvedValue([post({ id: "fb" })]);
    getPostAnalytics.mockResolvedValue(analyticsRecord(10));
    complete.mockRejectedValue(new Error("provider down"));

    const outcome = await runWeeklyAnalysis(NOW);

    expect(outcome.postsAnalyzed).toBe(1);
    expect(outcome.narrativeMode).toBeNull();

    const [, saved] = saveWeeklyReport.mock.calls[0] as [string, { narrative: unknown }];
    expect(saved.narrative).toBeNull();
  });
});
