import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger, redact } from "@/lib/logger";

/**
 * Audit log (spec §55).
 *
 * Written exclusively through the Admin SDK. `firestore.rules` denies every
 * client read and write on this collection (§33) — an audit trail a user can
 * edit is not an audit trail.
 */
export const AUDIT_COLLECTION = "auditLogs";

/** Actions from §55. Later modules extend this as they land. */
export type AuditAction =
  | "LOGIN"
  | "NEWS_IMPORTED"
  | "NEWS_SELECTED"
  | "CONTENT_GENERATED"
  | "CONTENT_EDITED"
  | "CONTENT_APPROVED"
  | "CONTENT_REJECTED"
  | "POST_SCHEDULED"
  | "POST_PUBLISHED"
  | "POST_FAILED"
  | "ANALYTICS_SYNCED"
  | "STRATEGY_GENERATED"
  | "SETTINGS_CHANGED"
  /*
   * Not in §55's list, which was written before the Slack workflow existed.
   * A person deliberately pushing the shortlist into the team channel is an
   * important action by §55's own standard, and the alternative — reusing a
   * listed action that means something else — would make the trail worse.
   */
  | "NOTIFICATION_SENT";

export interface AuditEntry {
  /** UID of the acting user, or a named system actor for automation. */
  actor: string;
  action: AuditAction;
  /** What was acted on — a document path, or a stable identifier. */
  resource: string;
  status: "SUCCESS" | "FAILURE";
  metadata?: Record<string, unknown>;
}

/**
 * Shape an entry for storage.
 *
 * Metadata goes through the same redaction as logging. §55 says never store
 * secrets in logs, and an audit record is the one place a well-meaning
 * caller is most likely to attach a whole request object.
 */
export function buildAuditDocument(entry: AuditEntry): Record<string, unknown> {
  return {
    actor: entry.actor,
    action: entry.action,
    resource: entry.resource,
    status: entry.status,
    ...(entry.metadata ? { metadata: redact(entry.metadata) } : {}),
  };
}

/**
 * Record an audited action.
 *
 * Never throws. A failed audit write must not take down the action being
 * audited — a user who successfully logged in should not see an error
 * because logging failed. The failure is logged loudly instead.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await getAdminFirestore()
      .collection(AUDIT_COLLECTION)
      .add({
        ...buildAuditDocument(entry),
        timestamp: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logger.error("Failed to write audit log entry", {
      action: entry.action,
      resource: entry.resource,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
