import "server-only";

import { getServerEnv } from "@/lib/env.server";
import {
  newsSelectionSchema,
  SELECTION_SIZE,
  type NewsItemStatus,
  type NewsSelection,
} from "@/lib/news/schema";
import {
  getNewsItem,
  getSelectionForDate,
  saveSelection,
  type StoredNewsItem,
} from "@/lib/news/store";

/**
 * Human news selection (spec §8, §10, §46).
 *
 * §10 is the whole point of this module: the system is AI-first but
 * human-controlled, and this is the first place a person's decision — not a
 * score — determines what happens next. So the rules here are strict and the
 * failures are explicit; a selection that is quietly corrected is not a
 * human decision any more.
 */

/**
 * Which statuses a person may pick from.
 *
 * SHORTLISTED is the recommendation, but RANKED is selectable too: §8 asks
 * the AI to shortlist and a human to choose, and a human who can only ratify
 * the shortlist is not choosing. REJECTED and DISCOVERED are not selectable —
 * one was ruled out with a reason, the other has never been scored.
 */
export const SELECTABLE_STATUSES: readonly NewsItemStatus[] = ["RANKED", "SHORTLISTED", "SELECTED"];

export function isSelectable(item: StoredNewsItem): boolean {
  return SELECTABLE_STATUSES.includes(item.status);
}

/**
 * Today's date in the configured timezone (§54).
 *
 * A selection belongs to a working day, and the working day is the team's,
 * not UTC's. Computing this from the server's own clock would put an evening
 * selection in Asia/Karachi onto the previous day for anyone reading the
 * history. `en-CA` is used only because it formats as YYYY-MM-DD.
 */
export function selectionDateFor(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function currentSelectionDate(now: Date = new Date()): string {
  return selectionDateFor(now, getServerEnv().APP_TIMEZONE);
}

/** Thrown for a selection a person can fix by choosing differently. */
export class SelectionError extends Error {}

export interface SelectionOutcome {
  id: string;
  selectionDate: string;
  storyIds: string[];
  replaced: boolean;
}

/**
 * Validate and record a selection.
 *
 * Validation is server-side and total: the client's count is a convenience,
 * and §33 assumes anything arriving from a browser is arbitrary.
 */
export async function selectStories(storyIds: string[], actor: string): Promise<SelectionOutcome> {
  const selectionDate = currentSelectionDate();

  const candidate: NewsSelection = {
    selectionDate,
    storyIds,
    selectedBy: actor,
    selectedAt: new Date().toISOString(),
    status: "PENDING_GENERATION",
    supersededBy: null,
  };

  /*
   * §8's "exactly 3" and the uniqueness rule both live in the schema, so the
   * server action and any future webhook get the same answer. A count that is
   * wrong is a message, not an exception the user cannot act on.
   */
  const parsed = newsSelectionSchema.safeParse(candidate);

  if (!parsed.success) {
    throw new SelectionError(parsed.error.issues[0]?.message ?? "That selection is not valid.");
  }

  const existing = await getSelectionForDate(selectionDate);

  /*
   * A selection that content has already been generated from is locked.
   * Silently repointing it would leave generated content attributed to
   * stories nobody chose — §55's trail would say one thing and the content
   * another.
   */
  if (existing?.status === "GENERATED") {
    throw new SelectionError(
      "Today's selection has already been used to generate content and can no longer be changed.",
    );
  }

  const items = await Promise.all(storyIds.map((id) => getNewsItem(id)));

  for (const [index, item] of items.entries()) {
    if (!item) throw new SelectionError(`One of the selected stories no longer exists.`);

    if (!isSelectable(item)) {
      // Named, not counted: "story 2 was rejected" is actionable, "invalid
      // selection" is not (§52).
      throw new SelectionError(
        `"${item.title.slice(0, 60)}" cannot be selected because it is ${item.status.toLowerCase()}.`,
      );
    }

    void index;
  }

  const id = await saveSelection(parsed.data);

  return {
    id,
    selectionDate,
    storyIds,
    replaced: existing !== null,
  };
}

export { SELECTION_SIZE };
