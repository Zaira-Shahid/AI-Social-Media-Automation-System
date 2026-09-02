import { z } from "zod";

/**
 * Generated content (spec §12, §13, §17, §31, §32).
 *
 * Firestore enforces no schema (§32), so this is the schema. §32 fixes the
 * split between `contentItems` and `platformPosts`, and §17 fixes where status
 * lives: on the platform post, never on the parent. That is not a modelling
 * preference — a weak LinkedIn version must never block Instagram.
 */

export const CONTENT_ITEMS_COLLECTION = "contentItems";
export const PLATFORM_POSTS_COLLECTION = "platformPosts";
export const CONTENT_VERSIONS_COLLECTION = "contentVersions";

/** §13. X/Twitter was removed from scope; §63 Module 15 is retired. */
export const PLATFORMS = ["FACEBOOK", "INSTAGRAM", "LINKEDIN"] as const;

export const platformSchema = z.enum(PLATFORMS);

export type Platform = z.infer<typeof platformSchema>;

/**
 * Per-platform caption limits.
 *
 * Instagram and LinkedIn are the platforms' own, verified against their
 * documentation on 2026-09-01 (§65):
 *
 * - Instagram: 2,200 characters, and no more than 30 hashtags per message.
 * - LinkedIn: 3,000 characters for a UGC post's commentary.
 *
 * Facebook's published limit could not be verified, so the number here is
 * **ours, not the platform's** — an editorial cap, deliberately conservative.
 * A cap we chose is honest; a platform limit we guessed would not be.
 */
export const PLATFORM_LIMITS: Record<Platform, { captionChars: number; source: string }> = {
  FACEBOOK: { captionChars: 2_000, source: "internal editorial cap — platform limit unverified" },
  INSTAGRAM: { captionChars: 2_200, source: "Instagram, verified 2026-09-01" },
  LINKEDIN: { captionChars: 3_000, source: "LinkedIn UGC Post API, verified 2026-09-01" },
};

/** Instagram's hard limit, and the ceiling the brand profile is capped to (§11). */
export const MAX_HASHTAGS = 30;

/**
 * §17's states.
 *
 * Module 07 only ever writes DRAFT and IN_REVIEW. The rest are declared here
 * so the vocabulary lives in one place, and because §33 forbids a client
 * writing this field wherever it appears.
 */
export const postStatusSchema = z.enum([
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
]);

export type PostStatus = z.infer<typeof postStatusSchema>;

/**
 * Which statuses may still be regenerated (§63 Module 07).
 *
 * Once a human has approved, scheduled or published a version, replacing its
 * text underneath them would make the approval a record of something nobody
 * agreed to (§10, §55).
 */
export const REGENERATABLE_STATUSES: readonly PostStatus[] = ["DRAFT", "IN_REVIEW"];

/**
 * The static visual concept (§12, §13, §15).
 *
 * A *concept*, not an image: Module 08 renders it with Satori from our own
 * templates. It therefore describes text and treatment only — deliberately no
 * image URL field exists, because §14 makes carrying one a legal risk rather
 * than a missing feature.
 */
export const VISUAL_TEMPLATES = [
  "HEADLINE_CARD",
  "QUOTE_CARD",
  "STATISTIC_CARD",
  "EDUCATIONAL_CARD",
] as const;

export const visualConceptSchema = z.object({
  template: z.enum(VISUAL_TEMPLATES),
  /** The few words that carry the card. Short, because it is rendered large. */
  headline: z.string().trim().min(1).max(120),
  supportingText: z.string().trim().max(200),
  /** How the brand's palette is applied. Never a colour value the model invented. */
  emphasis: z.enum(["PRIMARY", "SECONDARY", "ACCENT"]),
});

export type VisualConcept = z.infer<typeof visualConceptSchema>;

/**
 * The shared core of a story (§12).
 *
 * One per selected story, platform-independent. §11 requires the brand
 * identity not to be duplicated per platform, and the same applies to the
 * story's own substance: the angle is decided once and adapted after.
 */
export const coreMessageSchema = z.object({
  headline: z.string().trim().min(1).max(200),
  keyTakeaway: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(1_500),
  /** §12's "source reference" — attribution in words, not a scraped asset. */
  sourceReference: z.string().trim().min(1).max(200),
  angle: z.string().trim().max(300),
});

export type CoreMessage = z.infer<typeof coreMessageSchema>;

export const contentItemSchema = z.object({
  sourceNewsItemId: z.string().min(1),
  /** Denormalized for display, so the review queue needs no second read. */
  sourceTitle: z.string().trim().min(1).max(500),
  sourceUrl: z.string().trim().url(),
  selectionId: z.string().min(1),
  coreMessage: coreMessageSchema,
  /** §21/§66: whether a real provider wrote this, stored, not merely shown. */
  generation: z.object({
    mode: z.enum(["REAL", "MOCK"]),
    provider: z.string().min(1),
    model: z.string().min(1),
    generatedAt: z.string().datetime(),
  }),
});

export type ContentItem = z.infer<typeof contentItemSchema>;

export const platformPostSchema = z.object({
  contentItemId: z.string().min(1),
  platform: platformSchema,
  status: postStatusSchema,
  caption: z.string().trim().min(1),
  hashtags: z.array(z.string().trim().min(1)).max(MAX_HASHTAGS),
  cta: z.string().trim().max(200),
  visual: visualConceptSchema,
  /**
   * Module 08 fills these in. Declared as null here rather than omitted so
   * nothing downstream has to guess whether an absent field means "not yet"
   * or "failed" — §67: a post must never claim an image it does not have.
   */
  mediaUrl: z.string().nullable(),
  mediaPublicId: z.string().nullable(),
  /**
   * Why the last render or upload failed, or null (§32, §52).
   *
   * Kept alongside the null media rather than instead of it: "no image yet"
   * and "the image failed to render, here is why" are different states, and a
   * post that shows neither leaves an operator guessing (§67).
   */
  lastError: z.string().nullable(),
  /** Module 07 never writes a version number it did not create. */
  version: z.number().int().min(1),

  /**
   * Who approved this platform version, and when (§17, §55).
   *
   * §17 puts approval here and "only here" — the publishing engine reads
   * authorization from this document alone and must never infer it from the
   * parent content item.
   */
  approvedBy: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  /** Why a reviewer rejected it. Null unless the status is REJECTED. */
  rejectionNote: z.string().nullable(),

  /**
   * When this version is due to publish, in UTC (§18, §32, §54).
   *
   * Stored as an instant, never as a wall-clock string: §54 says store UTC and
   * display in the company's configured timezone, and a calendar that stored
   * "09:00" would move every scheduled post the day the offset changes.
   *
   * Null until Module 11 schedules it. Declared rather than omitted for the
   * same reason the media fields are — the calendar has to tell "not scheduled"
   * apart from "we do not know" (§67).
   */
  scheduledAt: z.string().datetime().nullable(),

  /**
   * The platform's own id for the published post (§32, §49, §53).
   *
   * §32 calls this field `platformPostId`. It is named `providerPostId` here
   * because a `platformPosts/{platformPostId}` document holding a *different*
   * `platformPostId` is a trap: every existing call site uses that word for
   * our own document id. The adapter contract already says `providerPostId`
   * (`src/lib/publishing/adapter.ts`), so this matches the name the value
   * arrives under rather than the one it collides with.
   *
   * This is the idempotency key §53 requires. Non-null means the platform
   * confirmed a post, so a retry must not create a second one.
   */
  providerPostId: z.string().nullable().default(null),
  /** A link a human can open, where the platform returns one. */
  permalink: z.string().nullable().default(null),
  /** When the platform confirmed the post, UTC (§54). */
  publishedAt: z.string().datetime().nullable().default(null),
  /**
   * Whether the publish that produced the id was real or simulated (§21, §66).
   *
   * Recorded on the post, not inferred from the current provider setting: a
   * post published while `FACEBOOK_PROVIDER=mock` stays MOCK forever, and
   * flipping the switch later must not retitle history as real.
   */
  publishMode: z.enum(["REAL", "MOCK"]).nullable().default(null),
  /**
   * How many times publishing has been attempted (§52, §53).
   *
   * Counted so a retryable failure retries a bounded number of times instead
   * of every tick forever. Defaulted rather than required so posts written
   * before Module 16 parse without a migration.
   */
  publishAttempts: z.number().int().min(0).default(0),
  /**
   * When the current attempt claimed this post, UTC, or null.
   *
   * A lease, not a status: §17's transitions are fixed and inventing a
   * PUBLISHING state is not open to this module. Two ticks overlapping is a
   * real possibility once n8n retries, and this is what stops both of them
   * calling the platform for the same post.
   */
  publishStartedAt: z.string().datetime().nullable().default(null),
});

export type PlatformPost = z.infer<typeof platformPostSchema>;

/** Why a version exists. Module 07 writes the first two; Module 09 writes EDITED. */
export const versionReasonSchema = z.enum(["INITIAL", "REGENERATED", "EDITED"]);

export type VersionReason = z.infer<typeof versionReasonSchema>;

/**
 * An immutable record of one generated version (§32's `content_versions`).
 *
 * Regeneration replaces what a platform post shows, so without this the copy a
 * human read before asking for a rewrite would be gone. §63 lists versioning
 * and regeneration together for that reason.
 */
export const contentVersionSchema = z.object({
  contentItemId: z.string().min(1),
  platformPostId: z.string().min(1),
  platform: platformSchema,
  version: z.number().int().min(1),
  reason: versionReasonSchema,
  caption: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
  visual: visualConceptSchema,
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
  mode: z.enum(["REAL", "MOCK"]),
});

export type ContentVersion = z.infer<typeof contentVersionSchema>;
