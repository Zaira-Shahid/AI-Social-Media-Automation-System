import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredWeeklyReport } from "@/lib/reporting/store";

/**
 * The strategy optimization orchestration (spec §24, §25, §31, §67, §63
 * Module 19).
 *
 * Firestore and the AI provider are replaced. Under test: the AI narrative
 * is skipped entirely when nothing was measured across the lookback window,
 * a malformed recommendation from the model is dropped rather than failing
 * the run, versions increment off the current highest version, and a failed
 * AI call still saves the real, computed weighting.
 */
const listRecentWeeklyReports = vi.fn();
const getCurrentStrategy = vi.fn();
const saveStrategyReport = vi.fn();
const recordAudit = vi.fn();
const complete = vi.fn();

let providerMode: "REAL" | "MOCK" = "REAL";

vi.mock("@/lib/reporting/store", () => ({
  listRecentWeeklyReports: (limit: number) => listRecentWeeklyReports(limit),
}));

vi.mock("@/lib/strategy/store", () => ({
  getCurrentStrategy: () => getCurrentStrategy(),
  saveStrategyReport: (report: unknown) => saveStrategyReport(report),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (entry: unknown) => recordAudit(entry),
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

const { runStrategyOptimization } = await import("@/lib/strategy/optimize");

const NOW = new Date("2026-09-08T09:00:00.000Z");

function week(overrides: Partial<StoredWeeklyReport> = {}): StoredWeeklyReport {
  return {
    id: "2026-09-01",
    windowStart: "2026-09-01T00:00:00.000Z",
    windowEnd: "2026-09-08T00:00:00.000Z",
    timeZone: "UTC",
    postsAnalyzed: 2,
    postsExcluded: 0,
    platformComparison: [
      { key: "FACEBOOK", postsAnalyzed: 2, totalEngagement: 20, averageEngagement: 10 },
    ],
    topicComparison: [{ key: "AI", postsAnalyzed: 2, totalEngagement: 20, averageEngagement: 10 }],
    formatComparison: [
      { key: "HEADLINE_CARD", postsAnalyzed: 2, totalEngagement: 20, averageEngagement: 10 },
    ],
    bestPosts: [],
    weakPosts: [],
    bestPlatform: "FACEBOOK",
    weakestPlatform: null,
    bestTopic: "AI",
    weakTopic: null,
    bestFormat: "HEADLINE_CARD",
    narrative: null,
    narrativeMode: null,
    generatedAt: NOW.toISOString(),
    ...overrides,
  } as StoredWeeklyReport;
}

function completionResult(data: unknown, mode: "REAL" | "MOCK" = "REAL") {
  return {
    data,
    mode,
    provider: "test",
    model: "test-model",
    inputTokens: null,
    outputTokens: null,
  };
}

beforeEach(() => {
  listRecentWeeklyReports.mockReset();
  getCurrentStrategy.mockReset().mockResolvedValue(null);
  saveStrategyReport.mockReset().mockResolvedValue("report-1");
  recordAudit.mockReset();
  complete.mockReset();
  providerMode = "REAL";
});

describe("runStrategyOptimization", () => {
  it("skips the AI call entirely when no week has any measured posts", async () => {
    listRecentWeeklyReports.mockResolvedValue([
      week({ postsAnalyzed: 0, platformComparison: [], topicComparison: [], formatComparison: [] }),
    ]);

    const outcome = await runStrategyOptimization("system:strategy", NOW);

    expect(outcome.postsAnalyzed).toBe(0);
    expect(outcome.mode).toBeNull();
    expect(complete).not.toHaveBeenCalled();

    const [saved] = saveStrategyReport.mock.calls[0] as [{ recommendations: unknown }];
    expect(saved.recommendations).toBeNull();
  });

  it("versions off the current highest version", async () => {
    listRecentWeeklyReports.mockResolvedValue([week()]);
    getCurrentStrategy.mockResolvedValue({ version: 5 });
    complete.mockResolvedValue(completionResult({ recommendations: [] }));

    await runStrategyOptimization("system:strategy", NOW);

    const [saved] = saveStrategyReport.mock.calls[0] as [{ version: number }];
    expect(saved.version).toBe(6);
  });

  it("starts at version 1 when nothing has run before", async () => {
    listRecentWeeklyReports.mockResolvedValue([week()]);
    complete.mockResolvedValue(completionResult({ recommendations: [] }));

    await runStrategyOptimization("system:strategy", NOW);

    const [saved] = saveStrategyReport.mock.calls[0] as [{ version: number }];
    expect(saved.version).toBe(1);
  });

  it("drops a malformed recommendation rather than failing the whole run", async () => {
    listRecentWeeklyReports.mockResolvedValue([week()]);
    complete.mockResolvedValue(
      completionResult({
        recommendations: [
          { category: "NOT_A_REAL_CATEGORY", recommendation: "x", reason: "y" },
          {
            category: "TOPIC_WEIGHTING",
            recommendation: "Shift toward AI topics.",
            reason: "AI led engagement.",
          },
        ],
      }),
    );

    const outcome = await runStrategyOptimization("system:strategy", NOW);

    expect(outcome.mode).toBe("REAL");
    const [saved] = saveStrategyReport.mock.calls[0] as [{ recommendations: unknown[] }];
    expect(saved.recommendations).toHaveLength(1);
    expect(saved.recommendations[0]).toMatchObject({ category: "TOPIC_WEIGHTING" });
  });

  it("still saves the real computed weighting when the AI call fails", async () => {
    listRecentWeeklyReports.mockResolvedValue([week()]);
    complete.mockRejectedValue(new Error("provider down"));

    const outcome = await runStrategyOptimization("system:strategy", NOW);

    expect(outcome.mode).toBeNull();
    const [saved] = saveStrategyReport.mock.calls[0] as [
      { recommendations: unknown; platformWeighting: unknown[] },
    ];
    expect(saved.recommendations).toBeNull();
    expect(saved.platformWeighting).toEqual([
      { key: "FACEBOOK", weight: 100, postsAnalyzed: 2, totalEngagement: 20 },
    ]);
  });

  it("records one STRATEGY_GENERATED audit entry per run", async () => {
    listRecentWeeklyReports.mockResolvedValue([week()]);
    complete.mockResolvedValue(completionResult({ recommendations: [] }));

    await runStrategyOptimization("uid-1", NOW);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "uid-1", action: "STRATEGY_GENERATED", status: "SUCCESS" }),
    );
  });
});
