import "server-only";

import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import {
  contentItemSchema,
  contentVersionSchema,
  platformPostSchema,
  CONTENT_ITEMS_COLLECTION,
  CONTENT_VERSIONS_COLLECTION,
  PLATFORM_POSTS_COLLECTION,
  type ContentItem,
  type ContentVersion,
  type PlatformPost,
  type PostStatus,
} from "@/lib/content/schema";

/**
 * Firestore access for generated content (spec §32, §33).
 *
 * Admin SDK only. `firestore.rules` lets signed-in users read these and lets
 * no client write them — §17 is explicit that a client must never write
 * `status` on a platform post, and the same reasoning covers the copy itself:
 * a caption a browser can rewrite is not the caption anybody approved.
 */

function contentItems() {
  return getAdminFirestore().collection(CONTENT_ITEMS_COLLECTION);
}

function platformPosts() {
  return getAdminFirestore().collection(PLATFORM_POSTS_COLLECTION);
}

function contentVersions() {
  return getAdminFirestore().collection(CONTENT_VERSIONS_COLLECTION);
}

export interface StoredContentItem extends ContentItem {
  id: string;
}

export interface StoredPlatformPost extends PlatformPost {
  id: string;
}

function parseContentItem(id: string, data: unknown): StoredContentItem | null {
  const parsed = contentItemSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored content item did not match the schema; skipping", { id });
    return null;
  }

  return { id, ...parsed.data };
}

function parsePlatformPost(id: string, data: unknown): StoredPlatformPost | null {
  const parsed = platformPostSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored platform post did not match the schema; skipping", { id });
    return null;
  }

  return { id, ...parsed.data };
}

export async function createContentItem(item: ContentItem): Promise<string> {
  const document = await contentItems().add({
    ...item,
    createdAt: FieldValue.serverTimestamp(),
  });

  return document.id;
}

export async function createPlatformPost(post: PlatformPost): Promise<string> {
  const document = await platformPosts().add({
    ...post,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return document.id;
}

/**
 * Replace a platform post's copy with a newly generated version (§63).
 *
 * `status` is deliberately not touched. Regeneration changes what a post says,
 * not where it is in §17's workflow, and the caller has already refused to
 * regenerate anything a human has approved.
 */
export async function replacePlatformPostContent(
  id: string,
  content: Pick<PlatformPost, "caption" | "hashtags" | "cta" | "visual" | "version">,
): Promise<void> {
  await platformPosts()
    .doc(id)
    .set({ ...content, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/**
 * Record a rendered image against a post (§15, §67).
 *
 * Written only after the upload has succeeded and returned a URL, so a post
 * can never claim media that does not exist. Clearing `lastError` here is
 * deliberate: the failure it described has just been resolved.
 */
export async function setPlatformPostMedia(
  id: string,
  media: { mediaUrl: string; mediaPublicId: string },
): Promise<void> {
  await platformPosts()
    .doc(id)
    .set({ ...media, lastError: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/**
 * Record why rendering failed (§52).
 *
 * The media fields are explicitly left null rather than untouched: a failed
 * re-render of a post that already had an image must not leave the old URL
 * looking like the result of the run that just failed.
 */
export async function setPlatformPostRenderError(id: string, message: string): Promise<void> {
  await platformPosts().doc(id).set(
    {
      lastError: message,
      mediaUrl: null,
      mediaPublicId: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getPlatformPost(id: string): Promise<StoredPlatformPost | null> {
  const snapshot = await platformPosts().doc(id).get();
  return snapshot.exists ? parsePlatformPost(snapshot.id, snapshot.data()) : null;
}

export async function getContentItem(id: string): Promise<StoredContentItem | null> {
  const snapshot = await contentItems().doc(id).get();
  return snapshot.exists ? parseContentItem(snapshot.id, snapshot.data()) : null;
}

/** Content items already generated from a selection, so a re-run is not a duplicate. */
export async function listContentForSelection(selectionId: string): Promise<StoredContentItem[]> {
  const snapshot = await contentItems().where("selectionId", "==", selectionId).get();

  return snapshot.docs
    .map((document) => parseContentItem(document.id, document.data()))
    .filter((item): item is StoredContentItem => item !== null);
}

export async function listPlatformPostsFor(
  contentItemIds: string[],
): Promise<StoredPlatformPost[]> {
  if (contentItemIds.length === 0) return [];

  /*
   * Firestore's `in` takes at most 30 values, so the ids are chunked. Three
   * stories times three platforms is well inside one chunk today; the chunking
   * is here so a larger day does not silently return a partial review queue.
   */
  const chunks: string[][] = [];

  for (let index = 0; index < contentItemIds.length; index += 30) {
    chunks.push(contentItemIds.slice(index, index + 30));
  }

  const snapshots = await Promise.all(
    chunks.map((chunk) => platformPosts().where("contentItemId", "in", chunk).get()),
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs)
    .map((document) => parsePlatformPost(document.id, document.data()))
    .filter((post): post is StoredPlatformPost => post !== null);
}

/**
 * Posts still waiting for an image (§15).
 *
 * A single equality on `mediaUrl`, so no composite index is needed. Published
 * posts are excluded: an image is fetched by the platform at publish time, and
 * replacing one afterwards would change a post that is already live.
 */
export async function listPostsWithoutMedia(limit: number): Promise<StoredPlatformPost[]> {
  const snapshot = await platformPosts().where("mediaUrl", "==", null).limit(limit).get();

  return snapshot.docs
    .map((document) => parsePlatformPost(document.id, document.data()))
    .filter((post): post is StoredPlatformPost => post !== null)
    .filter((post) => post.status !== "PUBLISHED");
}

/**
 * Scheduled versions falling inside a window, for the calendar (§32, §38).
 *
 * The bounds are UTC instants, because that is what `scheduledAt` stores
 * (§54); the caller works out which instants a local month covers. Ordered by
 * `scheduledAt`, so a day's posts arrive in the order they will publish.
 *
 * A range filter on `scheduledAt` with an `orderBy` on the same field needs no
 * composite index; the platform and status filters are applied in memory,
 * since a calendar window is already a small result set and an index per
 * filter combination would not earn its keep.
 */
export async function listScheduledPostsBetween(
  fromIso: string,
  toIso: string,
): Promise<StoredPlatformPost[]> {
  const snapshot = await platformPosts()
    .where("scheduledAt", ">=", fromIso)
    .where("scheduledAt", "<", toIso)
    .orderBy("scheduledAt", "asc")
    .get();

  return snapshot.docs
    .map((document) => parsePlatformPost(document.id, document.data()))
    .filter((post): post is StoredPlatformPost => post !== null);
}

/**
 * Put a post in a slot (§17, §18, §53).
 *
 * Everything happens inside one transaction: the status is re-read, the
 * neighbouring slots are re-read, and only then is the time written. Checking
 * either of those beforehand would leave the window §53 exists to close — two
 * schedulers, or one impatient double-click, both passing a check made against
 * a state that has since changed.
 *
 * The rules themselves are passed in, so this function knows how to write a
 * slot and nothing about what makes one acceptable.
 */
export async function scheduleAtInstant(
  id: string,
  instant: Date,
  rules: {
    isAllowed: (status: PostStatus) => boolean;
    refusal: (status: PostStatus) => string;
    window: (instant: Date) => { fromIso: string; toIso: string };
    findConflict: (
      slots: { id: string; platform: string; scheduledAt: string }[],
      candidate: { id: string; platform: string; instant: Date },
    ) => { id: string; platform: string; scheduledAt: string } | null;
    conflictRefusal: (slot: { platform: string; scheduledAt: string }) => string;
  },
): Promise<TransitionResult> {
  const firestore = getAdminFirestore();
  const reference = platformPosts().doc(id);
  const { fromIso, toIso } = rules.window(instant);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);

    if (!snapshot.exists) return { ok: false as const, reason: "That post no longer exists." };

    const current = parsePlatformPost(snapshot.id, snapshot.data());

    if (!current) {
      return { ok: false as const, reason: "That post's stored data is not readable." };
    }

    if (!rules.isAllowed(current.status)) {
      return { ok: false as const, reason: rules.refusal(current.status) };
    }

    /*
     * A range on `scheduledAt` alone, filtered in memory. Adding platform to
     * the query would need a composite index for a window that never holds
     * more than a handful of posts.
     */
    const neighbours = await transaction.get(
      platformPosts().where("scheduledAt", ">=", fromIso).where("scheduledAt", "<", toIso),
    );

    const slots = neighbours.docs
      .map((document) => parsePlatformPost(document.id, document.data()))
      .filter((post): post is StoredPlatformPost => post !== null)
      // Only live plans collide. A rejected or failed version sitting on a
      // timestamp is history, not a booking.
      .filter((post) => post.status === "SCHEDULED" || post.status === "PUBLISHED")
      .map((post) => ({
        id: post.id,
        platform: post.platform,
        scheduledAt: post.scheduledAt ?? "",
      }));

    const conflict = rules.findConflict(slots, {
      id,
      platform: current.platform,
      instant,
    });

    if (conflict) return { ok: false as const, reason: rules.conflictRefusal(conflict) };

    const scheduledAt = instant.toISOString();

    transaction.set(
      reference,
      { scheduledAt, status: "SCHEDULED", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return { ok: true as const, post: { ...current, scheduledAt, status: "SCHEDULED" } };
  });
}

/**
 * Posts whose slot has arrived (§49, §53).
 *
 * SCHEDULED only, and ordered by the time they were due, so the oldest debt is
 * paid first. Approval is not inferred from being here: the publishing engine
 * re-checks it on the document itself (§17, §18).
 */
export async function listDuePosts(nowIso: string, limit: number): Promise<StoredPlatformPost[]> {
  const snapshot = await platformPosts()
    .where("status", "==", "SCHEDULED")
    .where("scheduledAt", "<=", nowIso)
    .orderBy("scheduledAt", "asc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((document) => parsePlatformPost(document.id, document.data()))
    .filter((post): post is StoredPlatformPost => post !== null);
}

/**
 * Approved versions with no slot yet (§18, §38).
 *
 * The calendar shows these beside the grid rather than hiding them: work that
 * has been approved and then forgotten is exactly what a calendar is meant to
 * surface, and it is the queue Module 11 will schedule from. Needs the
 * `(status, scheduledAt)` composite index §32 calls for.
 */
export async function listApprovedUnscheduledPosts(limit: number): Promise<StoredPlatformPost[]> {
  const snapshot = await platformPosts()
    .where("status", "==", "APPROVED")
    .where("scheduledAt", "==", null)
    .limit(limit)
    .get();

  return snapshot.docs
    .map((document) => parsePlatformPost(document.id, document.data()))
    .filter((post): post is StoredPlatformPost => post !== null);
}

/**
 * Published posts, for Module 17's analytics sync.
 *
 * `status == "PUBLISHED"` alone: `recordPublishSuccess` never sets that
 * status without a `providerPostId` in the same write, so every post this
 * returns already carries one — analytics has something to sync against
 * without a second filter.
 */
export async function listPublishedPosts(limit: number): Promise<StoredPlatformPost[]> {
  const snapshot = await platformPosts().where("status", "==", "PUBLISHED").limit(limit).get();

  return snapshot.docs
    .map((document) => parsePlatformPost(document.id, document.data()))
    .filter((post): post is StoredPlatformPost => post !== null);
}

/** Content items by id, for screens that start from posts rather than stories. */
export async function getContentItemsByIds(ids: string[]): Promise<StoredContentItem[]> {
  if (ids.length === 0) return [];

  const unique = [...new Set(ids)];
  const chunks: string[][] = [];

  // Firestore's documentId() `in` query takes at most 30 ids, as above.
  for (let index = 0; index < unique.length; index += 30) {
    chunks.push(unique.slice(index, index + 30));
  }

  const snapshots = await Promise.all(
    chunks.map((chunk) => contentItems().where(FieldPath.documentId(), "in", chunk).get()),
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs)
    .map((document) => parseContentItem(document.id, document.data()))
    .filter((item): item is StoredContentItem => item !== null);
}

/** The most recent content items, newest first, for the content screen. */
export async function listRecentContentItems(limit: number): Promise<StoredContentItem[]> {
  const snapshot = await contentItems().orderBy("createdAt", "desc").limit(limit).get();

  return snapshot.docs
    .map((document) => parseContentItem(document.id, document.data()))
    .filter((item): item is StoredContentItem => item !== null);
}

/**
 * Record an immutable version (§32's `content_versions`).
 *
 * Never throws. Losing the history of a version must not fail the generation
 * that produced it — the failure is logged loudly instead, and the post the
 * user is waiting for still lands.
 */
export async function recordContentVersion(version: ContentVersion): Promise<void> {
  const parsed = contentVersionSchema.safeParse(version);

  if (!parsed.success) {
    logger.error("Refusing to store a malformed content version", {
      platformPostId: version.platformPostId,
    });
    return;
  }

  try {
    await contentVersions().add({ ...parsed.data, createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    logger.error("Failed to record content version", {
      platformPostId: version.platformPostId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Every stored version of one platform post, oldest first. */
export async function listVersions(platformPostId: string): Promise<ContentVersion[]> {
  const snapshot = await contentVersions()
    .where("platformPostId", "==", platformPostId)
    .orderBy("version", "asc")
    .get();

  return snapshot.docs
    .map((document) => contentVersionSchema.safeParse(document.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

export type TransitionResult =
  { ok: true; post: StoredPlatformPost } | { ok: false; reason: string };

/**
 * Move a platform post to a new status (§17, §33).
 *
 * The current status is re-read **inside a transaction** and the rule applied
 * there, not against whatever the screen last saw. Two reviewers acting at
 * once would otherwise both pass a check made seconds earlier — one approving
 * a post the other had already rejected.
 *
 * §17 requires this be enforced server-side; `firestore.rules` denies every
 * client write on this collection, so this function is the only way the field
 * moves at all.
 */
export async function applyStatusTransition(
  id: string,
  to: PostStatus,
  extra: Partial<Pick<PlatformPost, "approvedBy" | "approvedAt" | "rejectionNote">>,
  isAllowed: (from: PostStatus, to: PostStatus) => boolean,
  refusal: (from: PostStatus, to: PostStatus) => string,
): Promise<TransitionResult> {
  const firestore = getAdminFirestore();
  const reference = platformPosts().doc(id);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);

    if (!snapshot.exists) return { ok: false as const, reason: "That post no longer exists." };

    const current = parsePlatformPost(snapshot.id, snapshot.data());

    if (!current) {
      return { ok: false as const, reason: "That post's stored data is not readable." };
    }

    if (!isAllowed(current.status, to)) {
      return { ok: false as const, reason: refusal(current.status, to) };
    }

    transaction.set(
      reference,
      { status: to, ...extra, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return { ok: true as const, post: { ...current, status: to, ...extra } };
  });
}

/**
 * Replace a post's copy after a human edit (§16).
 *
 * Guarded the same way and for the same reason: the status is re-read inside
 * the transaction, so an edit cannot land on a post that was approved while
 * the form was open.
 */
export async function updatePlatformPostCopy(
  id: string,
  copy: Pick<PlatformPost, "caption" | "hashtags" | "cta">,
  isEditable: (status: PostStatus) => boolean,
): Promise<TransitionResult> {
  const firestore = getAdminFirestore();
  const reference = platformPosts().doc(id);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);

    if (!snapshot.exists) return { ok: false as const, reason: "That post no longer exists." };

    const current = parsePlatformPost(snapshot.id, snapshot.data());

    if (!current) {
      return { ok: false as const, reason: "That post's stored data is not readable." };
    }

    if (!isEditable(current.status)) {
      return {
        ok: false as const,
        reason: `This post is ${current.status.toLowerCase().replace("_", " ")} and can no longer be edited.`,
      };
    }

    const version = current.version + 1;

    transaction.set(
      reference,
      { ...copy, version, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return { ok: true as const, post: { ...current, ...copy, version } };
  });
}

/**
 * How long a publish claim is honoured before another tick may retry (§53).
 *
 * Long enough that a slow three-call LinkedIn publish is never overtaken by
 * the next tick, short enough that a process killed mid-publish does not pin
 * the post until somebody notices. A claim is not a lock the platform knows
 * about, so this is a duplicate-suppression window, not a guarantee — which
 * is exactly why `providerPostId` is checked first and is the real defence.
 */
export const PUBLISH_CLAIM_TTL_MS = 10 * 60 * 1000;

export type PublishClaim =
  { ok: true; post: StoredPlatformPost } | { ok: false; reason: string; alreadyPublished: boolean };

/**
 * Take exclusive responsibility for publishing one post (§49, §53).
 *
 * Every §53 pre-condition is re-read inside the transaction rather than
 * trusted from the due query, because the gap between "collect what is due"
 * and "publish it" is exactly where a second tick, a reviewer, or a retry
 * lands. In order: the post exists and parses, it has not already been
 * published, it is SCHEDULED, it carries its own approval record, it has a
 * rendered card, and no other attempt holds an unexpired claim.
 *
 * The approval check reads this document alone. §32 is explicit that the
 * publishing engine must never infer approval from the parent content item.
 */
export async function claimForPublish(
  id: string,
  now: Date,
  maxAttempts: number,
): Promise<PublishClaim> {
  const firestore = getAdminFirestore();
  const reference = platformPosts().doc(id);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);

    if (!snapshot.exists) {
      return { ok: false as const, reason: "That post no longer exists.", alreadyPublished: false };
    }

    const current = parsePlatformPost(snapshot.id, snapshot.data());

    if (!current) {
      return {
        ok: false as const,
        reason: "That post's stored data is not readable.",
        alreadyPublished: false,
      };
    }

    /*
     * First, and before anything else: a post the platform has already
     * confirmed is never published again. This is what makes a retry safe
     * (§53) — everything below it is about whether publishing may *start*.
     */
    if (current.providerPostId) {
      return {
        ok: false as const,
        reason: `Already published as ${current.providerPostId}.`,
        alreadyPublished: true,
      };
    }

    if (current.status !== "SCHEDULED") {
      return {
        ok: false as const,
        reason: `This post is ${current.status.toLowerCase().replace("_", " ")}, not scheduled.`,
        alreadyPublished: false,
      };
    }

    if (!current.approvedBy || !current.approvedAt) {
      return {
        ok: false as const,
        reason: "This post carries no approval record.",
        alreadyPublished: false,
      };
    }

    if (!current.mediaUrl) {
      return {
        ok: false as const,
        reason: "This post has no rendered card to publish.",
        alreadyPublished: false,
      };
    }

    if (current.publishAttempts >= maxAttempts) {
      return {
        ok: false as const,
        reason: `Publishing was attempted ${current.publishAttempts} times and will not be retried automatically.`,
        alreadyPublished: false,
      };
    }

    const heldSince = current.publishStartedAt ? Date.parse(current.publishStartedAt) : null;

    if (heldSince !== null && now.getTime() - heldSince < PUBLISH_CLAIM_TTL_MS) {
      return {
        ok: false as const,
        reason: "Another publishing attempt is already in progress.",
        alreadyPublished: false,
      };
    }

    const claimed = {
      publishAttempts: current.publishAttempts + 1,
      publishStartedAt: now.toISOString(),
    };

    transaction.set(
      reference,
      { ...claimed, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return { ok: true as const, post: { ...current, ...claimed } };
  });
}

/**
 * Record a confirmed publish (§49, §67).
 *
 * Written in one merge with the status, so a post can never read PUBLISHED
 * without the id that proves it — §67's whole point. `lastError` is cleared
 * because a failure that was later retried successfully is history, not a
 * standing problem.
 */
export async function recordPublishSuccess(
  id: string,
  result: Pick<PlatformPost, "providerPostId" | "permalink" | "publishedAt" | "publishMode">,
): Promise<void> {
  await platformPosts()
    .doc(id)
    .set(
      {
        ...result,
        status: "PUBLISHED" satisfies PostStatus,
        lastError: null,
        publishStartedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/**
 * Record a failed publish (§52, §67).
 *
 * `terminal` decides the status. A retryable failure leaves the post
 * SCHEDULED so the next tick picks it up again; only a refusal that will not
 * change on its own — or the attempt ceiling — moves it to FAILED. Either way
 * the reason is stored: §52 forbids failing silently, and a post that reverts
 * to SCHEDULED with no explanation is exactly that.
 */
export async function recordPublishFailure(
  id: string,
  reason: string,
  terminal: boolean,
): Promise<void> {
  await platformPosts()
    .doc(id)
    .set(
      {
        ...(terminal ? { status: "FAILED" satisfies PostStatus } : {}),
        lastError: reason,
        publishStartedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}
