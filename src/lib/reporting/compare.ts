import type { Platform, VisualTemplate } from "@/lib/content/schema";
import type { ComparisonGroup, RankedPost } from "@/lib/reporting/schema";

/**
 * The comparison math (spec §23, §63 Module 18).
 *
 * Pure and synchronous on purpose: `weekly.ts` does every bit of I/O
 * (Firestore, the AI call) and hands this file plain data, so what §23 means
 * by "compare posts / platforms / topics / formats" can be tested without a
 * database or a network call.
 *
 * A post whose `engagement` is `null` — Module 17 could not measure it —
 * never enters a comparison. Averaging it in as zero would understate a
 * platform's real performance; dropping it silently would hide that the
 * report is incomplete, which is why `runWeeklyAnalysis` counts and reports
 * `postsExcluded` separately (§22, §67: no fabricated numbers, and no silent
 * gaps either).
 */
export interface AnalyzablePost {
  platformPostId: string;
  platform: Platform;
  providerPostId: string;
  permalink: string | null;
  sourceTitle: string;
  topic: string;
  format: VisualTemplate;
  /** Null means Module 17 has no usable number for this post — not zero. */
  engagement: number | null;
}

/** Posts a comparison can actually use. */
export function withMeasuredEngagement(
  posts: readonly AnalyzablePost[],
): (AnalyzablePost & { engagement: number })[] {
  return posts.filter(
    (post): post is AnalyzablePost & { engagement: number } => post.engagement !== null,
  );
}

function toRankedPost(post: AnalyzablePost & { engagement: number }): RankedPost {
  return {
    platformPostId: post.platformPostId,
    platform: post.platform,
    providerPostId: post.providerPostId,
    permalink: post.permalink,
    sourceTitle: post.sourceTitle,
    engagement: post.engagement,
  };
}

/** The top `count` posts by engagement, highest first. */
export function bestPosts(posts: readonly AnalyzablePost[], count: number): RankedPost[] {
  return withMeasuredEngagement(posts)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, count)
    .map(toRankedPost);
}

/** The bottom `count` posts by engagement, lowest first. */
export function weakPosts(posts: readonly AnalyzablePost[], count: number): RankedPost[] {
  return withMeasuredEngagement(posts)
    .sort((a, b) => a.engagement - b.engagement)
    .slice(0, count)
    .map(toRankedPost);
}

/**
 * Group measured posts by a key (platform, topic or format) and average their
 * engagement, sorted from strongest group to weakest.
 */
export function compareBy(
  posts: readonly AnalyzablePost[],
  keyOf: (post: AnalyzablePost) => string,
): ComparisonGroup[] {
  const groups = new Map<string, number[]>();

  for (const post of withMeasuredEngagement(posts)) {
    const key = keyOf(post);
    const values = groups.get(key) ?? [];
    values.push(post.engagement);
    groups.set(key, values);
  }

  return [...groups.entries()]
    .map(([key, values]) => {
      const totalEngagement = values.reduce((sum, value) => sum + value, 0);

      return {
        key,
        postsAnalyzed: values.length,
        totalEngagement,
        averageEngagement: totalEngagement / values.length,
      };
    })
    .sort((a, b) => b.averageEngagement - a.averageEngagement);
}

/** The strongest group's key, or null when there was nothing to compare. */
export function bestOf(groups: readonly ComparisonGroup[]): string | null {
  return groups[0]?.key ?? null;
}

/** The weakest group's key, or null. Distinct from `bestOf` on a single group: neither. */
export function weakestOf(groups: readonly ComparisonGroup[]): string | null {
  if (groups.length < 2) return null;

  return groups[groups.length - 1].key;
}
