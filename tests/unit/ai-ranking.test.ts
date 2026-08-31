import { describe, expect, it } from "vitest";

import { MockProvider } from "@/lib/ai/mock";
import {
  RANKING_JSON_SCHEMA,
  RANKING_SCHEMA_NAME,
  rankingResponseSchema,
} from "@/lib/news/ranking-schema";

/**
 * The AI contract (spec §21, §30, §31, §58).
 *
 * Two things are worth pinning here: that the schema sent to the provider
 * satisfies strict mode's requirements, and that the mock provider is
 * deterministic and labels itself.
 */
function completionRequest(prompt: string) {
  return {
    system: "system",
    prompt,
    schema: RANKING_JSON_SCHEMA,
    schemaName: RANKING_SCHEMA_NAME,
    maxOutputTokens: 1000,
  };
}

const TWO_STORY_PROMPT = [
  "ID: story-one",
  "Headline: AI replaces support staff",
  "",
  "ID: story-two",
  "Headline: New AI agent launched",
].join("\n");

describe("RANKING_JSON_SCHEMA", () => {
  /**
   * Groq's strict mode rejects a schema that leaves any property optional or
   * any object open. Those rules are easy to break by adding one field, and
   * the failure arrives as an opaque 400 at request time.
   */
  function assertStrictModeSafe(node: unknown, path = "root"): void {
    if (typeof node !== "object" || node === null) return;

    const schema = node as Record<string, unknown>;

    if (schema.type === "object") {
      expect(schema.additionalProperties, `${path} must close additionalProperties`).toBe(false);

      const properties = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
      const required = (schema.required ?? []) as string[];

      expect([...required].sort(), `${path} must require every property`).toEqual(
        [...properties].sort(),
      );

      for (const [key, value] of Object.entries(
        (schema.properties ?? {}) as Record<string, unknown>,
      )) {
        assertStrictModeSafe(value, `${path}.${key}`);
      }
    }

    if (schema.type === "array") assertStrictModeSafe(schema.items, `${path}[]`);
  }

  it("satisfies strict mode: every property required, every object closed", () => {
    assertStrictModeSafe(RANKING_JSON_SCHEMA);
  });

  it("declares the same fields the Zod schema validates", () => {
    const items = (RANKING_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>).items;
    const itemSchema = items.items as Record<string, unknown>;
    const schemaFields = Object.keys(itemSchema.properties as Record<string, unknown>).sort();

    const zodFields = Object.keys(rankingResponseSchema.shape.items.element.shape).sort();

    expect(schemaFields).toEqual(zodFields);
  });
});

describe("rankingResponseSchema", () => {
  const VALID_ITEM = {
    id: "story-one",
    relevance: 80,
    credibility: 70,
    businessImportance: 60,
    aiRelevance: 90,
    socialPotential: 50,
    novelty: 40,
    whyItMatters: "A large employer replaced a whole support function.",
    rejectionReason: "NONE" as const,
  };

  it("accepts a well-formed response", () => {
    expect(rankingResponseSchema.safeParse({ items: [VALID_ITEM] }).success).toBe(true);
  });

  it("rejects a score outside 0-100", () => {
    expect(
      rankingResponseSchema.safeParse({ items: [{ ...VALID_ITEM, relevance: 140 }] }).success,
    ).toBe(false);
  });

  it("rejects a rejection reason the system does not define", () => {
    expect(
      rankingResponseSchema.safeParse({ items: [{ ...VALID_ITEM, rejectionReason: "BORING" }] })
        .success,
    ).toBe(false);
  });

  it("rejects an empty whyItMatters, which §8 requires the shortlist to show", () => {
    expect(
      rankingResponseSchema.safeParse({ items: [{ ...VALID_ITEM, whyItMatters: "" }] }).success,
    ).toBe(false);
  });

  it("accepts an empty batch rather than treating it as malformed", () => {
    expect(rankingResponseSchema.safeParse({ items: [] }).success).toBe(true);
  });
});

describe("MockProvider", () => {
  it("labels itself as simulated", async () => {
    const provider = new MockProvider();
    const result = await provider.complete(completionRequest(TWO_STORY_PROMPT));

    expect(provider.mode).toBe("MOCK");
    expect(result.mode).toBe("MOCK");
    expect(result.provider).toBe("mock");
  });

  it("returns one entry per story id in the prompt", async () => {
    const result = await new MockProvider().complete(completionRequest(TWO_STORY_PROMPT));
    const parsed = rankingResponseSchema.parse(result.data);

    expect(parsed.items.map((item) => item.id)).toEqual(["story-one", "story-two"]);
  });

  it("produces output the real validation accepts", async () => {
    const result = await new MockProvider().complete(completionRequest(TWO_STORY_PROMPT));

    expect(rankingResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it("is deterministic, so a run is reproducible and tests do not flake", async () => {
    const first = await new MockProvider().complete(completionRequest(TWO_STORY_PROMPT));
    const second = await new MockProvider().complete(completionRequest(TWO_STORY_PROMPT));

    expect(first.data).toEqual(second.data);
  });

  it("says in whyItMatters that no provider was called", async () => {
    const result = await new MockProvider().complete(completionRequest(TWO_STORY_PROMPT));
    const parsed = rankingResponseSchema.parse(result.data);

    expect(parsed.items[0].whyItMatters).toMatch(/simulated/i);
  });

  it("returns nothing for a prompt with no stories", async () => {
    const result = await new MockProvider().complete(completionRequest("no ids here"));
    const parsed = rankingResponseSchema.parse(result.data);

    expect(parsed.items).toEqual([]);
  });
});
