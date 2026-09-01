import { describe, expect, it } from "vitest";

import {
  bucketByDay,
  buildRange,
  dayLabel,
  parseAnchor,
  parseView,
  periodLabel,
  shiftAnchor,
  startOfWeek,
} from "@/lib/calendar/grid";
import {
  addDays,
  dateInTimeZone,
  endOfDayInTimeZone,
  isCalendarDate,
  startOfDayInTimeZone,
  timeInTimeZone,
} from "@/lib/time";

/**
 * The calendar's arithmetic (spec §38, §54).
 *
 * Tested as arithmetic, without Firestore or a browser: which day a post falls
 * on is a question about timezones, and getting it wrong would put a post on
 * the wrong date in a way no screenshot would reveal.
 */

const KARACHI = "Asia/Karachi";
const NEW_YORK = "America/New_York";

describe("dateInTimeZone", () => {
  it("puts a late-evening UTC instant on the next day in Karachi (§54)", () => {
    expect(dateInTimeZone(new Date("2026-03-11T23:30:00Z"), KARACHI)).toBe("2026-03-12");
  });

  it("puts an early-morning UTC instant on the previous day in New York", () => {
    expect(dateInTimeZone(new Date("2026-03-12T03:00:00Z"), NEW_YORK)).toBe("2026-03-11");
  });
});

describe("timeInTimeZone", () => {
  it("shows the wall clock the company reads, not UTC", () => {
    expect(timeInTimeZone(new Date("2026-03-12T04:00:00Z"), KARACHI)).toBe("09:00");
  });

  it("renders midnight as 00:00 rather than 24:00", () => {
    expect(timeInTimeZone(new Date("2026-03-11T19:00:00Z"), KARACHI)).toBe("00:00");
  });
});

describe("startOfDayInTimeZone", () => {
  it("is the instant the local day begins, not UTC midnight", () => {
    expect(startOfDayInTimeZone("2026-03-12", KARACHI).toISOString()).toBe(
      "2026-03-11T19:00:00.000Z",
    );
  });

  it("is right on both sides of a daylight-saving change", () => {
    // New York moves to daylight time on 2026-03-08.
    expect(startOfDayInTimeZone("2026-03-07", NEW_YORK).toISOString()).toBe(
      "2026-03-07T05:00:00.000Z",
    );
    expect(startOfDayInTimeZone("2026-03-09", NEW_YORK).toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });

  it("is right on the shortened day itself", () => {
    expect(startOfDayInTimeZone("2026-03-08", NEW_YORK).toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });

  it("ends a day where the next one starts, so no instant falls between two days", () => {
    expect(endOfDayInTimeZone("2026-03-07", NEW_YORK).toISOString()).toBe(
      startOfDayInTimeZone("2026-03-08", NEW_YORK).toISOString(),
    );
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses a year boundary backwards", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("knows February in a leap year", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("isCalendarDate", () => {
  it("rejects a day that does not exist", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
  });

  it("rejects anything that is not a date at all", () => {
    expect(isCalendarDate("last tuesday")).toBe(false);
  });

  it("accepts a real date", () => {
    expect(isCalendarDate("2026-03-12")).toBe(true);
  });
});

describe("parseView", () => {
  it("takes the three views §38 lists", () => {
    expect(parseView("month")).toBe("month");
    expect(parseView("week")).toBe("week");
    expect(parseView("day")).toBe("day");
  });

  it("falls back to the month rather than failing on a bad URL", () => {
    expect(parseView("year")).toBe("month");
    expect(parseView(undefined)).toBe("month");
  });
});

describe("parseAnchor", () => {
  it("keeps a usable date", () => {
    expect(parseAnchor("2026-03-12", "2026-09-01")).toBe("2026-03-12");
  });

  it("falls back to today for anything else", () => {
    expect(parseAnchor("2026-02-30", "2026-09-01")).toBe("2026-09-01");
    expect(parseAnchor(undefined, "2026-09-01")).toBe("2026-09-01");
  });
});

describe("startOfWeek", () => {
  it("returns the date itself when it is already a Monday", () => {
    expect(startOfWeek("2026-03-09")).toBe("2026-03-09");
  });

  it("walks a Sunday back to the Monday it belongs to, not forward", () => {
    expect(startOfWeek("2026-03-15")).toBe("2026-03-09");
  });
});

describe("buildRange", () => {
  it("gives a day view exactly one day", () => {
    const range = buildRange("day", "2026-03-12");

    expect(range.days).toEqual(["2026-03-12"]);
    expect(range.periodStart).toBe("2026-03-12");
    expect(range.periodEnd).toBe("2026-03-12");
  });

  it("gives a week view seven days beginning on Monday", () => {
    const range = buildRange("week", "2026-03-12");

    expect(range.days).toHaveLength(7);
    expect(range.days[0]).toBe("2026-03-09");
    expect(range.days[6]).toBe("2026-03-15");
  });

  it("gives a month view whole weeks that cover the month", () => {
    const range = buildRange("month", "2026-03-12");

    expect(range.days.length % 7).toBe(0);
    expect(range.days[0]).toBe("2026-02-23");
    expect(range.days).toContain("2026-03-01");
    expect(range.days).toContain("2026-03-31");
    expect(range.periodStart).toBe("2026-03-01");
    expect(range.periodEnd).toBe("2026-03-31");
  });

  it("covers a month that starts on a Sunday without dropping its first day", () => {
    const range = buildRange("month", "2026-02-15");

    expect(range.days[0]).toBe("2026-01-26");
    expect(range.days).toContain("2026-02-01");
    expect(range.days).toContain("2026-02-28");
  });

  it("keeps every day of a month that spills into a sixth week", () => {
    const range = buildRange("month", "2026-08-10");

    expect(range.days).toContain("2026-08-31");
    expect(range.days.length % 7).toBe(0);
  });
});

describe("shiftAnchor", () => {
  it("moves a day view one day", () => {
    expect(shiftAnchor("day", "2026-03-01", -1)).toBe("2026-02-28");
  });

  it("moves a week view seven days", () => {
    expect(shiftAnchor("week", "2026-03-12", 1)).toBe("2026-03-19");
  });

  it("moves a month view across a year boundary", () => {
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-15");
  });

  it("clamps a day that the next month does not have, rather than skipping it", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("bucketByDay", () => {
  const post = (id: string, scheduledAt: string | null) => ({ id, scheduledAt });

  it("buckets by the company's day, not UTC's (§54)", () => {
    const buckets = bucketByDay([post("a", "2026-03-11T23:30:00Z")], KARACHI);

    expect(Object.keys(buckets)).toEqual(["2026-03-12"]);
  });

  it("leaves unscheduled posts out of the grid entirely", () => {
    expect(bucketByDay([post("a", null)], KARACHI)).toEqual({});
  });

  it("orders a day by the time each post publishes", () => {
    const buckets = bucketByDay(
      [post("late", "2026-03-12T11:00:00Z"), post("early", "2026-03-12T04:00:00Z")],
      KARACHI,
    );

    expect(buckets["2026-03-12"].map((entry) => entry.id)).toEqual(["early", "late"]);
  });
});

describe("periodLabel", () => {
  it("names the month, not the anchor day", () => {
    expect(periodLabel(buildRange("month", "2026-03-12"))).toBe("March 2026");
  });

  it("names both ends of a week", () => {
    expect(periodLabel(buildRange("week", "2026-03-12"))).toBe("9 – 15 March 2026");
  });

  it("spells out a single day", () => {
    expect(periodLabel(buildRange("day", "2026-03-12"))).toBe("Thursday, 12 March 2026");
  });

  it("names both months when a week straddles them", () => {
    expect(periodLabel(buildRange("week", "2026-04-01"))).toBe("30 March – 5 April 2026");
  });
});

describe("dayLabel", () => {
  it("gives the weekday and the day of the month", () => {
    expect(dayLabel("2026-03-12")).toEqual({ weekday: "Thu", day: "12" });
  });
});
