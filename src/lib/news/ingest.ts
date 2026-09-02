import "server-only";

import Parser from "rss-parser";

import { recordAutomationRun } from "@/lib/automation/store";
import { logger } from "@/lib/logger";
import { normalizeFeed, type FeedEntry } from "@/lib/news/normalize";
import type { AutomationRun, NewsSource, SourceHealth } from "@/lib/news/schema";
import { listActiveSources, recordSourceHealth, upsertNewsItems } from "@/lib/news/store";

/**
 * The ingestion run (spec §45).
 *
 * Read active sources by priority, fetch each, normalize, store, update that
 * source's health, and log the run. Module 04 does the ranking; nothing here
 * scores anything.
 */
export const NEWS_DISCOVERY_WORKFLOW = "01_daily_news_discovery";

/**
 * A feed that has not answered in 20 seconds is not going to.
 *
 * Without a timeout one slow publisher stalls the whole run, and n8n's own
 * request would time out first — leaving a run that appears to have vanished.
 */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Identify the client honestly.
 *
 * Several publishers refuse the default Node agent outright, and an anonymous
 * scraper is the sort of thing that gets an IP blocked.
 */
const USER_AGENT = "ai-social-media-automation/1.0 (+internal news discovery)";

function createParser(): Parser<Record<string, unknown>, FeedEntry> {
  return new Parser<Record<string, unknown>, FeedEntry>({
    timeout: FETCH_TIMEOUT_MS,
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml" },
  });
}

export interface SourceResult {
  sourceId: string;
  sourceName: string;
  ok: boolean;
  discovered: number;
  created: number;
  error: string | null;
}

function healthAfterSuccess(previous: SourceHealth, now: string, itemCount: number): SourceHealth {
  return {
    ...previous,
    status: "OK",
    lastCheckedAt: now,
    lastSuccessAt: now,
    lastError: null,
    consecutiveFailures: 0,
    lastItemCount: itemCount,
  };
}

function healthAfterFailure(previous: SourceHealth, now: string, error: string): SourceHealth {
  return {
    ...previous,
    status: "FAILING",
    lastCheckedAt: now,
    lastError: error.slice(0, 500),
    consecutiveFailures: previous.consecutiveFailures + 1,
  };
}

/**
 * Fetch and store one source.
 *
 * Never throws. §52 requires a source failure to be detected, logged and
 * corrected in status rather than taking anything else down — one dead feed
 * must not cost the other eight.
 *
 * A failing source is marked, never deactivated. A feed that silently switches
 * itself off is a story that stops appearing with nobody noticing; a source
 * shown in red is one somebody fixes.
 */
export async function ingestSource(source: NewsSource): Promise<SourceResult> {
  const now = new Date().toISOString();

  try {
    const feed = await createParser().parseURL(source.feedUrl);
    const entries = normalizeFeed((feed.items ?? []) as FeedEntry[], source, now);
    const { created } = await upsertNewsItems(entries);

    await recordSourceHealth(source.id, healthAfterSuccess(source.health, now, entries.length));

    return {
      sourceId: source.id,
      sourceName: source.name,
      ok: true,
      discovered: entries.length,
      created,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.warn("News source fetch failed", { sourceId: source.id, error: message });

    await recordSourceHealth(source.id, healthAfterFailure(source.health, now, message));

    return {
      sourceId: source.id,
      sourceName: source.name,
      ok: false,
      discovered: 0,
      created: 0,
      error: message,
    };
  }
}

export interface IngestionSummary {
  run: AutomationRun;
  results: SourceResult[];
}

/**
 * Run discovery across every active source.
 *
 * Sources are fetched sequentially, in priority order. Parallel fetching would
 * finish sooner, but this runs on a Render free instance with modest memory
 * and the schedule has hours of slack — the cost of the simpler, gentler
 * option is nothing anyone will notice.
 */
export async function runNewsDiscovery(trigger: "WEBHOOK" | "MANUAL"): Promise<IngestionSummary> {
  const startedAt = new Date().toISOString();

  let sources: NewsSource[];

  try {
    sources = await listActiveSources();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Unlike a single feed failing, this means the run could not start.
    const run: AutomationRun = {
      workflow: NEWS_DISCOVERY_WORKFLOW,
      status: "FAILURE",
      startedAt,
      finishedAt: new Date().toISOString(),
      sourcesAttempted: 0,
      sourcesFailed: 0,
      itemsDiscovered: 0,
      itemsNew: 0,
      error: message.slice(0, 500),
      trigger,
      metrics: {},
    };

    await recordAutomationRun(run);
    return { run, results: [] };
  }

  const results: SourceResult[] = [];

  for (const source of sources) {
    results.push(await ingestSource(source));
  }

  const failed = results.filter((result) => !result.ok);

  const run: AutomationRun = {
    workflow: NEWS_DISCOVERY_WORKFLOW,
    // PARTIAL, not SUCCESS: a run where three feeds died did not do its job,
    // and §52 says never silently fail.
    status:
      failed.length === 0 ? "SUCCESS" : failed.length === results.length ? "FAILURE" : "PARTIAL",
    startedAt,
    finishedAt: new Date().toISOString(),
    sourcesAttempted: results.length,
    sourcesFailed: failed.length,
    itemsDiscovered: results.reduce((total, result) => total + result.discovered, 0),
    itemsNew: results.reduce((total, result) => total + result.created, 0),
    error:
      failed.length > 0
        ? failed
            .map((result) => `${result.sourceName}: ${result.error}`)
            .join("; ")
            .slice(0, 500)
        : null,
    trigger,
    metrics: {},
  };

  await recordAutomationRun(run);

  logger.info("News discovery run finished", {
    status: run.status,
    sourcesAttempted: run.sourcesAttempted,
    sourcesFailed: run.sourcesFailed,
    itemsNew: run.itemsNew,
  });

  return { run, results };
}
