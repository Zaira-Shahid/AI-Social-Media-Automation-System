import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishRequest } from "@/lib/publishing/adapter";
import {
  exchangeForLongLivedUserToken,
  FacebookAdapter,
  GRAPH_API_VERSION,
  listPages,
} from "@/lib/publishing/facebook";
import { MockPublishAdapter } from "@/lib/publishing/mock";

/**
 * The Facebook adapter (spec §19, §20, §21, §52, §66, §67).
 *
 * `fetch` is replaced; Meta is never called. What is under test is the part
 * that is ours: which responses count as published, which failures are worth
 * retrying, and that nothing invents a success.
 */
const request: PublishRequest = {
  platformPostId: "post-1",
  platform: "FACEBOOK",
  message: "A caption #ai",
  mediaUrl: "https://res.cloudinary.com/our-cloud/image/upload/posts/post-1.png",
};

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
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("FacebookAdapter.publish", () => {
  it("posts the card to the Page's photos edge with the caption", async () => {
    fetchMock.mockResolvedValue(reply({ id: "photo-1", post_id: "1234_5678" }));

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: true, mode: "REAL", providerPostId: "1234_5678" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/1234567890/photos`);

    const body = new URLSearchParams(String((init as RequestInit).body));
    expect(body.get("url")).toBe(request.mediaUrl);
    expect(body.get("caption")).toBe(request.message);
  });

  it("prefers the post id over the photo id", async () => {
    fetchMock.mockResolvedValue(reply({ id: "photo-1", post_id: "1234_5678" }));

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(result.ok && result.providerPostId).toBe("1234_5678");
  });

  it("refuses to call a response with no id a success (§67)", async () => {
    fetchMock.mockResolvedValue(reply({}));

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("no post id");
    expect(!result.ok && result.retryable).toBe(false);
  });

  it("passes Facebook's own wording back for a refusal (§52)", async () => {
    fetchMock.mockResolvedValue(
      reply({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400),
    );

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(!result.ok && result.reason).toContain("Invalid OAuth access token");
    expect(!result.ok && result.providerCode).toBe(190);
  });

  it("does not retry a rejected token, which retrying cannot fix", async () => {
    fetchMock.mockResolvedValue(reply({ error: { message: "Invalid token", code: 190 } }, 400));

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(!result.ok && result.retryable).toBe(false);
  });

  it("retries a rate limit, which is what §52 means by retrying when safe", async () => {
    for (const code of [32, 80001]) {
      fetchMock.mockResolvedValue(reply({ error: { message: "Rate limited", code } }, 400));

      const result = await new FacebookAdapter().publish(request, credentials);

      expect(!result.ok && result.retryable).toBe(true);
    }
  });

  it("retries a server-side fault even when Meta sends no code", async () => {
    fetchMock.mockResolvedValue(reply({}, 503));

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(!result.ok && result.retryable).toBe(true);
  });

  it("treats an unreachable Facebook as retryable rather than as a refusal", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(!result.ok && result.retryable).toBe(true);
    expect(!result.ok && result.reason).toContain("Could not reach Facebook");
  });

  it("prefers Meta's human-facing message where it gives one", async () => {
    fetchMock.mockResolvedValue(
      reply(
        {
          error: {
            message: "(#10) Application does not have permission",
            error_user_msg: "This Page needs the pages_manage_posts permission.",
            code: 10,
          },
        },
        403,
      ),
    );

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(!result.ok && result.reason).toContain("pages_manage_posts");
  });

  it("never returns a success for an unreadable body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const result = await new FacebookAdapter().publish(request, credentials);

    expect(result.ok).toBe(false);
  });
});

describe("FacebookAdapter.describe", () => {
  it("reports itself as REAL and names what it does not do (§66)", () => {
    const capability = new FacebookAdapter().describe();

    expect(capability.mode).toBe("REAL");
    expect(capability.detail).toContain(GRAPH_API_VERSION);
    expect(capability.limitation).toBeTruthy();
  });
});

describe("exchangeForLongLivedUserToken", () => {
  it("uses the documented grant type and returns the expiry Meta reports", async () => {
    fetchMock.mockResolvedValue(reply({ access_token: "long-lived", expires_in: 5_184_000 }));

    const result = await exchangeForLongLivedUserToken("app", "secret", "short-lived");

    expect(result.accessToken).toBe("long-lived");
    expect(result.expiresAt).not.toBeNull();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("grant_type=fb_exchange_token");
    expect(url).toContain("fb_exchange_token=short-lived");
  });

  it("throws with Meta's reason rather than returning an unusable token", async () => {
    fetchMock.mockResolvedValue(reply({ error: { message: "Invalid app secret", code: 1 } }, 400));

    await expect(exchangeForLongLivedUserToken("app", "secret", "short")).rejects.toThrow(
      "Invalid app secret",
    );
  });
});

describe("listPages", () => {
  it("returns each Page with its own token", async () => {
    fetchMock.mockResolvedValue(
      reply({ data: [{ id: "1", name: "Example Co", access_token: "page-token" }] }),
    );

    const pages = await listPages("user-token");

    expect(pages).toEqual([{ id: "1", name: "Example Co", accessToken: "page-token" }]);
  });

  it("throws when the token administers nothing readable", async () => {
    fetchMock.mockResolvedValue(reply({ error: { message: "Invalid token", code: 190 } }, 400));

    await expect(listPages("user-token")).rejects.toThrow("Invalid token");
  });
});

describe("MockPublishAdapter", () => {
  it("labels itself MOCK and returns an id nobody could mistake for real (§21, §67)", async () => {
    const adapter = new MockPublishAdapter("FACEBOOK", "Simulated for tests.");

    const result = await adapter.publish(request, credentials);

    expect(result.mode).toBe("MOCK");
    expect(result.ok && result.providerPostId.startsWith("mock-")).toBe(true);
    expect(result.ok && result.permalink).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
