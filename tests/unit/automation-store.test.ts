import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AutomationRun } from "@/lib/automation/schema";

/**
 * `recordAutomationRun`'s Slack alert (spec §41, §52's "Notify" step, §63
 * Module 21).
 *
 * Firestore and Slack are both replaced. Under test: a FAILURE alerts
 * Slack, a SUCCESS/PARTIAL never does, Publishing is excluded (it already
 * has its own richer per-post alert), and a Slack outage never surfaces as
 * an error from `recordAutomationRun` itself.
 */
const add = vi.fn().mockResolvedValue({ id: "run-1" });
const collection = vi.fn(() => ({ add }));
const post = vi.fn().mockResolvedValue({ mode: "REAL", channel: "C1", ts: "123" });
const getSlackTarget = vi.fn(() => ({ notifier: { name: "test", mode: "REAL", post }, channel: "C1" }));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => ({ collection }),
}));

vi.mock("@/lib/slack", () => ({
  getSlackTarget: () => getSlackTarget(),
}));

const { recordAutomationRun } = await import("@/lib/automation/store");

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    workflow: "01_daily_news_discovery",
    status: "SUCCESS",
    startedAt: "2026-09-01T10:00:00.000Z",
    finishedAt: "2026-09-01T10:00:05.000Z",
    sourcesAttempted: 0,
    sourcesFailed: 0,
    itemsDiscovered: 0,
    itemsNew: 0,
    error: null,
    trigger: "WEBHOOK",
    metrics: {},
    ...overrides,
  };
}

beforeEach(() => {
  add.mockClear();
  post.mockClear().mockResolvedValue({ mode: "REAL", channel: "C1", ts: "123" });
  getSlackTarget.mockClear();
});

describe("recordAutomationRun's Slack alert", () => {
  it("alerts Slack when a workflow fails", async () => {
    await recordAutomationRun(run({ status: "FAILURE", error: "feed timed out" }));

    expect(post).toHaveBeenCalledTimes(1);
    const [, message] = post.mock.calls[0] as [string, { text: string }];
    expect(message.text).toContain("01_daily_news_discovery");
  });

  it("never alerts on SUCCESS or PARTIAL", async () => {
    await recordAutomationRun(run({ status: "SUCCESS" }));
    await recordAutomationRun(run({ status: "PARTIAL" }));

    expect(post).not.toHaveBeenCalled();
  });

  it("excludes Publishing, which already sends its own richer alert", async () => {
    await recordAutomationRun(
      run({ workflow: "07_scheduled_publishing:publish", status: "FAILURE", error: "all posts failed" }),
    );

    expect(post).not.toHaveBeenCalled();
  });

  it("never throws when Slack itself fails", async () => {
    post.mockRejectedValue(new Error("Slack is down"));

    await expect(recordAutomationRun(run({ status: "FAILURE", error: "x" }))).resolves.toBeUndefined();
  });

  it("still stores the run even though the alert path runs after the write", async () => {
    await recordAutomationRun(run({ status: "FAILURE", error: "x" }));

    expect(add).toHaveBeenCalledTimes(1);
  });
});
