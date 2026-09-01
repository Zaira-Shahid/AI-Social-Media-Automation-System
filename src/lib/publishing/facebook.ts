import type {
  AdapterCapability,
  ProviderAdapter,
  PublishCredentials,
  PublishRequest,
  PublishResult,
} from "@/lib/publishing/adapter";
import { logger } from "@/lib/logger";

/**
 * Facebook Page publishing (spec §19, §20, §52, §63 Module 12, §65).
 *
 * Every fact below was verified against Meta's own documentation on
 * 2026-09-01 (§65 forbids asserting any of it from memory):
 *
 * - A photo post is `POST /{page-id}/photos` with `url` — "URL of a photo that
 *   is already uploaded to the Internet" — plus `caption`, and it answers with
 *   `id` and `post_id`.
 *   https://developers.facebook.com/docs/graph-api/reference/page/photos/
 * - It requires a Page access token held by someone with the `CREATE_CONTENT`
 *   task, and the `pages_manage_posts`, `pages_read_engagement` and
 *   `pages_show_list` permissions. (Same page; `pages_manage_posts` and
 *   `pages_read_engagement` are also listed at
 *   https://developers.facebook.com/docs/pages-api/posts.)
 * - Page rate limits are Business Use Case limits: "Calls within 24 hours =
 *   4800 * Number of Engaged Users", reported in `X-Business-Use-Case-Usage`,
 *   with error code 32 or 80001 when exceeded.
 *   https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 * - v26.0 is the current Graph API version, released 2026-07-29.
 *   https://developers.facebook.com/docs/graph-api/changelog/versions/
 *
 * The card rendered by Module 08 is a PNG on Cloudinary — already a public
 * URL, which is exactly what `/photos` wants, and PNG is among the formats
 * Meta's reference lists.
 */

/**
 * Pinned deliberately.
 *
 * Meta supports each version for about two years; an unversioned call follows
 * whatever is current and would change behaviour under us without a deploy.
 */
export const GRAPH_API_VERSION = "v26.0";

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** The scopes the connecting user's token must carry. Shown on §42's screen. */
export const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
] as const;

/**
 * Error codes worth trying again (§52's "retry when safe").
 *
 * 32 and 80001 are the documented Page rate-limit codes; 1 and 2 are Meta's
 * transient "unknown"/"service" errors. Everything else — a rejected token, a
 * refused image, a permission that was never granted — is a decision, and
 * retrying it would burn quota while hiding the real problem.
 */
const RETRYABLE_CODES = new Set([1, 2, 32, 80001]);

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
}

/** What Meta answers with. Only the fields this adapter reads are declared. */
interface PhotoResponse {
  id?: string;
  post_id?: string;
  error?: GraphError;
}

function describeGraphError(error: GraphError | undefined, status: number): string {
  if (!error) return `Facebook refused the post (HTTP ${status}).`;

  // `error_user_msg` is Meta's own wording for a human; prefer it when present.
  const message = error.error_user_msg ?? error.message ?? "no message";

  return `Facebook refused the post: ${message} (code ${error.code ?? "none"}).`;
}

export class FacebookAdapter implements ProviderAdapter {
  readonly platform = "FACEBOOK" as const;
  readonly mode = "REAL" as const;

  describe(): AdapterCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail: `Publishes photo posts to a Facebook Page through Graph API ${GRAPH_API_VERSION}.`,
      /*
       * Named, not hidden. §63's Module 12 rule is to implement the real
       * integration where it exists and document the limitation where it does
       * not — this is the part that genuinely does not exist yet.
       */
      limitation:
        "Publishing only. Comment and message handling are out of scope, and analytics are Module 17.",
    };
  }

  /**
   * Publish one card to the Page.
   *
   * Returns a failure rather than throwing for anything Facebook refused: the
   * caller has to store that reason on the post (§52). `ok: true` is returned
   * only when Facebook answered with an id — §67 allows nothing else to count
   * as published.
   */
  async publish(request: PublishRequest, credentials: PublishCredentials): Promise<PublishResult> {
    const body = new URLSearchParams({
      url: request.mediaUrl,
      caption: request.message,
      access_token: credentials.accessToken,
    });

    let response: Response;

    try {
      response = await fetch(`${GRAPH_BASE}/${credentials.accountId}/photos`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error) {
      // Never reached Facebook at all, so trying again is reasonable.
      return {
        ok: false,
        mode: this.mode,
        reason: `Could not reach Facebook: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }

    let payload: PhotoResponse;

    try {
      payload = (await response.json()) as PhotoResponse;
    } catch {
      return {
        ok: false,
        mode: this.mode,
        reason: `Facebook answered HTTP ${response.status} with a body this adapter could not read.`,
        retryable: response.status >= 500,
      };
    }

    if (!response.ok || payload.error) {
      const code = payload.error?.code;

      /*
       * Logged without the token — the body carried one, so the whole request
       * is deliberately not logged (§19, §55).
       */
      logger.warn("Facebook refused a post", {
        platformPostId: request.platformPostId,
        status: response.status,
        code,
      });

      return {
        ok: false,
        mode: this.mode,
        reason: describeGraphError(payload.error, response.status),
        retryable: (code !== undefined && RETRYABLE_CODES.has(code)) || response.status >= 500,
        providerCode: code,
      };
    }

    /*
     * `post_id` is the post; `id` is the photo. Publishing wants the post, and
     * a response carrying neither is not a success no matter what HTTP status
     * came with it.
     */
    const providerPostId = payload.post_id ?? payload.id;

    if (!providerPostId) {
      return {
        ok: false,
        mode: this.mode,
        reason:
          "Facebook accepted the request but returned no post id, so publication is unconfirmed.",
        retryable: false,
      };
    }

    logger.info("Published to Facebook", {
      platformPostId: request.platformPostId,
      providerPostId,
    });

    return {
      ok: true,
      mode: this.mode,
      providerPostId,
      permalink: `https://www.facebook.com/${providerPostId}`,
    };
  }
}

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
}

/**
 * Exchange a short-lived user token for a long-lived one.
 *
 * `GET /oauth/access_token?grant_type=fb_exchange_token` with the app id and
 * secret; Meta documents the result as lasting "about 60 days" and says the
 * call must be made server-side because it carries the app secret.
 * https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 */
export async function exchangeForLongLivedUserToken(
  appId: string,
  appSecret: string,
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresAt: string | null }> {
  const query = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });

  const response = await fetch(`${GRAPH_BASE}/oauth/access_token?${query.toString()}`);
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: GraphError;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(describeGraphError(payload.error, response.status));
  }

  return {
    accessToken: payload.access_token,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null,
  };
}

/**
 * The Pages this user administers, each with its own Page token.
 *
 * Meta: a Page access token is obtained by querying the user's `accounts` edge
 * with a long-lived user token, and "Long-lived Page access token do not have
 * an expiration date and only expire or are invalidated under certain
 * conditions". That is why a Facebook account is stored with a null
 * `expiresAt` rather than an invented one.
 */
export async function listPages(userAccessToken: string): Promise<FacebookPage[]> {
  const query = new URLSearchParams({
    fields: "id,name,access_token",
    access_token: userAccessToken,
  });

  const response = await fetch(`${GRAPH_BASE}/me/accounts?${query.toString()}`);
  const payload = (await response.json()) as {
    data?: { id: string; name: string; access_token: string }[];
    error?: GraphError;
  };

  if (!response.ok || !payload.data) {
    throw new Error(describeGraphError(payload.error, response.status));
  }

  return payload.data.map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
  }));
}
