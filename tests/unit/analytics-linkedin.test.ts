import { describe, expect, it } from "vitest";

import { LinkedInAnalyticsAdapter } from "@/lib/analytics/linkedin";

/**
 * LinkedIn analytics (spec §66, §63 Module 14/17).
 *
 * §66: a closed permission must read as UNAVAILABLE, never as "not connected"
 * — nothing here suggests reconnecting the account would fix it.
 */
describe("LinkedInAnalyticsAdapter", () => {
  it("is UNAVAILABLE, and says why in words §42's screen can show", () => {
    const adapter = new LinkedInAnalyticsAdapter();

    expect(adapter.mode).toBe("UNAVAILABLE");

    const capability = adapter.describe();
    expect(capability.limitation).toContain("r_member_social");
  });

  it("never returns ok:true", async () => {
    const result = await new LinkedInAnalyticsAdapter().fetchMetrics(
      { platform: "LINKEDIN", providerPostId: "urn:li:share:1" },
      { accountId: "person-1", accessToken: "token" },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.mode).toBe("UNAVAILABLE");
  });
});
