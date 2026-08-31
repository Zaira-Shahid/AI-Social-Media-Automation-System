import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import {
  AUTOMATION_RUNS_COLLECTION,
  EMPTY_SOURCE_HEALTH,
  NEWS_ITEMS_COLLECTION,
  NEWS_SOURCES_COLLECTION,
  newsSourceInputSchema,
  sourceHealthSchema,
  type AutomationRun,
  type NewsSource,
  type NewsSourceInput,
  type SourceHealth,
} from "@/lib/news/schema";
import type { NormalizedEntry } from "@/lib/news/normalize";

/**
 * Firestore access for news sources, items and run records.
 *
 * Always through the Admin SDK. `firestore.rules` lets clients read sources
 * and items but never write them, so every mutation here arrives after an
 * authorization check has already happened (§33).
 */

function sources() {
  return getAdminFirestore().collection(NEWS_SOURCES_COLLECTION);
}

function items() {
  return getAdminFirestore().collection(NEWS_ITEMS_COLLECTION);
}

/**
 * Parse a stored source, or drop it.
 *
 * A row that no longer matches the schema is logged and skipped rather than
 * thrown, so one bad document cannot take down the screen that could fix it.
 */
function parseSource(id: string, data: unknown): NewsSource | null {
  const parsed = newsSourceInputSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored news source did not match the schema; skipping", { id });
    return null;
  }

  const health = sourceHealthSchema.safeParse((data as { health?: unknown }).health);

  return { id, ...parsed.data, health: health.success ? health.data : EMPTY_SOURCE_HEALTH };
}

export async function listSources(): Promise<NewsSource[]> {
  const snapshot = await sources().get();

  return snapshot.docs
    .map((document) => parseSource(document.id, document.data()))
    .filter((source): source is NewsSource => source !== null)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/**
 * Active sources in priority order.
 *
 * Uses the declared `(active, priority)` index. Sorting in memory would work
 * at today's scale, but the index is what makes the query honest when it does
 * not (§32 step 6).
 */
export async function listActiveSources(): Promise<NewsSource[]> {
  const snapshot = await sources().where("active", "==", true).orderBy("priority").get();

  return snapshot.docs
    .map((document) => parseSource(document.id, document.data()))
    .filter((source): source is NewsSource => source !== null);
}

export async function getSource(id: string): Promise<NewsSource | null> {
  const snapshot = await sources().doc(id).get();
  return snapshot.exists ? parseSource(snapshot.id, snapshot.data()) : null;
}

/** Is this feed URL already registered? Returns the owning id, if any. */
export async function findSourceByFeedUrl(feedUrl: string): Promise<string | null> {
  const snapshot = await sources().where("feedUrl", "==", feedUrl).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0].id;
}

export async function createSource(input: NewsSourceInput, actor: string): Promise<string> {
  const document = await sources().add({
    ...input,
    health: EMPTY_SOURCE_HEALTH,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
  });

  return document.id;
}

export async function updateSource(
  id: string,
  input: NewsSourceInput,
  actor: string,
): Promise<void> {
  await sources()
    .doc(id)
    .set(
      { ...input, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor },
      // merge: health is written by ingestion and must survive an edit.
      { merge: true },
    );
}

export async function deleteSource(id: string): Promise<void> {
  await sources().doc(id).delete();
}

export async function recordSourceHealth(id: string, health: SourceHealth): Promise<void> {
  await sources().doc(id).set({ health }, { merge: true });
}

/**
 * Store a batch of normalized items.
 *
 * Written by derived ID (see `newsItemId`), so a re-run overwrites rather
 * than duplicates. Returns how many were genuinely new, which is the only
 * number worth reporting from a run — "50 items" is meaningless when the same
 * 50 arrive every time.
 *
 * `status` is preserved on documents that already exist: an item Module 04 or
 * 06 has already ranked or shortlisted must not silently revert to DISCOVERED
 * because the feed still lists it.
 */
export async function upsertNewsItems(entries: NormalizedEntry[]): Promise<{ created: number }> {
  if (entries.length === 0) return { created: 0 };

  const collection = items();

  const existing = await Promise.all(entries.map((entry) => collection.doc(entry.id).get()));

  const batch = getAdminFirestore().batch();
  let created = 0;

  entries.forEach((entry, index) => {
    const snapshot = existing[index];
    const reference = collection.doc(entry.id);

    if (snapshot.exists) {
      // `status` is omitted on update. An item Module 04 or 06 has already
      // ranked or shortlisted must not revert to DISCOVERED just because the
      // feed still lists it.
      const { status, ...withoutStatus } = entry.item;
      void status;
      batch.set(reference, withoutStatus, { merge: true });
      return;
    }

    created += 1;
    batch.set(reference, { ...entry.item, createdAt: FieldValue.serverTimestamp() });
  });

  await batch.commit();

  return { created };
}

export async function countNewsItems(): Promise<number> {
  const snapshot = await items().count().get();
  return snapshot.data().count;
}

/** §45: every run is logged. Module 20 builds the screen that reads these. */
export async function recordAutomationRun(run: AutomationRun): Promise<void> {
  try {
    await getAdminFirestore()
      .collection(AUTOMATION_RUNS_COLLECTION)
      .add({ ...run, createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    // A run that succeeded must not be reported as failed because its own
    // bookkeeping failed.
    logger.error("Failed to record automation run", {
      workflow: run.workflow,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
