import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import type { Platform } from "@/lib/content/schema";
import {
  analyticsRecordSchema,
  ANALYTICS_COLLECTION,
  type AnalyticsRecord,
} from "@/lib/analytics/schema";

/**
 * Firestore access for analytics (spec §32, §33, §63 Module 17).
 *
 * Admin SDK only. Document id is the platform post id — one row per post,
 * overwritten on each sync (see `schema.ts`), so "the analytics for this
 * post" is always a single read, never a query over history that Module 17
 * does not keep.
 *
 * This file is deliberately the whole read model this module ships: per-post
 * and per-platform lookups. Trends, comparisons and a dashboard screen read
 * this data but are built in Module 18, not here.
 */

function analytics() {
  return getAdminFirestore().collection(ANALYTICS_COLLECTION);
}

export async function saveAnalyticsRecord(record: AnalyticsRecord): Promise<void> {
  const parsed = analyticsRecordSchema.parse(record);

  await analytics()
    .doc(parsed.platformPostId)
    .set({ ...parsed, updatedAt: FieldValue.serverTimestamp() });
}

function parseAnalyticsRecord(id: string, data: unknown): AnalyticsRecord | null {
  const parsed = analyticsRecordSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored analytics record did not match the schema; skipping", { id });
    return null;
  }

  return parsed.data;
}

/** The latest synced metrics for one post, or null if it has never synced. */
export async function getPostAnalytics(platformPostId: string): Promise<AnalyticsRecord | null> {
  const snapshot = await analytics().doc(platformPostId).get();

  if (!snapshot.exists) return null;

  return parseAnalyticsRecord(snapshot.id, snapshot.data());
}

/** Every synced post for one platform — the per-platform read model. */
export async function listAnalyticsForPlatform(platform: Platform): Promise<AnalyticsRecord[]> {
  const snapshot = await analytics().where("platform", "==", platform).get();

  return snapshot.docs
    .map((document) => parseAnalyticsRecord(document.id, document.data()))
    .filter((record): record is AnalyticsRecord => record !== null);
}
