import { describe, expect, it } from "vitest";

import { aggregateWeighting } from "@/lib/strategy/compute";
import type { ComparisonGroup } from "@/lib/reporting/schema";

/**
 * Strategy weighting math (spec §24, §25, §67, §63 Module 19).
 *
 * Pure function, no I/O. Under test: a weight is always a real share of
 * measured engagement summed across weeks, never a number invented for a key
 * that was never actually measured, and a window with no engagement at all
 * produces no weighting rather than fabricated shares.
 */
function group(overrides: Partial<ComparisonGroup> = {}): ComparisonGroup {
  return {
    key: "FACEBOOK",
    postsAnalyzed: 1,
    totalEngagement: 10,
    averageEngagement: 10,
    ...overrides,
  };
}

describe("aggregateWeighting", () => {
  it("sums engagement per key across weeks before computing shares", () => {
    const week1 = [group({ key: "FACEBOOK", totalEngagement: 10, postsAnalyzed: 1 })];
    const week2 = [
      group({ key: "FACEBOOK", totalEngagement: 10, postsAnalyzed: 1 }),
      group({ key: "INSTAGRAM", totalEngagement: 20, postsAnalyzed: 1 }),
    ];

    const weights = aggregateWeighting([week1, week2]);

    // FACEBOOK: 20 of 40 total = 50%. INSTAGRAM: 20 of 40 = 50%.
    expect(weights).toEqual([
      { key: "FACEBOOK", weight: 50, postsAnalyzed: 2, totalEngagement: 20 },
      { key: "INSTAGRAM", weight: 50, postsAnalyzed: 1, totalEngagement: 20 },
    ]);
  });

  it("sorts strongest weight first", () => {
    const weights = aggregateWeighting([
      [group({ key: "LOW", totalEngagement: 10 }), group({ key: "HIGH", totalEngagement: 90 })],
    ]);

    expect(weights.map((w) => w.key)).toEqual(["HIGH", "LOW"]);
  });

  it("returns nothing when there is no measured engagement at all", () => {
    expect(aggregateWeighting([])).toEqual([]);
    expect(aggregateWeighting([[]])).toEqual([]);
  });

  it("never divides by zero when every week is empty", () => {
    expect(() => aggregateWeighting([[], []])).not.toThrow();
    expect(aggregateWeighting([[], []])).toEqual([]);
  });
});
