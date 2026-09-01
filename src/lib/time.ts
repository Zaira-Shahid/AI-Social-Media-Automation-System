/**
 * Timezone helpers (spec §54).
 *
 * §54: store timestamps in UTC, display them in the company's configured
 * timezone, and never let browser-local time become the source of truth. Every
 * conversion in the app goes through this file so there is one implementation
 * to be right about rather than one per screen.
 *
 * `Intl` does the arithmetic. A timezone database is not a thing to hand-roll,
 * and Node ships one — no dependency is added for this (§29).
 */

/** The calendar date an instant falls on, in `timeZone`, as YYYY-MM-DD. */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  // `en-CA` is used only because it formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The wall-clock time an instant shows in `timeZone`, as HH:MM. */
export function timeInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

/**
 * The wall-clock reading in `timeZone`, expressed as if it were UTC.
 *
 * Not a real instant — a measuring stick. Comparing it against the instant it
 * came from gives that zone's offset at that moment, which is how the two
 * functions below convert without a timezone library.
 */
function wallClockAsUtc(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // `hour12: false` can render midnight as hour 24 in some environments.
  const hour = field("hour") % 24;

  return Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour,
    field("minute"),
    field("second"),
  );
}

/** The instant at which a local date begins in `timeZone` — its midnight. */
export function startOfDayInTimeZone(date: string, timeZone: string): Date {
  return instantFromLocalTime(date, "00:00", timeZone);
}

/**
 * The instant at which a local wall-clock time occurs in `timeZone` (§18, §54).
 *
 * This is the conversion §18 asks for — a person picks a date and a time in
 * the company's zone, and what gets stored is the UTC instant they meant.
 *
 * The offset is measured twice: once from a first guess, then again from the
 * corrected instant. A single pass is wrong on the days a zone changes offset,
 * because the offset that applies at the chosen time is not always the one
 * that applied to the guess.
 *
 * On the hour a zone springs forward, the chosen wall clock may not exist. The
 * result then lands on the following hour rather than throwing: the intent
 * ("early on the 8th") is still served, and refusing would strand a scheduler
 * on one day a year.
 */
export function instantFromLocalTime(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const first = new Date(guess.getTime() - (wallClockAsUtc(guess, timeZone) - guess.getTime()));
  const offset = wallClockAsUtc(first, timeZone) - first.getTime();

  return new Date(guess.getTime() - offset);
}

/** Is this a 24-hour HH:MM clock time? */
export function isClockTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;

  const [hours, minutes] = value.split(":").map(Number);

  return hours < 24 && minutes < 60;
}

/** The instant at which a local date ends — the start of the next one. */
export function endOfDayInTimeZone(date: string, timeZone: string): Date {
  return startOfDayInTimeZone(addDays(date, 1), timeZone);
}

/**
 * Move a YYYY-MM-DD date by whole days.
 *
 * Done in UTC on purpose: these are calendar dates, not instants, and UTC is
 * the only zone where adding 24 hours always lands on the next date.
 */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);

  moved.setUTCDate(moved.getUTCDate() + days);

  return moved.toISOString().slice(0, 10);
}

/** Is this a well-formed, real YYYY-MM-DD date? */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
