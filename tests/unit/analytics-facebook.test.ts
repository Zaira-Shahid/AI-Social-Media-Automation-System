import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyticsRequest } from "@/lib/analytics/adapter";
import { FacebookAnalyticsAdapter } from "@/lib/analytics/facebook";
import { GRAPH_API_VERSION } from "@/lib/publishing/facebook";

/**
 * The Facebook analytics adapter (spec §22, §65, §67, §63 Module 17).
 *
 * `fetch` is replaced; Meta is never called. What is under test: only the
 * confirmed fields (likes/comments/shares) are ever read as real numbers, the
 * deprecated-metric fields are always reported `"UNAVAILABLE"`, and a refused
 * call never becomes a fabricated result.
 */
const request: AnalyticsRequest = { platform: "FACEBOOK", providerPostId: "1234_5678" };
const credentials = { accountId: "1234567890", accessToken: "page-token" };

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("FacebookAnalyticsAdapter.fetchMetrics", () => {
  it("reads likes, comments and shares, and computes engagement as their sum", async () => {
    fetchMock.mockResolvedValue(
      reply({
        likes: { summary: { total_count: 10 } },
        comments: { summary: { total_count: 3 } },
        shares: { count: 2 },
      }),
    );

    const result = await new FacebookAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok).toBe(true);
    expect(result.ok && result.metrics).toMatchObject({
      likes: 10,
      comments: 3,
      shares: 2,
      engagement: 15,
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/1234_5678?fields=likes.summary%28true%29%2Ccomments.summary%28true%29%2Cshares&access_token=page-token`,
    );
  });

  it("treats an absent shares field as zero, not unavailable", async () => {
    fetchMock.mockResolvedValue(
      reply({ likes: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } }),
    );

    const result = await new FacebookAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok && result.metrics.shares).toBe(0);
  });

  it("never reports reach, impressions, clicks or engagement rate as real numbers (§65)", async () => {
    fetchMock.mockResolvedValue(
      reply({
        likes: { summary: { total_count: 1 } },
        comments: { summary: { total_count: 1 } },
        shares: { count: 1 },
      }),
    );

    const result = await new FacebookAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok && result.metrics).toMatchObject({
      reach: "UNAVAILABLE",
      impressions: "UNAVAILABLE",
      clicks: "UNAVAILABLE",
      engagementRate: "UNAVAILABLE",
    });
  });

  it("returns a failure, not fabricated metrics, when Facebook refuses the call", async () => {
    fetchMock.mockResolvedValue(
      reply({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400),
    );

    const result = await new FacebookAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("Invalid OAuth access token");
  });

  it("returns a failure when fetch itself throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await new FacebookAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("Could not reach Facebook");
  });
});
