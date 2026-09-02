import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canSchedule,
  checkScheduleTime,
  conflictWindow,
  findConflict,
  MIN_PLATFORM_GAP_MINUTES,
  SCHEDULE_HORIZON_DAYS,
  scheduleRefusal,
} from "@/lib/content/schedule-rules";
import type { StoredPlatformPost } from "@/lib/content/store";

/**
 * The scheduling engine (spec §17, §18, §49, §53, §54).
 *
 * The rules are tested as rules and the orchestration with Firestore replaced.
 * §18's requirement — the scheduler never carries unapproved content — is
 * checked at both ends: what may be given a slot, and what the due list is
 * willing to hand to a publisher.
 */

const KARACHI = "Asia/Karachi";
const NOW = new Date("2026-09-01T06:00:00Z"); // 11:00 in Karachi

const getPlatformPost = vi.fn<(id: string) => Promise<StoredPlatformPost | null>>();
const scheduleAtInstant = vi.fn();
const listDuePosts = vi.fn<() => Promise<StoredPlatformPost[]>>();

vi.mock("@/lib/content/store", () => ({
  getPlatformPost: (id: string) => getPlatformPost(id),
  scheduleAtInstant: (...args: unknown[]) => scheduleAtInstant(...args),
  listDuePosts: () => listDuePosts(),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ APP_TIMEZONE: KARACHI }),
}));

function post(overrides: Partial<StoredPlatformPost> = {}): StoredPlatformPost {
  return {
    id: "post-1",
    contentItemId: "content-1",
    platform: "LINKEDIN",
    status: "APPROVED",
    caption: "A caption.",
    hashtags: ["ai"],
    cta: "Read more",
    visual: {
      template: "HEADLINE_CARD",
      headline: "A headline",
      supportingText: "",
      emphasis: "PRIMARY",
    },
    mediaUrl: "https://res.cloudinary.com/our-cloud/image/upload/posts/post-1.png",
    mediaPublicId: "posts/post-1",
    lastError: null,
    version: 1,
    approvedBy: "user-1",
    approvedAt: "2026-09-01T05:00:00.000Z",
    rejectionNote: null,
    scheduledAt: null,
    providerPostId: null,
    permalink: null,
    publishedAt: null,
    publishMode: null,
    publishAttempts: 0,
    publishStartedAt: null,
    ...overrides,
  };
}

async function load() {
  return import("@/lib/content/schedule");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getPlatformPost.mockResolvedValue(post());
  scheduleAtInstant.mockImplementation(async (id: string, instant: Date) => ({
    ok: true,
    post: post({ id, status: "SCHEDULED", scheduledAt: instant.toISOString() }),
  }));
  listDuePosts.mockResolvedValue([]);
});

describe("checkScheduleTime", () => {
  it("reads the time as the company's wall clock, not UTC (§54)", () => {
    const checked = checkScheduleTime("2026-09-02", "09:00", KARACHI, NOW);

    expect(checked.ok).toBe(true);
    // 09:00 in Karachi is 04:00 UTC, which is what gets stored.
    expect(checked.ok && checked.instant.toISOString()).toBe("2026-09-02T04:00:00.000Z");
  });

  it("refuses a time that has already passed", () => {
    const checked = checkScheduleTime("2026-09-01", "09:00", KARACHI, NOW);

    expect(checked.ok).toBe(false);
    expect(checked.ok === false && checked.reason).toContain("already passed");
  });

  it("refuses a date beyond the horizon rather than storing it", () => {
    const checked = checkScheduleTime("2027-09-01", "09:00", KARACHI, NOW);

    expect(checked.ok).toBe(false);
    expect(checked.ok === false && checked.reason).toContain(String(SCHEDULE_HORIZON_DAYS));
  });

  it("names which half of the input was wrong", () => {
    const badDate = checkScheduleTime("2026-02-30", "09:00", KARACHI, NOW);
    const badTime = checkScheduleTime("2026-09-02", "25:00", KARACHI, NOW);

    expect(badDate.ok === false && badDate.reason).toContain("not a date");
    expect(badTime.ok === false && badTime.reason).toContain("not a time of day");
  });

  it("accepts a slot just inside the horizon", () => {
    expect(checkScheduleTime("2026-11-29", "09:00", KARACHI, NOW).ok).toBe(true);
  });
});

describe("canSchedule", () => {
  it("takes approved work, which is all §18 permits", () => {
    expect(canSchedule("APPROVED")).toBe(true);
  });

  it("takes an already scheduled post, because moving one is a correction", () => {
    expect(canSchedule("SCHEDULED")).toBe(true);
  });

  it("refuses everything unapproved", () => {
    expect(canSchedule("DRAFT")).toBe(false);
    expect(canSchedule("IN_REVIEW")).toBe(false);
    expect(canSchedule("REJECTED")).toBe(false);
  });

  it("refuses to reschedule what has already gone out", () => {
    expect(canSchedule("PUBLISHED")).toBe(false);
    expect(canSchedule("FAILED")).toBe(false);
  });

  it("says why, in terms of what happened to the post", () => {
    expect(scheduleRefusal("PUBLISHED")).toContain("already been published");
    expect(scheduleRefusal("IN_REVIEW")).toContain("Approve it first");
  });
});

describe("findConflict", () => {
  const slot = (id: string, platform: string, scheduledAt: string) => ({
    id,
    platform,
    scheduledAt,
  });

  it("refuses two posts on one account inside the minimum gap (§53)", () => {
    const conflict = findConflict([slot("other", "LINKEDIN", "2026-09-02T04:05:00.000Z")], {
      id: "post-1",
      platform: "LINKEDIN",
      instant: new Date("2026-09-02T04:00:00.000Z"),
    });

    expect(conflict?.id).toBe("other");
  });

  it("allows every platform to post at the same moment", () => {
    const conflict = findConflict([slot("other", "FACEBOOK", "2026-09-02T04:00:00.000Z")], {
      id: "post-1",
      platform: "LINKEDIN",
      instant: new Date("2026-09-02T04:00:00.000Z"),
    });

    expect(conflict).toBeNull();
  });

  it("does not let a post collide with itself when it is moved slightly", () => {
    const conflict = findConflict([slot("post-1", "LINKEDIN", "2026-09-02T04:00:00.000Z")], {
      id: "post-1",
      platform: "LINKEDIN",
      instant: new Date("2026-09-02T04:02:00.000Z"),
    });

    expect(conflict).toBeNull();
  });

  it("allows a post exactly the minimum gap away", () => {
    const conflict = findConflict([slot("other", "LINKEDIN", "2026-09-02T04:00:00.000Z")], {
      id: "post-1",
      platform: "LINKEDIN",
      instant: new Date(
        new Date("2026-09-02T04:00:00.000Z").getTime() + MIN_PLATFORM_GAP_MINUTES * 60_000,
      ),
    });

    expect(conflict).toBeNull();
  });

  it("searches a window wide enough to see a conflict on either side", () => {
    const { fromIso, toIso } = conflictWindow(new Date("2026-09-02T04:00:00.000Z"));

    expect(fromIso).toBe("2026-09-02T03:45:00.000Z");
    expect(toIso).toBe("2026-09-02T04:15:00.000Z");
  });
});

describe("schedulePost", () => {
  it("stores UTC and reports the local time back (§54)", async () => {
    const { schedulePost } = await load();

    const outcome = await schedulePost(
      "post-1",
      "user-1",
      { date: "2026-09-02", time: "09:00" },
      NOW,
    );

    expect(outcome.scheduledAt).toBe("2026-09-02T04:00:00.000Z");
    expect(outcome.localDate).toBe("2026-09-02");
    expect(outcome.localTime).toBe("09:00");
  });

  it("refuses to schedule anything unapproved (§18)", async () => {
    const { schedulePost, ScheduleError } = await load();

    getPlatformPost.mockResolvedValue(post({ status: "IN_REVIEW" }));

    await expect(
      schedulePost("post-1", "user-1", { date: "2026-09-02", time: "09:00" }, NOW),
    ).rejects.toBeInstanceOf(ScheduleError);
    expect(scheduleAtInstant).not.toHaveBeenCalled();
  });

  it("refuses a post with no rendered card, which could never publish (§67)", async () => {
    const { schedulePost } = await load();

    getPlatformPost.mockResolvedValue(post({ mediaUrl: null }));

    await expect(
      schedulePost("post-1", "user-1", { date: "2026-09-02", time: "09:00" }, NOW),
    ).rejects.toThrow("no rendered card");
  });

  it("passes a refusal from the transaction straight through", async () => {
    const { schedulePost } = await load();

    scheduleAtInstant.mockResolvedValue({
      ok: false,
      reason: "LINKEDIN already has a post at 09:05",
    });

    await expect(
      schedulePost("post-1", "user-1", { date: "2026-09-02", time: "09:00" }, NOW),
    ).rejects.toThrow("already has a post");
  });

  it("refuses a time in the past before touching the database", async () => {
    const { schedulePost } = await load();

    await expect(
      schedulePost("post-1", "user-1", { date: "2026-08-30", time: "09:00" }, NOW),
    ).rejects.toThrow("already passed");
    expect(scheduleAtInstant).not.toHaveBeenCalled();
  });
});

describe("collectDuePosts", () => {
  it("reports what is due and publishes nothing", async () => {
    const { collectDuePosts } = await load();

    listDuePosts.mockResolvedValue([
      post({ id: "due-1", status: "SCHEDULED", scheduledAt: "2026-09-01T05:00:00.000Z" }),
    ]);

    const outcome = await collectDuePosts(NOW);

    expect(outcome.due).toBe(1);
    expect(outcome.posts.map((entry) => entry.id)).toEqual(["due-1"]);
    expect(outcome.unapproved).toEqual([]);
  });

  it("holds back a due post with no approval record (§18)", async () => {
    const { collectDuePosts } = await load();

    listDuePosts.mockResolvedValue([
      post({
        id: "orphan",
        status: "SCHEDULED",
        scheduledAt: "2026-09-01T05:00:00.000Z",
        approvedBy: null,
        approvedAt: null,
      }),
    ]);

    const outcome = await collectDuePosts(NOW);

    expect(outcome.due).toBe(0);
    expect(outcome.posts).toEqual([]);
    expect(outcome.unapproved).toEqual(["orphan"]);
  });
});
