import { z } from "zod";

import { platformSchema, VISUAL_TEMPLATES } from "@/lib/content/schema";

/**
 * Weekly performance reports (spec §23, §32, §63 Module 18).
 *
 * §32's collection list does not name this one — it says "may include", not
 * "only include" — and Module 19's `strategy_reports` is a different concern
 * (strategy versioning, §24) from this one (a read-only account of what
 * happened), so it gets its own collection rather than sharing that name.
 *
 * One document per week, overwritten if the same window is ever re-run
 * (§53): the doc id is the window's start date, so a retried n8n step
 * corrects the same report instead of duplicating it.
 */
export const WEEKLY_REPORTS_COLLECTION = "weeklyReports";

/**
 * A ranked post (§23's "best posts"/"weakest posts").
 *
 * Carries enough to link back to the post and to show the number that earned
 * its rank — never just a name with an implied "trust me".
 */
export const rankedPostSchema = z.object({
  platformPostId: z.string().min(1),
  platform: platformSchema,
  providerPostId: z.string().min(1),
  permalink: z.string().nullable(),
  sourceTitle: z.string(),
  engagement: z.number(),
});

export type RankedPost = z.infer<typeof rankedPostSchema>;

/** One group's aggregate — a platform, a topic, or a format (§23). */
export const comparisonGroupSchema = z.object({
  key: z.string().min(1),
  postsAnalyzed: z.number().int().min(1),
  totalEngagement: z.number(),
  averageEngagement: z.number(),
});

export type ComparisonGroup = z.infer<typeof comparisonGroupSchema>;

/**
 * The AI-written half of the report (§23's "AI analysis" step, §30's
 * `analyzePerformance()`).
 *
 * Grounded in the comparison data computed alongside it, the same discipline
 * §25 requires of Module 19's strategy evidence — never a number or a claim
 * the model was not handed.
 */
export const performanceNarrativeSchema = z.object({
  engagementPatterns: z.string().min(1).max(1_200),
  recommendedChanges: z.array(z.string().min(1).max(300)).max(6),
});

export type PerformanceNarrative = z.infer<typeof performanceNarrativeSchema>;

export const weeklyReportSchema = z.object({
  /** UTC instants bounding the week this report covers. */
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  timeZone: z.string().min(1),

  /** Posts with usable analytics vs. published posts this report could not rank. */
  postsAnalyzed: z.number().int().min(0),
  postsExcluded: z.number().int().min(0),

  platformComparison: z.array(comparisonGroupSchema),
  /** Keyed on `newsItems.category` — free text, so "(uncategorized)" is a real key. */
  topicComparison: z.array(comparisonGroupSchema),
  /** Keyed on `VISUAL_TEMPLATES`. */
  formatComparison: z.array(comparisonGroupSchema),

  bestPosts: z.array(rankedPostSchema),
  weakPosts: z.array(rankedPostSchema),

  bestPlatform: z.string().nullable(),
  weakestPlatform: z.string().nullable(),
  bestTopic: z.string().nullable(),
  weakTopic: z.string().nullable(),
  bestFormat: z.enum(VISUAL_TEMPLATES).nullable(),

  /**
   * Null only when there was nothing to analyze — §67 forbids narrating an
   * empty week as if patterns were found in it.
   */
  narrative: performanceNarrativeSchema.nullable(),
  narrativeMode: z.enum(["REAL", "MOCK"]).nullable(),

  generatedAt: z.string().datetime(),
});

export type WeeklyReport = z.infer<typeof weeklyReportSchema>;
