import "server-only";

import { FieldValue } from "firebase-admin/firestore";

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
