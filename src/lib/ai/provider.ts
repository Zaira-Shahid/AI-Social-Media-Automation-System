/**
 * AI provider abstraction (spec §30).
 *
 * §30 requires that the application never couple to one provider, and that no
 * provider-specific assumption leaks into the business layer. So the contract
 * here is deliberately small: give me a system prompt, a user prompt and a
 * JSON schema, hand me back parsed JSON that matches it.
 *
 * Everything provider-shaped — endpoints, model ids, `response_format`, rate
 * limits, retries — lives behind an adapter. The ranking code in
 * `lib/news/rank.ts` does not know which provider ran.
 */

/**
 * Whether a result came from a real provider or was simulated (§21, §66).
 *
 * This travels with every result and is stored on the document, because §21 is
 * explicit that the UI must never present a simulated outcome as a real one.
 * A boolean that only exists at call time would be lost by the time anyone
 * looks at the data.
 */
export type ExecutionMode = "REAL" | "MOCK";

export interface CompletionRequest {
  /** Stable instructions. Kept separate so a provider can cache the prefix. */
  system: string;
  prompt: string;
  /**
   * JSON Schema the response must satisfy.
   *
   * Providers that support constrained decoding enforce this; the caller
   * validates the result with Zod regardless (§31), because a provider that
   * claims to enforce a schema and a provider that actually does are not
   * reliably the same provider.
   */
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
}

export interface CompletionResult {
  /** Parsed JSON. Shape is the caller's to validate. */
  data: unknown;
  mode: ExecutionMode;
  /** For audit and display: which provider and model actually ran. */
  provider: string;
  model: string;
  /** Absent when the provider does not report usage. */
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly mode: ExecutionMode;

  /**
   * One structured completion.
   *
   * Throws on transport failure, an unusable response, or a rate limit that
   * survived the adapter's own retries. Callers treat that as "ranking did
   * not happen" rather than "everything scored zero" (§67).
   */
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * §30 names eight logical functions the AI service will eventually expose:
 * discoverNews, rankNews, summarizeNews, generateContent, adaptContent,
 * generateVisualPlan, analyzePerformance, generateStrategy.
 *
 * They are not declared here as seven throwing stubs. Each arrives with the
 * module that needs it, built on this same `complete` primitive — a method
 * that exists and always throws is worse documentation than one that does not
 * exist yet.
 */
export const AI_FUNCTIONS = [
  "discoverNews",
  "rankNews",
  "summarizeNews",
  "generateContent",
  "adaptContent",
  "generateVisualPlan",
  "analyzePerformance",
  "generateStrategy",
] as const;

export type AIFunction = (typeof AI_FUNCTIONS)[number];
