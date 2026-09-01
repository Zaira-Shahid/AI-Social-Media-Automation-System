import { beforeEach, describe, expect, it, vi } from "vitest";

import { newsSelectionSchema, SELECTION_SIZE } from "@/lib/news/schema";
import type { StoredNewsItem, StoredNewsSelection } from "@/lib/news/store";

/**
 * Human news selection (spec §8, §10, §46).
 *
 * §10 makes this the first place a person's decision, rather than a score,
 * decides what happens next. So the rules are tested as rules: exactly three,
 * all different, none of them rejected, and never a silent correction.
 */
const getNewsItem = vi.fn<(id: string) => Promise<StoredNewsItem | null>>();
const getSelectionForDate = vi.fn<() => Promise<StoredNewsSelection | null>>();
const saveSelection = vi.fn<() => Promise<string>>();

vi.mock("@/lib/news/store", () => ({
  getNewsItem: (id: string) => getNewsItem(id),
  getSelectionForDate: () => getSelectionForDate(),
  saveSelection: () => saveSelection(),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ APP_TIMEZONE: "Asia/Karachi" }),
}));

function story(id: string, overrides: Partial<StoredNewsItem> = {}): StoredNewsItem {
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
    imageUrl: "",
    compositeScore: 80,
    relevanceScore: 90,
    ...overrides,
  };
}

async function load() {
  return import("@/lib/news/selection");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getNewsItem.mockImplementation(async (id: string) => story(id));
  getSelectionForDate.mockResolvedValue(null);
  saveSelection.mockResolvedValue("selection-1");
});

describe("newsSelectionSchema", () => {
  const base = {
    selectionDate: "2026-09-01",
    selectedBy: "user-1",
    selectedAt: "2026-09-01T05:00:00.000Z",
    status: "PENDING_GENERATION" as const,
    supersededBy: null,
  };

  it("requires exactly three stories", () => {
    expect(newsSelectionSchema.safeParse({ ...base, storyIds: ["a", "b", "c"] }).success).toBe(
      true,
    );
    expect(newsSelectionSchema.safeParse({ ...base, storyIds: ["a", "b"] }).success).toBe(false);
    expect(newsSelectionSchema.safeParse({ ...base, storyIds: ["a", "b", "c", "d"] }).success).toBe(
      false,
    );
  });

  it("rejects the same story three times, which a length check alone would allow", () => {
    const result = newsSelectionSchema.safeParse({ ...base, storyIds: ["a", "a", "a"] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/cannot be selected twice/i);
  });

  it("rejects a selection date that is not a calendar date", () => {
    expect(
      newsSelectionSchema.safeParse({
        ...base,
        selectionDate: "2026-09-01T05:00:00.000Z",
        storyIds: ["a", "b", "c"],
      }).success,
    ).toBe(false);
  });
});

describe("selectionDateFor", () => {
  it("uses the configured timezone, not the server's", async () => {
    const { selectionDateFor } = await load();

    // 20:00 UTC on 31 August is already 01:00 on 1 September in Karachi.
    const evening = new Date("2026-08-31T20:00:00.000Z");

    expect(selectionDateFor(evening, "UTC")).toBe("2026-08-31");
    expect(selectionDateFor(evening, "Asia/Karachi")).toBe("2026-09-01");
  });
});

describe("selectStories", () => {
  it("records a valid selection", async () => {
    const { selectStories } = await load();

    const outcome = await selectStories(["a", "b", "c"], "user-1");

    expect(saveSelection).toHaveBeenCalledTimes(1);
    expect(outcome.storyIds).toEqual(["a", "b", "c"]);
    expect(outcome.replaced).toBe(false);
  });

  it("refuses a selection that is not exactly three", async () => {
    const { selectStories, SelectionError } = await load();

    await expect(selectStories(["a", "b"], "user-1")).rejects.toBeInstanceOf(SelectionError);
    // Nothing is written: a wrong count is never trimmed or padded into shape.
    expect(saveSelection).not.toHaveBeenCalled();
  });

  it("refuses a rejected story, and names it", async () => {
    getNewsItem.mockImplementation(async (id: string) =>
      id === "b" ? story(id, { status: "REJECTED", title: "Ruled out earlier" }) : story(id),
    );

    const { selectStories } = await load();

    await expect(selectStories(["a", "b", "c"], "user-1")).rejects.toThrow(/Ruled out earlier/);
    expect(saveSelection).not.toHaveBeenCalled();
  });

  it("refuses an unscored story", async () => {
    getNewsItem.mockImplementation(async (id: string) =>
      id === "c" ? story(id, { status: "DISCOVERED" }) : story(id),
    );

    const { selectStories } = await load();

    await expect(selectStories(["a", "b", "c"], "user-1")).rejects.toThrow(/discovered/i);
  });

  it("allows a ranked story that never made the shortlist (§10)", async () => {
    getNewsItem.mockImplementation(async (id: string) => story(id, { status: "RANKED" }));

    const { selectStories } = await load();

    await expect(selectStories(["a", "b", "c"], "user-1")).resolves.toMatchObject({
      storyIds: ["a", "b", "c"],
    });
  });

  it("refuses a story that has since been deleted", async () => {
    getNewsItem.mockImplementation(async (id: string) => (id === "b" ? null : story(id)));

    const { selectStories } = await load();

    await expect(selectStories(["a", "b", "c"], "user-1")).rejects.toThrow(/no longer exists/i);
  });

  it("replaces an earlier selection for the same day", async () => {
    getSelectionForDate.mockResolvedValue({
      id: "old",
      selectionDate: "2026-09-01",
      storyIds: ["x", "y", "z"],
      selectedBy: "user-2",
      selectedAt: "2026-09-01T04:00:00.000Z",
      status: "PENDING_GENERATION",
      supersededBy: null,
    });

    const { selectStories } = await load();

    const outcome = await selectStories(["a", "b", "c"], "user-1");

    expect(outcome.replaced).toBe(true);
    expect(saveSelection).toHaveBeenCalledTimes(1);
  });

  it("locks a selection that content has already been generated from", async () => {
    getSelectionForDate.mockResolvedValue({
      id: "old",
      selectionDate: "2026-09-01",
      storyIds: ["x", "y", "z"],
      selectedBy: "user-2",
      selectedAt: "2026-09-01T04:00:00.000Z",
      status: "GENERATED",
      supersededBy: null,
    });

    const { selectStories } = await load();

    await expect(selectStories(["a", "b", "c"], "user-1")).rejects.toThrow(
      /already been used to generate content/i,
    );
    expect(saveSelection).not.toHaveBeenCalled();
  });

  it("keeps §8's number in one place", () => {
    expect(SELECTION_SIZE).toBe(3);
  });
});
