import type { SlackBlock, SlackMessage } from "@/lib/slack/notifier";
import type { StoredNewsItem } from "@/lib/news/store";

/**
 * The daily shortlist message (spec §8, §9, §21).
 *
 * Pure: it takes stories and returns Block Kit JSON, so the layout can be
 * tested without a workspace, a token or a network call.
 *
 * Limits below are from Slack's Block Kit reference, verified 2026-09-01
 * (§65): 50 blocks per message, 3,000 characters in a section's text object,
 * 150 in a header. This message uses two blocks per story, so ten stories —
 * §8's ceiling — sits well inside the block limit; the text limits are
 * enforced by truncation rather than trusted to be short.
 */
const MAX_HEADER_CHARS = 150;
const MAX_SECTION_CHARS = 3_000;

/** Summaries are trimmed hard: Slack is a notification, not the article. */
const MAX_SUMMARY_CHARS = 280;

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Escape the three characters Slack's mrkdwn treats as markup.
 *
 * A headline containing `<` or `&` would otherwise be parsed as a link or an
 * entity and render as something the publisher never wrote.
 */
function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date";

  return date.toISOString().slice(0, 10);
}

/** Was this story scored by a real provider, or simulated (§21)? */
function wasSimulated(item: StoredNewsItem): boolean {
  return item.aiAnalysis?.mode === "MOCK";
}

function storyBlocks(item: StoredNewsItem, position: number): SlackBlock[] {
  const whyItMatters =
    typeof item.aiAnalysis?.whyItMatters === "string" ? item.aiAnalysis.whyItMatters : "";

  const lines = [
    `*${position}. <${item.sourceUrl}|${escape(truncate(item.title, 200))}>*`,
    item.summary ? escape(truncate(item.summary, MAX_SUMMARY_CHARS)) : "",
    whyItMatters ? `*Why it matters:* ${escape(truncate(whyItMatters, 400))}` : "",
  ].filter(Boolean);

  /*
   * §8 fixes what a shortlisted story must show: headline, short summary,
   * source, published date, why it matters, and the relevance score. All six
   * are here — the first three lines above and the context line below.
   */
  const facts = [
    escape(item.sourceName),
    formatDate(item.publishedAt),
    `score ${item.compositeScore ?? "—"} · relevance ${item.relevanceScore ?? "—"}`,
    // The label travels with the individual story, because one list can hold
    // stories scored by different runs.
    wasSimulated(item) ? ":test_tube: simulated score" : "",
  ].filter(Boolean);

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: truncate(lines.join("\n"), MAX_SECTION_CHARS) },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: facts.join(" · ") }],
    },
  ];
}

export interface ShortlistMessageInput {
  items: StoredNewsItem[];
  /** Base URL of this app, used for the link back to the news screen. */
  appUrl: string;
  /** Whether the message itself is being sent for real or simulated (§66). */
  deliveryMode: "REAL" | "MOCK";
}

/**
 * Build the shortlist message.
 *
 * The buttons are **link** buttons. Slack's interactive buttons need a public
 * HTTPS request URL answered within three seconds, which this system does not
 * have until it is deployed — so rather than invent an interaction that does
 * not work (§9: "do not invent Slack interaction capabilities"), the message
 * links into the app, where §46's selection of exactly three happens.
 */
export function buildShortlistMessage({
  items,
  appUrl,
  deliveryMode,
}: ShortlistMessageInput): SlackMessage {
  const newsUrl = `${appUrl.replace(/\/+$/, "")}/news`;
  const heading = `Today's news shortlist — ${items.length} ${items.length === 1 ? "story" : "stories"}`;

  const notes: string[] = [];

  if (deliveryMode === "MOCK") {
    notes.push(":test_tube: *Simulated delivery* — this message was not sent to a real workspace.");
  }

  if (items.some(wasSimulated)) {
    notes.push(":test_tube: Some scores below were simulated, not produced by a real AI provider.");
  }

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: truncate(heading, MAX_HEADER_CHARS) } },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          // §8: the AI shortlists, a human chooses. The message says so, so
          // nobody reads the top-scoring story as a decision already made.
          text: "Pick *three* to publish about. The ranking never chooses for you.",
        },
      ],
    },
  ];

  for (const note of notes) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
  }

  blocks.push({ type: "divider" });

  items.forEach((item, index) => {
    blocks.push(...storyBlocks(item, index + 1));
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open the news screen" },
        url: newsUrl,
        action_id: "open_news",
        style: "primary",
      },
    ],
  });

  return {
    // Fallback text: what a notification preview and any client that cannot
    // render blocks will show. `chat.postMessage` answers `no_text` without it.
    text: `${heading}. Pick three at ${newsUrl}`,
    blocks,
  };
}
