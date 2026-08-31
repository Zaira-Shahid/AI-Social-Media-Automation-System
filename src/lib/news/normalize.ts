import { createHash } from "node:crypto";

import { newsItemSchema, type NewsItem, type NewsSource } from "@/lib/news/schema";

/**
 * Feed entry -> normalized news item (spec §6).
 *
 * Pure, so it can be tested against fixture XML rather than live feeds (§58).
 * Nothing here reaches the network or the database.
 */

/** The shape `rss-parser` produces, narrowed to what normalization uses. */
export interface FeedEntry {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  categories?: string[];
  enclosure?: { url?: string; type?: string };
  ["media:content"]?: { $?: { url?: string } };
  ["media:thumbnail"]?: { $?: { url?: string } };
}

/**
 * Strip markup and collapse whitespace.
 *
 * Feed summaries routinely carry HTML, and some carry an entire article body.
 * What is stored should be text, because everything downstream — the AI
 * prompt, the Slack message, the card — wants text.
 */
export function toPlainText(value: string | undefined): string {
  if (!value) return "";

  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip the tracking and campaign parameters feeds attach.
 *
 * This matters beyond tidiness: the article URL is what the document ID is
 * derived from, and two links to the same story differing only by `utm_source`
 * would otherwise be stored as two different stories.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$)/i;

export function canonicalizeUrl(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }

  url.hash = "";

  // Trailing slashes are not meaningful here, and feeds are inconsistent
  // about them for the same article.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/**
 * The document ID for an article.
 *
 * Derived from the canonical URL rather than random, so re-running ingestion
 * overwrites the same document instead of creating a second copy. n8n will be
 * retrying and overlapping schedules; §53 wants that to be safe.
 */
export function newsItemId(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 40);
}

/**
 * Group key for the same story reported by several outlets.
 *
 * Titles are normalized hard — lowercased, punctuation and curly quotes
 * stripped, whitespace collapsed — because near-identical headlines are the
 * cheapest available signal. This groups only headlines that match after that
 * normalization; real paraphrase detection is Module 04's problem, and this
 * only has to make the obvious collisions visible to it.
 */
export function duplicateGroupKey(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

function firstImage(entry: FeedEntry): string {
  const candidates = [
    entry.enclosure?.type?.startsWith("image/") ? entry.enclosure.url : undefined,
    entry["media:content"]?.$?.url,
    entry["media:thumbnail"]?.$?.url,
  ];

  const found = candidates.find(
    (value) => typeof value === "string" && /^https?:\/\//i.test(value),
  );

  return found ?? "";
}

/**
 * Published date.
 *
 * `isoDate` is rss-parser's normalized field; `pubDate` is the raw one. A feed
 * with neither, or with an unparseable date, falls back to the retrieval time
 * rather than being dropped — the story is still real, and §54 only requires
 * that what is stored is UTC and consistent.
 */
function publishedAt(entry: FeedEntry, retrievedAt: string): string {
  for (const candidate of [entry.isoDate, entry.pubDate]) {
    if (!candidate) continue;

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return retrievedAt;
}

export interface NormalizedEntry {
  id: string;
  item: NewsItem;
}

/**
 * Normalize one entry. Returns null when the entry cannot be used.
 *
 * An entry with no title or no link is skipped rather than stored with a
 * placeholder: §7 will later reject low-quality stories, and an item with no
 * URL cannot be attributed at all, which §7 forbids outright.
 */
export function normalizeEntry(
  entry: FeedEntry,
  source: Pick<NewsSource, "id" | "name" | "category">,
  retrievedAt: string,
): NormalizedEntry | null {
  const title = toPlainText(entry.title);
  const link = entry.link?.trim();

  if (!title || !link) return null;

  const canonical = canonicalizeUrl(link);

  const candidate = {
    title: title.slice(0, 500),
    summary: toPlainText(entry.contentSnippet ?? entry.summary ?? entry.content).slice(0, 2000),
    sourceName: source.name,
    sourceId: source.id,
    sourceUrl: canonical,
    publishedAt: publishedAt(entry, retrievedAt),
    retrievedAt,
    // The feed's own category wins when it has one; otherwise the source's.
    category: (entry.categories?.[0] ?? source.category ?? "").slice(0, 60),
    imageUrl: firstImage(entry),
    duplicateGroup: duplicateGroupKey(title),
    status: "DISCOVERED" as const,
  };

  const parsed = newsItemSchema.safeParse(candidate);

  // A malformed entry is skipped, not stored half-valid. §31's pattern:
  // invalid input must not enter the workflow.
  if (!parsed.success) return null;

  return { id: newsItemId(canonical), item: parsed.data };
}

/** Normalize a whole feed, dropping unusable entries and de-duplicating within the batch. */
export function normalizeFeed(
  entries: FeedEntry[],
  source: Pick<NewsSource, "id" | "name" | "category">,
  retrievedAt: string,
): NormalizedEntry[] {
  const seen = new Set<string>();
  const normalized: NormalizedEntry[] = [];

  for (const entry of entries) {
    const result = normalizeEntry(entry, source, retrievedAt);
    if (!result || seen.has(result.id)) continue;

    seen.add(result.id);
    normalized.push(result);
  }

  return normalized;
}
