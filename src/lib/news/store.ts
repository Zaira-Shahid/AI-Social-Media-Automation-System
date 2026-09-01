import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import {
  newsItemSchema,
  newsItemStatusSchema,
  newsSelectionSchema,
  AUTOMATION_RUNS_COLLECTION,
  SELECTED_NEWS_COLLECTION,
  EMPTY_SOURCE_HEALTH,
  NEWS_ITEMS_COLLECTION,
  NEWS_SOURCES_COLLECTION,
  newsSourceInputSchema,
  sourceHealthSchema,
  type AutomationRun,
  type NewsSelection,
  type NewsSource,
  type NewsItemStatus,
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

/**
 * A stored item, plus the ranking fields Module 04 adds.
 *
 * The scores are optional because an item that has not been ranked yet does
 * not have them — and §6's shape deliberately leaves them absent rather than
 * writing zeroes that would be indistinguishable from real low scores.
 */
export interface StoredNewsItem {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceId: string;
  sourceUrl: string;
  publishedAt: string;
  category: string;
  duplicateGroup: string;
  status: NewsItemStatus;
  imageUrl: string;
  compositeScore?: number;
  relevanceScore?: number;
  credibilityScore?: number;
  socialPotentialScore?: number;
  aiAnalysis?: Record<string, unknown>;
  /**
   * What the status was before a human selected this story.
   *
   * Kept so deselecting restores the ranking outcome instead of guessing at
   * it. Without it, a story dropped from a selection would have to be sent
   * back to some default status, which would quietly rewrite Module 04's
   * result.
   */
  statusBeforeSelection?: NewsItemStatus;
}

function parseItem(id: string, data: unknown): StoredNewsItem | null {
  const parsed = newsItemSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored news item did not match the schema; skipping", { id });
    return null;
  }

  const extra = data as Record<string, unknown>;

  return {
    id,
    title: parsed.data.title,
    summary: parsed.data.summary,
    sourceName: parsed.data.sourceName,
    sourceId: parsed.data.sourceId,
    sourceUrl: parsed.data.sourceUrl,
    publishedAt: parsed.data.publishedAt,
    category: parsed.data.category,
    duplicateGroup: parsed.data.duplicateGroup,
    status: parsed.data.status,
    imageUrl: parsed.data.imageUrl,
    compositeScore: typeof extra.compositeScore === "number" ? extra.compositeScore : undefined,
    relevanceScore: typeof extra.relevanceScore === "number" ? extra.relevanceScore : undefined,
    credibilityScore:
      typeof extra.credibilityScore === "number" ? extra.credibilityScore : undefined,
    socialPotentialScore:
      typeof extra.socialPotentialScore === "number" ? extra.socialPotentialScore : undefined,
    statusBeforeSelection: newsItemStatusSchema.safeParse(extra.statusBeforeSelection).data,
    aiAnalysis:
      extra.aiAnalysis && typeof extra.aiAnalysis === "object"
        ? (extra.aiAnalysis as Record<string, unknown>)
        : undefined,
  };
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

/**
 * Items waiting to be ranked (§7).
 *
 * Uses the declared `(status, publishedAt)` index. Bounded because ranking
 * costs tokens and the free plan is small (§29) — an unbounded backlog would
 * spend the day's quota on stories nobody will read.
 */
export async function listItemsForRanking(limit: number): Promise<StoredNewsItem[]> {
  const snapshot = await items()
    .where("status", "==", "DISCOVERED")
    .orderBy("publishedAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((document) => parseItem(document.id, document.data()))
    .filter((item): item is StoredNewsItem => item !== null);
}

/** Shortlisted and ranked items, newest first, for the review screen (§8). */
export async function listRankedItems(limit: number): Promise<StoredNewsItem[]> {
  const [shortlisted, ranked] = await Promise.all([
    items().where("status", "==", "SHORTLISTED").orderBy("publishedAt", "desc").limit(limit).get(),
    items().where("status", "==", "RANKED").orderBy("publishedAt", "desc").limit(limit).get(),
  ]);

  return [...shortlisted.docs, ...ranked.docs]
    .map((document) => parseItem(document.id, document.data()))
    .filter((item): item is StoredNewsItem => item !== null)
    .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
}

/**
 * The current shortlist, best first (§8).
 *
 * Ordered by score rather than date, because this is what Slack sends and
 * what a person reads top-down when choosing three. Uses the declared
 * `(status, compositeScore)` index.
 */
export async function listShortlistedItems(limit: number): Promise<StoredNewsItem[]> {
  const snapshot = await items()
    .where("status", "==", "SHORTLISTED")
    .orderBy("compositeScore", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((document) => parseItem(document.id, document.data()))
    .filter((item): item is StoredNewsItem => item !== null);
}

/**
 * Write a ranking result.
 *
 * Merged, so the normalized fields Module 03 wrote are untouched. `status`,
 * the scores and `aiAnalysis` are all server-written — §33 forbids a client
 * writing any of them.
 */
export async function saveRanking(
  id: string,
  ranking: {
    status: NewsItemStatus;
    relevanceScore: number;
    credibilityScore: number;
    socialPotentialScore: number;
    compositeScore: number;
    aiAnalysis: Record<string, unknown>;
  },
): Promise<void> {
  await items()
    .doc(id)
    .set({ ...ranking, rankedAt: FieldValue.serverTimestamp() }, { merge: true });
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

/**
 * Items for the news screen (§36).
 *
 * Everything that has been through ranking, newest first. `DISCOVERED` items
 * are excluded: an unscored story has no relevance to show and is not
 * selectable, so listing it would only invite the question of why it cannot
 * be picked.
 *
 * Search and category filtering happen in memory over this bounded page, not
 * in the query. Firestore has no full-text search and no OR across fields, so
 * the honest options are an in-memory filter over a capped fetch or a second
 * search service. §29 rules out the second, and the cap keeps the first from
 * quietly becoming a full-collection scan.
 */
export async function listNewsForScreen(limit: number): Promise<StoredNewsItem[]> {
  const snapshot = await items()
    .where("status", "in", ["RANKED", "SHORTLISTED", "SELECTED", "REJECTED"])
    .orderBy("publishedAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((document) => parseItem(document.id, document.data()))
    .filter((item): item is StoredNewsItem => item !== null);
}

export async function getNewsItem(id: string): Promise<StoredNewsItem | null> {
  const snapshot = await items().doc(id).get();
  return snapshot.exists ? parseItem(snapshot.id, snapshot.data()) : null;
}

export interface StoredNewsSelection extends NewsSelection {
  id: string;
}

function selections() {
  return getAdminFirestore().collection(SELECTED_NEWS_COLLECTION);
}

function parseSelection(id: string, data: unknown): StoredNewsSelection | null {
  const parsed = newsSelectionSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored news selection did not match the schema; skipping", { id });
    return null;
  }

  return { id, ...parsed.data };
}

/**
 * The active selection for a date, if there is one.
 *
 * Superseded selections are excluded deliberately: they are kept as history,
 * not as state. Only one selection is live for a given day.
 */
export async function getSelectionForDate(date: string): Promise<StoredNewsSelection | null> {
  const snapshot = await selections()
    .where("selectionDate", "==", date)
    .where("status", "in", ["PENDING_GENERATION", "GENERATED"])
    .limit(1)
    .get();

  return snapshot.empty ? null : parseSelection(snapshot.docs[0].id, snapshot.docs[0].data());
}

/**
 * Mark a selection as generated (§46, §17).
 *
 * Written by Module 07 when content actually exists. It is what locks the
 * day's selection: repointing it afterwards would leave generated content
 * attributed to stories nobody chose.
 */
export async function markSelectionGenerated(id: string): Promise<void> {
  await selections().doc(id).set({ status: "GENERATED" }, { merge: true });
}

/** Recent selections, newest first, for the history panel. */
export async function listSelections(limit: number): Promise<StoredNewsSelection[]> {
  const snapshot = await selections().orderBy("selectedAt", "desc").limit(limit).get();

  return snapshot.docs
    .map((document) => parseSelection(document.id, document.data()))
    .filter((entry): entry is StoredNewsSelection => entry !== null);
}

/**
 * Record a selection (§46).
 *
 * One transaction, because a half-applied selection is worse than none: three
 * stories marked SELECTED with no selection document would look like a choice
 * nobody made, and a selection document whose stories were never marked would
 * be invisible on the screen.
 *
 * Inside it:
 *  - the previous live selection for the day becomes SUPERSEDED
 *  - stories it held that are not in the new one revert to the status ranking
 *    gave them, taken from `statusBeforeSelection` rather than guessed
 *  - the three chosen stories become SELECTED, remembering what they were
 *
 * Statuses are re-read inside the transaction rather than trusted from the
 * caller's earlier read, so two people selecting at once cannot interleave
 * into a state where four stories are SELECTED.
 */
export async function saveSelection(selection: NewsSelection): Promise<string> {
  const firestore = getAdminFirestore();
  const newSelectionRef = selections().doc();

  await firestore.runTransaction(async (transaction) => {
    const previousQuery = await transaction.get(
      selections()
        .where("selectionDate", "==", selection.selectionDate)
        .where("status", "in", ["PENDING_GENERATION", "GENERATED"])
        .limit(1),
    );

    const previous = previousQuery.empty ? null : previousQuery.docs[0];
    const previousIds: string[] = previous
      ? ((previous.data().storyIds as string[] | undefined) ?? [])
      : [];

    const chosen = new Set(selection.storyIds);
    const dropped = previousIds.filter((id) => !chosen.has(id));

    // Every read has to happen before any write inside a Firestore
    // transaction, so the documents are gathered first.
    const chosenDocs = await Promise.all(
      selection.storyIds.map((id) => transaction.get(items().doc(id))),
    );
    const droppedDocs = await Promise.all(dropped.map((id) => transaction.get(items().doc(id))));

    for (const document of chosenDocs) {
      if (!document.exists) throw new Error("A selected story no longer exists.");

      const data = document.data() as { status?: string; statusBeforeSelection?: string };

      transaction.set(
        document.ref,
        {
          status: "SELECTED",
          // Only recorded on the way in. Re-selecting an already selected
          // story must not overwrite the ranking outcome with "SELECTED".
          statusBeforeSelection:
            data.status === "SELECTED" ? (data.statusBeforeSelection ?? "RANKED") : data.status,
          selectedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    for (const document of droppedDocs) {
      if (!document.exists) continue;

      const data = document.data() as { statusBeforeSelection?: string };

      transaction.set(
        document.ref,
        {
          status: data.statusBeforeSelection ?? "RANKED",
          statusBeforeSelection: FieldValue.delete(),
          selectedAt: FieldValue.delete(),
        },
        { merge: true },
      );
    }

    if (previous) {
      transaction.set(
        previous.ref,
        { status: "SUPERSEDED", supersededBy: newSelectionRef.id },
        { merge: true },
      );
    }

    transaction.set(newSelectionRef, { ...selection, createdAt: FieldValue.serverTimestamp() });
  });

  return newSelectionRef.id;
}
