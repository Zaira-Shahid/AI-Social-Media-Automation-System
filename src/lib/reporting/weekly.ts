import "server-only";

import { getAIProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import { recordAudit } from "@/lib/audit";
import { getPostAnalytics } from "@/lib/analytics/store";
import type { AnalyticsRecord } from "@/lib/analytics/schema";
import { getContentItemsByIds, listPublishedPostsBetween } from "@/lib/content/store";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { getNewsItem } from "@/lib/news/store";
import {
  PERFORMANCE_NARRATIVE_JSON_SCHEMA,
  PERFORMANCE_NARRATIVE_SCHEMA_NAME,
  performanceNarrativeSchema,
} from "@/lib/reporting/generation-schema";
import { bestOf, bestPosts, compareBy, weakPosts, weakestOf, type AnalyzablePost } from "@/lib/reporting/compare";
import { saveWeeklyReport } from "@/lib/reporting/store";
import type { ComparisonGroup, PerformanceNarrative, WeeklyReport } from "@/lib/reporting/schema";
import { addDays, dateInTimeZone, startOfDayInTimeZone } from "@/lib/time";

/**
 * Weekly performance analysis (spec §23, §51, §63 Module 18).
 *
 * §51's workflow, this module's half of it: Analytics → Performance
 * Analysis → Save Report. "AI Strategy" and "Notify Team" belong to Module
 * 19, which reads what gets saved here.
 */
export const WEEKLY_ANALYSIS_WORKFLOW = "09_weekly_performance_analysis";

/** §23's report shows best/weak posts; three of each is enough to read at a glance. */
const RANKED_POST_COUNT = 3;

export interface WeekWindow {
  /** YYYY-MM-DD — also the report's document id. */
  id: string;
  startInstant: Date;
  endInstant: Date;
  timeZone: string;
}

/**
 * The last 7 complete calendar days in `timeZone`, ending at the start of
 * today.
 *
 * Not the calendar week (Mon–Sun): §23 says "at the end of every week" but
 * fixes no start-of-week convention, and a trailing 7-day window is correct
 * regardless of which day the trigger actually runs on — a Tuesday run and a
 * Monday run both cover exactly the 7 days that just finished, never a
 * partial "today" whose analytics have not settled yet.
 */
export function currentWeekWindow(now: Date, timeZone: string): WeekWindow {
  const today = dateInTimeZone(now, timeZone);
  const endInstant = startOfDayInTimeZone(today, timeZone);
  const startDate = addDays(today, -7);
  const startInstant = startOfDayInTimeZone(startDate, timeZone);

  return { id: startDate, startInstant, endInstant, timeZone };
}

/** A post's `engagement` metric, or null when Module 17 could not measure it. */
function measuredEngagement(record: AnalyticsRecord | null): number | null {
  const value = record?.metrics.engagement;

  return typeof value === "number" ? value : null;
}

function formatGroups(groups: ComparisonGroup[], keyLabel: string): string {
  if (groups.length === 0) return `${keyLabel}: no measured posts.`;

  return groups
    .map(
      (group) =>
        `${group.key}: ${group.postsAnalyzed} post(s), average engagement ${group.averageEngagement.toFixed(1)}`,
    )
    .join("\n");
}

const NARRATIVE_SYSTEM_PROMPT = `You write the "what happened" section of a weekly social media performance report.

You are given comparison numbers already computed from real, measured
analytics — never raw posts. Write:

- engagementPatterns: a short paragraph (2-4 sentences) describing what the
  numbers show — which platforms, topics or formats performed better or
  worse, and by how much.
- recommendedChanges: up to six short, specific, evidence-based suggestions
  for next week, each one traceable to a number you were given.

Use only the numbers in the prompt. Never invent a metric, a post, a topic or
a platform that is not named there. If the data is too thin to support a
claim, say less rather than guess.`;

async function narrate(
  provider: AIProvider,
  report: Pick<
    WeeklyReport,
    | "postsAnalyzed"
    | "postsExcluded"
    | "platformComparison"
    | "topicComparison"
    | "formatComparison"
    | "bestPosts"
    | "weakPosts"
  >,
): Promise<PerformanceNarrative> {
  const prompt = [
    `Posts analyzed: ${report.postsAnalyzed}. Posts excluded (no measurable analytics): ${report.postsExcluded}.`,
    "",
    "Platform comparison:",
    formatGroups(report.platformComparison, "Platforms"),
    "",
    "Topic comparison:",
    formatGroups(report.topicComparison, "Topics"),
    "",
    "Format comparison:",
    formatGroups(report.formatComparison, "Formats"),
    "",
    "Best posts:",
    report.bestPosts.map((post) => `${post.platform} "${post.sourceTitle}": ${post.engagement}`).join("\n") ||
      "(none)",
    "",
    "Weakest posts:",
    report.weakPosts.map((post) => `${post.platform} "${post.sourceTitle}": ${post.engagement}`).join("\n") ||
      "(none)",
  ].join("\n");

  const result = await provider.complete({
    system: NARRATIVE_SYSTEM_PROMPT,
    prompt,
    schema: PERFORMANCE_NARRATIVE_JSON_SCHEMA,
    schemaName: PERFORMANCE_NARRATIVE_SCHEMA_NAME,
    maxOutputTokens: 800,
  });

  const parsed = performanceNarrativeSchema.safeParse(result.data);

  if (!parsed.success) {
    throw new Error(`Weekly narrative failed validation: ${parsed.error.issues[0]?.message}`);
  }

  return parsed.data;
}

export interface WeeklyAnalysisOutcome {
  reportId: string;
  postsAnalyzed: number;
  postsExcluded: number;
  narrativeMode: "REAL" | "MOCK" | null;
}

/**
 * Run the weekly performance analysis and save its report.
 *
 * Every published post in the window is looked up once — content item for
 * its title and story, news item for its topic, analytics for its
 * engagement — then handed to the pure functions in `compare.ts`. The AI
 * call happens once, over the finished comparison, and only if there is
 * anything measured to narrate (§67).
 */
export async function runWeeklyAnalysis(now: Date = new Date()): Promise<WeeklyAnalysisOutcome> {
  const timeZone = getServerEnv().APP_TIMEZONE;
  const window = currentWeekWindow(now, timeZone);

  const posts = await listPublishedPostsBetween(
    window.startInstant.toISOString(),
    window.endInstant.toISOString(),
  );

  const contentItems = await getContentItemsByIds(posts.map((post) => post.contentItemId));
  const contentItemById = new Map(contentItems.map((item) => [item.id, item]));

  const newsItemIds = [...new Set(contentItems.map((item) => item.sourceNewsItemId))];
  const newsItems = await Promise.all(newsItemIds.map((id) => getNewsItem(id)));
  const topicById = new Map(
    newsItems
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => [item.id, item.category.trim() || "(uncategorized)"]),
  );

  const analyzable: AnalyzablePost[] = [];

  for (const post of posts) {
    // §53's invariant, same as Module 17's sync: PUBLISHED implies both.
    if (!post.providerPostId) continue;

    const contentItem = contentItemById.get(post.contentItemId);
    const analytics = await getPostAnalytics(post.id);

    analyzable.push({
      platformPostId: post.id,
      platform: post.platform,
      providerPostId: post.providerPostId,
      permalink: post.permalink,
      sourceTitle: contentItem?.sourceTitle ?? "(untitled)",
      topic: contentItem ? (topicById.get(contentItem.sourceNewsItemId) ?? "(uncategorized)") : "(uncategorized)",
      format: post.visual.template,
      engagement: measuredEngagement(analytics),
    });
  }

  const measured = analyzable.filter((post) => post.engagement !== null);

  const platformComparison = compareBy(analyzable, (post) => post.platform);
  const topicComparison = compareBy(analyzable, (post) => post.topic);
  const formatComparison = compareBy(analyzable, (post) => post.format);

  const reportBase = {
    postsAnalyzed: measured.length,
    postsExcluded: analyzable.length - measured.length,
    platformComparison,
    topicComparison,
    formatComparison,
    bestPosts: bestPosts(analyzable, RANKED_POST_COUNT),
    weakPosts: weakPosts(analyzable, RANKED_POST_COUNT),
  };

  let narrative: PerformanceNarrative | null = null;
  let narrativeMode: "REAL" | "MOCK" | null = null;

  if (measured.length > 0) {
    const provider = getAIProvider();

    try {
      narrative = await narrate(provider, reportBase);
      narrativeMode = provider.mode;
    } catch (error) {
      // §52: the numbers are still real and worth saving even if the AI
      // step fails. A missing narrative is visible on the report; fake
      // prose would not be (§67).
      logger.error("Weekly narrative generation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report: WeeklyReport = {
    windowStart: window.startInstant.toISOString(),
    windowEnd: window.endInstant.toISOString(),
    timeZone,
    ...reportBase,
    bestPlatform: bestOf(platformComparison),
    weakestPlatform: weakestOf(platformComparison),
    bestTopic: bestOf(topicComparison),
    weakTopic: weakestOf(topicComparison),
    bestFormat: (bestOf(formatComparison) as WeeklyReport["bestFormat"]) ?? null,
    narrative,
    narrativeMode,
    generatedAt: now.toISOString(),
  };

  await saveWeeklyReport(window.id, report);

  await recordAudit({
    actor: "system:reporting",
    action: "WEEKLY_REPORT_GENERATED",
    resource: `weeklyReports/${window.id}`,
    status: "SUCCESS",
    metadata: {
      postsAnalyzed: reportBase.postsAnalyzed,
      postsExcluded: reportBase.postsExcluded,
      narrativeMode,
    },
  });

  logger.info("Weekly performance analysis finished", {
    reportId: window.id,
    postsAnalyzed: reportBase.postsAnalyzed,
    postsExcluded: reportBase.postsExcluded,
  });

  return {
    reportId: window.id,
    postsAnalyzed: reportBase.postsAnalyzed,
    postsExcluded: reportBase.postsExcluded,
    narrativeMode,
  };
}
