import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredPlatformPost } from "@/lib/content/store";

/**
 * `runSchedulingCheck` (spec §41, §63 Module 20/21).
 *
 * Firestore is replaced. Under test: it records exactly one automation run
 * per call — the thing that lets both `content/due`'s webhook and the
 * Automation screen's manual "Run now" share one instrumented path instead
 * of two — and an unapproved due post is reported as PARTIAL, not silently
 * treated as SUCCESS.
 */
const listDuePosts = vi.fn<() => Promise<StoredPlatformPost[]>>();
const recordAutomationRun = vi.fn();

vi.mock("@/lib/content/store", () => ({
  listDuePosts: () => listDuePosts(),
}));

vi.mock("@/lib/automation/store", () => ({
  recordAutomationRun: (run: unknown) => recordAutomationRun(run),
}));

const { runSchedulingCheck } = await import("@/lib/content/schedule");

function post(overrides: Partial<StoredPlatformPost> = {}): StoredPlatformPost {
  return {
    id: "post-1",
    contentItemId: "content-1",
    platform: "LINKEDIN",
    status: "SCHEDULED",
    caption: "x",
    hashtags: [],
    cta: "",
    visual: { template: "HEADLINE_CARD", headline: "H", supportingText: "", emphasis: "PRIMARY" },
    mediaUrl: "https://example.com/x.png",
    mediaPublicId: "x",
    lastError: null,
    version: 1,
    approvedBy: "uid-1",
    approvedAt: "2026-09-01T00:00:00.000Z",
    rejectionNote: null,
    scheduledAt: "2026-09-01T06:00:00.000Z",
    providerPostId: null,
    permalink: null,
    publishedAt: null,
    publishMode: null,
    publishAttempts: 0,
    publishStartedAt: null,
    ...overrides,
  } as StoredPlatformPost;
}

const NOW = new Date("2026-09-01T06:05:00.000Z");

beforeEach(() => {
  listDuePosts.mockReset();
  recordAutomationRun.mockReset();
});

describe("runSchedulingCheck", () => {
  it("records a SUCCESS run when every due post is approved", async () => {
    listDuePosts.mockResolvedValue([post()]);

    const outcome = await runSchedulingCheck(NOW, "WEBHOOK");

    expect(outcome.due).toBe(1);
    expect(recordAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: "07_scheduled_publishing:due",
        status: "SUCCESS",
        trigger: "WEBHOOK",
        metrics: { due: 1, unapproved: 0 },
      }),
    );
  });

  it("records PARTIAL, not SUCCESS, when a due post carries no approval record", async () => {
    listDuePosts.mockResolvedValue([post({ approvedBy: null, approvedAt: null })]);

    const outcome = await runSchedulingCheck(NOW, "WEBHOOK");

    expect(outcome.unapproved).toHaveLength(1);
    expect(recordAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PARTIAL", error: expect.stringContaining("1 due post") }),
    );
  });

  it("tags a manual run as MANUAL", async () => {
    listDuePosts.mockResolvedValue([]);

    await runSchedulingCheck(NOW, "MANUAL");

    expect(recordAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "MANUAL" }),
    );
  });

  it("records a FAILURE run and rethrows when the read itself fails", async () => {
    listDuePosts.mockRejectedValue(new Error("firestore down"));

    await expect(runSchedulingCheck(NOW, "WEBHOOK")).rejects.toThrow("firestore down");

    expect(recordAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
    );
  });
});
