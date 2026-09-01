import type { Platform } from "@/lib/content/schema";

/**
 * The provider adapter contract (spec §20, §21, §66; Module 16).
 *
 * §20 and Module 16 both require this interface to exist **before** any
 * individual provider adapter is written, so every adapter is built to one
 * contract rather than refactored into one afterwards. This file is that
 * contract and nothing else: the orchestration around it — provider
 * selection, retry safety, writing PUBLISHED or FAILED back onto the post —
 * is Module 16's, and none of it is here.
 *
 * The rest of the application depends on this file, never on a platform's
 * API shape (§20).
 */

/**
 * What an adapter can actually do today (§66).
 *
 * REAL — the platform is integrated and calls reach it.
 * MOCK — the integration is simulated; nothing leaves this system.
 * UNAVAILABLE — the platform offers no path we can use, and one cannot be
 * configured. §21/§67: this is never presented as "not connected yet", which
 * would imply an OAuth click would fix it.
 */
export type AdapterMode = "REAL" | "MOCK" | "UNAVAILABLE";

/**
 * What an adapter is being asked to publish.
 *
 * Deliberately the finished article: a caption already assembled from copy,
 * hashtags and CTA, and a public image URL. An adapter formats for its own
 * platform's API; it does not compose content, and it never reads the brand
 * or the story.
 */
export interface PublishRequest {
  /** Our own platform post id, for logs and for the caller's bookkeeping. */
  platformPostId: string;
  platform: Platform;
  /** The full text as it should appear, hashtags and CTA included. */
  message: string;
  /**
   * Public URL of the rendered card (§15).
   *
   * Required. Every platform in scope either requires media or reads far
   * better with it, and §14's MVP publishes cards, not bare text.
   */
  mediaUrl: string;
}

/** Credentials for one connected account, already decrypted by the caller. */
export interface PublishCredentials {
  /** The account this publishes to — a Page id, an IG user id, a URN. */
  accountId: string;
  accessToken: string;
}

export interface PublishSuccess {
  ok: true;
  mode: AdapterMode;
  /**
   * The platform's own id for the created post (§16, §32, §53).
   *
   * Stored so a retry can tell "already published" from "never published",
   * which is what makes publishing idempotent rather than hopeful.
   */
  providerPostId: string;
  /** A link a human can open, where the platform gives one. */
  permalink: string | null;
}

export interface PublishFailure {
  ok: false;
  mode: AdapterMode;
  /** What went wrong, in words that belong on a post's `lastError` (§52). */
  reason: string;
  /**
   * Is trying again later reasonable?
   *
   * A rate limit or a network fault is retryable; a rejected token or a
   * refused image is not, and retrying it would only burn quota and hide the
   * real problem (§52's "retry when safe").
   */
  retryable: boolean;
  /** The platform's own error code, where it gives one. For diagnosis only. */
  providerCode?: string | number;
}

export type PublishResult = PublishSuccess | PublishFailure;

/**
 * What an adapter reports about itself, for §42's screen and §66's labelling.
 *
 * `limitation` is where an adapter says plainly what it cannot do — an
 * UNAVAILABLE platform must explain why, rather than looking like an account
 * nobody has connected yet.
 */
export interface AdapterCapability {
  platform: Platform;
  mode: AdapterMode;
  /** Human-readable, shown in the UI. Never a stack trace, never a token. */
  detail: string;
  limitation: string | null;
}

export interface ProviderAdapter {
  readonly platform: Platform;
  readonly mode: AdapterMode;

  /** What this adapter can do right now, given how it is configured. */
  describe(): AdapterCapability;

  /**
   * Publish one post.
   *
   * Returns a result rather than throwing for anything the platform refused:
   * a failure is data the caller has to store on the post (§52), not an
   * exception to be swallowed. Adapters must never return `ok: true` unless
   * the platform confirmed the post and returned its id (§67).
   */
  publish(request: PublishRequest, credentials: PublishCredentials): Promise<PublishResult>;
}
