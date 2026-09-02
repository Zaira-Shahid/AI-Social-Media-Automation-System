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
 * input produces the same result every run. A random mock makes a flaky test
 * suite and teaches nobody anything.
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
 * Dispatch on the schema the caller asked for.
 *
 * Keyed by `schemaName` rather than by sniffing the prompt: the caller already
 * says which contract it wants, and guessing would break the moment two
 * prompts looked alike.
 */
function buildMockResponse(request: CompletionRequest): unknown {
  switch (request.schemaName) {
    case "news_ranking":
      return buildRanking(request);
    case "content_core_message":
      return buildCoreMessage(request);
    case "content_platform_versions":
      return buildPlatformVersions(request);
    case "weekly_performance_narrative":
      return buildPerformanceNarrative(request);
    default:
      throw new Error(
        `The mock provider has no response for schema "${request.schemaName}". ` +
          "Add one rather than letting a module silently receive the wrong shape.",
      );
  }
}

function buildRanking(request: CompletionRequest): unknown {
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

/** The headline the prompt carried, so simulated copy is still about the story. */
function storyHeadline(prompt: string): string {
  return prompt.match(/^Headline:\s*(.+)$/m)?.[1]?.trim() ?? "an unnamed story";
}

function buildCoreMessage(request: CompletionRequest): unknown {
  const headline = storyHeadline(request.prompt);

  return {
    headline: `Simulated: ${headline}`.slice(0, 200),
    keyTakeaway: "Simulated key takeaway — no AI provider was called for this story.",
    body: [
      "This copy was simulated. No AI provider was called, so nothing here is a",
      "real editorial judgement about the story.",
      "",
      `The story it stands in for is: ${headline}.`,
    ]
      .join(" ")
      .slice(0, 1_500),
    sourceReference: "Simulated attribution",
    angle: "Simulated angle — set AI_PROVIDER to generate for real.",
  };
}

/**
 * One version per requested platform.
 *
 * Deliberately kept well inside every platform's caption limit and free of
 * URLs, so a mock run exercises the validation path rather than tripping it —
 * a mock that always fails validation tests nothing.
 */
function buildPlatformVersions(request: CompletionRequest): unknown {
  const platforms = (request.prompt.match(/^Platforms:\s*(.+)$/m)?.[1] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const headline = request.prompt.match(/^Headline:\s*(.+)$/m)?.[1]?.trim() ?? "a story";

  return {
    versions: platforms.map((platform) => ({
      platform,
      caption:
        `Simulated ${platform} caption — no AI provider was called. Story: ${headline}`.slice(
          0,
          900,
        ),
      hashtags: ["simulated", "ai", "automation"],
      cta: "Simulated call to action.",
      visual: {
        template: "HEADLINE_CARD",
        headline: `Simulated: ${headline}`.slice(0, 120),
        supportingText: "Simulated supporting text.",
        emphasis: "PRIMARY",
      },
    })),
  };
}

/**
 * Echoes back the post count the prompt carried rather than inventing a
 * pattern — a mock report should announce itself as simulated, never as an
 * analysis of numbers it never looked at (§21, §67).
 */
function buildPerformanceNarrative(request: CompletionRequest): unknown {
  const postsAnalyzed = request.prompt.match(/^Posts analyzed:\s*(\d+)/m)?.[1] ?? "0";

  return {
    engagementPatterns:
      `Simulated analysis — no AI provider was called. The prompt carried ${postsAnalyzed} ` +
      "measured post(s) for this window.",
    recommendedChanges: [
      "Simulated recommendation — set AI_PROVIDER to generate a real one.",
    ],
  };
}
