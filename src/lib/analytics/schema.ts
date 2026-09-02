import { z } from "zod";

import { platformSchema } from "@/lib/content/schema";

/**
 * Analytics storage (spec §22, §32, §63 Module 17).
 *
 * §32 names the collection `analytics`. One document per platform post,
 * overwritten on each sync — §50's workflow is "fetch → normalize → store →
 * update dashboards", not an append-only ledger, and Module 18 (weekly
 * comparison, trends) is explicitly out of this module's scope, so nothing
 * here needs history beyond "what did the platform say most recently".
 */
export const ANALYTICS_COLLECTION = "analytics";

/**
 * §22's potential metrics, kept as the fixed vocabulary every adapter reports
 * against — never a platform-specific field name leaking upward.
 *
 * `engagement` is likes + comments + shares where an adapter has all three; it
 * is a sum of real numbers, not an invented figure. `engagementRate` is
 * `engagement / reach` and only exists where `reach` is itself a real number.
 */
export const ANALYTICS_METRICS = [
  "reach",
  "impressions",
  "likes",
  "comments",
  "shares",
  "clicks",
  "engagement",
  "engagementRate",
] as const;

export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

/**
 * §22: "If unavailable: Unavailable. Never create fake numbers."
 *
 * The literal string, not `null` — `null` reads as "we have not tried yet" in
 * the rest of this codebase (§67's own convention for `mediaUrl` and friends),
 * and analytics has a third state that isn't "not yet": "this platform does
 * not offer this metric, confirmed against its own documentation."
 */
export const UNAVAILABLE = "UNAVAILABLE" as const;

export type MetricValue = number | typeof UNAVAILABLE;

export const metricValueSchema = z.union([z.number(), z.literal(UNAVAILABLE)]);

export const metricsSchema = z.partialRecord(z.enum(ANALYTICS_METRICS), metricValueSchema);

export type Metrics = Partial<Record<AnalyticsMetric, MetricValue>>;

/** §21/§66's vocabulary, same as the publishing adapters. */
export const analyticsModeSchema = z.enum(["REAL", "MOCK", "UNAVAILABLE"]);

export const analyticsRecordSchema = z.object({
  platformPostId: z.string().min(1),
  platform: platformSchema,
  /** The platform's own post id these metrics belong to (§53's same key). */
  providerPostId: z.string().min(1),
  mode: analyticsModeSchema,
  metrics: metricsSchema,
  /**
   * Why a whole sync attempt failed, distinct from a per-metric `UNAVAILABLE`
   * (§52). Null when the sync itself succeeded, whatever the metrics say.
   */
  syncError: z.string().nullable(),
  syncedAt: z.string().datetime(),
});

export type AnalyticsRecord = z.infer<typeof analyticsRecordSchema>;
