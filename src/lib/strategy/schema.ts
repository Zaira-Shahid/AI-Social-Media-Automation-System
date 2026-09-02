import { z } from "zod";

/**
 * AI strategy optimization (spec §24, §25, §32, §63 Module 19).
 *
 * §32's `strategy_reports` — versioned, append-only, like `contentVersions`
 * (§32's `content_versions`): every run adds a new version rather than
 * overwriting the last one, so a strategy change is never silently lost, and
 * "current strategy" is simply the highest `version`.
 *
 * §24 fixes what the AI may recommend or modify: topic weighting, platform
 * weighting, posting frequency, content mix, headline style, CTA style,
 * static format distribution, educational/promotional balance, recommended
 * timing. It does **not** give the AI write access to the brand profile
 * (§11 keeps that human-owned) or to Module 06's fixed "exactly three
 * stories a day" rule (§8) — this module's output is a recommendation a
 * human reads on the Strategy screen, not a rewrite of either.
 */
export const STRATEGY_REPORTS_COLLECTION = "strategyReports";

export const STRATEGY_CATEGORIES = [
  "TOPIC_WEIGHTING",
  "PLATFORM_WEIGHTING",
  "POSTING_FREQUENCY",
  "CONTENT_MIX",
  "HEADLINE_STYLE",
  "CTA_STYLE",
  "FORMAT_DISTRIBUTION",
  "TIMING",
] as const;

export const strategyCategorySchema = z.enum(STRATEGY_CATEGORIES);

/**
 * One recommendation (§25's own example shape: a recommendation, and the
 * reason for it). `reason` must trace back to real, stored analytics — never
 * fabricated — which is what `optimize.ts` grounds the AI prompt in.
 */
export const strategyRecommendationSchema = z.object({
  category: strategyCategorySchema,
  recommendation: z.string().min(1).max(300),
  reason: z.string().min(1).max(500),
});

export type StrategyRecommendation = z.infer<typeof strategyRecommendationSchema>;

/**
 * A computed weight for one topic, platform or format (§24).
 *
 * Deliberately not AI output: `weight` is a proportion of measured
 * engagement over the lookback window, computed the same deterministic way
 * Module 18 computes its comparisons — never a number the model invented.
 */
export const weightedGroupSchema = z.object({
  key: z.string().min(1),
  weight: z.number().min(0).max(100),
  postsAnalyzed: z.number().int().min(1),
  totalEngagement: z.number(),
});

export type WeightedGroup = z.infer<typeof weightedGroupSchema>;

export const strategyReportSchema = z.object({
  version: z.number().int().min(1),
  /** The `weeklyReports` doc ids this version was computed from — the evidence trail. */
  weeksAnalyzed: z.array(z.string().min(1)),
  /** Total measured posts across every week in `weeksAnalyzed`. */
  postsAnalyzed: z.number().int().min(0),

  topicWeighting: z.array(weightedGroupSchema),
  platformWeighting: z.array(weightedGroupSchema),
  formatWeighting: z.array(weightedGroupSchema),

  /**
   * Null only when there was not enough measured data across the lookback
   * window to recommend anything (§67) — never an empty-but-invented list.
   */
  recommendations: z.array(strategyRecommendationSchema).nullable(),
  mode: z.enum(["REAL", "MOCK"]).nullable(),

  generatedAt: z.string().datetime(),
  /** `system:strategy` for the automatic weekly run, or a uid for a manual one (§24). */
  generatedBy: z.string().min(1),
});

export type StrategyReport = z.infer<typeof strategyReportSchema>;
