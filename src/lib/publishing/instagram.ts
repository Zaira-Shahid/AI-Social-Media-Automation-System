import type {
  AdapterCapability,
  ProviderAdapter,
  PublishCredentials,
  PublishRequest,
  PublishResult,
} from "@/lib/publishing/adapter";
import { GRAPH_API_VERSION } from "@/lib/publishing/facebook";
import { logger } from "@/lib/logger";

/**
 * Instagram publishing (spec §19, §20, §52, §63 Module 13, §65).
 *
 * Module −1 left three things to "confirm in Module 13". All three were
 * checked against Meta's own documentation on 2026-09-02 (§65 forbids
 * asserting any of this from memory), and the answers are recorded here
 * because they shape the code:
 *
 * 1. **Publishing is two calls, not one.** `POST /{ig-user-id}/media` creates
 *    a container, then `POST /{ig-user-id}/media_publish` publishes it.
 *    https://developers.facebook.com/docs/instagram-platform/content-publishing
 *
 * 2. **The media must be a public URL, and JPEG.** "We cURL media used in
 *    publishing attempts, so the media must be hosted on a publicly
 *    accessible server at the time of the attempt", and "JPEG is the only
 *    image format supported. Extended JPEG formats such as MPO and JPS are
 *    not supported." Module 08 already stores the Instagram card as JPEG on
 *    Cloudinary for exactly this reason, so nothing has to convert here — but
 *    this adapter refuses a non-JPEG URL rather than letting Meta refuse it
 *    after a container has been created.
 *
 * 3. **The permission names.** Module −1 recorded
 *    `instagram_business_basic` / `instagram_business_content_publish` as
 *    UNVERIFIED. They are real, but they belong to *Instagram Login*. This
 *    system uses *Facebook Login* — the Page is already connected in Module
 *    12 and the Instagram account hangs off it — and that path's documented
 *    scopes are `instagram_basic`, `instagram_content_publish` and
 *    `pages_read_engagement`. Those are the ones the connect screen asks for.
 *
 * 4. **The quota Module −1 asked about exists**: "Instagram accounts are
 *    limited to 100 API-published posts within a 24-hour moving period",
 *    readable at `GET /{ig-user-id}/content_publishing_limit`. Three posts a
 *    day (§3) is nowhere near it, so the scheduler is not changed; the
 *    reading is exposed below so Module 20 can show it rather than guess.
 */

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * The scopes the connecting user's token must carry, for §42's screen.
 *
 * The Facebook Login set, not the Instagram Login set — see note 3 above.
 * `pages_show_list` is inherited from Module 12's connect flow, which is what
 * finds the Page the Instagram account is attached to.
 */
export const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
] as const;

/** Meta's documented cap, shown rather than assumed. */
export const INSTAGRAM_DAILY_POST_LIMIT = 100;

/** Meta's advice is to poll once a minute for no more than five minutes. */
export const CONTAINER_POLL_ATTEMPTS = 5;
export const CONTAINER_POLL_INTERVAL_MS = 60_000;

/**
 * Error codes worth trying again (§52).
 *
 * 1 and 2 are Meta's transient "unknown"/"service" errors; 4, 17 and 32 are
 * its rate-limit codes, and 9007 is the Instagram publishing limit itself.
 * Everything else — a rejected token, a refused image, a permission that was
 * never granted — is a decision, and retrying it would burn quota while
 * hiding the real problem.
 */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 9007]);

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
}

interface ContainerResponse {
  id?: string;
  error?: GraphError;
}

interface StatusResponse {
  status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  error?: GraphError;
}

interface PublishResponse {
  id?: string;
  error?: GraphError;
}

interface PermalinkResponse {
  permalink?: string;
  error?: GraphError;
}

function describeGraphError(error: GraphError | undefined, status: number): string {
  if (!error) return `Instagram refused the request (HTTP ${status}).`;

  // `error_user_msg` is Meta's own wording for a human; prefer it when present.
  const message = error.error_user_msg ?? error.message ?? "no message";

  return `Instagram refused the request: ${message} (code ${error.code ?? "none"}).`;
}

function failed(reason: string, retryable: boolean, providerCode?: string | number): PublishResult {
  return { ok: false, mode: "REAL", reason, retryable, providerCode };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Does this URL look like the JPEG Instagram insists on?
 *
 * Checked before a container is created, because a container is a resource on
 * Meta's side: creating one that can never publish spends quota and leaves a
 * dangling object behind. Cloudinary URLs carry the extension, which is what
 * makes this checkable at all — a path with no extension is allowed through
 * rather than guessed at, and Meta judges it instead.
 */
export function isJpegUrl(url: string): boolean {
  let path: string;

  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }

  const lastDot = path.lastIndexOf(".");
  const extension = lastDot === -1 ? "" : path.slice(lastDot);

  if (!extension) return true;

  return extension === ".jpg" || extension === ".jpeg";
}

export class InstagramAdapter implements ProviderAdapter {
  readonly platform = "INSTAGRAM" as const;
  readonly mode = "REAL" as const;

  constructor(
    private readonly pollAttempts = CONTAINER_POLL_ATTEMPTS,
    private readonly pollIntervalMs = CONTAINER_POLL_INTERVAL_MS,
  ) {}

  describe(): AdapterCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail: `Publishes single-image feed posts to an Instagram professional account through Graph API ${GRAPH_API_VERSION}.`,
      /*
       * Named, not hidden. §63's rule for this module is to implement the
       * real integration where it exists and document the limitation where it
       * does not — this is the part that genuinely is not built.
       */
      limitation:
        "Single JPEG feed images only. Stories, Reels and carousels are out of scope, comments are not handled, and analytics are Module 17.",
    };
  }

  /**
   * Publish one card.
   *
   * Container, then publish. A failure at either step returns a reason rather
   * than throwing, because the caller has to store it on the post (§52), and
   * `ok: true` is returned only once Instagram has answered with a media id —
   * §67 allows nothing else to count as published.
   */
  async publish(request: PublishRequest, credentials: PublishCredentials): Promise<PublishResult> {
    if (!isJpegUrl(request.mediaUrl)) {
      return failed(
        "Instagram accepts JPEG only, and this card is not a .jpg. Re-render it before publishing.",
        false,
      );
    }

    const container = await this.createContainer(request, credentials);

    if (!container.ok) return container.failure;

    const ready = await this.waitForContainer(container.id, credentials);

    if (!ready.ok) return ready.failure;

    return this.publishContainer(container.id, request, credentials);
  }

  /** `POST /{ig-user-id}/media` — the container Meta fetches the image for. */
  private async createContainer(
    request: PublishRequest,
    credentials: PublishCredentials,
  ): Promise<{ ok: true; id: string } | { ok: false; failure: PublishResult }> {
    const body = new URLSearchParams({
      image_url: request.mediaUrl,
      caption: request.message,
      access_token: credentials.accessToken,
    });

    const answer = await this.post<ContainerResponse>(
      `${GRAPH_BASE}/${credentials.accountId}/media`,
      body,
    );

    if (!answer.ok) return { ok: false, failure: answer.failure };

    const id = answer.payload.id;

    if (!id) {
      return {
        ok: false,
        failure: failed(
          "Instagram accepted the image but returned no container id, so nothing can be published.",
          false,
        ),
      };
    }

    return { ok: true, id };
  }

  /**
   * Wait until the container is FINISHED.
   *
   * A single image is normally ready at once, so this checks immediately and
   * only then starts waiting, and it gives up rather than blocking a
   * scheduler run indefinitely. Still IN_PROGRESS at the end is retryable —
   * the image is fine and the container lives 24 hours, it is Meta that is
   * still working.
   */
  private async waitForContainer(
    containerId: string,
    credentials: PublishCredentials,
  ): Promise<{ ok: true } | { ok: false; failure: PublishResult }> {
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      if (attempt > 0) await sleep(this.pollIntervalMs);

      const query = new URLSearchParams({
        fields: "status_code",
        access_token: credentials.accessToken,
      });

      const answer = await this.get<StatusResponse>(
        `${GRAPH_BASE}/${containerId}?${query.toString()}`,
      );

      if (!answer.ok) return { ok: false, failure: answer.failure };

      const status = answer.payload.status_code;

      /*
       * FINISHED is "the container and its media object are ready to be
       * published". PUBLISHED means it already was — republishing is the one
       * thing that must not happen, so that is treated as arrival, not as a
       * reason to try again.
       */
      if (status === "FINISHED" || status === "PUBLISHED") return { ok: true };

      if (status === "ERROR") {
        return {
          ok: false,
          failure: failed(
            "Instagram could not process the image. Check the card is a reachable JPEG within Instagram's limits.",
            false,
          ),
        };
      }

      if (status === "EXPIRED") {
        return {
          ok: false,
          failure: failed(
            "The Instagram container expired before it could be published. Nothing was posted.",
            true,
          ),
        };
      }
    }

    return {
      ok: false,
      failure: failed(
        "Instagram was still processing the image when this attempt gave up. Nothing was published.",
        true,
      ),
    };
  }

  /** `POST /{ig-user-id}/media_publish` — the call that actually posts. */
  private async publishContainer(
    containerId: string,
    request: PublishRequest,
    credentials: PublishCredentials,
  ): Promise<PublishResult> {
    const body = new URLSearchParams({
      creation_id: containerId,
      access_token: credentials.accessToken,
    });

    const answer = await this.post<PublishResponse>(
      `${GRAPH_BASE}/${credentials.accountId}/media_publish`,
      body,
    );

    if (!answer.ok) return answer.failure;

    const providerPostId = answer.payload.id;

    if (!providerPostId) {
      return failed(
        "Instagram accepted the publish but returned no media id, so publication is unconfirmed.",
        false,
      );
    }

    logger.info("Published to Instagram", {
      platformPostId: request.platformPostId,
      providerPostId,
    });

    return {
      ok: true,
      mode: this.mode,
      providerPostId,
      permalink: await this.readPermalink(providerPostId, credentials),
    };
  }

  /**
   * The post's own URL.
   *
   * Unlike Facebook there is nothing to build one from — an Instagram media
   * id does not appear in a public URL — so it has to be asked for. A failure
   * here is not a publishing failure: the post exists either way, so this
   * returns null rather than turning a success into an error. §67 cuts both
   * ways — do not claim a link we do not have, and do not disown a post we do.
   */
  private async readPermalink(
    mediaId: string,
    credentials: PublishCredentials,
  ): Promise<string | null> {
    const query = new URLSearchParams({
      fields: "permalink",
      access_token: credentials.accessToken,
    });

    const answer = await this.get<PermalinkResponse>(
      `${GRAPH_BASE}/${mediaId}?${query.toString()}`,
    );

    return answer.ok ? (answer.payload.permalink ?? null) : null;
  }

  private post<T extends { error?: GraphError }>(url: string, body: URLSearchParams) {
    return this.call<T>(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  private get<T extends { error?: GraphError }>(url: string) {
    return this.call<T>(url, { method: "GET" });
  }

  /**
   * One Graph call, with every refusal turned into a `PublishResult`.
   *
   * Nothing here logs the request or its URL: every one of them carries a
   * token in the body or the query string (§19, §55).
   */
  private async call<T extends { error?: GraphError }>(
    url: string,
    init: RequestInit,
  ): Promise<{ ok: true; payload: T } | { ok: false; failure: PublishResult }> {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (error) {
      // Never reached Instagram at all, so trying again is reasonable.
      return {
        ok: false,
        failure: failed(
          `Could not reach Instagram: ${error instanceof Error ? error.message : String(error)}`,
          true,
        ),
      };
    }

    let payload: T;

    try {
      payload = (await response.json()) as T;
    } catch {
      return {
        ok: false,
        failure: failed(
          `Instagram answered HTTP ${response.status} with a body this adapter could not read.`,
          response.status >= 500,
        ),
      };
    }

    if (!response.ok || payload.error) {
      const code = payload.error?.code;

      logger.warn("Instagram refused a request", { status: response.status, code });

      return {
        ok: false,
        failure: failed(
          describeGraphError(payload.error, response.status),
          (code !== undefined && RETRYABLE_CODES.has(code)) || response.status >= 500,
          code,
        ),
      };
    }

    return { ok: true, payload };
  }
}

export interface InstagramAccount {
  /** The IG user id publishing goes to — not the @handle. */
  id: string;
  username: string;
  pageId: string;
  pageName: string;
}

/**
 * Find the Instagram professional account attached to a Page.
 *
 * The Page node carries `instagram_business_account`, documented as the
 * "Instagram account linked to page during Instagram business conversion
 * flow". That link is the whole reason this uses Facebook Login: the account
 * is reached through the Page Module 12 already connects, so there is no
 * second OAuth flow and still no App Review.
 *
 * https://developers.facebook.com/docs/graph-api/reference/page/
 */
export async function findInstagramAccount(
  pageId: string,
  pageName: string,
  accessToken: string,
): Promise<InstagramAccount> {
  const query = new URLSearchParams({
    fields: "instagram_business_account{id,username}",
    access_token: accessToken,
  });

  const response = await fetch(`${GRAPH_BASE}/${pageId}?${query.toString()}`);
  const payload = (await response.json()) as {
    instagram_business_account?: { id?: string; username?: string };
    error?: GraphError;
  };

  if (!response.ok || payload.error) {
    throw new Error(describeGraphError(payload.error, response.status));
  }

  const account = payload.instagram_business_account;

  /*
   * A Page with no linked account is the single most likely reason this
   * fails, and Meta's own answer for it is an absent field rather than an
   * error — so it is named here instead of surfacing as "undefined".
   */
  if (!account?.id) {
    throw new Error(
      `Page ${pageId} has no Instagram professional account linked to it. Convert the Instagram account to Business or Creator, link it to the Page, then try again.`,
    );
  }

  return {
    id: account.id,
    username: account.username ?? account.id,
    pageId,
    pageName,
  };
}

/**
 * How much of the 24-hour publishing quota is spent.
 *
 * Exposed rather than assumed, because §65 says a limit we cannot see is a
 * limit we must not claim. Nothing calls this on the publishing path — three
 * posts a day is nowhere near 100 — but Module 20's control centre can show
 * the real number instead of a remembered one.
 */
export async function readPublishingLimit(
  igUserId: string,
  accessToken: string,
): Promise<{ used: number; limit: number }> {
  const query = new URLSearchParams({
    fields: "config,quota_usage",
    access_token: accessToken,
  });

  const response = await fetch(
    `${GRAPH_BASE}/${igUserId}/content_publishing_limit?${query.toString()}`,
  );
  const payload = (await response.json()) as {
    data?: { quota_usage?: number; config?: { quota_total?: number } }[];
    error?: GraphError;
  };

  if (!response.ok || payload.error) {
    throw new Error(describeGraphError(payload.error, response.status));
  }

  const row = payload.data?.[0];

  return {
    used: row?.quota_usage ?? 0,
    limit: row?.config?.quota_total ?? INSTAGRAM_DAILY_POST_LIMIT,
  };
}
