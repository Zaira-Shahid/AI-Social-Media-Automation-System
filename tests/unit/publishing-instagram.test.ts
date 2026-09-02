import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishRequest } from "@/lib/publishing/adapter";
import { GRAPH_API_VERSION } from "@/lib/publishing/facebook";
import {
  findInstagramAccount,
  InstagramAdapter,
  isJpegUrl,
  readPublishingLimit,
} from "@/lib/publishing/instagram";

/**
 * The Instagram adapter (spec §19, §20, §21, §52, §66, §67).
 *
 * `fetch` is replaced; Meta is never called (§58). What is under test is the
 * part that is ours: that the two-step container/publish dance is done in the
 * right order, which responses count as published, which failures are worth
 * retrying, and that nothing invents a success.
 */
const request: PublishRequest = {
  platformPostId: "post-1",
  platform: "INSTAGRAM",
  message: "A caption #ai",
  mediaUrl: "https://res.cloudinary.com/our-cloud/image/upload/posts/post-1.jpg",
};

const credentials = { accountId: "17841400000000000", accessToken: "page-token" };

const BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

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

/** No waiting: the poll interval is a constructor argument for exactly this. */
function adapter(attempts = 5) {
  return new InstagramAdapter(attempts, 0);
}

/** Container created, FINISHED at once, published, permalink read. */
function happyPath() {
  fetchMock
    .mockResolvedValueOnce(reply({ id: "container-1" }))
    .mockResolvedValueOnce(reply({ status_code: "FINISHED" }))
    .mockResolvedValueOnce(reply({ id: "media-1" }))
    .mockResolvedValueOnce(reply({ permalink: "https://www.instagram.com/p/abc/" }));
}

describe("isJpegUrl", () => {
  it("accepts .jpg and .jpeg", () => {
    expect(isJpegUrl("https://example.com/a.jpg")).toBe(true);
    expect(isJpegUrl("https://example.com/a.JPEG")).toBe(true);
  });

  it("rejects the PNG the other platforms use", () => {
    expect(isJpegUrl("https://example.com/a.png")).toBe(false);
  });

  it("allows a path with no extension, because Meta is the judge of that", () => {
    expect(isJpegUrl("https://example.com/media/12345")).toBe(true);
  });

  it("rejects something that is not a URL at all", () => {
    expect(isJpegUrl("not a url")).toBe(false);
  });
});

describe("InstagramAdapter.publish", () => {
  it("creates a container, waits for it, then publishes it", async () => {
    happyPath();

    const result = await adapter().publish(request, credentials);

    expect(result).toMatchObject({
      ok: true,
      mode: "REAL",
      providerPostId: "media-1",
      permalink: "https://www.instagram.com/p/abc/",
    });

    const [containerUrl, containerInit] = fetchMock.mock.calls[0];
    expect(containerUrl).toBe(`${BASE}/${credentials.accountId}/media`);

    const containerBody = new URLSearchParams(String((containerInit as RequestInit).body));
    expect(containerBody.get("image_url")).toBe(request.mediaUrl);
    expect(containerBody.get("caption")).toBe(request.message);

    const [publishUrl, publishInit] = fetchMock.mock.calls[2];
    expect(publishUrl).toBe(`${BASE}/${credentials.accountId}/media_publish`);
    expect(new URLSearchParams(String((publishInit as RequestInit).body)).get("creation_id")).toBe(
      "container-1",
    );
  });

  it("refuses a non-JPEG card before spending a container (§67)", async () => {
    const result = await adapter().publish(
      { ...request, mediaUrl: "https://res.cloudinary.com/c/image/upload/post-1.png" },
      credentials,
    );

    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("JPEG");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not publish when the container never finishes", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ id: "container-1" }))
      .mockResolvedValue(reply({ status_code: "IN_PROGRESS" }));

    const result = await adapter(2).publish(request, credentials);

    // Retryable: the image is fine, Meta is still working on it.
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("media_publish"))).toBe(false);
  });

  it("treats a container Instagram could not process as final, not retryable", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ id: "container-1" }))
      .mockResolvedValueOnce(reply({ status_code: "ERROR" }));

    const result = await adapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: false });
  });

  it("treats an expired container as retryable and publishes nothing", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ id: "container-1" }))
      .mockResolvedValueOnce(reply({ status_code: "EXPIRED" }));

    const result = await adapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("publishes a container Meta already marks PUBLISHED rather than looping", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ id: "container-1" }))
      .mockResolvedValueOnce(reply({ status_code: "PUBLISHED" }))
      .mockResolvedValueOnce(reply({ id: "media-1" }))
      .mockResolvedValueOnce(reply({ permalink: null }));

    await expect(adapter().publish(request, credentials)).resolves.toMatchObject({ ok: true });
  });

  it("is not a success when the publish returns no media id (§67)", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ id: "container-1" }))
      .mockResolvedValueOnce(reply({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(reply({}));

    const result = await adapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: false });
    if (!result.ok) expect(result.reason).toContain("unconfirmed");
  });

  it("is not a success when the container call returns no id", async () => {
    fetchMock.mockResolvedValueOnce(reply({}));

    const result = await adapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: false });
  });

  it("marks the publishing rate limit retryable and a rejected token not", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ error: { message: "limit reached", code: 9007 } }, 400),
    );

    await expect(adapter().publish(request, credentials)).resolves.toMatchObject({
      ok: false,
      retryable: true,
      providerCode: 9007,
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      reply({ error: { message: "Invalid OAuth access token", code: 190 } }, 401),
    );

    await expect(adapter().publish(request, credentials)).resolves.toMatchObject({
      ok: false,
      retryable: false,
      providerCode: 190,
    });
  });

  it("prefers Meta's own wording for a human when it gives one", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(
        { error: { message: "raw", error_user_msg: "Try a smaller image.", code: 36003 } },
        400,
      ),
    );

    const result = await adapter().publish(request, credentials);

    if (!result.ok) expect(result.reason).toContain("Try a smaller image.");
  });

  it("treats an unreachable Instagram as retryable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(adapter().publish(request, credentials)).resolves.toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("treats a 5xx as retryable even when the body is unreadable", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await expect(adapter().publish(request, credentials)).resolves.toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("still reports the post when only the permalink lookup fails", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ id: "container-1" }))
      .mockResolvedValueOnce(reply({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(reply({ id: "media-1" }))
      .mockResolvedValueOnce(reply({ error: { message: "nope", code: 100 } }, 400));

    await expect(adapter().publish(request, credentials)).resolves.toMatchObject({
      ok: true,
      providerPostId: "media-1",
      permalink: null,
    });
  });

  it("never puts a token in the logged failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce(reply({ error: { message: "no", code: 100 } }, 400));
    await adapter().publish(request, credentials);

    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(credentials.accessToken);
    }

    warn.mockRestore();
  });
});

describe("InstagramAdapter.describe", () => {
  it("reports REAL and names what it cannot do (§66)", () => {
    const capability = adapter().describe();

    expect(capability).toMatchObject({ platform: "INSTAGRAM", mode: "REAL" });
    expect(capability.limitation).toContain("Reels");
  });
});

describe("findInstagramAccount", () => {
  it("reads the account linked to the Page", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ instagram_business_account: { id: "17841400000000000", username: "ourbrand" } }),
    );

    await expect(findInstagramAccount("page-1", "Our Page", "token")).resolves.toEqual({
      id: "17841400000000000",
      username: "ourbrand",
      pageId: "page-1",
      pageName: "Our Page",
    });
  });

  it("says plainly when the Page has no linked account", async () => {
    // Meta answers an absent field, not an error, so this is where it is named.
    fetchMock.mockResolvedValueOnce(reply({ id: "page-1" }));

    await expect(findInstagramAccount("page-1", "Our Page", "token")).rejects.toThrow(
      /no Instagram professional account/i,
    );
  });

  it("surfaces Meta's refusal rather than a blank failure", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ error: { message: "Invalid OAuth access token", code: 190 } }, 401),
    );

    await expect(findInstagramAccount("page-1", "Our Page", "token")).rejects.toThrow(
      /Invalid OAuth access token/,
    );
  });
});

describe("readPublishingLimit", () => {
  it("reports what Meta says is spent, not a remembered number (§65)", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] }),
    );

    await expect(readPublishingLimit("ig-1", "token")).resolves.toEqual({ used: 3, limit: 100 });
  });
});
