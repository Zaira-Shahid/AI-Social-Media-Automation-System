import { addDays, dateInTimeZone, isCalendarDate } from "@/lib/time";

/**
 * The calendar's shape (spec §38).
 *
 * §38 asks for month, week and day views. All three are the same thing — a
 * list of consecutive local dates — so they are built by one function and
 * differ only in where the list starts and how long it is.
 *
 * Pure, and free of Firestore: what belongs on 12 March in Asia/Karachi is a
 * question about dates, and it is answered here rather than inside a query.
 */

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** An unrecognised view falls back to the month, which is §38's broadest. */
export function parseView(raw: string | undefined): CalendarView {
  return CALENDAR_VIEWS.includes(raw as CalendarView) ? (raw as CalendarView) : "month";
}

/** An unusable date in the URL is ignored in favour of today (§67: no error theatre). */
export function parseAnchor(raw: string | undefined, today: string): string {
  return raw && isCalendarDate(raw) ? raw : today;
}

/**
 * The Monday on or before a date.
 *
 * Weeks start on Monday. The spec does not say, and the team's working week
 * does — a Sunday-first grid puts a working Monday in the middle of a row.
 */
export function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

  // getUTCDay is 0 for Sunday, which is six days after the Monday it belongs to.
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function daysInMonth(date: string): number {
  const [year, month] = date.split("-").map(Number);

  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface CalendarRange {
  view: CalendarView;
  /** The date the view is anchored on — the day, or a day inside the period. */
  anchor: string;
  /** Every date the grid renders, in order. */
  days: string[];
  /** The period itself, which for a month view is narrower than `days`. */
  periodStart: string;
  periodEnd: string;
}

/**
 * The dates a view covers.
 *
 * The month view returns whole weeks, so the grid is rectangular and the days
 * either side of the month still show what is scheduled on them — a post on
 * the 1st is not less relevant for falling on a Thursday. `periodStart` and
 * `periodEnd` keep the month itself, so those days can be drawn as adjacent
 * rather than as part of the month being read.
 */
export function buildRange(view: CalendarView, anchor: string): CalendarRange {
  if (view === "day") {
    return { view, anchor, days: [anchor], periodStart: anchor, periodEnd: anchor };
  }

  if (view === "week") {
    const start = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

    return { view, anchor, days, periodStart: start, periodEnd: days[6] };
  }

  const first = startOfMonth(anchor);
  const last = addDays(first, daysInMonth(anchor) - 1);
  const gridStart = startOfWeek(first);
  // Whole weeks from the grid's first Monday through the week containing the
  // last of the month: five rows most months, six when the month spills.
  const length = Math.ceil((countDays(gridStart, last) + 1) / 7) * 7;

  return {
    view,
    anchor,
    days: Array.from({ length }, (_, index) => addDays(gridStart, index)),
    periodStart: first,
    periodEnd: last,
  };
}

/** Whole days from one date to another, both as YYYY-MM-DD. */
function countDays(from: string, to: string): number {
  const milliseconds = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);

  return Math.round(milliseconds / 86_400_000);
}

/** The anchor one period earlier or later, for the previous/next controls. */
export function shiftAnchor(view: CalendarView, anchor: string, periods: number): string {
  if (view === "day") return addDays(anchor, periods);
  if (view === "week") return addDays(anchor, periods * 7);

  const [year, month] = anchor.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + periods, 1));
  const target = moved.toISOString().slice(0, 7);

  // The day of the month is kept where it exists, so paging back and forth
  // does not walk the anchor off 31 January and onto 3 March.
  const day = Math.min(Number(anchor.slice(8, 10)), daysInMonth(`${target}-01`));

  return `${target}-${String(day).padStart(2, "0")}`;
}

/**
 * Group scheduled posts by the local date they land on (§54).
 *
 * The bucket is chosen from the company's timezone, not the server's or the
 * browser's: a post at 23:30 UTC belongs to the next morning in Asia/Karachi,
 * and the calendar has to say so.
 */
export function bucketByDay<T extends { scheduledAt: string | null }>(
  posts: readonly T[],
  timeZone: string,
): Record<string, T[]> {
  const buckets: Record<string, T[]> = {};

  for (const post of posts) {
    if (!post.scheduledAt) continue;

    const day = dateInTimeZone(new Date(post.scheduledAt), timeZone);

    (buckets[day] ??= []).push(post);
  }

  for (const day of Object.keys(buckets)) {
    buckets[day].sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  }

  return buckets;
}

/** "March 2026", "9–15 March 2026" or "Thursday, 12 March 2026". */
export function periodLabel(range: CalendarRange): string {
  /*
   * Formatted at UTC noon and in UTC. These are already calendar dates in the
   * company's timezone, not instants: re-interpreting them in that zone a
   * second time is what shifts a heading onto the wrong day.
   */
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(
      new Date(`${date}T12:00:00Z`),
    );

  if (range.view === "day") {
    return format(range.anchor, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (range.view === "week") {
    const sameMonth = range.periodStart.slice(0, 7) === range.periodEnd.slice(0, 7);

    return `${format(range.periodStart, sameMonth ? { day: "numeric" } : { day: "numeric", month: "long" })} – ${format(
      range.periodEnd,
      { day: "numeric", month: "long", year: "numeric" },
    )}`;
  }

  return format(range.periodStart, { month: "long", year: "numeric" });
}

/** The weekday and day-of-month a cell is labelled with. */
export function dayLabel(date: string): { weekday: string; day: string } {
  const at = new Date(`${date}T12:00:00Z`);

  return {
    weekday: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(at),
    day: String(Number(date.slice(8, 10))),
  };
}
