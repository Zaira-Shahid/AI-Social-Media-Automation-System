import type {
  AdapterCapability,
  ProviderAdapter,
  PublishCredentials,
  PublishRequest,
  PublishResult,
} from "@/lib/publishing/adapter";
import type { Platform } from "@/lib/content/schema";
import { logger } from "@/lib/logger";

/**
 * Simulated publishing (spec §21, §66, §67).
 *
 * §21 permits mock publishing and fixes what it may never do: claim a post
 * reached a platform. So the result carries `mode: "MOCK"` — stored, not
 * merely returned — and the id it invents is visibly fake rather than a
 * plausible Facebook id somebody could paste into a URL.
 */
export class MockPublishAdapter implements ProviderAdapter {
  readonly mode = "MOCK" as const;

  constructor(
    readonly platform: Platform,
    /** Why this adapter is simulated, in words §42's screen can show. */
    private readonly why: string,
  ) {}

  describe(): AdapterCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail: `Simulated. Nothing reaches ${this.platform}.`,
      limitation: this.why,
    };
  }

  async publish(request: PublishRequest, credentials: PublishCredentials): Promise<PublishResult> {
    void credentials;

    logger.info("Simulated a publish", {
      platform: this.platform,
      platformPostId: request.platformPostId,
    });

    return {
      ok: true,
      mode: this.mode,
      // "mock-" so nothing downstream can mistake it for a platform id (§67).
      providerPostId: `mock-${this.platform.toLowerCase()}-${request.platformPostId}`,
      permalink: null,
    };
  }
}
