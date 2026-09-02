import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredPlatformPost } from "@/lib/content/store";
import type { AnalyticsRecord } from "@/lib/analytics/schema";

/**
 * The analytics sync engine (spec §22, §50, §67, §63 Module 17).
 *
 * Firestore, the credential store and every adapter are replaced. Under
 * test: a mock-published post never reaches a real adapter or credentials at
 * all, a real post always uses the real adapter regardless of the current
 * provider env setting, a missing credential is stored as a sync failure
 * rather than skipped silently, and one post's failure never stops the run.
 */
const listPublishedPosts = vi.fn();
const getUsableCredentials = vi.fn();
const saveAnalyticsRecord = vi.fn();
const recordAudit = vi.fn();

const facebookFetchMetrics = vi.fn();
const instagramFetchMetrics = vi.fn();
const mockFetchMetrics = vi.fn();

vi.mock("@/lib/content/store", () => ({
  listPublishedPosts: (limit: number) => listPublishedPosts(limit),
}));

vi.mock("@/lib/social/store", () => ({
  getUsableCredentials: (platform: string, now: Date) => getUsableCredentials(platform, now),
}));

vi.mock("@/lib/analytics/store", () => ({
  saveAnalyticsRecord: (record: AnalyticsRecord) => saveAnalyticsRecord(record),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (entry: unknown) => recordAudit(entry),
}));

vi.mock("@/lib/analytics/facebook", () => ({
  FacebookAnalyticsAdapter: class {
    platform = "FACEBOOK" as const;
    mode = "REAL" as const;
    fetchMetrics = facebookFetchMetrics;
  },
}));

vi.mock("@/lib/analytics/instagram", () => ({
  InstagramAnalyticsAdapter: class {
    platform = "INSTAGRAM" as const;
    mode = "REAL" as const;
    fetchMetrics = instagramFetchMetrics;
  },
}));

vi.mock("@/lib/analytics/mock", () => ({
  MockAnalyticsAdapter: class {
    platform: string;
    mode = "MOCK" as const;
    fetchMetrics = mockFetchMetrics;
    constructor(platform: string) {
      this.platform = platform;
    }
  },
}));

const { runAnalyticsSync, syncOne } = await import("@/lib/analytics/sync");

const NOW = new Date("2026-09-02T09:00:00.000Z");

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
    providerPostId: "1234_5678",
    permalink: null,
    publishedAt: NOW.toISOString(),
    publishMode: "REAL",
    publishAttempts: 1,
    publishStartedAt: null,
    ...overrides,
  } as StoredPlatformPost;
}

beforeEach(() => {
  listPublishedPosts.mockReset();
  getUsableCredentials.mockReset();
  saveAnalyticsRecord.mockReset();
  recordAudit.mockReset();
  facebookFetchMetrics.mockReset();
  instagramFetchMetrics.mockReset();
  mockFetchMetrics.mockReset();
});

describe("syncOne", () => {
  it("never touches credentials or the real adapter for a mock-published post", async () => {
    mockFetchMetrics.mockResolvedValue({ ok: true, mode: "MOCK", metrics: { likes: 5 } });

    const outcome = await syncOne(
      post({ publishMode: "MOCK", providerPostId: "mock-facebook-post-1" }),
      NOW,
    );

    expect(outcome.status).toBe("SYNCED");
    expect(getUsableCredentials).not.toHaveBeenCalled();
    expect(facebookFetchMetrics).not.toHaveBeenCalled();
    expect(mockFetchMetrics).toHaveBeenCalledTimes(1);
    expect(saveAnalyticsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "MOCK", syncError: null }),
    );
  });

  it("uses the real adapter for a REAL post and stores its metrics", async () => {
    getUsableCredentials.mockResolvedValue({
      ok: true,
      credentials: { accountId: "acct-1", accessToken: "token" },
    });
    facebookFetchMetrics.mockResolvedValue({
      ok: true,
      mode: "REAL",
      metrics: { likes: 10, comments: 2, shares: 1, engagement: 13 },
    });

    const outcome = await syncOne(post(), NOW);

    expect(outcome.status).toBe("SYNCED");
    expect(facebookFetchMetrics).toHaveBeenCalledWith(
      { platform: "FACEBOOK", providerPostId: "1234_5678" },
      { accountId: "acct-1", accessToken: "token" },
    );
    expect(saveAnalyticsRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "REAL",
        metrics: { likes: 10, comments: 2, shares: 1, engagement: 13 },
      }),
    );
  });

  it("records a sync failure, not a skip, when no usable credential exists", async () => {
    getUsableCredentials.mockResolvedValue({
      ok: false,
      reason: "No FACEBOOK account is connected.",
    });

    const outcome = await syncOne(post(), NOW);

    expect(outcome.status).toBe("FAILED");
    expect(outcome.reason).toBe("No FACEBOOK account is connected.");
    expect(facebookFetchMetrics).not.toHaveBeenCalled();
    expect(saveAnalyticsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ syncError: "No FACEBOOK account is connected.", metrics: {} }),
    );
  });

  it("skips a post with no providerPostId rather than syncing nothing", async () => {
    const outcome = await syncOne(post({ providerPostId: null }), NOW);

    expect(outcome.status).toBe("SKIPPED");
    expect(saveAnalyticsRecord).not.toHaveBeenCalled();
  });
});

describe("runAnalyticsSync", () => {
  it("does not let one post's failure stop the run", async () => {
    getUsableCredentials.mockResolvedValue({
      ok: true,
      credentials: { accountId: "acct-1", accessToken: "token" },
    });
    facebookFetchMetrics
      .mockResolvedValueOnce({ ok: false, mode: "REAL", reason: "rate limited" })
      .mockResolvedValueOnce({ ok: true, mode: "REAL", metrics: { likes: 1 } });

    listPublishedPosts.mockResolvedValue([
      post({ id: "post-1", providerPostId: "1_1" }),
      post({ id: "post-2", providerPostId: "1_2" }),
    ]);

    const outcome = await runAnalyticsSync(NOW);

    expect(outcome.candidates).toBe(2);
    expect(outcome.synced).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ANALYTICS_SYNCED", status: "SUCCESS" }),
    );
  });
});
