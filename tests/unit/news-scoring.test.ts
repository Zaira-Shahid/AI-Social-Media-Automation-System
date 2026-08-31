import { describe, expect, it } from "vitest";

import {
  MAX_STORY_AGE_DAYS,
  SCORE_WEIGHTS,
  SHORTLIST_MAX,
  SHORTLIST_MIN,
  ageInHours,
  compositeScore,
  isTooOld,
  recencyScore,
  sourceQualityScore,
} from "@/lib/news/scoring";

/**
 * The arithmetic half of scoring (spec §7, §8, §58).
 *
 * These are the factors the code computes rather than asking a model for, so
 * they are the ones a test can pin down exactly.
 */
const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function hoursAgo(hours: number): string {
  return new Date(NOW - hours * HOUR).toISOString();
}

const NEUTRAL_AI = {
  relevance: 50,
  credibility: 50,
  businessImportance: 50,
  aiRelevance: 50,
  socialPotential: 50,
  novelty: 50,
};

describe("ageInHours", () => {
  it("measures elapsed hours", () => {
    expect(ageInHours(hoursAgo(5), NOW)).toBeCloseTo(5);
  });

  it("never goes negative for a story dated in the future", () => {
    expect(ageInHours(new Date(NOW + DAY).toISOString(), NOW)).toBe(0);
  });
});

describe("isTooOld", () => {
  it("accepts a story inside the window", () => {
    expect(isTooOld(hoursAgo(MAX_STORY_AGE_DAYS * 24 - 1), NOW)).toBe(false);
  });

  it("rejects a story past the window", () => {
    expect(isTooOld(hoursAgo(MAX_STORY_AGE_DAYS * 24 + 1), NOW)).toBe(true);
  });
});

describe("recencyScore", () => {
  it("scores a story published now at 100", () => {
    expect(recencyScore(hoursAgo(0), NOW)).toBe(100);
  });

  it("scores a story at the edge of the window at 0", () => {
    expect(recencyScore(hoursAgo(MAX_STORY_AGE_DAYS * 24), NOW)).toBe(0);
  });

  it("never goes below zero for older stories", () => {
    expect(recencyScore(hoursAgo(90 * 24), NOW)).toBe(0);
  });

  it("decays linearly, so today's stories are not separated by hours", () => {
    const midpoint = recencyScore(hoursAgo((MAX_STORY_AGE_DAYS * 24) / 2), NOW);

    expect(midpoint).toBe(50);
  });
});

describe("sourceQualityScore", () => {
  it("maps priority 1 to the top and 5 to the bottom", () => {
    expect(sourceQualityScore(1)).toBe(100);
    expect(sourceQualityScore(5)).toBe(20);
  });

  it("is monotonic across the range", () => {
    const scores = [1, 2, 3, 4, 5].map(sourceQualityScore);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("clamps a priority outside the configured range rather than producing nonsense", () => {
    expect(sourceQualityScore(0)).toBe(100);
    expect(sourceQualityScore(99)).toBe(20);
  });
});

describe("compositeScore", () => {
  it("weights sum to 1, so the composite stays on the same 0-100 scale", () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

    expect(total).toBeCloseTo(1, 10);
  });

  it("returns 100 when everything is perfect", () => {
    expect(
      compositeScore({
        ai: {
          relevance: 100,
          credibility: 100,
          businessImportance: 100,
          aiRelevance: 100,
          socialPotential: 100,
          novelty: 100,
        },
        recency: 100,
        sourceQuality: 100,
      }),
    ).toBe(100);
  });

  it("returns 0 when nothing scores", () => {
    expect(
      compositeScore({
        ai: {
          relevance: 0,
          credibility: 0,
          businessImportance: 0,
          aiRelevance: 0,
          socialPotential: 0,
          novelty: 0,
        },
        recency: 0,
        sourceQuality: 0,
      }),
    ).toBe(0);
  });

  it("lets relevance move the result more than recency, per §4's topic direction", () => {
    const relevant = compositeScore({
      ai: { ...NEUTRAL_AI, relevance: 100 },
      recency: 0,
      sourceQuality: 50,
    });

    const merelyFresh = compositeScore({ ai: NEUTRAL_AI, recency: 100, sourceQuality: 50 });

    expect(relevant).toBeGreaterThan(merelyFresh);
  });

  it("ranks an on-topic older story above an off-topic fresh one", () => {
    const onTopicOlder = compositeScore({
      ai: { ...NEUTRAL_AI, relevance: 90, aiRelevance: 90 },
      recency: 20,
      sourceQuality: 60,
    });

    const offTopicFresh = compositeScore({
      ai: { ...NEUTRAL_AI, relevance: 10, aiRelevance: 10 },
      recency: 100,
      sourceQuality: 100,
    });

    expect(onTopicOlder).toBeGreaterThan(offTopicFresh);
  });
});

describe("shortlist bounds", () => {
  it("matches the 5-10 range §8 specifies", () => {
    expect(SHORTLIST_MIN).toBe(5);
    expect(SHORTLIST_MAX).toBe(10);
  });
});
