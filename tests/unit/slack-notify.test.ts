import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredNewsItem } from "@/lib/news/store";
import type { NotificationLog } from "@/lib/slack/schema";
import type { SlackMessage, SlackNotifier } from "@/lib/slack/notifier";

/**
 * The notification pipeline (spec §9, §45, §52, §67).
 *
 * Firestore and Slack are both replaced here; what is under test is the
 * decision-making between them — when to send, when to skip, and what gets
 * written down about it. §67 is the through-line: every outcome, including
 * the ones that send nothing, has to leave an honest record.
 */
const listShortlistedItems = vi.fn<() => Promise<StoredNewsItem[]>>();
const recordNotification = vi.fn<(entry: NotificationLog) => Promise<void>>();
const lastSentNotification = vi.fn<() => Promise<{ dedupeKey: string } | null>>();
const post = vi.fn<SlackNotifier["post"]>();

let notifierMode: "REAL" | "MOCK" = "MOCK";

vi.mock("@/lib/news/store", () => ({
  listShortlistedItems: () => listShortlistedItems(),
}));

vi.mock("@/lib/slack/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack/store")>("@/lib/slack/store");

  return {
    // The real fingerprint, so the dedupe test exercises what production uses.
    shortlistDedupeKey: actual.shortlistDedupeKey,
    recordNotification: (entry: NotificationLog) => recordNotification(entry),
    lastSentNotification: () => lastSentNotification(),
  };
});

vi.mock("@/lib/slack", () => ({
  getSlackTarget: () => ({
    channel: "C0123456789",
    notifier: {
      name: "test",
      get mode() {
        return notifierMode;
      },
      post: (channel: string, message: SlackMessage) => post(channel, message),
    },
  }),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ APP_BASE_URL: "https://app.example.com" }),
}));

function story(id: string): StoredNewsItem {
  return {
    id,
    title: `Story ${id}`,
    summary: "A summary.",
    sourceName: "TechCrunch",
    sourceId: "src-1",
    sourceUrl: "https://example.com/story",
    publishedAt: "2026-08-30T09:00:00.000Z",
    category: "AI",
    duplicateGroup: `group-${id}`,
    status: "SHORTLISTED",
    compositeScore: 80,
    relevanceScore: 90,
    aiAnalysis: { mode: "REAL", whyItMatters: "It matters." },
  };
}

async function sendShortlist(trigger: "WEBHOOK" | "MANUAL" = "WEBHOOK") {
  const { sendShortlistNotification } = await import("@/lib/slack/notify");
  return sendShortlistNotification(trigger);
}

beforeEach(() => {
  vi.clearAllMocks();
  notifierMode = "MOCK";
  listShortlistedItems.mockResolvedValue([story("a"), story("b")]);
  lastSentNotification.mockResolvedValue(null);
  post.mockResolvedValue({ mode: "MOCK", channel: "C0123456789", ts: "MOCK.1" });
});

describe("sendShortlistNotification", () => {
  it("sends the shortlist and records what actually happened", async () => {
    const outcome = await sendShortlist();

    expect(post).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("SENT");
    expect(outcome.storyCount).toBe(2);

    const entry = recordNotification.mock.calls[0][0];
    expect(entry.status).toBe("SENT");
    expect(entry.messageTs).toBe("MOCK.1");
    expect(entry.storyIds).toEqual(["a", "b"]);
  });

  it("records the mode on the log entry, not just in the return value (§21)", async () => {
    await sendShortlist();

    expect(recordNotification.mock.calls[0][0].mode).toBe("MOCK");
  });

  it("skips an empty shortlist and says so, rather than posting nothing quietly", async () => {
    listShortlistedItems.mockResolvedValue([]);

    const outcome = await sendShortlist();

    expect(post).not.toHaveBeenCalled();
    expect(outcome.status).toBe("SKIPPED");
    // A thin news day still leaves a record (§67).
    expect(recordNotification.mock.calls[0][0].status).toBe("SKIPPED");
  });

  it("does not post the same shortlist twice for a scheduled retry", async () => {
    const first = await sendShortlist("WEBHOOK");
    const sentKey = recordNotification.mock.calls[0][0].dedupeKey;
    expect(first.status).toBe("SENT");

    vi.clearAllMocks();
    lastSentNotification.mockResolvedValue({ dedupeKey: sentKey });

    const second = await sendShortlist("WEBHOOK");

    expect(post).not.toHaveBeenCalled();
    expect(second.status).toBe("SKIPPED");
  });

  it("still sends when the shortlist has changed", async () => {
    lastSentNotification.mockResolvedValue({ dedupeKey: "a-different-shortlist" });

    const outcome = await sendShortlist("WEBHOOK");

    expect(post).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("SENT");
  });

  it("always sends for a manual trigger, because a person asked for it", async () => {
    const first = await sendShortlist("MANUAL");
    const sentKey = recordNotification.mock.calls[0][0].dedupeKey;
    expect(first.status).toBe("SENT");

    vi.clearAllMocks();
    lastSentNotification.mockResolvedValue({ dedupeKey: sentKey });

    const second = await sendShortlist("MANUAL");

    expect(post).toHaveBeenCalledTimes(1);
    expect(second.status).toBe("SENT");
  });

  it("records a Slack failure with its reason instead of throwing (§52)", async () => {
    post.mockRejectedValue(new Error("Slack refused the message: not_in_channel."));

    const outcome = await sendShortlist();

    expect(outcome.status).toBe("FAILED");
    expect(outcome.detail).toMatch(/not_in_channel/);

    const entry = recordNotification.mock.calls[0][0];
    expect(entry.status).toBe("FAILED");
    expect(entry.messageTs).toBeNull();
  });

  it("never reports SENT when Slack refused the message (§67)", async () => {
    post.mockRejectedValue(new Error("Slack rate limit reached."));

    const outcome = await sendShortlist();

    expect(outcome.status).not.toBe("SENT");
    expect(recordNotification.mock.calls.every((call) => call[0].status !== "SENT")).toBe(true);
  });

  it("orders the fingerprint independently of the order stories come back in", async () => {
    await sendShortlist("MANUAL");
    const first = recordNotification.mock.calls[0][0].dedupeKey;

    vi.clearAllMocks();
    listShortlistedItems.mockResolvedValue([story("b"), story("a")]);

    await sendShortlist("MANUAL");
    const second = recordNotification.mock.calls[0][0].dedupeKey;

    expect(second).toBe(first);
  });
});
