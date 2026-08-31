import "server-only";

import { getServerEnv } from "@/lib/env.server";
import { GroqProvider, DEFAULT_GROQ_MODEL } from "@/lib/ai/groq";
import { MockProvider } from "@/lib/ai/mock";
import type { AIProvider } from "@/lib/ai/provider";

/**
 * Build the configured provider (spec §30, §21).
 *
 * One place decides which adapter runs. The business layer asks for an
 * `AIProvider` and never learns which one it got, beyond the `mode` it has to
 * record and display (§66).
 */
export function getAIProvider(): AIProvider {
  const env = getServerEnv();

  if (env.AI_PROVIDER === "groq") {
    if (!env.GROQ_API_KEY) {
      /*
       * Fails loudly rather than falling back to mock. A silent downgrade
       * would leave the system producing simulated scores while every screen
       * reported them as real, which §21 and §67 both forbid.
       */
      throw new Error(
        "AI_PROVIDER is 'groq' but GROQ_API_KEY is not set. " +
          "Set the key, or set AI_PROVIDER=mock to run simulated.",
      );
    }

    return new GroqProvider(env.GROQ_API_KEY, env.AI_MODEL ?? DEFAULT_GROQ_MODEL);
  }

  return new MockProvider();
}

export type { AIProvider };
