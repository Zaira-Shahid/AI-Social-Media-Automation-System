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
