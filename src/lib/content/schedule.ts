import "server-only";

import { NO_SOURCE_METRICS, SCHEDULING_WORKFLOW } from "@/lib/automation/schema";
import { recordAutomationRun } from "@/lib/automation/store";
import {
  canSchedule,
  checkScheduleTime,
  conflictWindow,
  findConflict,
  scheduleRefusal,
  type ScheduledSlot,
} from "@/lib/content/schedule-rules";
import {
  getPlatformPost,
  listDuePosts,
  scheduleAtInstant,
  type StoredPlatformPost,
} from "@/lib/content/store";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { dateInTimeZone, timeInTimeZone } from "@/lib/time";

/**
 * The scheduling engine (spec §18, §49, §53, §54).
 *
 * §18's hard rule is that the scheduler must never publish unapproved content.
 * That is enforced twice on purpose: nothing but an approved post can be given
 * a slot, and the due list re-checks the approval record rather than trusting
 * that a SCHEDULED status implies one.
 *
 * This module schedules. It does not publish — §63 puts publishing in Module
 * 16, and a "scheduler" that quietly published would be exactly the false
 * capability §67 forbids.
 */

/** Thrown when a scheduling request cannot be carried out as asked. */
export class ScheduleError extends Error {}

/** One page of due work. n8n calls the webhook on a schedule, not once a year. */
const DUE_LIMIT = 100;

export interface ScheduleInput {
  /** Calendar date in the company's timezone, YYYY-MM-DD. */
  date: string;
  /** Wall-clock time in the company's timezone, HH:MM. */
  time: string;
}

export interface ScheduleOutcome {
  scheduledAt: string;
  /** What the reviewer will see on the calendar, in their own words. */
  localDate: string;
  localTime: string;
}

/**
 * Give an approved post a slot (§18).
 *
 * The input is wall-clock time in the company's timezone and what is stored is
 * a UTC instant (§54). A post scheduled for "09:00" keeps meaning nine in the
 * morning to the team, which is the only reading that survives the day an
 * offset changes.
 */
export async function schedulePost(
  platformPostId: string,
  actor: string,
  input: ScheduleInput,
  now: Date = new Date(),
): Promise<ScheduleOutcome> {
  const timeZone = getServerEnv().APP_TIMEZONE;
  const post = await getPlatformPost(platformPostId);

  if (!post) throw new ScheduleError("That post no longer exists.");

  if (!canSchedule(post.status)) throw new ScheduleError(scheduleRefusal(post.status));

  /*
   * §67, the same rule approval applies: a post with no rendered card cannot
   * be published, so a slot for it would be a promise the publishing engine
   * has to break. Approval already required an image; this catches the case
   * where one was cleared after the fact.
   */
  if (!post.mediaUrl) {
    throw new ScheduleError(
      "This post has no rendered card, so it cannot be published at any time. Render it first.",
    );
  }

  const checked = checkScheduleTime(input.date, input.time, timeZone, now);

  if (!checked.ok) throw new ScheduleError(checked.reason);

  const result = await scheduleAtInstant(platformPostId, checked.instant, {
    isAllowed: canSchedule,
    refusal: scheduleRefusal,
    window: conflictWindow,
    findConflict,
    conflictRefusal: (slot: Pick<ScheduledSlot, "platform" | "scheduledAt">) =>
      `${slot.platform} already has a post at ${timeInTimeZone(new Date(slot.scheduledAt), timeZone)} on ${dateInTimeZone(new Date(slot.scheduledAt), timeZone)}. Two posts that close together on one account read as a double post.`,
  });

  if (!result.ok) throw new ScheduleError(result.reason);

  const scheduledAt = result.post.scheduledAt ?? checked.instant.toISOString();

  logger.info("Platform post scheduled", {
    platformPostId,
    platform: post.platform,
    scheduledAt,
    actor,
  });

  return {
    scheduledAt,
    localDate: dateInTimeZone(new Date(scheduledAt), timeZone),
    localTime: timeInTimeZone(new Date(scheduledAt), timeZone),
  };
}

export interface DueOutcome {
  due: number;
  /** Posts due but missing the approval record §18 requires. Should be empty. */
  unapproved: string[];
  posts: StoredPlatformPost[];
}

/**
 * What is due right now (§49's scheduler step).
 *
 * The integration point for n8n's `07_scheduled_publishing`: it answers what
 * should go out and publishes nothing, because nothing here can publish yet.
 *
 * Approval is re-verified on each document. §18 says the scheduler must
 * prevent publishing unapproved content, and "it is SCHEDULED, so somebody
 * must have approved it" is an inference, not a check — §17 is explicit that
 * authorization is read from the platform post itself.
 */
export async function collectDuePosts(now: Date = new Date()): Promise<DueOutcome> {
  const posts = await listDuePosts(now.toISOString(), DUE_LIMIT);

  const approved = posts.filter((post) => post.approvedBy && post.approvedAt);
  const unapproved = posts.filter((post) => !post.approvedBy || !post.approvedAt);

  if (unapproved.length > 0) {
    // Loudly: a scheduled post with no approval record means something wrote
    // this collection outside the review path, which is a §17 violation.
    logger.error("Scheduled posts are due without an approval record", {
      ids: unapproved.map((post) => post.id),
    });
  }

  return {
    due: approved.length,
    unapproved: unapproved.map((post) => post.id),
    posts: approved,
  };
}

/**
 * `collectDuePosts`, instrumented for the Automation Control Center (§41,
 * §63 Module 20/21).
 *
 * A separate function rather than instrumenting `collectDuePosts` itself:
 * `runDuePublishing` (Publishing) also calls `collectDuePosts` internally,
 * and recording a run there too would double-count every publish tick as a
 * Scheduling run. This is what both `content/due`'s webhook and the
 * Automation screen's manual "Run now" call instead.
 */
export async function runSchedulingCheck(
  now: Date,
  trigger: "WEBHOOK" | "MANUAL",
): Promise<DueOutcome> {
  const startedAt = now.toISOString();

  try {
    const outcome = await collectDuePosts(now);

    await recordAutomationRun({
      workflow: SCHEDULING_WORKFLOW,
      status: outcome.unapproved.length > 0 ? "PARTIAL" : "SUCCESS",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...NO_SOURCE_METRICS,
      error:
        outcome.unapproved.length > 0
          ? `${outcome.unapproved.length} due post(s) carry no approval record.`
          : null,
      trigger,
      metrics: { due: outcome.due, unapproved: outcome.unapproved.length },
    });

    return outcome;
  } catch (error) {
    await recordAutomationRun({
      workflow: SCHEDULING_WORKFLOW,
      status: "FAILURE",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...NO_SOURCE_METRICS,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      trigger,
      metrics: {},
    });

    throw error;
  }
}
