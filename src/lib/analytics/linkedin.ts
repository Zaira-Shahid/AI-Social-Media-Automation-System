import type {
  AnalyticsAdapter,
  AnalyticsCapability,
  AnalyticsCredentials,
  AnalyticsRequest,
  AnalyticsResult,
} from "@/lib/analytics/adapter";

/**
 * LinkedIn analytics — unavailable (spec §19, §22, §66, §63 Module 14/17).
 *
 * Module 14 confirmed against LinkedIn's own documentation that
 * `r_member_social` — the permission post analytics need — is "restricted
 * and available to approved users only", and that LinkedIn is not accepting
 * requests for it. Nothing has changed since; this is not "not connected", it
 * is a closed door, and §66 requires it be shown as exactly that rather than
 * as an account someone forgot to link.
 */
export class LinkedInAnalyticsAdapter implements AnalyticsAdapter {
  readonly platform = "LINKEDIN" as const;
  readonly mode = "UNAVAILABLE" as const;

  describe(): AnalyticsCapability {
    return {
      platform: this.platform,
      mode: this.mode,
      detail: "No analytics are read from LinkedIn.",
      limitation:
        "r_member_social, the permission LinkedIn post analytics require, is restricted to " +
        "approved users only and LinkedIn is not accepting requests for it (verified " +
        "2026-09-02, Module 14). This cannot be fixed by reconnecting the account.",
    };
  }

  async fetchMetrics(
    request: AnalyticsRequest,
    credentials: AnalyticsCredentials,
  ): Promise<AnalyticsResult> {
    void request;
    void credentials;

    return {
      ok: false,
      mode: this.mode,
      reason: "LinkedIn analytics are unavailable: r_member_social is a closed permission.",
    };
  }
}
