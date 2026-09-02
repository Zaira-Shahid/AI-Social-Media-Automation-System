import type {
  AnalyticsAdapter,
  AnalyticsCapability,
  AnalyticsCredentials,
  AnalyticsRequest,
  AnalyticsResult,
} from "@/lib/analytics/adapter";
import { UNAVAILABLE, type Metrics } from "@/lib/analytics/schema";
import { GRAPH_API_VERSION } from "@/lib/publishing/facebook";
import { logger } from "@/lib/logger";

/**
 * Facebook Page post analytics (spec §19, §20, §22, §63 Module 17, §65).
 *
 * Verified against Meta's own documentation on 2026-09-02:
 *
 * - `likes.summary(true)`, `comments.summary(true)` and `shares` are ordinary
 *   fields on a Page post node, readable with `pages_read_engagement` (already
 *   granted in Module 12) — no App Review, no separate permission.
 *   https://developers.facebook.com/docs/graph-api/reference/v26.0/page-post
 * - The `insights` edge additionally needs `read_insights` (Standard Access
 *   for a Page we own — no App Review).
 *   https://developers.facebook.com/docs/graph-api/reference/insights/
 *
 * What is deliberately **not** called: Meta has been actively deprecating
 * impression/reach metrics on this edge — `post_impressions` and every
 * `*_impressions_unique` variant were deprecated between 2025-06-15 and
 * 2025-11-15, and the replacement family (`post_media_view` and friends) is
 * documented only in Meta's deprecation notice, not in a primary metric
 * reference I could fetch and confirm as a current, valid enum value. §65
 * forbids asserting an unconfirmed metric name, so this adapter does not call
 * `insights` at all and reports `reach`, `impressions`, `clicks` and
 * `engagementRate` as `UNAVAILABLE` for Facebook rather than guess.
 *
 * `engagement` is a real number even so: it is `likes + comments + shares`,
 * a sum of three confirmed fields, not an invented metric.
 */

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Additional scope this needs beyond publishing's `FACEBOOK_SCOPES`. */
export const FACEBOOK_ANALYTICS_SCOPES = ["pages_read_engagement"] as const;

interface GraphError {
  message?: string;
  error_user_msg?: string;
  code?: number;
}

interface PostFieldsResponse {
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
  error?: GraphError;
}

function describeGraphError(error: GraphError | undefined, status: number): string {
  if (!error) return `Facebook refused the analytics request (HTTP ${status}).`;

  const message = error.error_user_msg ?? error.message ?? "no message";

  return `Facebook refused the analytics request: ${message} (code ${error.code ?? "none"}).`;
}

export class FacebookAnalyticsAdapter implements AnalyticsAdapter {
  readonly platform = "FACEBOOK" as const;
  readonly mode = "REAL" as const;

  describe(): AnalyticsCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail:
        "Reads likes, comments and shares for Page posts through Graph API " +
        `${GRAPH_API_VERSION}.`,
      limitation:
        "Reach, impressions, click and engagement-rate metrics are unavailable: Meta has " +
        "deprecated its impression metrics and the replacement was not confirmed against " +
        "primary documentation, so this adapter does not report it rather than guess.",
    };
  }

  async fetchMetrics(
    request: AnalyticsRequest,
    credentials: AnalyticsCredentials,
  ): Promise<AnalyticsResult> {
    const params = new URLSearchParams({
      fields: "likes.summary(true),comments.summary(true),shares",
      access_token: credentials.accessToken,
    });

    let response: Response;

    try {
      response = await fetch(`${GRAPH_BASE}/${request.providerPostId}?${params.toString()}`);
    } catch (error) {
      return {
        ok: false,
        mode: this.mode,
        reason: `Could not reach Facebook: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let payload: PostFieldsResponse;

    try {
      payload = (await response.json()) as PostFieldsResponse;
    } catch {
      return {
        ok: false,
        mode: this.mode,
        reason: `Facebook answered HTTP ${response.status} with a body this adapter could not read.`,
      };
    }

    if (!response.ok || payload.error) {
      logger.warn("Facebook refused an analytics request", {
        providerPostId: request.providerPostId,
        status: response.status,
        code: payload.error?.code,
      });

      return {
        ok: false,
        mode: this.mode,
        reason: describeGraphError(payload.error, response.status),
      };
    }

    // Meta omits `shares` entirely on a post with zero shares, rather than
    // returning `{ count: 0 }` — absence here means zero, not "unknown".
    const likes = payload.likes?.summary?.total_count ?? 0;
    const comments = payload.comments?.summary?.total_count ?? 0;
    const shares = payload.shares?.count ?? 0;

    const metrics: Metrics = {
      likes,
      comments,
      shares,
      engagement: likes + comments + shares,
      reach: UNAVAILABLE,
      impressions: UNAVAILABLE,
      clicks: UNAVAILABLE,
      engagementRate: UNAVAILABLE,
    };

    return { ok: true, mode: this.mode, metrics };
  }
}
