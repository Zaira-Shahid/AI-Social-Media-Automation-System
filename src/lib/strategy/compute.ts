import type { ComparisonGroup } from "@/lib/reporting/schema";
import type { WeightedGroup } from "@/lib/strategy/schema";

/**
 * Strategy weighting math (spec §24, §25, §63 Module 19).
 *
 * Pure and synchronous, same discipline as `reporting/compare.ts`: `optimize.ts`
 * does the I/O and hands this file plain `ComparisonGroup[]` data already
 * computed by Module 18, so a "weight" here is always a real proportion of
 * measured engagement, never a number the AI invented.
 */

/**
 * Combine one dimension's comparison groups across several weeks into a
 * single weighting, each key's `weight` its share of total measured
 * engagement across the whole window (0–100, summing to ~100 across keys).
 *
 * Summing `totalEngagement` per key across weeks, then computing shares once
 * at the end, weights the whole window by its actual engagement rather than
 * by treating every week as equally important regardless of how much it
 * measured.
 */
export function aggregateWeighting(weeks: readonly ComparisonGroup[][]): WeightedGroup[] {
  const totals = new Map<string, { totalEngagement: number; postsAnalyzed: number }>();

  for (const groups of weeks) {
    for (const group of groups) {
      const existing = totals.get(group.key) ?? { totalEngagement: 0, postsAnalyzed: 0 };

      totals.set(group.key, {
        totalEngagement: existing.totalEngagement + group.totalEngagement,
        postsAnalyzed: existing.postsAnalyzed + group.postsAnalyzed,
      });
    }
  }

  const grandTotal = [...totals.values()].reduce((sum, entry) => sum + entry.totalEngagement, 0);

  if (grandTotal <= 0) return [];

  return [...totals.entries()]
    .map(([key, entry]) => ({
      key,
      // One decimal place — plenty of precision for a relative weight, and
      // stable enough not to jitter on trivial re-runs of the same data.
      weight: Math.round((entry.totalEngagement / grandTotal) * 1000) / 10,
      postsAnalyzed: entry.postsAnalyzed,
      totalEngagement: entry.totalEngagement,
    }))
    .sort((a, b) => b.weight - a.weight);
}
