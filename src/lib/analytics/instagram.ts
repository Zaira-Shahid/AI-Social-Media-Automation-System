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
 * Instagram media analytics (spec §19, §20, §22, §63 Module 17, §65).
 *
 * Verified against Meta's own `ig-media/insights` reference on 2026-09-02.
 * Every post this system publishes is a FEED image (Module 08's static card;
 * no Reels or Stories in scope), and for FEED media the currently valid,
 * non-deprecated metrics are: `reach`, `likes`, `comments`, `shares`,
 * `saved`, `total_interactions`. `impressions` is excluded on purpose — the
 * documentation marks it deprecated for media created after 2024-07-02.
 * https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights
 *
 * Permission: `instagram_manage_insights`, read through the same Facebook
 * Login connection Module 13 already uses (with `pages_read_engagement`).
 * Standard Access, no App Review, for an account we own and manage.
 *
 * That scope was **not** requested by Module 13's original connect flow — an
 * account connected before this module may not carry it. That is not papered
 * over: a permission refusal from Meta is returned as the sync failure it
 * actually is, with Meta's own wording, so reconnecting is an informed choice
 * rather than a guess.
 */

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Additional scope this needs beyond publishing's `INSTAGRAM_SCOPES`. */
export const INSTAGRAM_ANALYTICS_SCOPES = [
  "instagram_manage_insights",
  "pages_read_engagement",
] as const;

/** The confirmed, non-deprecated FEED media metrics this adapter asks for. */
const REQUESTED_METRICS = ["reach", "likes", "comments", "shares", "saved", "total_interactions"];

interface GraphError {
  message?: string;
  error_user_msg?: string;
  code?: number;
}

interface InsightValue {
  name?: string;
  values?: Array<{ value?: number }>;
}

interface InsightsResponse {
  data?: InsightValue[];
  error?: GraphError;
}

function describeGraphError(error: GraphError | undefined, status: number): string {
  if (!error) return `Instagram refused the analytics request (HTTP ${status}).`;

  const message = error.error_user_msg ?? error.message ?? "no message";

  return `Instagram refused the analytics request: ${message} (code ${error.code ?? "none"}).`;
}

export class InstagramAnalyticsAdapter implements AnalyticsAdapter {
  readonly platform = "INSTAGRAM" as const;
  readonly mode = "REAL" as const;

  describe(): AnalyticsCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail:
        "Reads reach, likes, comments, shares and saves for feed media through " +
        `Graph API ${GRAPH_API_VERSION}.`,
      limitation:
        "Impressions and clicks are unavailable: Meta deprecated the impressions metric for " +
        "feed media created after 2024-07-02, and does not offer a click metric for it.",
    };
  }

  async fetchMetrics(
    request: AnalyticsRequest,
    credentials: AnalyticsCredentials,
  ): Promise<AnalyticsResult> {
    const params = new URLSearchParams({
      metric: REQUESTED_METRICS.join(","),
      access_token: credentials.accessToken,
    });

    let response: Response;

    try {
      response = await fetch(
        `${GRAPH_BASE}/${request.providerPostId}/insights?${params.toString()}`,
      );
    } catch (error) {
      return {
        ok: false,
        mode: this.mode,
        reason: `Could not reach Instagram: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let payload: InsightsResponse;

    try {
      payload = (await response.json()) as InsightsResponse;
    } catch {
      return {
        ok: false,
        mode: this.mode,
        reason: `Instagram answered HTTP ${response.status} with a body this adapter could not read.`,
      };
    }

    if (!response.ok || payload.error) {
      logger.warn("Instagram refused an analytics request", {
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

    const byName = new Map<string, number>();

    for (const entry of payload.data ?? []) {
      const value = entry.values?.[0]?.value;

      if (entry.name && typeof value === "number") {
        byName.set(entry.name, value);
      }
    }

    // A metric Meta silently dropped from the response — rather than
    // refusing the whole call — is reported as unavailable, not as zero.
    const reach = byName.get("reach") ?? UNAVAILABLE;
    const likes = byName.get("likes") ?? UNAVAILABLE;
    const comments = byName.get("comments") ?? UNAVAILABLE;
    const shares = byName.get("shares") ?? UNAVAILABLE;
    const engagement = byName.get("total_interactions") ?? UNAVAILABLE;

    const engagementRate =
      typeof engagement === "number" && typeof reach === "number" && reach > 0
        ? engagement / reach
        : UNAVAILABLE;

    const metrics: Metrics = {
      reach,
      likes,
      comments,
      shares,
      engagement,
      engagementRate,
      impressions: UNAVAILABLE,
      clicks: UNAVAILABLE,
    };

    return { ok: true, mode: this.mode, metrics };
  }
}
