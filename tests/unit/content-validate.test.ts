import { describe, expect, it } from "vitest";

import { EMPTY_BRAND_SETTINGS, type BrandSettings } from "@/lib/brand/schema";
import type { PlatformVersion } from "@/lib/content/generation-schema";
import { applyHashtagRules, containsUrl, validatePlatformVersion } from "@/lib/content/validate";
import { PLATFORM_LIMITS } from "@/lib/content/schema";

/**
 * Business rules on generated content (spec §11, §14, §31).
 *
 * §14's image sourcing rule is the one that matters most here: it is a legal
 * requirement, and §14 says in as many words that it must be enforced in code
 * rather than documented. So it is tested as a rule, including the case where
 * the model invents a URL nobody gave it.
 */
function brand(overrides: Partial<BrandSettings> = {}): BrandSettings {
  return { ...EMPTY_BRAND_SETTINGS, ...overrides };
}

function version(overrides: Partial<PlatformVersion> = {}): PlatformVersion {
  return {
    platform: "LINKEDIN",
    caption: "A caption about an AI story.",
    hashtags: ["ai", "automation"],
    cta: "Read more",
    visual: {
      template: "HEADLINE_CARD",
      headline: "AI agents take over support desks",
      supportingText: "One retailer moved its whole desk.",
      emphasis: "PRIMARY",
    },
    ...overrides,
  };
}

describe("containsUrl", () => {
  it("catches the forms a model actually produces", () => {
    expect(containsUrl("https://example.com/photo.jpg")).toBe(true);
    expect(containsUrl("see www.example.com for the image")).toBe(true);
    expect(containsUrl("http://example.com")).toBe(true);
    expect(containsUrl("A headline with no link in it")).toBe(false);
  });
});

describe("applyHashtagRules", () => {
  it("normalizes away the leading hash, spaces and case", () => {
    expect(
      applyHashtagRules(["#AI", " Machine Learning "], EMPTY_BRAND_SETTINGS.hashtagRules),
    ).toEqual(["ai", "machinelearning"]);
  });

  it("drops banned tags", () => {
    const rules = { ...EMPTY_BRAND_SETTINGS.hashtagRules, banned: ["crypto"] };

    expect(applyHashtagRules(["ai", "#Crypto"], rules)).toEqual(["ai"]);
  });

  it("adds required tags the model left out", () => {
    const rules = { ...EMPTY_BRAND_SETTINGS.hashtagRules, required: ["ourbrand"] };

    expect(applyHashtagRules(["ai"], rules)).toEqual(["ourbrand", "ai"]);
  });

  it("puts required tags first, so a tight cap never drops them", () => {
    const rules = { ...EMPTY_BRAND_SETTINGS.hashtagRules, required: ["ourbrand"], maxHashtags: 1 };

    expect(applyHashtagRules(["ai", "automation"], rules)).toEqual(["ourbrand"]);
  });

  it("removes duplicates that differ only in case or hash", () => {
    expect(applyHashtagRules(["ai", "#AI", "Ai"], EMPTY_BRAND_SETTINGS.hashtagRules)).toEqual([
      "ai",
    ]);
  });

  it("caps at the brand's maximum", () => {
    const rules = { ...EMPTY_BRAND_SETTINGS.hashtagRules, maxHashtags: 2 };

    expect(applyHashtagRules(["a", "b", "c", "d"], rules)).toHaveLength(2);
  });
});

describe("validatePlatformVersion", () => {
  it("accepts a well-formed version and returns the repaired hashtags", () => {
    const result = validatePlatformVersion(version({ hashtags: ["#AI", "AI"] }), brand());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version.hashtags).toEqual(["ai"]);
  });

  it("refuses a visual concept containing a URL (§14)", () => {
    const result = validatePlatformVersion(
      version({
        visual: {
          template: "HEADLINE_CARD",
          headline: "Use this photo",
          supportingText: "https://publisher.example.com/photo.jpg",
          emphasis: "PRIMARY",
        },
      }),
      brand(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/§14/);
  });

  it("refuses a URL a model invented in the card headline", () => {
    const result = validatePlatformVersion(
      version({
        visual: {
          template: "HEADLINE_CARD",
          headline: "See www.example.com",
          supportingText: "",
          emphasis: "PRIMARY",
        },
      }),
      brand(),
    );

    expect(result.ok).toBe(false);
  });

  it("refuses an empty caption", () => {
    const result = validatePlatformVersion(version({ caption: "   " }), brand());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty/i);
  });

  it("counts hashtags against the caption limit, because they publish together", () => {
    const rules = { ...EMPTY_BRAND_SETTINGS.hashtagRules, maxHashtags: 30 };
    const justUnder = "x".repeat(PLATFORM_LIMITS.INSTAGRAM.captionChars - 10);

    const result = validatePlatformVersion(
      version({
        platform: "INSTAGRAM",
        caption: justUnder,
        hashtags: ["averylonghashtagindeed"],
      }),
      brand({ hashtagRules: rules }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/over the 2200 limit/);
  });

  it("never silently truncates an over-long caption", () => {
    const result = validatePlatformVersion(
      version({ platform: "LINKEDIN", caption: "x".repeat(4_000), hashtags: [] }),
      brand(),
    );

    // §67: a machine-trimmed caption can lose its call to action and still
    // look finished, so this is refused rather than repaired.
    expect(result.ok).toBe(false);
  });

  it("applies each platform's own limit", () => {
    const caption = "x".repeat(2_500);

    expect(
      validatePlatformVersion(version({ platform: "LINKEDIN", caption, hashtags: [] }), brand()).ok,
    ).toBe(true);
    expect(
      validatePlatformVersion(version({ platform: "INSTAGRAM", caption, hashtags: [] }), brand())
        .ok,
    ).toBe(false);
    expect(
      validatePlatformVersion(version({ platform: "FACEBOOK", caption, hashtags: [] }), brand()).ok,
    ).toBe(false);
  });
});
