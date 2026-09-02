import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyticsRequest } from "@/lib/analytics/adapter";
import { InstagramAnalyticsAdapter } from "@/lib/analytics/instagram";

/**
 * The Instagram analytics adapter (spec §22, §65, §67, §63 Module 17).
 *
 * `fetch` is replaced; Meta is never called. Under test: only the metrics
 * confirmed valid for feed media are requested, a metric Meta omits from its
 * response is reported unavailable rather than zero, and engagement rate is
 * only ever computed from two real numbers.
 */
const request: AnalyticsRequest = { platform: "INSTAGRAM", providerPostId: "179999999999" };
const credentials = { accountId: "ig-user-1", accessToken: "ig-token" };

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

function metricPayload(values: Record<string, number>) {
  return {
    data: Object.entries(values).map(([name, value]) => ({ name, values: [{ value }] })),
  };
}

describe("InstagramAnalyticsAdapter.fetchMetrics", () => {
  it("requests only the confirmed, non-deprecated feed metrics", async () => {
    fetchMock.mockResolvedValue(reply(metricPayload({})));

    await new InstagramAnalyticsAdapter().fetchMetrics(request, credentials);

    const [url] = fetchMock.mock.calls[0] as [string];
    const params = new URL(url).searchParams;

    expect(params.get("metric")).toBe("reach,likes,comments,shares,saved,total_interactions");
    expect(url).not.toContain("impressions");
  });

  it("normalizes reach, likes, comments, shares and engagement, and computes engagement rate", async () => {
    fetchMock.mockResolvedValue(
      reply(metricPayload({ reach: 200, likes: 20, comments: 5, shares: 2, total_interactions: 30 })),
    );

    const result = await new InstagramAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok).toBe(true);
    expect(result.ok && result.metrics).toMatchObject({
      reach: 200,
      likes: 20,
      comments: 5,
      shares: 2,
      engagement: 30,
      engagementRate: 0.15,
      impressions: "UNAVAILABLE",
      clicks: "UNAVAILABLE",
    });
  });

  it("reports a metric Meta dropped from the response as unavailable, not zero", async () => {
    fetchMock.mockResolvedValue(reply(metricPayload({ reach: 100 })));

    const result = await new InstagramAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok && result.metrics.likes).toBe("UNAVAILABLE");
    expect(result.ok && result.metrics.engagementRate).toBe("UNAVAILABLE");
  });

  it("returns a failure, not fabricated metrics, when Instagram refuses the call", async () => {
    fetchMock.mockResolvedValue(
      reply({ error: { message: "Missing permissions", code: 10 } }, 400),
    );

    const result = await new InstagramAnalyticsAdapter().fetchMetrics(request, credentials);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("Missing permissions");
  });
});
