import { z } from "zod";

import { strategyRecommendationSchema } from "@/lib/strategy/schema";

/**
 * The AI recommendation list's structured contract (spec §24, §25, §30, §31,
 * §63 Module 19).
 *
 * Same two-schema pattern as `content/generation-schema.ts` and
 * `reporting/generation-schema.ts`: a JSON Schema for constrained decoding,
 * a Zod schema for what actually has to come back and be stored (§31).
 */
export const strategyRecommendationsResponseSchema = z.object({
  recommendations: z.array(strategyRecommendationSchema),
});

export type StrategyRecommendationsResponse = z.infer<typeof strategyRecommendationsResponseSchema>;

/**
 * The envelope, with entries left unparsed.
 *
 * Same reasoning as `content/generation-schema.ts`'s
 * `adaptationEnvelopeSchema`: entries are validated one at a time in
 * `optimize.ts` so one malformed recommendation (an invented `category`, for
 * one) cannot discard the others alongside it.
 */
export const strategyRecommendationsEnvelopeSchema = z.object({
  recommendations: z.array(z.unknown()),
});

export const STRATEGY_RECOMMENDATIONS_SCHEMA_NAME = "strategy_recommendations";

export const STRATEGY_RECOMMENDATIONS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["recommendations"],
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "recommendation", "reason"],
        properties: {
          category: { type: "string" },
          recommendation: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};
