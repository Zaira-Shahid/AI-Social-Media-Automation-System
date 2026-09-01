import { describe, expect, it } from "vitest";

import { MockProvider } from "@/lib/ai/mock";
import {
  adaptationResponseSchema,
  coreResponseSchema,
  ADAPTATION_JSON_SCHEMA,
  ADAPTATION_SCHEMA_NAME,
  CORE_JSON_SCHEMA,
  CORE_SCHEMA_NAME,
} from "@/lib/content/generation-schema";
import { EMPTY_BRAND_SETTINGS } from "@/lib/brand/schema";
import { validatePlatformVersion } from "@/lib/content/validate";

/**
 * The generation contracts (spec §21, §30, §31, §58).
 *
 * Two things are worth pinning: that the schemas sent to the provider satisfy
 * strict mode's requirements, and that the mock provider produces output that
 * actually survives validation. A mock whose output always fails validation
 * tests the error path and nothing else.
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

const CORE_PROMPT = [
  "Company: Example",
  "",
  "Story:",
  "Headline: AI agents take over support desks",
  "Source: TechCrunch",
].join("\n");

const ADAPT_PROMPT = [
  "Company: Example",
  "",
  "Platforms: FACEBOOK, INSTAGRAM, LINKEDIN",
  "",
  "Core message:",
  "Headline: AI agents take over support desks",
].join("\n");

function request(schemaName: string, schema: Record<string, unknown>, prompt: string) {
  return { system: "system", prompt, schema, schemaName, maxOutputTokens: 2_000 };
}

describe("the JSON schemas sent to the provider", () => {
  it("satisfy strict mode for the core message", () => {
    assertStrictModeSafe(CORE_JSON_SCHEMA);
  });

  it("satisfy strict mode for the platform versions, including the nested visual", () => {
    assertStrictModeSafe(ADAPTATION_JSON_SCHEMA);
  });
});

describe("MockProvider, for content", () => {
  it("returns a core message that passes its own Zod contract", async () => {
    const result = await new MockProvider().complete(
      request(CORE_SCHEMA_NAME, CORE_JSON_SCHEMA, CORE_PROMPT),
    );

    const parsed = coreResponseSchema.safeParse(result.data);

    expect(parsed.success).toBe(true);
    expect(result.mode).toBe("MOCK");
  });

  it("keeps the story in the simulated copy, and says it is simulated (§21)", async () => {
    const result = await new MockProvider().complete(
      request(CORE_SCHEMA_NAME, CORE_JSON_SCHEMA, CORE_PROMPT),
    );

    const core = coreResponseSchema.parse(result.data);

    expect(core.headline).toContain("AI agents take over support desks");
    expect(core.headline.toLowerCase()).toContain("simulated");
  });

  it("returns one version per requested platform", async () => {
    const result = await new MockProvider().complete(
      request(ADAPTATION_SCHEMA_NAME, ADAPTATION_JSON_SCHEMA, ADAPT_PROMPT),
    );

    const parsed = adaptationResponseSchema.parse(result.data);

    expect(parsed.versions.map((version) => version.platform).sort()).toEqual([
      "FACEBOOK",
      "INSTAGRAM",
      "LINKEDIN",
    ]);
  });

  it("produces versions that survive the business rules, including §14", async () => {
    const result = await new MockProvider().complete(
      request(ADAPTATION_SCHEMA_NAME, ADAPTATION_JSON_SCHEMA, ADAPT_PROMPT),
    );

    for (const version of adaptationResponseSchema.parse(result.data).versions) {
      expect(validatePlatformVersion(version, EMPTY_BRAND_SETTINGS).ok).toBe(true);
    }
  });

  it("is deterministic, so the suite does not flake", async () => {
    const first = await new MockProvider().complete(
      request(CORE_SCHEMA_NAME, CORE_JSON_SCHEMA, CORE_PROMPT),
    );
    const second = await new MockProvider().complete(
      request(CORE_SCHEMA_NAME, CORE_JSON_SCHEMA, CORE_PROMPT),
    );

    expect(first.data).toEqual(second.data);
  });

  it("refuses a schema it has no answer for, rather than returning the wrong shape", async () => {
    await expect(
      new MockProvider().complete(request("something_new", {}, "prompt")),
    ).rejects.toThrow(/no response for schema/i);
  });
});
