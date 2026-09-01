import "server-only";

import { getBrandProfile } from "@/lib/brand/store";
import { validatePlatformVersion } from "@/lib/content/validate";
import {
  canEditCopy,
  canTransition,
  eligibleForApproval,
  transitionRefusal,
} from "@/lib/content/status";
import {
  applyStatusTransition,
  getPlatformPost,
  listPlatformPostsFor,
  recordContentVersion,
  updatePlatformPostCopy,
  type StoredPlatformPost,
} from "@/lib/content/store";
import { logger } from "@/lib/logger";

/**
 * Review, editing and approval (spec §10, §16, §17, §48).
 *
 * §10's mandatory rule is that no post may be published without human
 * approval, and §17 puts that approval on the platform post and only there.
 * Everything in this file exists to make that record trustworthy: transitions
 * are checked against §17's table inside a transaction, edits re-run the same
 * validation generation did, and every change writes a version.
 */

/** Thrown when a reviewer's action cannot be carried out as asked. */
export class ReviewError extends Error {}

/**
 * An approval needs an image (§14, §15).
 *
 * The MVP publishes static cards, not text — and Instagram's API will not
 * accept a post without media at all. Approving a post that cannot be
 * published produces an APPROVED record that publishing will later have to
 * fail on, which is exactly the false success §67 forbids.
 */
function requiresImage(post: StoredPlatformPost): string | null {
  if (post.mediaUrl) return null;

  return post.lastError
    ? `${post.platform}: the card could not be rendered, so there is nothing to approve yet. ${post.lastError}`
    : `${post.platform}: render the card before approving — a post without its image cannot be published.`;
}

export interface ApprovalOutcome {
  approved: number;
  problems: string[];
}

/** Approve one platform version. §17: recorded here, and nowhere else. */
export async function approvePost(platformPostId: string, actor: string): Promise<void> {
  const post = await getPlatformPost(platformPostId);

  if (!post) throw new ReviewError("That post no longer exists.");

  const missingImage = requiresImage(post);

  if (missingImage) throw new ReviewError(missingImage);

  const result = await applyStatusTransition(
    platformPostId,
    "APPROVED",
    { approvedBy: actor, approvedAt: new Date().toISOString(), rejectionNote: null },
    canTransition,
    transitionRefusal,
  );

  if (!result.ok) throw new ReviewError(result.reason);

  logger.info("Platform post approved", { platformPostId, platform: post.platform });
}

/**
 * Reject one platform version.
 *
 * The note is stored because a rejection without a reason tells whoever comes
 * back to it nothing, and §55's trail is meant to answer "why" as well as
 * "who".
 */
export async function rejectPost(
  platformPostId: string,
  actor: string,
  note: string,
): Promise<void> {
  const result = await applyStatusTransition(
    platformPostId,
    "REJECTED",
    { rejectionNote: note.trim() || null, approvedBy: null, approvedAt: null },
    canTransition,
    transitionRefusal,
  );

  if (!result.ok) throw new ReviewError(result.reason);

  logger.info("Platform post rejected", { platformPostId, actor });
}

/**
 * Approve every eligible version of one story (§17, §63).
 *
 * §63 is explicit that this "is not a separate story-level state": each post
 * goes through the same approval path a single one would, with its own record.
 * A post that cannot be approved is reported rather than skipped silently —
 * "approve all" that quietly approved two of three would be worse than one
 * that approved none.
 */
export async function approveAllForStory(
  contentItemId: string,
  actor: string,
): Promise<ApprovalOutcome> {
  const posts = await listPlatformPostsFor([contentItemId]);
  const eligible = eligibleForApproval(posts);

  const problems: string[] = [];
  let approved = 0;

  for (const post of posts) {
    if (!eligible.includes(post)) {
      problems.push(`${post.platform}: ${transitionRefusal(post.status, "APPROVED")}`);
      continue;
    }

    try {
      await approvePost(post.id, actor);
      approved += 1;
    } catch (error) {
      problems.push(error instanceof ReviewError ? error.message : String(error));
    }
  }

  return { approved, problems };
}

export interface EditInput {
  caption: string;
  hashtags: string[];
  cta: string;
}

/**
 * Apply a human edit (§16).
 *
 * The edited copy goes through **the same validation generated copy does**:
 * the brand's hashtag rules, the platform's caption limit, and §14's rule
 * against a URL in the visual concept. A human editing past a platform limit
 * would otherwise produce a post that fails at publish time, which is the one
 * place nobody is watching (§52).
 *
 * The visual concept is deliberately not editable here. Changing it would
 * invalidate the rendered card without re-rendering it, and a post whose image
 * no longer matches its concept is worse than one nobody edited.
 */
export async function editPost(
  platformPostId: string,
  actor: string,
  input: EditInput,
): Promise<{ version: number }> {
  const post = await getPlatformPost(platformPostId);

  if (!post) throw new ReviewError("That post no longer exists.");

  if (!canEditCopy(post.status)) {
    throw new ReviewError(
      `This post is ${post.status.toLowerCase().replace("_", " ")} and can no longer be edited.`,
    );
  }

  const { brand } = await getBrandProfile();

  const checked = validatePlatformVersion(
    {
      platform: post.platform,
      caption: input.caption,
      hashtags: input.hashtags,
      cta: input.cta,
      visual: post.visual,
    },
    brand,
  );

  if (!checked.ok) throw new ReviewError(checked.reason);

  const result = await updatePlatformPostCopy(
    platformPostId,
    {
      caption: checked.version.caption,
      hashtags: checked.version.hashtags,
      cta: checked.version.cta,
    },
    canEditCopy,
  );

  if (!result.ok) throw new ReviewError(result.reason);

  // §32's content_versions: the copy a reviewer read before editing is kept,
  // so an edit can be traced rather than merely observed.
  await recordContentVersion({
    contentItemId: post.contentItemId,
    platformPostId,
    platform: post.platform,
    version: result.post.version,
    reason: "EDITED",
    caption: checked.version.caption,
    hashtags: checked.version.hashtags,
    cta: checked.version.cta,
    visual: post.visual,
    createdAt: new Date().toISOString(),
    createdBy: actor,
    // An edit is a human's words, not a provider's. Recorded as REAL because
    // that is what it is — §21's flag describes who wrote it.
    mode: "REAL",
  });

  return { version: result.post.version };
}
