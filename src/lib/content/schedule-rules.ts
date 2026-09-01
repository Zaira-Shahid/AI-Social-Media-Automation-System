import type { PostStatus } from "@/lib/content/schema";
import { instantFromLocalTime, isCalendarDate, isClockTime } from "@/lib/time";

/**
 * Scheduling rules (spec §18, §53, §54).
 *
 * Pure, and separate from the Firestore work in `schedule.ts`, so every rule
 * can be tested as a rule. §18's one hard requirement — the scheduler must
 * never publish unapproved content — is a status check, and it lives here
 * beside the rest rather than being implied by whoever calls it.
 */

/**
 * How far ahead a post may be scheduled.
 *
 * Ninety days is not in the spec. It is a guard against a typo in the year
 * putting a post beyond every calendar anyone will look at, where it would sit
 * indefinitely as work nobody can see is stuck. Anything genuinely further out
 * is a plan, not a schedule.
 */
export const SCHEDULE_HORIZON_DAYS = 90;

/**
 * The smallest gap between two posts on the same platform (§53).
 *
 * Duplicate protection at the schedule end: two versions landing on one
 * account within a quarter of an hour reads as a double post to every follower
 * who sees both, and it is nearly always a mistake rather than a plan. The
 * publishing engine will still have its own idempotency checks (§53) — this
 * one stops the mistake being made, not merely repeated.
 */
export const MIN_PLATFORM_GAP_MINUTES = 15;

const MINUTE = 60_000;

export type ScheduleCheck = { ok: true; instant: Date } | { ok: false; reason: string };

/**
 * Is this a time a person can be scheduled for?
 *
 * The refusals name the value that was wrong, because "invalid input" tells
 * whoever typed it nothing about which half to fix.
 */
export function checkScheduleTime(
  date: string,
  time: string,
  timeZone: string,
  now: Date,
): ScheduleCheck {
  if (!isCalendarDate(date)) return { ok: false, reason: `${date || "That date"} is not a date.` };

  if (!isClockTime(time)) {
    return { ok: false, reason: `${time || "That time"} is not a time of day (use HH:MM).` };
  }

  const instant = instantFromLocalTime(date, time, timeZone);

  if (instant.getTime() <= now.getTime()) {
    return { ok: false, reason: "That time has already passed. Pick a time in the future." };
  }

  const horizon = now.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 60 * MINUTE;

  if (instant.getTime() > horizon) {
    return {
      ok: false,
      reason: `That is more than ${SCHEDULE_HORIZON_DAYS} days away. Schedule it closer to the day.`,
    };
  }

  return { ok: true, instant };
}

/**
 * Which statuses may be scheduled (§17, §18).
 *
 * APPROVED is §17's transition. SCHEDULED is here because moving an already
 * scheduled post to a different time is a correction, not a transition — the
 * status does not change, and a schedule nobody can correct is a trap. Nothing
 * else qualifies: §18 is explicit that unapproved content must never reach the
 * scheduler.
 */
export function canSchedule(status: PostStatus): boolean {
  return status === "APPROVED" || status === "SCHEDULED";
}

export function scheduleRefusal(status: PostStatus): string {
  if (status === "PUBLISHED") return "This post has already been published.";
  if (status === "FAILED")
    return "This post failed to publish; scheduling it again would hide why.";
  if (status === "REJECTED") return "This post was rejected.";

  return "Only approved posts can be scheduled. Approve it first (§18).";
}

export interface ScheduledSlot {
  id: string;
  platform: string;
  scheduledAt: string;
}

/**
 * Does this slot collide with something already scheduled (§53)?
 *
 * Only the same platform counts. Three platforms posting at 09:00 is one
 * story going out everywhere, which is the intended shape of a day here — the
 * problem is two posts hitting the *same* account together.
 *
 * The post being scheduled is excluded by id, so moving a post to a time near
 * where it already sits does not collide with itself.
 */
export function findConflict(
  slots: readonly ScheduledSlot[],
  candidate: { id: string; platform: string; instant: Date },
): ScheduledSlot | null {
  const gap = MIN_PLATFORM_GAP_MINUTES * MINUTE;

  return (
    slots.find(
      (slot) =>
        slot.id !== candidate.id &&
        slot.platform === candidate.platform &&
        Math.abs(new Date(slot.scheduledAt).getTime() - candidate.instant.getTime()) < gap,
    ) ?? null
  );
}

/** The window a conflict search has to cover — the gap either side of a slot. */
export function conflictWindow(instant: Date): { fromIso: string; toIso: string } {
  const gap = MIN_PLATFORM_GAP_MINUTES * MINUTE;

  return {
    fromIso: new Date(instant.getTime() - gap).toISOString(),
    toIso: new Date(instant.getTime() + gap).toISOString(),
  };
}
