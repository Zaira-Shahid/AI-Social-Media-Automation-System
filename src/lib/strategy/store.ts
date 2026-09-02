import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import {
  strategyReportSchema,
  STRATEGY_REPORTS_COLLECTION,
  type StrategyReport,
} from "@/lib/strategy/schema";

/**
 * Firestore access for strategy reports (spec §32, §33, §63 Module 19).
 *
 * Admin SDK only. Append-only, like `contentVersions` — a run adds a new
 * version rather than overwriting the last one, so "current strategy" is
 * simply the highest `version` and nothing is ever silently lost.
 */
function reports() {
  return getAdminFirestore().collection(STRATEGY_REPORTS_COLLECTION);
}

export interface StoredStrategyReport extends StrategyReport {
  id: string;
}

export async function saveStrategyReport(report: StrategyReport): Promise<string> {
  const parsed = strategyReportSchema.parse(report);

  const document = await reports().add({ ...parsed, createdAt: FieldValue.serverTimestamp() });

  return document.id;
}

function parseReport(id: string, data: unknown): StoredStrategyReport | null {
  const parsed = strategyReportSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored strategy report did not match the schema; skipping", { id });
    return null;
  }

  return { id, ...parsed.data };
}

/** The current strategy — the highest version — or null if none has run yet. */
export async function getCurrentStrategy(): Promise<StoredStrategyReport | null> {
  const snapshot = await reports().orderBy("version", "desc").limit(1).get();

  if (snapshot.empty) return null;

  return parseReport(snapshot.docs[0].id, snapshot.docs[0].data());
}

/** Most recent versions first, for the Strategy screen's version history. */
export async function listRecentStrategyReports(limit: number): Promise<StoredStrategyReport[]> {
  const snapshot = await reports().orderBy("version", "desc").limit(limit).get();

  return snapshot.docs
    .map((document) => parseReport(document.id, document.data()))
    .filter((report): report is StoredStrategyReport => report !== null);
}
