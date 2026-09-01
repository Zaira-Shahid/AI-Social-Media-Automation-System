import type { RankedItem } from "@/lib/news/ranking-schema";

/**
 * The parts of scoring that are arithmetic, not judgement (spec §7).
 *
 * §7 lists eight factors. Two of them — recency and source quality — are
 * already known to the code: one is a subtraction against `publishedAt`, the
 * other is the priority a person set on the source. Asking a model for either
 * would add a way to be wrong without adding anything.
 *
 * Pure and side-effect free, so the weighting can be tested directly rather
 * than inferred from a live ranking run.
 */

/**
 * Stories older than this are rejected outright (§7: "very old stories").
 *
 * Seven days, because the daily workflow (§3) is meant to surface current
 * news; anything a week old has either been covered already or was not worth
 * covering.
 */
export const MAX_STORY_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInHours(publishedAt: string, now: number): number {
  return Math.max(0, (now - new Date(publishedAt).getTime()) / (60 * 60 * 1000));
}

export function isTooOld(publishedAt: string, now: number): boolean {
  return now - new Date(publishedAt).getTime() > MAX_STORY_AGE_DAYS * DAY_MS;
}

/**
 * Recency, 0–100.
 *
 * Linear decay across the acceptable window rather than a steep curve: a
 * twelve-hour-old story and a two-hour-old story are both "today", and a
 * sharper curve would let raw speed outrank a better story.
 */
export function recencyScore(publishedAt: string, now: number): number {
  const hours = ageInHours(publishedAt, now);
  const maxHours = MAX_STORY_AGE_DAYS * 24;

  if (hours >= maxHours) return 0;

  return Math.round(100 * (1 - hours / maxHours));
}

/**
 * Source quality from the priority a person configured, 0–100.
 *
 * Priority 1 is highest (§5's source management). This is editorial judgement
 * that has already been made; re-deriving it from the model would ignore it.
 */
export function sourceQualityScore(priority: number): number {
  const clamped = Math.min(5, Math.max(1, Math.round(priority)));
  return Math.round(100 - (clamped - 1) * 20);
}

/**
 * Weights across §7's eight factors.
 *
 * Relevance and AI relevance dominate because §4 is explicit that this system
 * exists to surface AI and AI-automation stories — a highly credible, very
 * recent story about something else is not what anyone asked for. They sum to
 * 1 so the composite stays on the same 0–100 scale as its parts.
 */
export const SCORE_WEIGHTS = {
  relevance: 0.22,
  aiRelevance: 0.22,
  businessImportance: 0.14,
  socialPotential: 0.12,
  credibility: 0.1,
  novelty: 0.08,
  recency: 0.07,
  sourceQuality: 0.05,
} as const;

export interface CompositeInput {
  ai: Pick<
    RankedItem,
    | "relevance"
    | "credibility"
    | "businessImportance"
    | "aiRelevance"
    | "socialPotential"
    | "novelty"
  >;
  recency: number;
  sourceQuality: number;
}

/** The single number the shortlist is ordered by. */
export function compositeScore({ ai, recency, sourceQuality }: CompositeInput): number {
  const total =
    ai.relevance * SCORE_WEIGHTS.relevance +
    ai.aiRelevance * SCORE_WEIGHTS.aiRelevance +
    ai.businessImportance * SCORE_WEIGHTS.businessImportance +
    ai.socialPotential * SCORE_WEIGHTS.socialPotential +
    ai.credibility * SCORE_WEIGHTS.credibility +
    ai.novelty * SCORE_WEIGHTS.novelty +
    recency * SCORE_WEIGHTS.recency +
    sourceQuality * SCORE_WEIGHTS.sourceQuality;

  return Math.round(total);
}

/**
 * The shortlist §8 asks for: 5–10 stories.
 *
 * The AI does not choose the final three. §8 is explicit that a human does,
 * and this module has no business narrowing further than the shortlist.
 */
export const SHORTLIST_MIN = 5;
export const SHORTLIST_MAX = 10;

/**
 * Below this composite score a story is not shortlisted even to reach the
 * minimum of five. A thin shortlist of real candidates is more useful than
 * one padded to five with stories nobody would pick — and §67 forbids
 * presenting a filled quota as a real result.
 */
export const SHORTLIST_SCORE_FLOOR = 45;
