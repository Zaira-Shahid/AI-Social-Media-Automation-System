import { describe, expect, it } from "vitest";

import {
  canonicalizeUrl,
  duplicateGroupKey,
  newsItemId,
  normalizeEntry,
  firstCategory,
  normalizeFeed,
  toPlainText,
  type FeedEntry,
} from "@/lib/news/normalize";

/**
 * Normalization (spec §6, §58).
 *
 * Everything here runs against fixture entries shaped like what rss-parser
 * produces. §58 keeps tests off the network, and a test that depended on a
 * live publisher would fail for reasons that have nothing to do with the code.
 */
const SOURCE = { id: "src-1", name: "TechCrunch AI", category: "AI" };
const RETRIEVED_AT = "2026-08-31T12:00:00.000Z";

/** An RSS entry, as rss-parser hands it over. */
const RSS_ENTRY: FeedEntry = {
  title: "Company replaces 500 support staff with AI agents",
  link: "https://example.test/story-one",
  isoDate: "2026-08-30T09:15:00.000Z",
  contentSnippet: "The firm said the change was permanent.",
  categories: ["Enterprise"],
};

/** An Atom entry, which uses `summary` and often no `isoDate`. */
const ATOM_ENTRY: FeedEntry = {
  title: "New AI agent launched",
  link: "https://example.test/story-two",
  pubDate: "Sat, 30 Aug 2026 11:00:00 GMT",
  summary: "<p>An <b>agent</b> that books travel.</p>",
};

describe("toPlainText", () => {
  it("strips markup and collapses whitespace", () => {
    expect(toPlainText("<p>Hello   <b>there</b></p>\n<p>friend</p>")).toBe("Hello there friend");
  });

  it("removes script and style bodies rather than leaving their contents", () => {
    expect(toPlainText("<script>alert('x')</script>Real text")).toBe("Real text");
    expect(toPlainText("<style>.a{color:red}</style>Real text")).toBe("Real text");
  });

  it("decodes the entities feeds actually use", () => {
    expect(toPlainText("AT&amp;T &quot;wins&quot; &#39;big&#39;")).toBe("AT&T \"wins\" 'big'");
  });

  it("returns an empty string for nothing", () => {
    expect(toPlainText(undefined)).toBe("");
  });
});

describe("canonicalizeUrl", () => {
  it("drops tracking parameters, which would otherwise split one story in two", () => {
    expect(canonicalizeUrl("https://example.test/a?utm_source=rss&utm_medium=feed")).toBe(
      "https://example.test/a",
    );
  });

  it("keeps parameters that identify the article", () => {
    expect(canonicalizeUrl("https://example.test/view?id=99&utm_campaign=x")).toBe(
      "https://example.test/view?id=99",
    );
  });

  it("drops the fragment and a trailing slash", () => {
    expect(canonicalizeUrl("https://example.test/a/#top")).toBe("https://example.test/a");
  });

  it("leaves an unparseable value alone rather than throwing", () => {
    expect(canonicalizeUrl("  not a url  ")).toBe("not a url");
  });
});

describe("newsItemId", () => {
  it("is stable, so re-running ingestion overwrites instead of duplicating", () => {
    expect(newsItemId("https://example.test/a")).toBe(newsItemId("https://example.test/a"));
  });

  it("differs between articles", () => {
    expect(newsItemId("https://example.test/a")).not.toBe(newsItemId("https://example.test/b"));
  });

  it("collapses the same article reached with different tracking parameters", () => {
    const withTracking = canonicalizeUrl("https://example.test/a?utm_source=rss");
    expect(newsItemId(withTracking)).toBe(newsItemId("https://example.test/a"));
  });
});

describe("duplicateGroupKey", () => {
  it("groups the same headline across punctuation and casing", () => {
    expect(duplicateGroupKey("AI Replaces 500 Jobs!")).toBe(
      duplicateGroupKey("ai replaces 500 jobs"),
    );
  });

  it("groups across curly and straight quotes", () => {
    expect(duplicateGroupKey("The “big” shift")).toBe(duplicateGroupKey("The big shift"));
  });

  it("separates genuinely different headlines", () => {
    expect(duplicateGroupKey("AI replaces jobs")).not.toBe(duplicateGroupKey("AI creates jobs"));
  });
});

describe("firstCategory", () => {
  it("takes a plain string category", () => {
    expect(firstCategory({ categories: ["Enterprise"] })).toBe("Enterprise");
  });

  it("reads an RSS category that carries a domain attribute", () => {
    // <category domain="https://example.test/cat">Enterprise</category>
    expect(firstCategory({ categories: [{ _: "Enterprise", $: { domain: "x" } }] })).toBe(
      "Enterprise",
    );
  });

  it("reads an Atom category, whose text is in the term attribute", () => {
    // <category term="Enterprise"/> — no body at all.
    expect(firstCategory({ categories: [{ $: { term: "Enterprise" } }] })).toBe("Enterprise");
  });

  it("skips entries it cannot read rather than stringifying them", () => {
    expect(firstCategory({ categories: [{ $: { domain: "x" } }, "Enterprise"] })).toBe(
      "Enterprise",
    );
    expect(firstCategory({ categories: [{ $: { domain: "x" } }] })).toBeNull();
    expect(firstCategory({ categories: [null, "", "  "] })).toBeNull();
  });

  it("is null when the feed offers no categories", () => {
    expect(firstCategory({})).toBeNull();
  });
});

describe("normalizeEntry", () => {
  it("normalizes an RSS entry", () => {
    const result = normalizeEntry(RSS_ENTRY, SOURCE, RETRIEVED_AT);

    expect(result).not.toBeNull();
    expect(result?.item.title).toBe(RSS_ENTRY.title);
    expect(result?.item.sourceName).toBe("TechCrunch AI");
    expect(result?.item.sourceId).toBe("src-1");
    expect(result?.item.publishedAt).toBe("2026-08-30T09:15:00.000Z");
    expect(result?.item.retrievedAt).toBe(RETRIEVED_AT);
    expect(result?.item.status).toBe("DISCOVERED");
  });

  it("normalizes an Atom entry, using summary and pubDate", () => {
    const result = normalizeEntry(ATOM_ENTRY, SOURCE, RETRIEVED_AT);

    expect(result?.item.summary).toBe("An agent that books travel.");
    expect(result?.item.publishedAt).toBe("2026-08-30T11:00:00.000Z");
  });

  it("prefers the feed's own category over the source's", () => {
    expect(normalizeEntry(RSS_ENTRY, SOURCE, RETRIEVED_AT)?.item.category).toBe("Enterprise");
  });

  it("falls back to the source category when the entry has none", () => {
    expect(normalizeEntry(ATOM_ENTRY, SOURCE, RETRIEVED_AT)?.item.category).toBe("AI");
  });

  it("falls back to the retrieval time when the date is missing or unparseable", () => {
    const noDate = normalizeEntry(
      { ...RSS_ENTRY, isoDate: undefined, pubDate: undefined },
      SOURCE,
      RETRIEVED_AT,
    );
    expect(noDate?.item.publishedAt).toBe(RETRIEVED_AT);

    const badDate = normalizeEntry(
      { ...RSS_ENTRY, isoDate: undefined, pubDate: "not a date" },
      SOURCE,
      RETRIEVED_AT,
    );
    expect(badDate?.item.publishedAt).toBe(RETRIEVED_AT);
  });

  it("skips an entry with no title, since it cannot be reviewed", () => {
    expect(normalizeEntry({ ...RSS_ENTRY, title: undefined }, SOURCE, RETRIEVED_AT)).toBeNull();
  });

  it("skips an entry with no link, since §7 forbids a story without a source", () => {
    expect(normalizeEntry({ ...RSS_ENTRY, link: undefined }, SOURCE, RETRIEVED_AT)).toBeNull();
  });

  it("skips an entry whose link is not http(s)", () => {
    expect(
      normalizeEntry({ ...RSS_ENTRY, link: "javascript:alert(1)" }, SOURCE, RETRIEVED_AT),
    ).toBeNull();
  });

  it("captures an enclosure image for internal reference only", () => {
    const result = normalizeEntry(
      { ...RSS_ENTRY, enclosure: { url: "https://cdn.test/a.jpg", type: "image/jpeg" } },
      SOURCE,
      RETRIEVED_AT,
    );

    expect(result?.item.imageUrl).toBe("https://cdn.test/a.jpg");
  });

  it("ignores a non-image enclosure, such as a podcast attachment", () => {
    const result = normalizeEntry(
      { ...RSS_ENTRY, enclosure: { url: "https://cdn.test/a.mp3", type: "audio/mpeg" } },
      SOURCE,
      RETRIEVED_AT,
    );

    expect(result?.item.imageUrl).toBe("");
  });

  it("truncates an over-long title rather than dropping the story", () => {
    const result = normalizeEntry({ ...RSS_ENTRY, title: "x".repeat(900) }, SOURCE, RETRIEVED_AT);

    expect(result?.item.title).toHaveLength(500);
  });
});

describe("normalizeEntry and object categories", () => {
  /*
   * The bug this guards: `categories` was typed `string[]` and used with
   * `.slice(0, 60)`, so a feed sending category objects threw
   * "…slice is not a function" and every item in that feed was lost.
   */
  it("normalizes an entry whose categories are objects, falling back where unreadable", () => {
    const withObject = normalizeEntry(
      { ...RSS_ENTRY, categories: [{ $: { domain: "https://example.test/c" } }] },
      SOURCE,
      RETRIEVED_AT,
    );

    expect(withObject?.item.category).toBe("AI");

    const withTerm = normalizeEntry(
      { ...RSS_ENTRY, categories: [{ $: { term: "Enterprise" } }] },
      SOURCE,
      RETRIEVED_AT,
    );

    expect(withTerm?.item.category).toBe("Enterprise");
  });
});

describe("normalizeFeed", () => {
  it("drops unusable entries and keeps the rest", () => {
    const result = normalizeFeed(
      [RSS_ENTRY, { ...ATOM_ENTRY, link: undefined }, ATOM_ENTRY],
      SOURCE,
      RETRIEVED_AT,
    );

    expect(result).toHaveLength(2);
  });

  it("de-duplicates within one batch, since feeds repeat entries", () => {
    const result = normalizeFeed(
      [RSS_ENTRY, { ...RSS_ENTRY, link: "https://example.test/story-one?utm_source=rss" }],
      SOURCE,
      RETRIEVED_AT,
    );

    expect(result).toHaveLength(1);
  });

  it("returns nothing for an empty feed rather than failing", () => {
    expect(normalizeFeed([], SOURCE, RETRIEVED_AT)).toEqual([]);
  });
});
