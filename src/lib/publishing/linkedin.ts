import type {
  AdapterCapability,
  ProviderAdapter,
  PublishCredentials,
  PublishRequest,
  PublishResult,
} from "@/lib/publishing/adapter";
import { logger } from "@/lib/logger";

/**
 * LinkedIn publishing (spec §19, §20, §52, §63 Module 14, §65, §66).
 *
 * Module −1 rated the **personal profile** REAL and the **company page**
 * UNAVAILABLE, and left one question open for this module. Everything below
 * was checked against LinkedIn's own documentation on 2026-09-02 (§65 forbids
 * asserting any of it from memory):
 *
 * 1. **Posting is `POST /rest/posts`** with `author`, `commentary`,
 *    `visibility`, `distribution`, `content.media` and `lifecycleState`. The
 *    created post id comes back in the **`x-restli-id` response header**, not
 *    in the body — the body of a 201 is empty.
 *    https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *
 * 2. **An image must be uploaded, not linked.** Unlike Meta, LinkedIn will not
 *    fetch a public URL: `POST /rest/images?action=initializeUpload` returns an
 *    `uploadUrl` and an image URN, the bytes go to that URL by **PUT** with the
 *    OAuth token attached, and the URN is then referenced in the post. So this
 *    adapter downloads the card from Cloudinary and re-uploads it.
 *    https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
 *    PNG is supported ("JPG, GIF, and PNG formats"), which is what Module 08
 *    already stores for LinkedIn — nothing has to convert.
 *
 * 3. **Module −1's open question — is "Sign In with LinkedIn using OpenID
 *    Connect" strictly required? — is answered: yes.** `/rest/posts` needs an
 *    `author` URN, and the only self-serve way to learn the member's own id is
 *    the OIDC `userinfo` endpoint, whose `sub` field becomes
 *    `urn:li:person:{sub}`. So the app needs both products: "Share on
 *    LinkedIn" for `w_member_social` and "Sign In with LinkedIn using OpenID
 *    Connect" for `openid`/`profile`.
 *
 * 4. **The 60-day token is real and cannot be refreshed** on this tier, which
 *    is why `expiresAt` here is a genuine date read from token introspection
 *    rather than the `null` Facebook and Instagram store (§19).
 */

/**
 * Pinned deliberately, in LinkedIn's `YYYYMM` format.
 *
 * LinkedIn sunsets a version about a year out — the docs currently warn that
 * 202508 goes on 2026-08-17 — so an unpinned call would break without a
 * deploy. `202608` is the version the documentation defaults to.
 */
export const LINKEDIN_API_VERSION = "202608";

const REST_BASE = "https://api.linkedin.com/rest";
const OAUTH_BASE = "https://www.linkedin.com/oauth/v2";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

/**
 * The scopes the pasted token must carry, for §42's screen.
 *
 * `w_member_social` posts; `openid` and `profile` are what make the author URN
 * knowable (note 3 above). Both products are self-serve — no App Review, which
 * is the whole reason the personal profile is REAL and the company page is not.
 */
export const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"] as const;

/** Every request needs both of these. Stated once so no call can forget one. */
function restHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "x-restli-protocol-version": "2.0.0",
    "linkedin-version": LINKEDIN_API_VERSION,
  };
}

interface LinkedInError {
  message?: string;
  status?: number;
  code?: string;
  serviceErrorCode?: number;
}

function describeError(payload: LinkedInError | undefined, status: number): string {
  const message = payload?.message ?? "no message";

  return `LinkedIn refused the request: ${message} (HTTP ${status}${
    payload?.code ? `, ${payload.code}` : ""
  }).`;
}

/**
 * Is trying again later reasonable (§52)?
 *
 * LinkedIn's own error table calls 409 "A write conflict occurred. Retry the
 * request." and 429 a rate limit; 500 and 503 say to retry. Everything else —
 * a missing token, a denied scope, a malformed post, an image it could not
 * process — is a decision, and retrying it would only burn quota and hide the
 * real problem.
 */
function isRetryableStatus(status: number): boolean {
  return status === 409 || status === 429 || status >= 500;
}

function failed(reason: string, retryable: boolean, providerCode?: string | number): PublishResult {
  return { ok: false, mode: "REAL", reason, retryable, providerCode };
}

export class LinkedInAdapter implements ProviderAdapter {
  readonly platform = "LINKEDIN" as const;
  readonly mode = "REAL" as const;

  describe(): AdapterCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail: `Publishes single-image posts to a member's LinkedIn profile through the versioned REST API (${LINKEDIN_API_VERSION}).`,
      /*
       * Both limitations are named rather than hidden. §63's rule for this
       * module is to implement the real integration where it exists and
       * document the limitation where it does not — and here two things
       * genuinely do not exist on the self-serve tier.
       */
      limitation:
        "Personal profile only — posting as a company Page needs the Community Management API, which requires two-tier App Review, a registered company and a verified Page. Post analytics are unavailable: r_member_social is a closed permission LinkedIn is not granting. The token expires after 60 days and cannot be refreshed programmatically, so a human must reconnect.",
    };
  }

  /**
   * Publish one card.
   *
   * Three calls: register an upload, send the bytes, create the post. A
   * failure at any step returns a reason rather than throwing (§52), and
   * `ok: true` is returned only once LinkedIn has answered with a post id —
   * §67 allows nothing else to count as published.
   */
  async publish(request: PublishRequest, credentials: PublishCredentials): Promise<PublishResult> {
    const registration = await this.initializeUpload(credentials);

    if (!registration.ok) return registration.failure;

    const bytes = await this.downloadCard(request.mediaUrl);

    if (!bytes.ok) return bytes.failure;

    const uploaded = await this.uploadBytes(registration.uploadUrl, bytes.body, credentials);

    if (!uploaded.ok) return uploaded.failure;

    return this.createPost(registration.image, request, credentials);
  }

  /** `POST /rest/images?action=initializeUpload` — reserve an image URN. */
  private async initializeUpload(
    credentials: PublishCredentials,
  ): Promise<
    { ok: true; uploadUrl: string; image: string } | { ok: false; failure: PublishResult }
  > {
    let response: Response;

    try {
      response = await fetch(`${REST_BASE}/images?action=initializeUpload`, {
        method: "POST",
        headers: { ...restHeaders(credentials.accessToken), "content-type": "application/json" },
        body: JSON.stringify({
          // The member is the owner; `accountId` here is the person URN.
          initializeUploadRequest: { owner: credentials.accountId },
        }),
      });
    } catch (error) {
      return {
        ok: false,
        failure: failed(
          `Could not reach LinkedIn: ${error instanceof Error ? error.message : String(error)}`,
          true,
        ),
      };
    }

    let payload: { value?: { uploadUrl?: string; image?: string } } & LinkedInError;

    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      return {
        ok: false,
        failure: failed(
          `LinkedIn answered HTTP ${response.status} with a body this adapter could not read.`,
          isRetryableStatus(response.status),
        ),
      };
    }

    if (!response.ok) {
      logger.warn("LinkedIn refused an image upload registration", { status: response.status });

      return {
        ok: false,
        failure: failed(
          describeError(payload, response.status),
          isRetryableStatus(response.status),
          payload.code ?? response.status,
        ),
      };
    }

    const uploadUrl = payload.value?.uploadUrl;
    const image = payload.value?.image;

    if (!uploadUrl || !image) {
      return {
        ok: false,
        failure: failed(
          "LinkedIn accepted the upload registration but returned no upload URL, so the card cannot be sent.",
          false,
        ),
      };
    }

    return { ok: true, uploadUrl, image };
  }

  /**
   * Fetch the rendered card from Cloudinary.
   *
   * LinkedIn will not fetch a URL itself, so the bytes have to pass through
   * this process. A card that cannot be downloaded is a failure worth
   * retrying — Cloudinary being briefly unreachable says nothing about the
   * post.
   */
  private async downloadCard(
    mediaUrl: string,
  ): Promise<{ ok: true; body: ArrayBuffer } | { ok: false; failure: PublishResult }> {
    let response: Response;

    try {
      response = await fetch(mediaUrl);
    } catch (error) {
      return {
        ok: false,
        failure: failed(
          `Could not download the rendered card: ${
            error instanceof Error ? error.message : String(error)
          }`,
          true,
        ),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        failure: failed(
          `The rendered card could not be downloaded (HTTP ${response.status}).`,
          response.status >= 500,
        ),
      };
    }

    const body = await response.arrayBuffer();

    if (body.byteLength === 0) {
      return {
        ok: false,
        failure: failed(
          "The rendered card downloaded as an empty file, so there is nothing to post.",
          false,
        ),
      };
    }

    return { ok: true, body };
  }

  /** PUT the bytes to the URL LinkedIn handed back. */
  private async uploadBytes(
    uploadUrl: string,
    body: ArrayBuffer,
    credentials: PublishCredentials,
  ): Promise<{ ok: true } | { ok: false; failure: PublishResult }> {
    let response: Response;

    try {
      response = await fetch(uploadUrl, {
        method: "PUT",
        /*
         * The image upload — unlike the video one — requires the OAuth token.
         * LinkedIn's documentation is explicit about the difference.
         */
        headers: { authorization: `Bearer ${credentials.accessToken}` },
        body,
      });
    } catch (error) {
      return {
        ok: false,
        failure: failed(
          `Could not upload the card to LinkedIn: ${
            error instanceof Error ? error.message : String(error)
          }`,
          true,
        ),
      };
    }

    if (!response.ok) {
      logger.warn("LinkedIn refused the card upload", { status: response.status });

      return {
        ok: false,
        failure: failed(
          `LinkedIn refused the card upload (HTTP ${response.status}).`,
          isRetryableStatus(response.status),
          response.status,
        ),
      };
    }

    return { ok: true };
  }

  /** `POST /rest/posts` — the call that actually publishes. */
  private async createPost(
    image: string,
    request: PublishRequest,
    credentials: PublishCredentials,
  ): Promise<PublishResult> {
    let response: Response;

    try {
      response = await fetch(`${REST_BASE}/posts`, {
        method: "POST",
        headers: { ...restHeaders(credentials.accessToken), "content-type": "application/json" },
        body: JSON.stringify({
          author: credentials.accountId,
          commentary: request.message,
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          content: { media: { id: image } },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
      });
    } catch (error) {
      return failed(
        `Could not reach LinkedIn: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    if (!response.ok) {
      let payload: LinkedInError | undefined;

      try {
        payload = (await response.json()) as LinkedInError;
      } catch {
        payload = undefined;
      }

      logger.warn("LinkedIn refused a post", {
        platformPostId: request.platformPostId,
        status: response.status,
      });

      return failed(
        describeError(payload, response.status),
        isRetryableStatus(response.status),
        payload?.code ?? response.status,
      );
    }

    /*
     * The id is in a header, not the body — a 201 here has an empty body. A
     * response without it is not a success no matter what status came with it
     * (§67): without an id nothing downstream could tell a retry that this
     * was already published.
     */
    const providerPostId = response.headers.get("x-restli-id");

    if (!providerPostId) {
      return failed(
        "LinkedIn accepted the post but returned no post id, so publication is unconfirmed.",
        false,
      );
    }

    logger.info("Published to LinkedIn", {
      platformPostId: request.platformPostId,
      providerPostId,
    });

    return {
      ok: true,
      mode: this.mode,
      providerPostId,
      // LinkedIn's own documented shape for viewing a published post.
      permalink: `https://www.linkedin.com/feed/update/${providerPostId}/`,
    };
  }
}

export interface LinkedInMember {
  /** `urn:li:person:{sub}` — what a post is authored by. */
  urn: string;
  name: string;
}

/**
 * Who this token belongs to.
 *
 * OIDC's `userinfo`; `sub` is the member id. This is the call Module −1 was
 * unsure was needed — it is, because `/rest/posts` cannot be called without an
 * author URN and nothing else self-serve will tell us one.
 */
export async function fetchMemberIdentity(accessToken: string): Promise<LinkedInMember> {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const payload = (await response.json()) as { sub?: string; name?: string } & LinkedInError;

  if (!response.ok || !payload.sub) {
    throw new Error(
      `${describeError(payload, response.status)} The token needs the openid and profile scopes.`,
    );
  }

  return { urn: `urn:li:person:${payload.sub}`, name: payload.name ?? payload.sub };
}

export interface TokenIntrospection {
  active: boolean;
  status: string | null;
  /** ISO 8601, converted from LinkedIn's epoch **seconds**. Null if absent. */
  expiresAt: string | null;
  scopes: string[];
}

/**
 * Ask LinkedIn what this token actually is (§19, §65).
 *
 * `expiresAt` has to be a real date here, not a guess. Facebook and Instagram
 * store `null` because their Page tokens genuinely do not expire; LinkedIn's
 * does, in about 60 days, and §19 wants a warning 5–7 days out. Assuming
 * "now + 60 days" would put a countdown on §42's screen that drifts from the
 * truth by however long the token sat before it was pasted in — so the real
 * value is read instead.
 *
 * https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection
 */
export async function introspectToken(
  clientId: string,
  clientSecret: string,
  token: string,
): Promise<TokenIntrospection> {
  const response = await fetch(`${OAUTH_BASE}/introspectToken`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
  });

  if (!response.ok) {
    // 400 is a bad client id or token; 401 is a bad client secret.
    throw new Error(
      response.status === 401
        ? "LinkedIn rejected the client secret. Check LINKEDIN_CLIENT_SECRET."
        : `LinkedIn could not inspect that token (HTTP ${response.status}). Check the token and LINKEDIN_CLIENT_ID.`,
    );
  }

  const payload = (await response.json()) as {
    active?: boolean;
    status?: string;
    expires_at?: number;
    scope?: string;
  };

  return {
    active: payload.active === true,
    status: payload.status ?? null,
    // Epoch **seconds**, per the documented field type.
    expiresAt: payload.expires_at ? new Date(payload.expires_at * 1000).toISOString() : null,
    scopes: payload.scope ? payload.scope.split(",").map((scope) => scope.trim()) : [],
  };
}

/** The scopes that are missing for publishing, or an empty list. */
export function missingScopes(granted: readonly string[]): string[] {
  return LINKEDIN_SCOPES.filter((required) => !granted.includes(required));
}
