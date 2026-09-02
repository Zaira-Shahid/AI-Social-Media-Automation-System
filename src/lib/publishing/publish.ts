import "server-only";

import { recordAudit } from "@/lib/audit";
import { NO_SOURCE_METRICS, PUBLISHING_WORKFLOW } from "@/lib/automation/schema";
import { recordAutomationRun } from "@/lib/automation/store";
import type { Platform, PlatformPost } from "@/lib/content/schema";
import { collectDuePosts } from "@/lib/content/schedule";
import {
  claimForPublish,
  recordPublishFailure,
  recordPublishSuccess,
  type StoredPlatformPost,
} from "@/lib/content/store";
import { logger } from "@/lib/logger";
import { getAdapter } from "@/lib/publishing";
import type { AdapterMode, PublishRequest } from "@/lib/publishing/adapter";
import { getSlackTarget } from "@/lib/slack";
import { getUsableCredentials } from "@/lib/social/store";

/**
 * The publishing engine (spec §18, §19, §20, §21, §49, §52, §53, §55, §67).
 *
 * §49's workflow end to end: approved → scheduler → verify approval → verify
 * social account → publish → verify response → store the platform post id →
 * PUBLISHED. Every adapter was built to one contract before this existed
 * (§20), so nothing here knows what a Graph call or a LinkedIn URN looks
 * like; this module decides *whether* to publish, *which* adapter to ask, and
 * what the answer means for the post.
 *
 * The ordering rule that runs through all of it: the platform is asked last
 * and believed only when it returns an id. A post reaches PUBLISHED because
 * something outside this system confirmed it, never because a call did not
 * throw (§67).
 */

/**
 * How many times a post is published-attempted before it is left alone.
 *
 * §52 says retry when safe, which cuts both ways: a rate limit deserves
 * another go on the next tick, and a post that has failed three times is
 * telling us something a fourth call will not fix. Three is also small
 * enough that a genuinely broken run cannot spend a day's API quota.
 */
export const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * How many posts one tick publishes.
 *
 * A day is nine (three stories, three platforms). The cap is a backstop
 * against a backlog trying to publish everything at once, not a limit normal
 * use should reach.
 */
export const MAX_PUBLISHES_PER_RUN = 12;

/** What happened to one post. `SKIPPED` is not a failure — see `publishOne`. */
export type PublishOutcomeStatus = "PUBLISHED" | "SKIPPED" | "RETRYING" | "FAILED";

export interface PostPublishOutcome {
  platformPostId: string;
  platform: Platform;
  status: PublishOutcomeStatus;
  /** Present on PUBLISHED only. The platform's own id (§53). */
  providerPostId?: string;
  /** Present on everything else. Why, in words that belong on the post. */
  reason?: string;
  mode?: AdapterMode;
}

export interface PublishRunOutcome {
  /** How many due, approved posts the scheduler handed over. */
  due: number;
  published: number;
  failed: number;
  retrying: number;
  skipped: number;
  outcomes: PostPublishOutcome[];
  /** Whether a failure alert reached Slack, and whether it was simulated. */
  notified: boolean;
}

/**
 * Assemble the text as it should appear on the platform (§14, §16).
 *
 * The adapter contract takes a finished caption: an adapter formats for its
 * own API and never composes content. Assembly happens here, once, so all
 * three platforms publish the same words in the same order rather than three
 * near-identical string builders drifting apart.
 *
 * Hashtags are normalised to a leading `#` because they are stored bare, and
 * a caption reading "automation ai" instead of "#automation #ai" would be a
 * silent content bug nobody notices until it is live.
 */
export function composeMessage(post: Pick<PlatformPost, "caption" | "hashtags" | "cta">): string {
  const tags = post.hashtags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));

  return [post.caption.trim(), post.cta.trim(), tags.join(" ")]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/**
 * Publish one post, having already established it is due.
 *
 * Returns an outcome rather than throwing. One post failing must not stop the
 * eight beside it — §17 gives every platform version its own fate, and that
 * applies to publishing as much as to review.
 *
 * `SKIPPED` covers the cases where publishing correctly did not happen: the
 * post was already published, something else holds the claim, or it stopped
 * being eligible between the due query and now. None of those are failures
 * and none of them are written to the post as errors.
 */
export async function publishOne(
  post: StoredPlatformPost,
  now: Date = new Date(),
): Promise<PostPublishOutcome> {
  const base = { platformPostId: post.id, platform: post.platform };

  /*
   * §53's four pre-publish checks — approval, scheduled state, previous
   * attempt, platform post id — all happen inside this transaction, not here.
   * Re-checking them in this function as well would be two implementations of
   * one rule, and the one that mattered would be the weaker one.
   */
  const claim = await claimForPublish(post.id, now, MAX_PUBLISH_ATTEMPTS);

  if (!claim.ok) {
    if (!claim.alreadyPublished) {
      logger.warn("Skipped a due post before publishing", {
        platformPostId: post.id,
        platform: post.platform,
        reason: claim.reason,
      });
    }

    return { ...base, status: "SKIPPED", reason: claim.reason };
  }

  const claimed = claim.post;

  // §49's "verify social account", and §19's rule that an expired credential
  // fails loudly. A missing account is terminal: no retry will conjure one.
  const credentials = await getUsableCredentials(post.platform, now);

  if (!credentials.ok) {
    return finishFailure(claimed, credentials.reason, true, null);
  }

  const adapter = getAdapter(post.platform);

  /*
   * `mediaUrl` is non-null here — `claimForPublish` refuses a post without a
   * card — but the contract asks for a string and TypeScript is right to make
   * that explicit rather than let an assertion stand in for the check.
   */
  const request: PublishRequest = {
    platformPostId: claimed.id,
    platform: claimed.platform,
    message: composeMessage(claimed),
    mediaUrl: claimed.mediaUrl ?? "",
  };

  let result;

  try {
    result = await adapter.publish(request, credentials.credentials);
  } catch (error) {
    /*
     * An adapter throwing is a bug or a network fault, not a platform
     * refusal. It is treated as retryable because the post's real state is
     * unknown — and the `providerPostId` check is what stops that retry
     * duplicating a post that did land (§53).
     */
    const reason = error instanceof Error ? error.message : String(error);

    return finishFailure(
      claimed,
      `Publishing threw before the platform answered: ${reason}`,
      false,
      adapter.mode,
    );
  }

  if (!result.ok) {
    // §52: a refusal that will not change on its own is terminal; a rate limit
    // or a network fault is left SCHEDULED for the next tick.
    return finishFailure(claimed, result.reason, !result.retryable, result.mode);
  }

  await recordPublishSuccess(claimed.id, {
    providerPostId: result.providerPostId,
    permalink: result.permalink,
    publishedAt: now.toISOString(),
    // UNAVAILABLE never reaches here: an adapter that cannot publish does not
    // return ok, so the stored mode is only ever REAL or MOCK.
    publishMode: result.mode === "REAL" ? "REAL" : "MOCK",
  });

  await recordAudit({
    actor: "system:publishing",
    action: "POST_PUBLISHED",
    resource: `platformPosts/${claimed.id}`,
    status: "SUCCESS",
    metadata: {
      platform: claimed.platform,
      providerPostId: result.providerPostId,
      mode: result.mode,
    },
  });

  logger.info("Published a post", {
    platformPostId: claimed.id,
    platform: claimed.platform,
    providerPostId: result.providerPostId,
    mode: result.mode,
  });

  return {
    ...base,
    status: "PUBLISHED",
    providerPostId: result.providerPostId,
    mode: result.mode,
  };
}

/**
 * Store a failure and decide whether this was the last attempt.
 *
 * A retryable failure on the final attempt is still terminal: leaving it
 * SCHEDULED would park it in a state the engine has already refused to act
 * on, which reads as "waiting" to anyone looking at the calendar (§67).
 */
async function finishFailure(
  post: StoredPlatformPost,
  reason: string,
  refusalIsTerminal: boolean,
  mode: AdapterMode | null,
): Promise<PostPublishOutcome> {
  const exhausted = post.publishAttempts >= MAX_PUBLISH_ATTEMPTS;
  const terminal = refusalIsTerminal || exhausted;

  const stored =
    exhausted && !refusalIsTerminal
      ? `${reason} (gave up after ${post.publishAttempts} attempts)`
      : reason;

  await recordPublishFailure(post.id, stored, terminal);

  await recordAudit({
    actor: "system:publishing",
    action: "POST_FAILED",
    resource: `platformPosts/${post.id}`,
    status: "FAILURE",
    metadata: {
      platform: post.platform,
      reason: stored,
      attempt: post.publishAttempts,
      terminal,
      ...(mode ? { mode } : {}),
    },
  });

  logger.error("Publishing failed", {
    platformPostId: post.id,
    platform: post.platform,
    reason: stored,
    attempt: post.publishAttempts,
    terminal,
  });

  return {
    platformPostId: post.id,
    platform: post.platform,
    status: terminal ? "FAILED" : "RETRYING",
    reason: stored,
    ...(mode ? { mode } : {}),
  };
}

/**
 * Tell the team a post will not publish without them (§52's "Notify").
 *
 * Only terminal failures are announced. A retryable failure that the next
 * tick will clear is not something anyone needs to act on, and a channel that
 * reports every transient rate limit is one people stop reading.
 *
 * A Slack failure is logged and swallowed here, unlike the token alert: the
 * posts really did fail, that is already recorded on each one, and throwing
 * would replace an accurate partial result with no result at all.
 */
async function notifyFailures(failures: PostPublishOutcome[]): Promise<boolean> {
  if (failures.length === 0) return false;

  try {
    const { notifier, channel } = getSlackTarget();

    await notifier.post(channel, {
      text: `${failures.length} post(s) failed to publish`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Posts failed to publish" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: failures
              .map((failure) => `• *${failure.platform}* — ${failure.reason}`)
              .join("\n"),
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "These will not be retried automatically. Fix the cause, then reschedule them from the calendar.",
            },
          ],
        },
      ],
    });

    return true;
  } catch (error) {
    logger.error("Could not announce publishing failures on Slack", {
      error: error instanceof Error ? error.message : String(error),
      failed: failures.length,
    });

    return false;
  }
}

/**
 * Publish everything that is due (§49).
 *
 * The due list comes from the scheduler rather than being re-queried here, so
 * "what is due" has one definition and §18's approval filter is applied by the
 * module that owns it. Posts are published one at a time, not in parallel:
 * every platform rate-limits, and nine sequential publishes cost seconds while
 * nine concurrent ones are how a run trips a limit it need never have met.
 */
export async function runDuePublishing(now: Date = new Date()): Promise<PublishRunOutcome> {
  const startedAt = now.toISOString();

  try {
    const due = await collectDuePosts(now);
    const batch = due.posts.slice(0, MAX_PUBLISHES_PER_RUN);

    if (batch.length < due.posts.length) {
      logger.warn("More posts are due than one run publishes", {
        due: due.posts.length,
        limit: MAX_PUBLISHES_PER_RUN,
      });
    }

    const outcomes: PostPublishOutcome[] = [];

    for (const post of batch) {
      outcomes.push(await publishOne(post, now));
    }

    const failures = outcomes.filter((outcome) => outcome.status === "FAILED");
    const notified = await notifyFailures(failures);

    const result: PublishRunOutcome = {
      due: due.due,
      published: outcomes.filter((outcome) => outcome.status === "PUBLISHED").length,
      failed: failures.length,
      retrying: outcomes.filter((outcome) => outcome.status === "RETRYING").length,
      skipped: outcomes.filter((outcome) => outcome.status === "SKIPPED").length,
      outcomes,
      notified,
    };

    // §41, §63 Module 20: this endpoint stays side-effect free otherwise —
    // this write is bookkeeping about the run, not a second effect of it.
    await recordAutomationRun({
      workflow: PUBLISHING_WORKFLOW,
      status: result.failed > 0 && result.published === 0 ? "FAILURE" : result.failed > 0 ? "PARTIAL" : "SUCCESS",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...NO_SOURCE_METRICS,
      error: failures.length > 0 ? failures.map((f) => f.reason).join("; ").slice(0, 500) : null,
      trigger: "WEBHOOK",
      metrics: {
        due: result.due,
        published: result.published,
        failed: result.failed,
        retrying: result.retrying,
        skipped: result.skipped,
      },
    });

    return result;
  } catch (error) {
    await recordAutomationRun({
      workflow: PUBLISHING_WORKFLOW,
      status: "FAILURE",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...NO_SOURCE_METRICS,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      trigger: "WEBHOOK",
      metrics: {},
    });

    throw error;
  }
}
