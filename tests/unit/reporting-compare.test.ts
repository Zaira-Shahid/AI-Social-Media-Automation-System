import { describe, expect, it } from "vitest";

import {
  bestOf,
  bestPosts,
  compareBy,
  weakestOf,
  weakPosts,
  withMeasuredEngagement,
  type AnalyzablePost,
} from "@/lib/reporting/compare";

/**
 * The comparison math (spec §22, §23, §67, §63 Module 18).
 *
 * Pure functions, no I/O. Under test: a post with no measured engagement
 * never enters a rank or an average, best/weak ordering is correct, and a
 * single group has no "weakest" distinct from "best".
 */
function post(overrides: Partial<AnalyzablePost> = {}): AnalyzablePost {
  return {
    platformPostId: "post-1",
    platform: "FACEBOOK",
    providerPostId: "1_1",
    permalink: null,
    sourceTitle: "A story",
    topic: "AI",
    format: "HEADLINE_CARD",
    engagement: 10,
    ...overrides,
  };
}

describe("withMeasuredEngagement", () => {
  it("drops posts with no measured engagement rather than treating them as zero", () => {
    const posts = [post({ platformPostId: "a", engagement: 5 }), post({ platformPostId: "b", engagement: null })];

    expect(withMeasuredEngagement(posts).map((p) => p.platformPostId)).toEqual(["a"]);
  });
});

describe("bestPosts / weakPosts", () => {
  const posts = [
    post({ platformPostId: "low", engagement: 2 }),
    post({ platformPostId: "high", engagement: 50 }),
    post({ platformPostId: "mid", engagement: 20 }),
    post({ platformPostId: "unmeasured", engagement: null }),
  ];

  it("ranks best posts highest engagement first, excluding unmeasured posts", () => {
    expect(bestPosts(posts, 3).map((p) => p.platformPostId)).toEqual(["high", "mid", "low"]);
  });

  it("ranks weak posts lowest engagement first", () => {
    expect(weakPosts(posts, 2).map((p) => p.platformPostId)).toEqual(["low", "mid"]);
  });

  it("respects the requested count", () => {
    expect(bestPosts(posts, 1)).toHaveLength(1);
  });

  it("returns an empty list when nothing is measured", () => {
    expect(bestPosts([post({ engagement: null })], 3)).toEqual([]);
  });
});

describe("compareBy", () => {
  it("averages engagement per group, sorted strongest first", () => {
    const posts = [
      post({ platform: "FACEBOOK", engagement: 10 }),
      post({ platform: "FACEBOOK", engagement: 30 }),
      post({ platform: "INSTAGRAM", engagement: 100 }),
    ];

    const groups = compareBy(posts, (p) => p.platform);

    expect(groups).toEqual([
      { key: "INSTAGRAM", postsAnalyzed: 1, totalEngagement: 100, averageEngagement: 100 },
      { key: "FACEBOOK", postsAnalyzed: 2, totalEngagement: 40, averageEngagement: 20 },
    ]);
  });

  it("excludes unmeasured posts from both the count and the average", () => {
    const posts = [post({ platform: "FACEBOOK", engagement: 10 }), post({ platform: "FACEBOOK", engagement: null })];

    const groups = compareBy(posts, (p) => p.platform);

    expect(groups).toEqual([
      { key: "FACEBOOK", postsAnalyzed: 1, totalEngagement: 10, averageEngagement: 10 },
    ]);
  });

  it("returns an empty array when nothing is measured", () => {
    expect(compareBy([post({ engagement: null })], (p) => p.platform)).toEqual([]);
  });
});

describe("bestOf / weakestOf", () => {
  it("picks the strongest and weakest group", () => {
    const groups = compareBy(
      [
        post({ platform: "FACEBOOK", engagement: 10 }),
        post({ platform: "INSTAGRAM", engagement: 100 }),
      ],
      (p) => p.platform,
    );

    expect(bestOf(groups)).toBe("INSTAGRAM");
    expect(weakestOf(groups)).toBe("FACEBOOK");
  });

  it("returns null for both when there is nothing to compare", () => {
    expect(bestOf([])).toBeNull();
    expect(weakestOf([])).toBeNull();
  });

  it("has no weakest distinct from best when there is only one group", () => {
    const groups = compareBy([post({ platform: "FACEBOOK", engagement: 10 })], (p) => p.platform);

    expect(bestOf(groups)).toBe("FACEBOOK");
    expect(weakestOf(groups)).toBeNull();
  });
});
