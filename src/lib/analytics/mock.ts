import type {
  AnalyticsAdapter,
  AnalyticsCapability,
  AnalyticsRequest,
  AnalyticsResult,
} from "@/lib/analytics/adapter";
import type { Platform } from "@/lib/content/schema";
import type { Metrics } from "@/lib/analytics/schema";
import { logger } from "@/lib/logger";

/**
 * Simulated analytics (spec §21, §66, §67).
 *
 * Used only for posts that were themselves mock-published (`publishMode ===
 * "MOCK"` on the platform post) — a real post never reaches this adapter.
 * §21 permits simulated numbers but never lets them pass as real ones, so the
 * result carries `mode: "MOCK"` and every value is derived deterministically
 * from the fake `providerPostId` a mock publish already invented, rather than
 * from `Math.random()` pretending to be a measurement.
 */

/** A small, deterministic, non-cryptographic hash — stable across syncs. */
function seedFrom(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

export class MockAnalyticsAdapter implements AnalyticsAdapter {
  readonly mode = "MOCK" as const;

  constructor(readonly platform: Platform) {}

  describe(): AnalyticsCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail: `Simulated. These numbers were never measured on ${this.platform}.`,
      limitation: "This post was mock-published, so its analytics are simulated too.",
    };
  }

  async fetchMetrics(request: AnalyticsRequest): Promise<AnalyticsResult> {
    logger.info("Simulated an analytics sync", {
      platform: this.platform,
      providerPostId: request.providerPostId,
    });

    const seed = seedFrom(request.providerPostId);
    const likes = seed % 200;
    const comments = seed % 20;
    const shares = seed % 10;
    const reach = 500 + (seed % 3_000);
    const engagement = likes + comments + shares;

    const metrics: Metrics = {
      likes,
      comments,
      shares,
      reach,
      engagement,
      engagementRate: reach > 0 ? engagement / reach : "UNAVAILABLE",
      impressions: reach + (seed % 500),
      clicks: seed % 50,
    };

    return { ok: true, mode: this.mode, metrics };
  }
}
