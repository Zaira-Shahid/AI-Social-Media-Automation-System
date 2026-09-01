import "server-only";

import { getAIProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import { GROQ_FREE_TIER } from "@/lib/ai/groq";
import { getBrandProfile } from "@/lib/brand/store";
import { logger } from "@/lib/logger";
import {
  RANKING_JSON_SCHEMA,
  RANKING_SCHEMA_NAME,
  rankingResponseSchema,
  type RankedItem,
} from "@/lib/news/ranking-schema";
import type { AutomationRun } from "@/lib/news/schema";
import {
  compositeScore,
  isTooOld,
  recencyScore,
  sourceQualityScore,
  SHORTLIST_MAX,
  SHORTLIST_SCORE_FLOOR,
} from "@/lib/news/scoring";
import {
  listItemsForRanking,
  listSources,
  recordAutomationRun,
  saveRanking,
  type StoredNewsItem,
} from "@/lib/news/store";

/**
 * News ranking and shortlist generation (spec §7, §8, §45).
 *
 * The AI scores the judgement factors; the code computes the arithmetic ones,
 * collapses duplicates, and decides the shortlist. §8 is explicit that the AI
 * does not choose the final three — a human does — so this stops at the
 * shortlist and never narrows further.
 */
export const NEWS_RANKING_WORKFLOW = "02_news_ranking";

/**
 * How many stories one request covers.
 *
 * Groq's free plan allows 8,000 tokens a minute (§29's constraint, verified
 * against their published limits). Eight stories of title-plus-summary fits
 * inside that with room for the response, and a batch that overruns is
 * rejected wholesale rather than degrading.
 */
const BATCH_SIZE = 8;

/**
 * Upper bound on a run.
 *
 * 1,000 requests a day sounds generous until a backlog arrives; capping the
 * run keeps one bad day from spending the quota that tomorrow's news needs.
 */
export const MAX_ITEMS_PER_RUN = 40;

const SYSTEM_PROMPT = `You score news stories for an internal social media team.

The team publishes about artificial intelligence: AI automation, AI agents, AI
replacing or reducing jobs, major AI business developments and product
launches, and AI transforming industries.

Score each story from 0 to 100 on each factor. Be strict: most stories are not
worth publishing about.

- relevance: how well it matches the topics above
- credibility: how well supported the claims are, given the source
- businessImportance: whether this changes decisions for real companies
- aiRelevance: how central AI is to the story, not merely mentioned
- socialPotential: whether it would earn engagement as a static post
- novelty: whether this is new, or a rehash of something already covered

whyItMatters: one sentence a human reads to decide whether to pick this story.
Say what changed and who it affects. Do not restate the headline.

rejectionReason: NONE unless the story is unusable. Use IRRELEVANT for
off-topic stories, SPAM for promotional filler, UNSUPPORTED_CLAIMS for claims
with no evidence, LOW_QUALITY_SOURCE for unreliable outlets.

Score only the stories given. Never invent a story, a source or a fact that is
not in the input. Return one entry per input ID, using the ID exactly.`;

function buildPrompt(items: StoredNewsItem[], preferredTopics: string[], avoidTopics: string[]) {
  const guidance = [
    preferredTopics.length > 0
      ? `Topics this team prioritises: ${preferredTopics.join(", ")}.`
      : "",
    avoidTopics.length > 0
      ? `Topics this team avoids — score these low on relevance: ${avoidTopics.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  /*
   * `ID:` at the start of a line is load-bearing: it is how each score is tied
   * back to a document, and how the mock provider recognises the batch.
   * Summaries are truncated because the token budget is the binding limit and
   * a headline plus two sentences is enough to judge relevance.
   */
  const stories = items
    .map((item) =>
      [
        `ID: ${item.id}`,
        `Headline: ${item.title}`,
        `Source: ${item.sourceName}`,
        `Published: ${item.publishedAt}`,
        `Summary: ${item.summary.slice(0, 400) || "(none provided)"}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [guidance, "Score these stories:", stories].filter(Boolean).join("\n\n");
}

/** Pause between batches so a run stays inside the free plan's per-minute limits. */
async function pace(): Promise<void> {
  const delay = Math.ceil(60_000 / GROQ_FREE_TIER.requestsPerMinute);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export interface RankingOutcome {
  run: AutomationRun;
  shortlisted: number;
  rejected: number;
  mode: "REAL" | "MOCK";
}

/**
 * Score one batch.
 *
 * Returns a map keyed by document id. A model that returns an id nobody asked
 * about is ignored rather than trusted — §65's rule against invented data
 * applies to the model's output as much as to anything else.
 */
async function scoreBatch(
  provider: AIProvider,
  items: StoredNewsItem[],
  preferredTopics: string[],
  avoidTopics: string[],
): Promise<Map<string, RankedItem>> {
  const result = await provider.complete({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(items, preferredTopics, avoidTopics),
    schema: RANKING_JSON_SCHEMA,
    schemaName: RANKING_SCHEMA_NAME,
    maxOutputTokens: 4_000,
  });

  // §31: validate before anything reaches the database.
  const parsed = rankingResponseSchema.safeParse(result.data);

  if (!parsed.success) {
    throw new Error(`AI ranking output failed validation: ${parsed.error.issues[0]?.message}`);
  }

  const known = new Set(items.map((item) => item.id));
  const scores = new Map<string, RankedItem>();

  for (const scored of parsed.data.items) {
    if (!known.has(scored.id)) {
      logger.warn("AI returned a score for an unknown story id; ignoring", { id: scored.id });
      continue;
    }

    scores.set(scored.id, scored);
  }

  return scores;
}

/**
 * Rank the discovered backlog and produce a shortlist.
 *
 * Never partially writes a nonsense state: an item the model did not score
 * stays DISCOVERED and is picked up by the next run, rather than being stored
 * with zeroes.
 */
export async function runNewsRanking(trigger: "WEBHOOK" | "MANUAL"): Promise<RankingOutcome> {
  const startedAt = new Date().toISOString();
  const now = Date.now();

  const provider = getAIProvider();
  const [{ brand }, sources, backlog] = await Promise.all([
    getBrandProfile(),
    listSources(),
    listItemsForRanking(MAX_ITEMS_PER_RUN),
  ]);

  const priorityBySource = new Map(sources.map((source) => [source.id, source.priority]));

  /*
   * Age is decided here, not by the model. It is a subtraction, it costs no
   * tokens, and rejecting stale stories first means the quota is spent on
   * stories that could actually be published (§7).
   */
  const tooOld = backlog.filter((item) => isTooOld(item.publishedAt, now));
  const candidates = backlog.filter((item) => !isTooOld(item.publishedAt, now));

  for (const item of tooOld) {
    await saveRanking(item.id, {
      status: "REJECTED",
      relevanceScore: 0,
      credibilityScore: 0,
      socialPotentialScore: 0,
      compositeScore: 0,
      aiAnalysis: {
        mode: provider.mode,
        provider: provider.name,
        rejectionReason: "TOO_OLD",
        whyItMatters: "Rejected before scoring: older than the acceptable window.",
        scoredByAI: false,
      },
    });
  }

  const scored: {
    item: StoredNewsItem;
    ai: RankedItem;
    composite: number;
    recency: number;
    sourceQuality: number;
  }[] = [];

  let failedBatches = 0;

  for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
    const batch = candidates.slice(index, index + BATCH_SIZE);

    try {
      const scores = await scoreBatch(provider, batch, brand.preferredTopics, brand.topicsToAvoid);

      for (const item of batch) {
        const ai = scores.get(item.id);
        // Unscored items stay DISCOVERED for the next run.
        if (!ai) continue;

        const recency = recencyScore(item.publishedAt, now);
        const sourceQuality = sourceQualityScore(priorityBySource.get(item.sourceId) ?? 3);

        scored.push({
          item,
          ai,
          recency,
          sourceQuality,
          composite: compositeScore({ ai, recency, sourceQuality }),
        });
      }
    } catch (error) {
      failedBatches += 1;
      logger.error("Ranking batch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (index + BATCH_SIZE < candidates.length) await pace();
  }

  /*
   * Duplicate collapse (§7).
   *
   * Module 03 grouped identical headlines; the decision of which copy to keep
   * belongs here, because it needs the scores. The best-scoring copy survives
   * and the rest are rejected — not deleted, so the audit trail of what was
   * discovered stays intact.
   */
  const bestByGroup = new Map<string, (typeof scored)[number]>();
  const duplicates: typeof scored = [];

  for (const entry of scored.sort((a, b) => b.composite - a.composite)) {
    const existing = bestByGroup.get(entry.item.duplicateGroup);

    if (existing) duplicates.push(entry);
    else bestByGroup.set(entry.item.duplicateGroup, entry);
  }

  const survivors = [...bestByGroup.values()].sort((a, b) => b.composite - a.composite);

  /*
   * The shortlist (§8): 5–10 stories, and no further.
   *
   * The floor is applied before the cap, so a thin day produces a short
   * shortlist rather than one padded with stories nobody would pick. §67:
   * a filled quota is not a real result.
   */
  const shortlist = survivors
    .filter(
      (entry) => entry.ai.rejectionReason === "NONE" && entry.composite >= SHORTLIST_SCORE_FLOOR,
    )
    .slice(0, SHORTLIST_MAX);

  const shortlistIds = new Set(shortlist.map((entry) => entry.item.id));

  for (const entry of [...survivors, ...duplicates]) {
    const isDuplicate = duplicates.includes(entry);
    const rejected = isDuplicate || entry.ai.rejectionReason !== "NONE";

    await saveRanking(entry.item.id, {
      status: shortlistIds.has(entry.item.id) ? "SHORTLISTED" : rejected ? "REJECTED" : "RANKED",
      relevanceScore: entry.ai.relevance,
      credibilityScore: entry.ai.credibility,
      socialPotentialScore: entry.ai.socialPotential,
      compositeScore: entry.composite,
      aiAnalysis: {
        // §21/§66: the mode is stored, not just displayed, so a simulated
        // score can never later be mistaken for a real one.
        mode: provider.mode,
        provider: provider.name,
        model: provider.model,
        scoredByAI: true,
        whyItMatters: entry.ai.whyItMatters,
        rejectionReason: isDuplicate ? "DUPLICATE" : entry.ai.rejectionReason,
        factors: {
          relevance: entry.ai.relevance,
          credibility: entry.ai.credibility,
          businessImportance: entry.ai.businessImportance,
          aiRelevance: entry.ai.aiRelevance,
          socialPotential: entry.ai.socialPotential,
          novelty: entry.ai.novelty,
          recency: entry.recency,
          sourceQuality: entry.sourceQuality,
        },
      },
    });
  }

  const rejectedCount =
    tooOld.length +
    duplicates.length +
    survivors.filter((e) => e.ai.rejectionReason !== "NONE").length;

  const run: AutomationRun = {
    workflow: NEWS_RANKING_WORKFLOW,
    status: failedBatches === 0 ? "SUCCESS" : scored.length > 0 ? "PARTIAL" : "FAILURE",
    startedAt,
    finishedAt: new Date().toISOString(),
    sourcesAttempted: candidates.length,
    sourcesFailed: failedBatches,
    itemsDiscovered: backlog.length,
    itemsNew: shortlist.length,
    error: failedBatches > 0 ? `${failedBatches} ranking batch(es) failed` : null,
    trigger,
  };

  await recordAutomationRun(run);

  logger.info("News ranking run finished", {
    mode: provider.mode,
    considered: backlog.length,
    shortlisted: shortlist.length,
    rejected: rejectedCount,
  });

  return { run, shortlisted: shortlist.length, rejected: rejectedCount, mode: provider.mode };
}
