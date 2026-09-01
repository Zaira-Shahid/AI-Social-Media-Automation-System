import { describe, expect, it } from "vitest";

import { buildShortlistMessage } from "@/lib/slack/blocks";
import type { StoredNewsItem } from "@/lib/news/store";

/**
 * The shortlist message (spec §8, §9, §21).
 *
 * §8 fixes the six fields a shortlisted story must show, and §21 requires a
 * simulated result to be labelled wherever it surfaces — including in Slack,
 * which is the one place a reader has no other context to judge it by.
 */
function story(overrides: Partial<StoredNewsItem> = {}): StoredNewsItem {
  return {
    id: "story-1",
    title: "AI agents take over support desks",
    summary: "A large retailer moved its whole support desk to agents.",
    sourceName: "TechCrunch",
    sourceId: "src-1",
    sourceUrl: "https://example.com/story",
    publishedAt: "2026-08-30T09:00:00.000Z",
    category: "AI",
    duplicateGroup: "group-1",
    imageUrl: "",
    status: "SHORTLISTED",
    compositeScore: 82,
    relevanceScore: 91,
    aiAnalysis: { mode: "REAL", whyItMatters: "It puts a number on job displacement." },
    ...overrides,
  };
}

function textOf(message: { blocks: Record<string, unknown>[] }): string {
  return JSON.stringify(message.blocks);
}

describe("buildShortlistMessage", () => {
  it("includes every field §8 requires for each story", () => {
    const message = buildShortlistMessage({
      items: [story()],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    const rendered = textOf(message);

    expect(rendered).toContain("AI agents take over support desks");
    expect(rendered).toContain("A large retailer moved its whole support desk");
    expect(rendered).toContain("TechCrunch");
    expect(rendered).toContain("2026-08-30");
    expect(rendered).toContain("It puts a number on job displacement.");
    expect(rendered).toContain("relevance 91");
  });

  it("links the headline to the article, not to the feed", () => {
    const message = buildShortlistMessage({
      items: [story()],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    expect(textOf(message)).toContain("<https://example.com/story|");
  });

  it("offers a link button into the app, because Slack interactivity is not configured", () => {
    const message = buildShortlistMessage({
      items: [story()],
      appUrl: "https://app.example.com/",
      deliveryMode: "REAL",
    });

    const actions = message.blocks.find((block) => block.type === "actions") as {
      elements: { url: string; type: string }[];
    };

    expect(actions.elements[0].type).toBe("button");
    // The trailing slash on appUrl must not produce a double slash.
    expect(actions.elements[0].url).toBe("https://app.example.com/news");
  });

  it("says a human picks three, so the top score is not read as a decision", () => {
    const message = buildShortlistMessage({
      items: [story(), story({ id: "story-2" })],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    expect(textOf(message)).toContain("Pick *three*");
  });

  it("labels a simulated delivery (§21)", () => {
    const real = buildShortlistMessage({
      items: [story()],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });
    const mock = buildShortlistMessage({
      items: [story()],
      appUrl: "https://app.example.com",
      deliveryMode: "MOCK",
    });

    expect(textOf(real)).not.toContain("Simulated delivery");
    expect(textOf(mock)).toContain("Simulated delivery");
  });

  it("labels a simulated score on the story it belongs to, not the whole message", () => {
    const message = buildShortlistMessage({
      items: [
        story({ id: "real-one" }),
        story({ id: "mock-one", aiAnalysis: { mode: "MOCK", whyItMatters: "Simulated." } }),
      ],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    const simulated = message.blocks.filter((block) =>
      JSON.stringify(block).includes("simulated score"),
    );

    expect(simulated).toHaveLength(1);
  });

  it("escapes mrkdwn control characters in a headline", () => {
    const message = buildShortlistMessage({
      items: [story({ title: "AI & <script>alert(1)</script> in support" })],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    const rendered = textOf(message);

    expect(rendered).toContain("&amp;");
    expect(rendered).not.toContain("<script>");
  });

  it("stays inside Slack's fifty-block limit at §8's ceiling of ten stories", () => {
    const items = Array.from({ length: 10 }, (_, index) => story({ id: `story-${index}` }));

    const message = buildShortlistMessage({
      items,
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    expect(message.blocks.length).toBeLessThanOrEqual(50);
  });

  it("truncates a long section rather than letting Slack reject the message", () => {
    const message = buildShortlistMessage({
      items: [story({ summary: "x".repeat(5_000) })],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    for (const block of message.blocks) {
      const text = (block as { text?: { text?: string } }).text?.text;
      if (typeof text === "string") expect(text.length).toBeLessThanOrEqual(3_000);
    }
  });

  it("always carries fallback text, which chat.postMessage requires", () => {
    const message = buildShortlistMessage({
      items: [story()],
      appUrl: "https://app.example.com",
      deliveryMode: "REAL",
    });

    expect(message.text.length).toBeGreaterThan(0);
  });
});
