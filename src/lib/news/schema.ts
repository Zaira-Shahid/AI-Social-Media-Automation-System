import { z } from "zod";

/**
 * News sources and normalized news items (spec §5, §6, §31).
 *
 * Firestore enforces no schema (§32), so these are the schema. Shared by the
 * ingestion pipeline, the server actions and the forms, so what the UI accepts
 * and what the database stores cannot drift apart.
 */

export const NEWS_SOURCES_COLLECTION = "newsSources";
export const NEWS_ITEMS_COLLECTION = "newsItems";
export const AUTOMATION_RUNS_COLLECTION = "automationRuns";

/**
 * Priority is 1 (highest) to 5, not an open number.
 *
 * Ingestion reads sources in priority order, and an unbounded score turns
 * into a race where every source is a 1.
 */
export const SOURCE_PRIORITIES = [1, 2, 3, 4, 5] as const;

export const sourceHealthStatusSchema = z.enum(["UNKNOWN", "OK", "FAILING"]);

export type SourceHealthStatus = z.infer<typeof sourceHealthStatusSchema>;

export const sourceHealthSchema = z.object({
  status: sourceHealthStatusSchema,
  lastCheckedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int().min(0),
  lastItemCount: z.number().int().min(0).nullable(),
});

export type SourceHealth = z.infer<typeof sourceHealthSchema>;

export const EMPTY_SOURCE_HEALTH: SourceHealth = {
  status: "UNKNOWN",
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  lastItemCount: null,
};

/**
 * Feed URLs must be http(s).
 *
 * Zod's `.url()` alone would accept `javascript:` and `file:`, and this value
 * is later handed to a fetch on the server.
 */
const httpUrl = z
  .string()
  .trim()
  .url("Must be a full URL, including https://")
  .refine((value) => /^https?:\/\//i.test(value), "Must start with http:// or https://");

/** What a person fills in. Health and timestamps are the system's, not theirs. */
export const newsSourceInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  feedUrl: httpUrl,
  homepageUrl: z.union([z.literal(""), httpUrl]),
  category: z.string().trim().max(60),
  priority: z.coerce.number().int().min(1).max(5),
  active: z.boolean(),
});

export type NewsSourceInput = z.infer<typeof newsSourceInputSchema>;

export const newsSourceSchema = newsSourceInputSchema.extend({
  id: z.string().min(1),
  health: sourceHealthSchema,
});

export type NewsSource = z.infer<typeof newsSourceSchema>;

/**
 * Item status.
 *
 * Module 03 only ever writes DISCOVERED. The later values are declared here
 * so the vocabulary is defined in one place, and because §33 requires that
 * status never be writable from a client wherever it lives.
 */
export const newsItemStatusSchema = z.enum(["DISCOVERED", "RANKED", "SHORTLISTED", "REJECTED"]);

export type NewsItemStatus = z.infer<typeof newsItemStatusSchema>;

/**
 * A normalized news item (§6).
 *
 * The scoring fields §6 lists — relevanceScore, credibilityScore,
 * socialPotentialScore, aiAnalysis — are deliberately absent until Module 04
 * writes them. Storing zeroes would be indistinguishable from a real score of
 * zero, and something downstream would eventually trust them.
 */
export const newsItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().max(2000),
  sourceName: z.string().trim().min(1).max(120),
  sourceId: z.string().min(1),
  /** The article's own URL. Never the feed's. */
  sourceUrl: httpUrl,
  publishedAt: z.string().datetime(),
  retrievedAt: z.string().datetime(),
  category: z.string().trim().max(60),

  /*
   * REFERENCE ONLY — internal UI attribution.
   *
   * §14 forbids this ever reaching the static post generator: republishing a
   * publisher's image without a licence risks takedown and termination of the
   * company's own social accounts. That is a legal constraint, not a
   * stylistic one. Generated cards use our own templates and branding only.
   */
  imageUrl: z.union([z.literal(""), httpUrl]),

  /** Hash of the normalized title, so the same story from three outlets groups. */
  duplicateGroup: z.string().min(1),

  status: newsItemStatusSchema,
});

export type NewsItem = z.infer<typeof newsItemSchema>;

export const automationRunSchema = z.object({
  workflow: z.string().min(1),
  status: z.enum(["SUCCESS", "PARTIAL", "FAILURE"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  sourcesAttempted: z.number().int().min(0),
  sourcesFailed: z.number().int().min(0),
  itemsDiscovered: z.number().int().min(0),
  itemsNew: z.number().int().min(0),
  error: z.string().nullable(),
  trigger: z.enum(["WEBHOOK", "MANUAL"]),
});

export type AutomationRun = z.infer<typeof automationRunSchema>;
