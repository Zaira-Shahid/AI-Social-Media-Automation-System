import type { Platform } from "@/lib/content/schema";
import type { Metrics } from "@/lib/analytics/schema";

/**
 * The analytics adapter contract (spec §20's rule applied to Module 17: one
 * interface before any provider is written to it, mirroring
 * `src/lib/publishing/adapter.ts`).
 *
 * A `ProviderAdapter` publishes; an `AnalyticsAdapter` reads back what
 * happened to something already published. Nothing here composes content,
 * decides what to sync, or writes to Firestore — that is `sync.ts`.
 */

export type AnalyticsMode = "REAL" | "MOCK" | "UNAVAILABLE";

export interface AnalyticsRequest {
  platform: Platform;
  /** The platform's own id for the post, from §53's `providerPostId`. */
  providerPostId: string;
}

export interface AnalyticsCredentials {
  accountId: string;
  accessToken: string;
}

export interface AnalyticsSuccess {
  ok: true;
  mode: AnalyticsMode;
  /** Per-metric number, or the literal `"UNAVAILABLE"` — never a fabricated 0. */
  metrics: Metrics;
}

export interface AnalyticsFailure {
  ok: false;
  mode: AnalyticsMode;
  /** Why the whole sync attempt failed — a refused call, not a missing metric. */
  reason: string;
}

export type AnalyticsResult = AnalyticsSuccess | AnalyticsFailure;

export interface AnalyticsCapability {
  platform: Platform;
  mode: AnalyticsMode;
  detail: string;
  limitation: string | null;
}

export interface AnalyticsAdapter {
  readonly platform: Platform;
  readonly mode: AnalyticsMode;

  describe(): AnalyticsCapability;

  /**
   * Fetch current metrics for one already-published post.
   *
   * Never called for a post this system did not itself publish (`sync.ts`
   * only syncs posts carrying a `providerPostId`), and never invents a metric
   * the platform did not return — an adapter that cannot confirm a number
   * reports it as `"UNAVAILABLE"`, not `0` and not omitted (§22, §67).
   */
  fetchMetrics(
    request: AnalyticsRequest,
    credentials: AnalyticsCredentials,
  ): Promise<AnalyticsResult>;
}
