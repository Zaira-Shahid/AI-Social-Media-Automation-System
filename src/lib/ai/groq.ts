import "server-only";

import { logger } from "@/lib/logger";
import type { AIProvider, CompletionRequest, CompletionResult } from "@/lib/ai/provider";

/**
 * Groq adapter (spec §30).
 *
 * Chosen against §29's free-tier-first policy: Groq's free plan needs no card
 * and supports JSON-schema constrained decoding, which §31 wants. Gemini's
 * free tier was rejected because its own documentation says free-tier content
 * is used to improve Google's products, and the brand profile that will feed
 * later prompts is company data.
 *
 * Endpoint and `response_format` shape are from Groq's own documentation,
 * verified 2026-08-31 — not recalled (§65).
 */
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Free-plan limits for `openai/gpt-oss-120b`, from Groq's rate-limit page
 * (verified 2026-08-31): 30 RPM, 1K RPD, 8K TPM, 200K TPD.
 *
 * TPM is the binding one and it is small. The ranking pipeline batches
 * accordingly; these constants exist so that pacing is derived from the
 * published limits rather than from a guess someone typed once.
 */
export const GROQ_FREE_TIER = {
  requestsPerMinute: 30,
  tokensPerMinute: 8_000,
  requestsPerDay: 1_000,
} as const;

/** Strict mode is only available on some models; this is one of them. */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

interface GroqChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface GroqResponse {
  choices?: GroqChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class GroqProvider implements AIProvider {
  readonly name = "groq";
  readonly mode = "REAL" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string = DEFAULT_GROQ_MODEL,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        // Constrained decoding. Strict mode requires every property to be
        // required and every object to set additionalProperties:false — the
        // schema builder in `ranking-schema.ts` produces exactly that.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
        max_completion_tokens: request.maxOutputTokens,
        // Ranking should be reproducible enough to compare two runs.
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");

      // Log the status, never the key. The body can echo request content, so
      // it is truncated hard (§55).
      logger.error("Groq request failed", {
        status: response.status,
        detail: detail.slice(0, 300),
      });

      throw new Error(
        response.status === 429
          ? "Groq rate limit reached. The free plan allows 30 requests and 8,000 tokens per minute."
          : `Groq request failed with status ${response.status}.`,
      );
    }

    const body = (await response.json()) as GroqResponse;
    const choice = body.choices?.[0];
    const content = choice?.message?.content;

    if (!content) throw new Error("Groq returned no content.");

    /*
     * A truncated response is still syntactically JSON-shaped often enough to
     * parse into something wrong. Checking finish_reason first turns a silent
     * bad ranking into a clear failure (§67).
     */
    if (choice?.finish_reason === "length") {
      throw new Error("Groq response was cut off by the output token limit.");
    }

    let data: unknown;

    try {
      data = JSON.parse(content);
    } catch {
      throw new Error("Groq returned content that was not valid JSON.");
    }

    return {
      data,
      mode: this.mode,
      provider: this.name,
      model: this.model,
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
    };
  }
}
