import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import {
  weeklyReportSchema,
  WEEKLY_REPORTS_COLLECTION,
  type WeeklyReport,
} from "@/lib/reporting/schema";

/**
 * Firestore access for weekly reports (spec §32, §33, §63 Module 18).
 *
 * Admin SDK only. Doc id is the window's start date (`weekly.ts` sets it),
 * so a re-run of the same week overwrites rather than duplicates (§53).
 */
function reports() {
  return getAdminFirestore().collection(WEEKLY_REPORTS_COLLECTION);
}

export interface StoredWeeklyReport extends WeeklyReport {
  id: string;
}

export async function saveWeeklyReport(id: string, report: WeeklyReport): Promise<void> {
  const parsed = weeklyReportSchema.parse(report);

  await reports()
    .doc(id)
    .set({ ...parsed, updatedAt: FieldValue.serverTimestamp() });
}

function parseReport(id: string, data: unknown): StoredWeeklyReport | null {
  const parsed = weeklyReportSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored weekly report did not match the schema; skipping", { id });
    return null;
  }

  return { id, ...parsed.data };
}

export async function getWeeklyReport(id: string): Promise<StoredWeeklyReport | null> {
  const snapshot = await reports().doc(id).get();

  if (!snapshot.exists) return null;

  return parseReport(snapshot.id, snapshot.data());
}

/** Most recent reports first — the read model behind the Analytics screen's trend view. */
export async function listRecentWeeklyReports(limit: number): Promise<StoredWeeklyReport[]> {
  const snapshot = await reports().orderBy("windowStart", "desc").limit(limit).get();

  return snapshot.docs
    .map((document) => parseReport(document.id, document.data()))
    .filter((report): report is StoredWeeklyReport => report !== null);
}
