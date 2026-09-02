import "server-only";

import { getAIProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import { recordAudit } from "@/lib/audit";
import { NO_SOURCE_METRICS } from "@/lib/automation/schema";
import { recordAutomationRun } from "@/lib/automation/store";
import { logger } from "@/lib/logger";
import { listRecentWeeklyReports, type StoredWeeklyReport } from "@/lib/reporting/store";
import { aggregateWeighting } from "@/lib/strategy/compute";
import {
  STRATEGY_RECOMMENDATIONS_JSON_SCHEMA,
  STRATEGY_RECOMMENDATIONS_SCHEMA_NAME,
  strategyRecommendationsEnvelopeSchema,
} from "@/lib/strategy/generation-schema";
import { getCurrentStrategy, saveStrategyReport } from "@/lib/strategy/store";
import {
  strategyRecommendationSchema,
  type StrategyRecommendation,
  type StrategyReport,
  type WeightedGroup,
} from "@/lib/strategy/schema";

/**
 * AI strategy optimization (spec §24, §25, §51, §63 Module 19).
 *
 * §51's workflow, this module's half: AI Strategy → Save Report. §24 is
 * explicit that the strategy itself may change automatically — unlike a
 * post, there is no approval gate on a recommendation — so this runs and
 * saves without anyone confirming it, and the version history is what makes
 * that safe to trust: nothing here overwrites a previous version, and a
 * human reviewing the Strategy screen sees exactly what changed and why.
 *
 * §24 also fixes what this module is not allowed to touch: the brand
 * profile (§11 keeps that human-owned) and Module 06's fixed "exactly three
 * stories a day" rule (§8). Every recommendation here is data for a human to
 * read, never a write to either.
 */
export const STRATEGY_OPTIMIZATION_WORKFLOW = "10_strategy_optimization";

/** §25's own example cites "the previous 4 weeks" — the lookback this module uses. */
export const STRATEGY_LOOKBACK_WEEKS = 4;

function formatWeights(groups: WeightedGroup[], label: string): string {
  if (groups.length === 0) return `${label}: no measured data.`;

  return groups
    .map(
      (group) =>
        `${group.key}: ${group.weight}% of measured engagement (${group.postsAnalyzed} post(s))`,
    )
    .join("\n");
}

const RECOMMENDATIONS_SYSTEM_PROMPT = `You write strategy recommendations for a company's social media program.

You are given weighting numbers already computed from real, measured
engagement over the last few weeks — never raw posts. For each recommendation,
pick exactly one category from this fixed list: TOPIC_WEIGHTING,
PLATFORM_WEIGHTING, POSTING_FREQUENCY, CONTENT_MIX, HEADLINE_STYLE,
CTA_STYLE, FORMAT_DISTRIBUTION, TIMING.

Write up to eight recommendations. Each one needs:
- recommendation: a short, specific, actionable suggestion for next week.
- reason: why, citing a number from what you were given.

Use only the numbers in the prompt. Never invent a topic, a platform, a
format or a metric that is not named there. If the data is too thin to
support a recommendation in some category, skip that category rather than
guess. FORMAT_DISTRIBUTION is the closest data this system stores to
"educational vs. promotional" content — EDUCATIONAL_CARD is the educational
format; the other three formats are the more promotional/informational ones.`;

async function recommend(
  provider: AIProvider,
  input: {
    postsAnalyzed: number;
    weeksAnalyzed: number;
    topicWeighting: WeightedGroup[];
    platformWeighting: WeightedGroup[];
    formatWeighting: WeightedGroup[];
  },
): Promise<StrategyRecommendation[]> {
  const prompt = [
    `Weeks analyzed: ${input.weeksAnalyzed}. Total measured posts: ${input.postsAnalyzed}.`,
    "",
    "Topic weighting:",
    formatWeights(input.topicWeighting, "Topics"),
    "",
    "Platform weighting:",
    formatWeights(input.platformWeighting, "Platforms"),
    "",
    "Format weighting:",
    formatWeights(input.formatWeighting, "Formats"),
  ].join("\n");

  const result = await provider.complete({
    system: RECOMMENDATIONS_SYSTEM_PROMPT,
    prompt,
    schema: STRATEGY_RECOMMENDATIONS_JSON_SCHEMA,
    schemaName: STRATEGY_RECOMMENDATIONS_SCHEMA_NAME,
    maxOutputTokens: 1_500,
  });

  const envelope = strategyRecommendationsEnvelopeSchema.safeParse(result.data);

  if (!envelope.success) {
    throw new Error(
      `Strategy recommendations failed validation: ${envelope.error.issues[0]?.message}`,
    );
  }

  const recommendations: StrategyRecommendation[] = [];

  for (const raw of envelope.data.recommendations) {
    // §31: one malformed entry — an invented category, for one — is dropped
    // rather than failing the whole run.
    const parsed = strategyRecommendationSchema.safeParse(raw);

    if (!parsed.success) {
      logger.warn("Discarding a malformed strategy recommendation", {
        reason: parsed.error.issues[0]?.message,
      });
      continue;
    }

    recommendations.push(parsed.data);
  }

  return recommendations;
}

export interface StrategyOptimizationOutcome {
  reportId: string;
  version: number;
  weeksAnalyzed: number;
  postsAnalyzed: number;
  mode: "REAL" | "MOCK" | null;
}

/**
 * Run strategy optimization over the last `STRATEGY_LOOKBACK_WEEKS` weekly
 * reports and save the next version.
 *
 * Wrapped so both the normal result and an unexpected throw each record
 * exactly one automation run (§41, §63 Module 20).
 */
export async function runStrategyOptimization(
  actor: string,
  now: Date = new Date(),
): Promise<StrategyOptimizationOutcome> {
  const startedAt = now.toISOString();
  // Same convention as `content/generate.ts`: the webhook passes
  // "system:strategy"; a person's own uid means the manual "Regenerate now" button.
  const trigger: "WEBHOOK" | "MANUAL" = actor === "system:strategy" ? "WEBHOOK" : "MANUAL";

  try {
    const outcome = await runStrategyOptimizationInner(actor, now);

    await recordAutomationRun({
      workflow: STRATEGY_OPTIMIZATION_WORKFLOW,
      status: "SUCCESS",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...NO_SOURCE_METRICS,
      error: null,
      trigger,
      metrics: {
        version: outcome.version,
        weeksAnalyzed: outcome.weeksAnalyzed,
        postsAnalyzed: outcome.postsAnalyzed,
      },
    });

    return outcome;
  } catch (error) {
    await recordAutomationRun({
      workflow: STRATEGY_OPTIMIZATION_WORKFLOW,
      status: "FAILURE",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...NO_SOURCE_METRICS,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      trigger,
      metrics: {},
    });

    throw error;
  }
}

async function runStrategyOptimizationInner(
  actor: string,
  now: Date,
): Promise<StrategyOptimizationOutcome> {
  const weeks: StoredWeeklyReport[] = await listRecentWeeklyReports(STRATEGY_LOOKBACK_WEEKS);

  const postsAnalyzed = weeks.reduce((sum, week) => sum + week.postsAnalyzed, 0);

  const topicWeighting = aggregateWeighting(weeks.map((week) => week.topicComparison));
  const platformWeighting = aggregateWeighting(weeks.map((week) => week.platformComparison));
  const formatWeighting = aggregateWeighting(weeks.map((week) => week.formatComparison));

  let recommendations: StrategyRecommendation[] | null = null;
  let mode: "REAL" | "MOCK" | null = null;

  if (postsAnalyzed > 0) {
    const provider = getAIProvider();

    try {
      recommendations = await recommend(provider, {
        postsAnalyzed,
        weeksAnalyzed: weeks.length,
        topicWeighting,
        platformWeighting,
        formatWeighting,
      });
      mode = provider.mode;
    } catch (error) {
      // §52: the computed weights are still real and worth saving even if
      // the AI step fails. §67 rules out saving fabricated prose instead.
      logger.error("Strategy recommendation generation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const current = await getCurrentStrategy();
  const version = (current?.version ?? 0) + 1;

  const report: StrategyReport = {
    version,
    weeksAnalyzed: weeks.map((week) => week.id),
    postsAnalyzed,
    topicWeighting,
    platformWeighting,
    formatWeighting,
    recommendations,
    mode,
    generatedAt: now.toISOString(),
    generatedBy: actor,
  };

  const reportId = await saveStrategyReport(report);

  await recordAudit({
    actor,
    action: "STRATEGY_GENERATED",
    resource: `strategyReports/${reportId}`,
    status: "SUCCESS",
    metadata: { version, weeksAnalyzed: weeks.length, postsAnalyzed, mode },
  });

  logger.info("Strategy optimization finished", { reportId, version, postsAnalyzed });

  return { reportId, version, weeksAnalyzed: weeks.length, postsAnalyzed, mode };
}
