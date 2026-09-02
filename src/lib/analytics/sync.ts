import "server-only";

import { recordAudit } from "@/lib/audit";
import type { Platform } from "@/lib/content/schema";
import { listPublishedPosts, type StoredPlatformPost } from "@/lib/content/store";
import { logger } from "@/lib/logger";
import { getUsableCredentials } from "@/lib/social/store";
import { saveAnalyticsRecord } from "@/lib/analytics/store";
import { FacebookAnalyticsAdapter } from "@/lib/analytics/facebook";
import { InstagramAnalyticsAdapter } from "@/lib/analytics/instagram";
import { LinkedInAnalyticsAdapter } from "@/lib/analytics/linkedin";
import { MockAnalyticsAdapter } from "@/lib/analytics/mock";
import type { AnalyticsAdapter } from "@/lib/analytics/adapter";
import type { AnalyticsRecord } from "@/lib/analytics/schema";

/**
 * The analytics sync engine (spec §22, §50, §63 Module 17).
 *
 * n8n's `08_analytics_sync` workflow: "fetch available platform data →
 * normalize → store". Dashboards are Module 18's.
 *
 * How a post is synced follows how it was published, not the platform's
 * current provider setting: a post whose `publishMode` was `"MOCK"` gets
 * simulated analytics, clearly labelled, and never touches credentials or a
 * network call — its `providerPostId` is `mock-facebook-…`, not something any
 * real API would recognise. A post whose `publishMode` was `"REAL"` always
 * gets the real adapter, because it really did reach the platform, whatever
 * `FACEBOOK_PROVIDER`/`INSTAGRAM_PROVIDER` happen to be set to right now.
 */

export const MAX_SYNCS_PER_RUN = 60;

export interface PostSyncOutcome {
  platformPostId: string;
  platform: Platform;
  status: "SYNCED" | "SKIPPED" | "FAILED";
  reason?: string;
}

export interface AnalyticsSyncOutcome {
  candidates: number;
  synced: number;
  skipped: number;
  failed: number;
  outcomes: PostSyncOutcome[];
}

function realAdapterFor(platform: Platform): AnalyticsAdapter {
  if (platform === "FACEBOOK") return new FacebookAnalyticsAdapter();
  if (platform === "INSTAGRAM") return new InstagramAnalyticsAdapter();

  return new LinkedInAnalyticsAdapter();
}

/**
 * Sync one already-published post. Exported for the webhook route and for
 * anything that wants to re-sync a single post rather than a whole run.
 */
export async function syncOne(
  post: StoredPlatformPost,
  now: Date = new Date(),
): Promise<PostSyncOutcome> {
  const base = { platformPostId: post.id, platform: post.platform };

  // §53's invariant: PUBLISHED implies a providerPostId. Checked rather than
  // assumed, because this function also has to be safe to call directly.
  if (!post.providerPostId) {
    return { ...base, status: "SKIPPED", reason: "No providerPostId to sync against." };
  }

  const isMock = post.publishMode === "MOCK";
  const adapter: AnalyticsAdapter = isMock
    ? new MockAnalyticsAdapter(post.platform)
    : realAdapterFor(post.platform);

  let credentials: { accountId: string; accessToken: string } | null = null;

  if (!isMock) {
    const usable = await getUsableCredentials(post.platform, now);

    if (!usable.ok) {
      const record: AnalyticsRecord = {
        platformPostId: post.id,
        platform: post.platform,
        providerPostId: post.providerPostId,
        mode: adapter.mode,
        metrics: {},
        syncError: usable.reason,
        syncedAt: now.toISOString(),
      };

      await saveAnalyticsRecord(record);

      return { ...base, status: "FAILED", reason: usable.reason };
    }

    credentials = usable.credentials;
  }

  const result = await adapter.fetchMetrics(
    { platform: post.platform, providerPostId: post.providerPostId },
    credentials ?? { accountId: "", accessToken: "" },
  );

  const record: AnalyticsRecord = {
    platformPostId: post.id,
    platform: post.platform,
    providerPostId: post.providerPostId,
    mode: result.mode,
    metrics: result.ok ? result.metrics : {},
    syncError: result.ok ? null : result.reason,
    syncedAt: now.toISOString(),
  };

  await saveAnalyticsRecord(record);

  if (!result.ok) {
    logger.warn("Analytics sync failed for a post", {
      platformPostId: post.id,
      platform: post.platform,
      reason: result.reason,
    });

    return { ...base, status: "FAILED", reason: result.reason };
  }

  return { ...base, status: "SYNCED" };
}

/**
 * Sync every published post, up to `MAX_SYNCS_PER_RUN` per tick.
 *
 * One post's failure never stops the run — the same rule §17 and the
 * publishing engine already follow: every platform version has its own fate.
 */
export async function runAnalyticsSync(now: Date = new Date()): Promise<AnalyticsSyncOutcome> {
  const posts = await listPublishedPosts(MAX_SYNCS_PER_RUN);

  const outcomes: PostSyncOutcome[] = [];

  for (const post of posts) {
    outcomes.push(await syncOne(post, now));
  }

  const synced = outcomes.filter((outcome) => outcome.status === "SYNCED").length;
  const failed = outcomes.filter((outcome) => outcome.status === "FAILED").length;
  const skipped = outcomes.filter((outcome) => outcome.status === "SKIPPED").length;

  await recordAudit({
    actor: "system:analytics",
    action: "ANALYTICS_SYNCED",
    resource: "analytics",
    status: failed > 0 && synced === 0 && skipped === 0 ? "FAILURE" : "SUCCESS",
    metadata: { candidates: posts.length, synced, failed, skipped },
  });

  logger.info("Analytics sync run finished", {
    candidates: posts.length,
    synced,
    failed,
    skipped,
  });

  return { candidates: posts.length, synced, skipped, failed, outcomes };
}
