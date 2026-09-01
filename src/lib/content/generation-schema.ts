import { z } from "zod";

import { MAX_HASHTAGS, PLATFORMS, VISUAL_TEMPLATES } from "@/lib/content/schema";

/**
 * The structured shapes the model must return (spec §12, §13, §30, §31).
 *
 * Two contracts, because §12 and §30 describe two steps: generate the core
 * message, then adapt it per platform. Each is expressed twice — a JSON Schema
 * for the provider's constrained decoding and a Zod schema for what comes
 * back — and both live here so they cannot drift.
 *
 * The Zod pass is not redundant (§31). A provider that claims to enforce a
 * schema and one that actually does are not reliably the same provider.
 */

// --- Step 1: the core message ------------------------------------------------

export const coreResponseSchema = z.object({
  headline: z.string().min(1).max(200),
  keyTakeaway: z.string().min(1).max(300),
  body: z.string().min(1).max(1_500),
  sourceReference: z.string().min(1).max(200),
  angle: z.string().max(300),
});

export type CoreResponse = z.infer<typeof coreResponseSchema>;

export const CORE_SCHEMA_NAME = "content_core_message";

export const CORE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "keyTakeaway", "body", "sourceReference", "angle"],
  properties: {
    headline: { type: "string" },
    keyTakeaway: { type: "string" },
    body: { type: "string" },
    sourceReference: { type: "string" },
    angle: { type: "string" },
  },
};

// --- Step 2: the platform versions -------------------------------------------

const visualSchema = z.object({
  template: z.enum(VISUAL_TEMPLATES),
  headline: z.string().min(1).max(120),
  supportingText: z.string().max(200),
  emphasis: z.enum(["PRIMARY", "SECONDARY", "ACCENT"]),
});

export const platformVersionSchema = z.object({
  platform: z.enum(PLATFORMS),
  caption: z.string().min(1).max(3_000),
  /*
   * Hashtags arrive without the leading '#'. Models are inconsistent about it,
   * and normalizing on the way in is cheaper than every consumer stripping it.
   */
  hashtags: z.array(z.string().min(1).max(60)).max(MAX_HASHTAGS),
  cta: z.string().max(200),
  visual: visualSchema,
});

export type PlatformVersion = z.infer<typeof platformVersionSchema>;

export const adaptationResponseSchema = z.object({
  versions: z.array(platformVersionSchema),
});

export type AdaptationResponse = z.infer<typeof adaptationResponseSchema>;

/**
 * The envelope, with entries left unparsed.
 *
 * Entries are validated one at a time rather than as an array, so a single bad
 * entry cannot discard the good ones alongside it. A model that adds a fourth
 * platform nobody asked for should cost us that entry, not the three versions
 * it got right — and constrained decoding is supposed to prevent this anyway,
 * which is exactly why the fallback should be cheap rather than catastrophic.
 *
 * `adaptationResponseSchema` above remains the strict statement of the
 * contract, and is what the tests hold the mock provider to.
 */
export const adaptationEnvelopeSchema = z.object({ versions: z.array(z.unknown()) });

export const ADAPTATION_SCHEMA_NAME = "content_platform_versions";

/**
 * Written out rather than generated from Zod.
 *
 * Strict mode requires every property to appear in `required` and every object
 * to close `additionalProperties`, which a generic converter does not reliably
 * produce — and a schema the provider silently rejects is worse than a verbose
 * one.
 */
export const ADAPTATION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["versions"],
  properties: {
    versions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["platform", "caption", "hashtags", "cta", "visual"],
        properties: {
          platform: { type: "string", enum: [...PLATFORMS] },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          cta: { type: "string" },
          visual: {
            type: "object",
            additionalProperties: false,
            required: ["template", "headline", "supportingText", "emphasis"],
            properties: {
              template: { type: "string", enum: [...VISUAL_TEMPLATES] },
              headline: { type: "string" },
              supportingText: { type: "string" },
              emphasis: { type: "string", enum: ["PRIMARY", "SECONDARY", "ACCENT"] },
            },
          },
        },
      },
    },
  },
};
