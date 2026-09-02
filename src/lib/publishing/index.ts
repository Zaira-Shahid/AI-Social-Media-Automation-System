import "server-only";

import type { Platform } from "@/lib/content/schema";
import { getServerEnv } from "@/lib/env.server";
import type { AdapterCapability, ProviderAdapter } from "@/lib/publishing/adapter";
import { FacebookAdapter } from "@/lib/publishing/facebook";
import { InstagramAdapter } from "@/lib/publishing/instagram";
import { MockPublishAdapter } from "@/lib/publishing/mock";

/**
 * Adapter selection (spec §20, §21, §30, §66).
 *
 * One place decides which adapter runs for a platform. Module 16's publishing
 * service will ask for a `ProviderAdapter` and never learn which one it got,
 * beyond the `mode` it must record and display.
 *
 * The default is mock everywhere: nothing reaches a real account until
 * somebody sets the provider deliberately (§58 keeps the test runs off live
 * services, and the same switch keeps development off them).
 */

const NOT_BUILT_YET: Record<Platform, string> = {
  FACEBOOK: "",
  INSTAGRAM: "",
  LINKEDIN: "The LinkedIn integration is Module 14.",
};

export function getAdapter(platform: Platform): ProviderAdapter {
  const env = getServerEnv();

  if (platform === "FACEBOOK") {
    return env.FACEBOOK_PROVIDER === "graph"
      ? new FacebookAdapter()
      : new MockPublishAdapter(
          platform,
          "FACEBOOK_PROVIDER is 'mock', so nothing reaches the Page. Set it to 'graph' to publish for real.",
        );
  }

  if (platform === "INSTAGRAM") {
    return env.INSTAGRAM_PROVIDER === "graph"
      ? new InstagramAdapter()
      : new MockPublishAdapter(
          platform,
          "INSTAGRAM_PROVIDER is 'mock', so nothing reaches the account. Set it to 'graph' to publish for real.",
        );
  }

  return new MockPublishAdapter(platform, NOT_BUILT_YET[platform]);
}

/** What every platform can do right now, for §42's screen. */
export function describeAdapters(platforms: readonly Platform[]): AdapterCapability[] {
  return platforms.map((platform) => getAdapter(platform).describe());
}
