import { performanceNarrativeSchema } from "@/lib/reporting/schema";

/**
 * The AI narrative's structured contract (spec §23, §30, §31, §63 Module 18).
 *
 * Same two-schema pattern as `content/generation-schema.ts`: a JSON Schema
 * for the provider's constrained decoding, and the Zod schema
 * (`performanceNarrativeSchema`, in `schema.ts` since it is also what gets
 * stored) for what actually has to come back. §31 requires both regardless of
 * what a provider claims to enforce.
 */
export { performanceNarrativeSchema };

export const PERFORMANCE_NARRATIVE_SCHEMA_NAME = "weekly_performance_narrative";

export const PERFORMANCE_NARRATIVE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["engagementPatterns", "recommendedChanges"],
  properties: {
    engagementPatterns: { type: "string" },
    recommendedChanges: { type: "array", items: { type: "string" } },
  },
};
