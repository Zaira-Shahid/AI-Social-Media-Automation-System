import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishRequest } from "@/lib/publishing/adapter";
import {
  fetchMemberIdentity,
  introspectToken,
  LinkedInAdapter,
  LINKEDIN_API_VERSION,
  missingScopes,
} from "@/lib/publishing/linkedin";

/**
 * The LinkedIn adapter (spec §19, §20, §21, §52, §66, §67).
 *
 * `fetch` is replaced; LinkedIn is never called (§58). What is under test is
 * the part that is ours: that the register/upload/post sequence happens in the
 * right order, that the post id is read from the header where LinkedIn
 * actually puts it, which failures are worth retrying, and that nothing
 * invents a success.
 */
const request: PublishRequest = {
  platformPostId: "post-1",
  platform: "LINKEDIN",
  message: "A caption #ai",
  mediaUrl: "https://res.cloudinary.com/our-cloud/image/upload/posts/post-1.png",
};

const credentials = { accountId: "urn:li:person:abc123", accessToken: "member-token" };

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as Response;
}

function card(bytes = 8) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(bytes),
    json: async () => ({}),
  } as Response;
}

/** Register → download the card → PUT the bytes → create the post. */
function happyPath() {
  fetchMock
    .mockResolvedValueOnce(
      json({ value: { uploadUrl: "https://upload.linkedin.example/1", image: "urn:li:image:i1" } }),
    )
    .mockResolvedValueOnce(card())
    .mockResolvedValueOnce(json({}, 201))
    .mockResolvedValueOnce(json({}, 201, { "x-restli-id": "urn:li:share:999" }));
}

describe("LinkedInAdapter.publish", () => {
  it("registers an upload, sends the bytes, then creates the post", async () => {
    happyPath();

    const result = await new LinkedInAdapter().publish(request, credentials);

    expect(result).toMatchObject({
      ok: true,
      mode: "REAL",
      providerPostId: "urn:li:share:999",
      permalink: "https://www.linkedin.com/feed/update/urn:li:share:999/",
    });

    const [registerUrl, registerInit] = fetchMock.mock.calls[0];
    expect(registerUrl).toBe("https://api.linkedin.com/rest/images?action=initializeUpload");
    expect(JSON.parse(String((registerInit as RequestInit).body))).toEqual({
      initializeUploadRequest: { owner: credentials.accountId },
    });

    // The card is downloaded from Cloudinary, because LinkedIn will not fetch it.
    expect(fetchMock.mock.calls[1][0]).toBe(request.mediaUrl);

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[2];
    expect(uploadUrl).toBe("https://upload.linkedin.example/1");
    expect((uploadInit as RequestInit).method).toBe("PUT");

    const [postUrl, postInit] = fetchMock.mock.calls[3];
    expect(postUrl).toBe("https://api.linkedin.com/rest/posts");

    const body = JSON.parse(String((postInit as RequestInit).body));
    expect(body).toMatchObject({
      author: credentials.accountId,
      commentary: request.message,
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      content: { media: { id: "urn:li:image:i1" } },
    });
  });

  it("sends the version and protocol headers LinkedIn requires on every REST call", async () => {
    happyPath();

    await new LinkedInAdapter().publish(request, credentials);

    for (const index of [0, 3]) {
      const headers = (fetchMock.mock.calls[index][1] as RequestInit).headers as Record<
        string,
        string
      >;

      expect(headers["linkedin-version"]).toBe(LINKEDIN_API_VERSION);
      expect(headers["x-restli-protocol-version"]).toBe("2.0.0");
    }
  });

  it("is not a success when the post id header is absent (§67)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          value: { uploadUrl: "https://upload.linkedin.example/1", image: "urn:li:image:i1" },
        }),
      )
      .mockResolvedValueOnce(card())
      .mockResolvedValueOnce(json({}, 201))
      // 201, but no x-restli-id — the id lives only in that header.
      .mockResolvedValueOnce(json({}, 201));

    const result = await new LinkedInAdapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: false });
    if (!result.ok) expect(result.reason).toContain("unconfirmed");
  });

  it("is not a success when the upload registration returns no URL", async () => {
    fetchMock.mockResolvedValueOnce(json({ value: {} }));

    const result = await new LinkedInAdapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: false });
    // Nothing was uploaded and no post was attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not post when the card cannot be downloaded", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          value: { uploadUrl: "https://upload.linkedin.example/1", image: "urn:li:image:i1" },
        }),
      )
      .mockResolvedValueOnce(json({}, 404));

    const result = await new LinkedInAdapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/rest/posts"))).toBe(false);
  });

  it("refuses an empty card rather than posting a blank image", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          value: { uploadUrl: "https://upload.linkedin.example/1", image: "urn:li:image:i1" },
        }),
      )
      .mockResolvedValueOnce(card(0));

    const result = await new LinkedInAdapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: false });
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("does not post when the byte upload is refused", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          value: { uploadUrl: "https://upload.linkedin.example/1", image: "urn:li:image:i1" },
        }),
      )
      .mockResolvedValueOnce(card())
      .mockResolvedValueOnce(json({}, 400));

    const result = await new LinkedInAdapter().publish(request, credentials);

    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/rest/posts"))).toBe(false);
  });

  it("marks a write conflict and a rate limit retryable, and a denied scope not", async () => {
    for (const [status, retryable] of [
      [409, true],
      [429, true],
      [503, true],
      [403, false],
      [401, false],
      [422, false],
    ] as const) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json({ message: "no", status }, status));

      await expect(new LinkedInAdapter().publish(request, credentials)).resolves.toMatchObject({
        ok: false,
        retryable,
      });
    }
  });

  it("treats an unreachable LinkedIn as retryable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(new LinkedInAdapter().publish(request, credentials)).resolves.toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("never puts the token in a logged failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce(json({ message: "no" }, 400));
    await new LinkedInAdapter().publish(request, credentials);

    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(credentials.accessToken);
    }

    warn.mockRestore();
  });
});

describe("LinkedInAdapter.describe", () => {
  it("names both things the self-serve tier cannot do (§66)", () => {
    const capability = new LinkedInAdapter().describe();

    expect(capability).toMatchObject({ platform: "LINKEDIN", mode: "REAL" });
    // The company Page and analytics are limitations, not missing features.
    expect(capability.limitation).toContain("Personal profile only");
    expect(capability.limitation).toContain("r_member_social");
  });
});

describe("fetchMemberIdentity", () => {
  it("builds the author URN from the OIDC subject", async () => {
    fetchMock.mockResolvedValueOnce(json({ sub: "abc123", name: "Jamie Doe" }));

    await expect(fetchMemberIdentity("token")).resolves.toEqual({
      urn: "urn:li:person:abc123",
      name: "Jamie Doe",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.linkedin.com/v2/userinfo");
  });

  it("says which scopes are needed when the identity call is refused", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Not enough permissions" }, 403));

    await expect(fetchMemberIdentity("token")).rejects.toThrow(/openid and profile/);
  });
});

describe("introspectToken", () => {
  it("converts LinkedIn's epoch seconds into a real expiry date (§19)", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        active: true,
        status: "active",
        expires_at: 1_800_000_000,
        scope: "openid,profile,w_member_social",
      }),
    );

    await expect(introspectToken("id", "secret", "token")).resolves.toEqual({
      active: true,
      status: "active",
      expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
      scopes: ["openid", "profile", "w_member_social"],
    });
  });

  it("reports an inactive token rather than storing it", async () => {
    fetchMock.mockResolvedValueOnce(json({ active: false, status: "expired" }));

    await expect(introspectToken("id", "secret", "token")).resolves.toMatchObject({
      active: false,
      status: "expired",
    });
  });

  it("names the client secret when LinkedIn rejects it", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401));

    await expect(introspectToken("id", "secret", "token")).rejects.toThrow(
      /LINKEDIN_CLIENT_SECRET/,
    );
  });
});

describe("missingScopes", () => {
  it("returns nothing when everything needed is granted", () => {
    expect(missingScopes(["openid", "profile", "w_member_social", "email"])).toEqual([]);
  });

  it("names the publishing scope when it is absent", () => {
    expect(missingScopes(["openid", "profile"])).toEqual(["w_member_social"]);
  });
});
