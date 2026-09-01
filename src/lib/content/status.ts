import { REGENERATABLE_STATUSES, type PostStatus } from "@/lib/content/schema";

/**
 * Status transitions and the derived story view (spec §17, §48).
 *
 * Pure, so the rules can be tested as rules rather than inferred from a live
 * approval. §17 is explicit that transitions must be enforced server-side and
 * that "frontend-only status protection" is not acceptable — this table is
 * what the server enforces, and the screen merely reflects it.
 */

/**
 * §17's allowed transitions, exactly as listed.
 *
 * Nothing is added. An "un-approve" from APPROVED back to IN_REVIEW is not in
 * §17 and is not invented here: approval is recorded per platform with an
 * actor and a timestamp (§55), and quietly reversing it would make that record
 * describe a state the post is no longer in. A reviewer who approved by
 * mistake needs a decision from the spec, not a transition from the code.
 */
const ALLOWED: Record<PostStatus, readonly PostStatus[]> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["SCHEDULED"],
  SCHEDULED: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: [],
  REJECTED: [],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Human phrasing for a status, used in messages and on screen. */
export function statusLabel(status: PostStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace("_", " ");
}

/**
 * Why a transition was refused, in words a reviewer can act on.
 *
 * Naming both states matters: "cannot approve" tells someone nothing, while
 * "already rejected" tells them what happened and who to ask.
 */
export function transitionRefusal(from: PostStatus, to: PostStatus): string {
  return `This post is ${statusLabel(from).toLowerCase()} and cannot become ${statusLabel(to).toLowerCase()}.`;
}

/**
 * May this post's copy still be changed?
 *
 * The same answer as regeneration, and for the same reason: replacing the text
 * under an approval would make it a record of something nobody agreed to
 * (§10, §55).
 */
export function canEditCopy(status: PostStatus): boolean {
  return REGENERATABLE_STATUSES.includes(status);
}

/**
 * A story-level status, for display only (§17).
 *
 * §17 is explicit that this is derived for display, never stored, and never
 * the value that authorizes publishing. It exists so a review queue can show
 * one line per story instead of three, and it is deliberately computed from
 * the platform posts every time rather than cached anywhere.
 *
 * The order below is "least settled first": a story with anything still
 * waiting reads as waiting, because that is the thing a reviewer has to act
 * on. A story whose platforms have genuinely diverged reads as Mixed rather
 * than picking a winner.
 */
export function deriveStoryStatus(statuses: readonly PostStatus[]): string {
  if (statuses.length === 0) return "No platform versions";

  const unique = new Set(statuses);

  if (unique.size === 1) return statusLabel(statuses[0]);

  if (unique.has("IN_REVIEW")) return "Partly reviewed";
  if (unique.has("DRAFT")) return "Partly drafted";

  return "Mixed";
}

/**
 * Which posts an "approve all" would actually act on (§17, §63).
 *
 * §63 calls this "a convenience that applies the same per-platform approval to
 * each eligible platform post individually; it is not a separate story-level
 * state". So it is expressed as a filter over posts, and the caller approves
 * each one through the same path a single approval takes.
 */
export function eligibleForApproval<T extends { status: PostStatus }>(posts: readonly T[]): T[] {
  return posts.filter((post) => canTransition(post.status, "APPROVED"));
}
