import { describe, expect, it } from "vitest";

import { newsItemSchema, newsSourceInputSchema } from "@/lib/news/schema";

/**
 * Source and item validation (spec §5, §6, §31).
 */
const VALID_SOURCE = {
  name: "TechCrunch AI",
  feedUrl: "https://techcrunch.com/category/artificial-intelligence/feed/",
  homepageUrl: "https://techcrunch.com",
  category: "AI",
  priority: 1,
  active: true,
};

describe("newsSourceInputSchema", () => {
  it("accepts a well-formed source", () => {
    expect(newsSourceInputSchema.safeParse(VALID_SOURCE).success).toBe(true);
  });

  it("requires a name", () => {
    expect(newsSourceInputSchema.safeParse({ ...VALID_SOURCE, name: "  " }).success).toBe(false);
  });

  it("rejects a feed URL that is not http(s), since the server will fetch it", () => {
    for (const feedUrl of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.test/f"]) {
      expect(newsSourceInputSchema.safeParse({ ...VALID_SOURCE, feedUrl }).success).toBe(false);
    }
  });

  it("rejects a bare domain with no scheme", () => {
    expect(
      newsSourceInputSchema.safeParse({ ...VALID_SOURCE, feedUrl: "techcrunch.com" }).success,
    ).toBe(false);
  });

  it("allows an empty homepage but not a malformed one", () => {
    expect(newsSourceInputSchema.safeParse({ ...VALID_SOURCE, homepageUrl: "" }).success).toBe(
      true,
    );
    expect(newsSourceInputSchema.safeParse({ ...VALID_SOURCE, homepageUrl: "nope" }).success).toBe(
      false,
    );
  });

  it("bounds priority, so every source cannot be a 1", () => {
    expect(newsSourceInputSchema.safeParse({ ...VALID_SOURCE, priority: 0 }).success).toBe(false);
    expect(newsSourceInputSchema.safeParse({ ...VALID_SOURCE, priority: 6 }).success).toBe(false);
    expect(newsSourceInputSchema.safeParse({ ...VALID_SOURCE, priority: 3 }).success).toBe(true);
  });

  it("coerces the priority a form submits as a string", () => {
    const result = newsSourceInputSchema.parse({ ...VALID_SOURCE, priority: "2" });

    expect(result.priority).toBe(2);
  });
});

describe("newsItemSchema", () => {
  const VALID_ITEM = {
    title: "AI replaces support staff",
    summary: "A summary.",
    sourceName: "TechCrunch AI",
    sourceId: "src-1",
    sourceUrl: "https://example.test/a",
    publishedAt: "2026-08-30T09:15:00.000Z",
    retrievedAt: "2026-08-31T12:00:00.000Z",
    category: "AI",
    imageUrl: "",
    duplicateGroup: "abc123",
    status: "DISCOVERED" as const,
  };

  it("accepts a normalized item", () => {
    expect(newsItemSchema.safeParse(VALID_ITEM).success).toBe(true);
  });

  it("requires timestamps to be ISO, since §54 stores UTC consistently", () => {
    expect(newsItemSchema.safeParse({ ...VALID_ITEM, publishedAt: "30 Aug 2026" }).success).toBe(
      false,
    );
  });

  it("rejects a status outside the declared vocabulary", () => {
    expect(newsItemSchema.safeParse({ ...VALID_ITEM, status: "PUBLISHED" }).success).toBe(false);
  });

  it("requires a duplicate group, since dedupe depends on it", () => {
    expect(newsItemSchema.safeParse({ ...VALID_ITEM, duplicateGroup: "" }).success).toBe(false);
  });

  it("does not carry scoring fields, which are Module 04's to write", () => {
    const parsed = newsItemSchema.parse(VALID_ITEM);

    expect(parsed).not.toHaveProperty("relevanceScore");
    expect(parsed).not.toHaveProperty("aiAnalysis");
  });
});
