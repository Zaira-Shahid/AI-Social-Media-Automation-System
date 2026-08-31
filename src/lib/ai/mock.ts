import { createHash } from "node:crypto";

import type { AIProvider, CompletionRequest, CompletionResult } from "@/lib/ai/provider";

/**
 * Mock provider (spec §21).
 *
 * Development and tests must be able to exercise the whole pipeline without a
 * key and without the network. §58 forbids tests calling live services, and
 * §21 requires that a simulated result be clearly labelled — `mode: "MOCK"`
 * travels with the result and is stored on every document it produces.
 *
 * The output is deterministic: derived from a hash of the prompt, so the same
 * input scores the same way every run. A random mock makes a flaky test suite
 * and teaches nobody anything.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "deterministic-hash";
  readonly mode = "MOCK" as const;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    return {
      data: buildMockResponse(request),
      mode: this.mode,
      provider: this.name,
      model: this.model,
      inputTokens: null,
      outputTokens: null,
    };
  }
}

/** A stable pseudo-score in [min, max] for a given seed. */
function seededScore(seed: string, min: number, max: number): number {
  const digest = createHash("sha256").update(seed).digest();
  return min + (digest.readUInt16BE(0) % (max - min + 1));
}

/**
 * Build a response shaped like the ranking schema.
 *
 * The mock is aware of exactly one schema — the ranking one — because that is
 * the only structured call that exists so far. When another module adds one,
 * it extends this rather than inventing a second mock provider.
 */
function buildMockResponse(request: CompletionRequest): unknown {
  const ids = [...request.prompt.matchAll(/^ID:\s*(\S+)/gm)].map((match) => match[1]);

  return {
    items: ids.map((id) => {
      const relevance = seededScore(`${id}:relevance`, 20, 95);

      return {
        id,
        relevance,
        credibility: seededScore(`${id}:credibility`, 40, 95),
        businessImportance: seededScore(`${id}:business`, 20, 90),
        aiRelevance: seededScore(`${id}:ai`, 20, 95),
        socialPotential: seededScore(`${id}:social`, 20, 90),
        novelty: seededScore(`${id}:novelty`, 20, 90),
        // §21: a mock result must announce itself wherever it surfaces, and
        // "why it matters" is the field a human reads first (§8).
        whyItMatters: "Simulated analysis — no AI provider was called for this story.",
        rejectionReason: relevance < 30 ? "IRRELEVANT" : "NONE",
      };
    }),
  };
}
