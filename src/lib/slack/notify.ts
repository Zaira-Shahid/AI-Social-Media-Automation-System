import "server-only";

import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { SHORTLIST_MAX } from "@/lib/news/scoring";
import { listShortlistedItems } from "@/lib/news/store";
import { buildShortlistMessage } from "@/lib/slack/blocks";
import { getSlackTarget } from "@/lib/slack";
import { NEWS_SHORTLIST_WORKFLOW, type NotificationStatus } from "@/lib/slack/schema";
import { lastSentNotification, recordNotification, shortlistDedupeKey } from "@/lib/slack/store";

/**
 * The daily shortlist notification (spec §9, §45, §52, §67).
 *
 * Sits at the end of §45's pipeline: discover, normalize, deduplicate, rank,
 * select 5–10, database — then Slack. It only ever reads what ranking already
 * decided; it never re-scores and never narrows the list further, because §8
 * gives the choice of three to a human.
 *
 * Every attempt is recorded, including the ones that send nothing. "No log
 * entry" and "nothing worth sending" must not look the same from the outside.
 */
export interface NotificationOutcome {
  status: NotificationStatus;
  /** §21/§66: whether the message actually reached Slack or was simulated. */
  mode: "REAL" | "MOCK";
  channel: string;
  storyCount: number;
  /** Why it failed or was skipped; null when it was sent. */
  detail: string | null;
}

/**
 * Send today's shortlist.
 *
 * Configuration errors — a missing bot token or channel — throw, because
 * nothing was attempted and the person who can fix it needs the message. A
 * delivery failure does not throw: it is a real, recorded outcome, and the
 * caller reports it as one rather than as an unexplained exception.
 */
export async function sendShortlistNotification(
  trigger: "WEBHOOK" | "MANUAL",
): Promise<NotificationOutcome> {
  const { notifier, channel } = getSlackTarget();
  const items = await listShortlistedItems(SHORTLIST_MAX);
  const storyIds = items.map((item) => item.id);
  const dedupeKey = shortlistDedupeKey(storyIds);
  const sentAt = new Date().toISOString();

  const base = {
    workflow: NEWS_SHORTLIST_WORKFLOW,
    mode: notifier.mode,
    channel,
    trigger,
    storyCount: items.length,
    storyIds,
    dedupeKey,
    sentAt,
  };

  /*
   * An empty shortlist is a result, not a failure (§67). A thin news day
   * should leave a record saying so, not an unexplained silence in the
   * channel and nothing in the log.
   */
  if (items.length === 0) {
    const detail = "Nothing is shortlisted, so there was nothing to send.";
    await recordNotification({ ...base, status: "SKIPPED", messageTs: null, detail });

    return { status: "SKIPPED", mode: notifier.mode, channel, storyCount: 0, detail };
  }

  /*
   * Deduplication, for scheduled triggers only.
   *
   * n8n retries a failed step, and a retry that already succeeded would post
   * the same shortlist twice. A person clicking the button has asked for the
   * message deliberately, so a manual trigger always sends.
   */
  if (trigger === "WEBHOOK") {
    const previous = await lastSentNotification(NEWS_SHORTLIST_WORKFLOW);

    if (previous?.dedupeKey === dedupeKey) {
      const detail = "This shortlist has already been sent; nothing has changed since.";
      await recordNotification({ ...base, status: "SKIPPED", messageTs: null, detail });

      return {
        status: "SKIPPED",
        mode: notifier.mode,
        channel,
        storyCount: items.length,
        detail,
      };
    }
  }

  const message = buildShortlistMessage({
    items,
    appUrl: getServerEnv().APP_BASE_URL,
    deliveryMode: notifier.mode,
  });

  try {
    const delivery = await notifier.post(channel, message);

    await recordNotification({
      ...base,
      channel: delivery.channel,
      status: "SENT",
      messageTs: delivery.ts,
      detail: null,
    });

    logger.info("Shortlist notification sent", {
      mode: delivery.mode,
      channel: delivery.channel,
      stories: items.length,
    });

    return {
      status: "SENT",
      mode: delivery.mode,
      channel: delivery.channel,
      storyCount: items.length,
      detail: null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    // §52: a Slack failure is handled and recorded, never swallowed. The
    // shortlist itself is untouched, so the next run can send it again.
    await recordNotification({ ...base, status: "FAILED", messageTs: null, detail });

    logger.error("Shortlist notification failed", { channel, error: detail });

    return { status: "FAILED", mode: notifier.mode, channel, storyCount: items.length, detail };
  }
}
