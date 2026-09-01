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
/** §32 names this entity `selected_news`; this is its Firestore spelling. */
export const SELECTED_NEWS_COLLECTION = "selectedNews";

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
 * Module 03 only ever writes DISCOVERED, Module 04 the three ranking
 * outcomes, and Module 06 SELECTED. The vocabulary is defined in one place,
 * and §33 requires that status never be writable from a client wherever it
 * lives.
 */
export const newsItemStatusSchema = z.enum([
  "DISCOVERED",
  "RANKED",
  "SHORTLISTED",
  "REJECTED",
  "SELECTED",
]);

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

/**
 * How many stories a human picks (§8).
 *
 * Three, exactly — not a minimum and not a maximum. §8 fixes it, and a
 * selection of two or four is rejected rather than accepted and trimmed.
 */
export const SELECTION_SIZE = 3;

/**
 * Selection state (§46).
 *
 * PENDING_GENERATION is where a selection lands and where it stays until
 * Module 07 exists to consume it. SUPERSEDED records a selection that a later
 * one replaced — the old one is never deleted, because who chose what, and
 * when they changed their mind, is exactly the sort of thing an audit trail
 * is for (§55).
 */
export const selectionStatusSchema = z.enum(["PENDING_GENERATION", "SUPERSEDED", "GENERATED"]);

export type SelectionStatus = z.infer<typeof selectionStatusSchema>;

export const newsSelectionSchema = z.object({
  /** Calendar date in the configured timezone (§54), as YYYY-MM-DD. */
  selectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "selectionDate must be YYYY-MM-DD"),
  /*
   * Exactly three, and three *different* stories. Without the uniqueness
   * check, the same story sent three times would satisfy a length test and
   * produce a day with one story in it.
   */
  storyIds: z
    .array(z.string().min(1))
    .length(SELECTION_SIZE, `Select exactly ${SELECTION_SIZE} stories`)
    .refine((ids) => new Set(ids).size === ids.length, "The same story cannot be selected twice"),
  selectedBy: z.string().min(1),
  selectedAt: z.string().datetime(),
  status: selectionStatusSchema,
  /** Set on the older selection when a newer one replaces it. */
  supersededBy: z.string().nullable(),
});

export type NewsSelection = z.infer<typeof newsSelectionSchema>;
