import { describe, expect, it } from "vitest";

import {
  EMPTY_BRAND_SETTINGS,
  EMPTY_COMPANY_SETTINGS,
  brandSettingsSchema,
  companySettingsSchema,
  isBrandConfigured,
} from "@/lib/brand/schema";

/**
 * Brand validation (spec §11, §31, §58).
 *
 * Firestore enforces no schema, so these tests are the only thing standing
 * between a malformed brand profile and every module that generates from it.
 */
const VALID_BRAND = {
  ...EMPTY_BRAND_SETTINGS,
  toneOfVoice: "Direct and practical",
  targetAudience: "Operations leads at mid-size logistics firms",
  preferredTopics: ["automation", "logistics"],
  topicsToAvoid: ["politics"],
  hashtagRules: { maxHashtags: 5, required: ["ourbrand"], banned: ["follow4follow"], style: "" },
  contentRules: ["Never promise delivery times"],
};

describe("companySettingsSchema", () => {
  it("requires a company name", () => {
    const result = companySettingsSchema.safeParse({ ...EMPTY_COMPANY_SETTINGS, name: "" });

    expect(result.success).toBe(false);
  });

  it("accepts an empty website but rejects a malformed one", () => {
    expect(
      companySettingsSchema.safeParse({ ...EMPTY_COMPANY_SETTINGS, name: "Acme", website: "" })
        .success,
    ).toBe(true);

    expect(
      companySettingsSchema.safeParse({
        ...EMPTY_COMPANY_SETTINGS,
        name: "Acme",
        website: "acme.com",
      }).success,
    ).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const result = companySettingsSchema.parse({
      ...EMPTY_COMPANY_SETTINGS,
      name: "  Acme  ",
    });

    expect(result.name).toBe("Acme");
  });
});

describe("brandSettingsSchema", () => {
  it("accepts a complete profile", () => {
    expect(brandSettingsSchema.safeParse(VALID_BRAND).success).toBe(true);
  });

  it("rejects a colour that is not hex, since the renderer resolves no names", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      colors: { ...VALID_BRAND.colors, primary: "rebeccapurple" },
    });

    expect(result.success).toBe(false);
  });

  it("accepts both three- and six-digit hex", () => {
    expect(
      brandSettingsSchema.safeParse({
        ...VALID_BRAND,
        colors: { ...VALID_BRAND.colors, primary: "#fff", accent: "#1D4ED8" },
      }).success,
    ).toBe(true);
  });

  it("rejects a font the renderer does not ship", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      typography: { headingFont: "Comic Sans MS", bodyFont: "Inter" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a topic that is both preferred and avoided", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      preferredTopics: ["automation"],
      topicsToAvoid: ["automation"],
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].message).toContain("automation");
  });

  it("catches that conflict regardless of casing", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      preferredTopics: ["Automation"],
      topicsToAvoid: ["automation"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a hashtag that is both required and banned", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      hashtagRules: { maxHashtags: 5, required: ["ourbrand"], banned: ["ourbrand"], style: "" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a hashtag limit lower than the required hashtags", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      hashtagRules: { maxHashtags: 1, required: ["a", "b", "c"], banned: [], style: "" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects more hashtags than any platform accepts", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      hashtagRules: { ...VALID_BRAND.hashtagRules, maxHashtags: 31 },
    });

    expect(result.success).toBe(false);
  });

  it("normalizes topics to lowercase and drops duplicates", () => {
    const result = brandSettingsSchema.parse({
      ...VALID_BRAND,
      preferredTopics: ["Automation", "automation", "Logistics"],
      topicsToAvoid: [],
    });

    expect(result.preferredTopics).toEqual(["automation", "logistics"]);
  });

  it("drops blank rules rather than rejecting the form", () => {
    const result = brandSettingsSchema.parse({
      ...VALID_BRAND,
      contentRules: ["Keep it factual", "", "   "],
    });

    expect(result.contentRules).toEqual(["Keep it factual"]);
  });

  it("accepts a null logo", () => {
    expect(brandSettingsSchema.safeParse({ ...VALID_BRAND, logo: null }).success).toBe(true);
  });

  it("rejects a logo without a public id, which could not be replaced or deleted", () => {
    const result = brandSettingsSchema.safeParse({
      ...VALID_BRAND,
      logo: { url: "https://example.com/l.png", publicId: "", width: 10, height: 10 },
    });

    expect(result.success).toBe(false);
  });
});

describe("isBrandConfigured", () => {
  it("reports an untouched profile as unusable and says what is missing", () => {
    const { configured, missing } = isBrandConfigured(EMPTY_COMPANY_SETTINGS, EMPTY_BRAND_SETTINGS);

    expect(configured).toBe(false);
    expect(missing).toContain("Company name");
    expect(missing).toContain("Tone of voice");
    expect(missing).toContain("Target audience");
    expect(missing).toContain("Logo");
  });

  it("reports a filled profile as usable", () => {
    const { configured, missing } = isBrandConfigured(
      { ...EMPTY_COMPANY_SETTINGS, name: "Acme" },
      {
        ...VALID_BRAND,
        logo: { url: "https://example.com/l.png", publicId: "brand/logo", width: 64, height: 64 },
      },
    );

    expect(configured).toBe(true);
    expect(missing).toEqual([]);
  });

  it("still reports a profile that parses but has no voice as unusable", () => {
    const { configured, missing } = isBrandConfigured(
      { ...EMPTY_COMPANY_SETTINGS, name: "Acme" },
      {
        ...EMPTY_BRAND_SETTINGS,
        logo: { url: "https://example.com/l.png", publicId: "brand/logo", width: 64, height: 64 },
      },
    );

    expect(configured).toBe(false);
    expect(missing).toEqual(["Tone of voice", "Target audience"]);
  });
});
