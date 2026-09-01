import "server-only";

import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import {
  NOTIFICATION_LOGS_COLLECTION,
  notificationLogSchema,
  type NotificationLog,
} from "@/lib/slack/schema";

/**
 * Firestore access for notification logs.
 *
 * Admin SDK only. `firestore.rules` denies clients both reads and writes on
 * this collection, exactly as it does for automation runs and the audit log —
 * a delivery record a client can write is not evidence that anything was
 * delivered (§33, §67).
 */
function logs() {
  return getAdminFirestore().collection(NOTIFICATION_LOGS_COLLECTION);
}

/** A stable fingerprint of one shortlist, order-independent. */
export function shortlistDedupeKey(storyIds: string[]): string {
  return createHash("sha256")
    .update([...storyIds].sort().join("|"))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Record one notification attempt.
 *
 * Never throws. A message that really was posted must not be reported as a
 * failure because its own bookkeeping failed — the write is logged loudly
 * instead, and the caller's result still reflects what Slack actually did.
 */
export async function recordNotification(entry: NotificationLog): Promise<void> {
  try {
    await logs().add({ ...entry, createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    logger.error("Failed to record notification log entry", {
      workflow: entry.workflow,
      status: entry.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface StoredNotificationLog extends NotificationLog {
  id: string;
}

function parse(id: string, data: unknown): StoredNotificationLog | null {
  const parsed = notificationLogSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored notification log did not match the schema; skipping", { id });
    return null;
  }

  return { id, ...parsed.data };
}

/** Recent attempts for one workflow, newest first. Uses the declared index. */
export async function listNotifications(
  workflow: string,
  limit: number,
): Promise<StoredNotificationLog[]> {
  const snapshot = await logs()
    .where("workflow", "==", workflow)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((document) => parse(document.id, document.data()))
    .filter((entry): entry is StoredNotificationLog => entry !== null);
}

/**
 * The most recent *successful* send for a workflow.
 *
 * Only sends count: a failed attempt must not suppress the retry that would
 * fix it, and a skip is not something to deduplicate against.
 */
export async function lastSentNotification(
  workflow: string,
): Promise<StoredNotificationLog | null> {
  const recent = await listNotifications(workflow, 10);
  return recent.find((entry) => entry.status === "SENT") ?? null;
}
