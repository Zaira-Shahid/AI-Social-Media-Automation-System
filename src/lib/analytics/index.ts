import "server-only";

import type { Platform } from "@/lib/content/schema";
import { getServerEnv } from "@/lib/env.server";
import type { AnalyticsAdapter, AnalyticsCapability } from "@/lib/analytics/adapter";
import { FacebookAnalyticsAdapter } from "@/lib/analytics/facebook";
import { InstagramAnalyticsAdapter } from "@/lib/analytics/instagram";
import { LinkedInAnalyticsAdapter } from "@/lib/analytics/linkedin";
import { MockAnalyticsAdapter } from "@/lib/analytics/mock";

/**
 * Analytics adapter selection (spec §20, §21, §66, §63 Module 17).
 *
 * Mirrors `src/lib/publishing/index.ts`: one place decides which adapter
 * runs. This reuses the *same* `FACEBOOK_PROVIDER`/`INSTAGRAM_PROVIDER`
 * switches publishing already reads — REAL analytics only make sense for an
 * account this system actually publishes to for real, so a second pair of
 * flags would only be a way for the two to drift apart. LinkedIn has no
 * REAL/MOCK choice: it is unavailable regardless of `LINKEDIN_PROVIDER`.
 */
export function getAnalyticsAdapter(platform: Platform): AnalyticsAdapter {
  const env = getServerEnv();

  if (platform === "FACEBOOK") {
    return env.FACEBOOK_PROVIDER === "graph"
      ? new FacebookAnalyticsAdapter()
      : new MockAnalyticsAdapter(platform);
  }

  if (platform === "INSTAGRAM") {
    return env.INSTAGRAM_PROVIDER === "graph"
      ? new InstagramAnalyticsAdapter()
      : new MockAnalyticsAdapter(platform);
  }

  return new LinkedInAnalyticsAdapter();
}

/** What every platform can report right now, for a future analytics screen. */
export function describeAnalyticsAdapters(platforms: readonly Platform[]): AnalyticsCapability[] {
  return platforms.map((platform) => getAnalyticsAdapter(platform).describe());
}
