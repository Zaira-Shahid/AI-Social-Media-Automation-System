import { z } from "zod";

/**
 * The structured shape the model must return (spec §7, §31).
 *
 * Two representations of one contract: a JSON Schema handed to the provider
 * for constrained decoding, and a Zod schema that validates what comes back.
 * Both are kept here so they cannot drift.
 *
 * The Zod pass is not redundant. §31's pattern is AI → structured output →
 * Zod → business rules → database, and a provider that claims to enforce a
 * schema and one that actually does are not reliably the same provider.
 */

/** §7's rejection reasons, plus NONE. The model picks one; code enforces some itself. */
export const REJECTION_REASONS = [
  "NONE",
  "DUPLICATE",
  "TOO_OLD",
  "LOW_QUALITY_SOURCE",
  "IRRELEVANT",
  "SPAM",
  "UNSUPPORTED_CLAIMS",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

const score = z.number().min(0).max(100);

export const rankedItemSchema = z.object({
  id: z.string().min(1),

  /*
   * The judgement calls. Recency and source quality are deliberately absent:
   * both are arithmetic the code already knows (age from `publishedAt`, quality
   * from the source's configured priority), and asking a model to compute what
   * a subtraction can compute invites it to be wrong for no benefit.
   */
  relevance: score,
  credibility: score,
  businessImportance: score,
  aiRelevance: score,
  socialPotential: score,
  novelty: score,

  /** §8 requires the shortlist to show a human why each story matters. */
  whyItMatters: z.string().min(1).max(400),

  rejectionReason: z.enum(REJECTION_REASONS),
});

export type RankedItem = z.infer<typeof rankedItemSchema>;

export const rankingResponseSchema = z.object({
  items: z.array(rankedItemSchema),
});

export type RankingResponse = z.infer<typeof rankingResponseSchema>;

/**
 * The JSON Schema sent to the provider.
 *
 * Written out rather than generated from the Zod schema. Strict mode has
 * requirements a generic converter does not reliably produce — every property
 * listed in `required`, every object closed with `additionalProperties: false`
 * — and a schema the provider silently rejects is worse than a verbose one.
 */
export const RANKING_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "relevance",
          "credibility",
          "businessImportance",
          "aiRelevance",
          "socialPotential",
          "novelty",
          "whyItMatters",
          "rejectionReason",
        ],
        properties: {
          id: { type: "string" },
          relevance: { type: "integer", minimum: 0, maximum: 100 },
          credibility: { type: "integer", minimum: 0, maximum: 100 },
          businessImportance: { type: "integer", minimum: 0, maximum: 100 },
          aiRelevance: { type: "integer", minimum: 0, maximum: 100 },
          socialPotential: { type: "integer", minimum: 0, maximum: 100 },
          novelty: { type: "integer", minimum: 0, maximum: 100 },
          whyItMatters: { type: "string" },
          rejectionReason: { type: "string", enum: [...REJECTION_REASONS] },
        },
      },
    },
  },
};

export const RANKING_SCHEMA_NAME = "news_ranking";
