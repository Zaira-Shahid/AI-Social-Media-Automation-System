import { describe, expect, it } from "vitest";

import { EMPTY_BRAND_SETTINGS, EMPTY_COMPANY_SETTINGS, SUPPORTED_FONTS } from "@/lib/brand/schema";
import { VISUAL_TEMPLATES, type VisualConcept } from "@/lib/content/schema";
import { renderCard, RENDER_SIZES, STORED_FORMAT } from "@/lib/render/card";
import { loadFont } from "@/lib/render/fonts";
import { isOwnCloudinaryAsset } from "@/lib/render/assets";

/**
 * Static card rendering (spec §14, §15).
 *
 * These tests render for real — Satori and resvg both run locally with no
 * network and no key, so there is no reason to mock the one part of this
 * module that can actually be wrong. A template that overflows, a font that
 * fails to parse or a colour Satori cannot resolve all surface here rather
 * than as a blank card in production.
 */
const COMPANY = { ...EMPTY_COMPANY_SETTINGS, name: "Example Co" };

function concept(overrides: Partial<VisualConcept> = {}): VisualConcept {
  return {
    template: "HEADLINE_CARD",
    headline: "AI agents take over support desks",
    supportingText: "One retailer moved its whole desk in a quarter.",
    emphasis: "PRIMARY",
    ...overrides,
  };
}

/** PNG dimensions live in the IHDR chunk, at a fixed offset. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function isPng(buffer: Buffer): boolean {
  return buffer.subarray(1, 4).toString() === "PNG";
}

describe("fonts", () => {
  it("ships every font the brand form offers (§15 has no fallback)", async () => {
    for (const family of SUPPORTED_FONTS) {
      const loaded = await loadFont(family);

      expect(loaded.map((font) => font.weight).sort()).toEqual([400, 700]);
      expect(loaded.every((font) => font.data.length > 0)).toBe(true);
    }
  });

  it("loads bold as genuinely different data from regular", async () => {
    const [regular, bold] = await loadFont("Inter");

    // Satori picks a weight by matching the data it was given; two identical
    // buffers would mean bold silently rendering as regular.
    expect(regular.data.equals(bold.data)).toBe(false);
  });
});

describe("renderCard", () => {
  it("renders every template to a real PNG", async () => {
    for (const template of VISUAL_TEMPLATES) {
      const png = await renderCard({
        visual: concept({ template }),
        brand: EMPTY_BRAND_SETTINGS,
        company: COMPANY,
        platform: "LINKEDIN",
        logoDataUri: null,
      });

      expect(isPng(png), `${template} should produce a PNG`).toBe(true);
      expect(png.length).toBeGreaterThan(1_000);
    }
  });

  it("renders at each platform's final size, so nothing is transformed later (§28)", async () => {
    for (const platform of ["FACEBOOK", "INSTAGRAM", "LINKEDIN"] as const) {
      const png = await renderCard({
        visual: concept(),
        brand: EMPTY_BRAND_SETTINGS,
        company: COMPANY,
        platform,
        logoDataUri: null,
      });

      expect(pngSize(png)).toEqual(RENDER_SIZES[platform]);
    }
  });

  it("stores Instagram as JPEG, which its publishing API requires", () => {
    expect(STORED_FORMAT.INSTAGRAM).toBe("jpg");
    expect(STORED_FORMAT.LINKEDIN).toBe("png");
  });

  it("renders a long headline without failing", async () => {
    const png = await renderCard({
      visual: concept({
        headline:
          "A deliberately long headline that keeps going well past any sensible length for a card so the size arithmetic has to cope",
      }),
      brand: EMPTY_BRAND_SETTINGS,
      company: COMPANY,
      platform: "INSTAGRAM",
      logoDataUri: null,
    });

    expect(isPng(png)).toBe(true);
  });

  it("falls back to the headline treatment when a statistic card has no number", async () => {
    const withFigure = await renderCard({
      visual: concept({ template: "STATISTIC_CARD", headline: "42% of desks are automated" }),
      brand: EMPTY_BRAND_SETTINGS,
      company: COMPANY,
      platform: "LINKEDIN",
      logoDataUri: null,
    });

    const withoutFigure = await renderCard({
      visual: concept({ template: "STATISTIC_CARD", headline: "Most desks are automated" }),
      brand: EMPTY_BRAND_SETTINGS,
      company: COMPANY,
      platform: "LINKEDIN",
      logoDataUri: null,
    });

    // Both render; they simply do not render the same way.
    expect(isPng(withFigure)).toBe(true);
    expect(isPng(withoutFigure)).toBe(true);
    expect(withFigure.equals(withoutFigure)).toBe(false);
  });

  it("applies the brand's chosen fonts", async () => {
    const inter = await renderCard({
      visual: concept(),
      brand: EMPTY_BRAND_SETTINGS,
      company: COMPANY,
      platform: "LINKEDIN",
      logoDataUri: null,
    });

    const montserrat = await renderCard({
      visual: concept(),
      brand: {
        ...EMPTY_BRAND_SETTINGS,
        typography: { headingFont: "Montserrat", bodyFont: "Montserrat" },
      },
      company: COMPANY,
      platform: "LINKEDIN",
      logoDataUri: null,
    });

    expect(inter.equals(montserrat)).toBe(false);
  });

  it("is deterministic for the same input", async () => {
    const input = {
      visual: concept(),
      brand: EMPTY_BRAND_SETTINGS,
      company: COMPANY,
      platform: "LINKEDIN" as const,
      logoDataUri: null,
    };

    expect((await renderCard(input)).equals(await renderCard(input))).toBe(true);
  });
});

describe("isOwnCloudinaryAsset", () => {
  it("accepts an asset in our own account", () => {
    expect(
      isOwnCloudinaryAsset(
        "https://res.cloudinary.com/our-cloud/image/upload/brand/logo.png",
        "our-cloud",
      ),
    ).toBe(true);
  });

  it("rejects another account's asset on the same host (§14)", () => {
    // The host alone proves nothing: res.cloudinary.com serves every account
    // on the platform.
    expect(
      isOwnCloudinaryAsset(
        "https://res.cloudinary.com/someone-else/image/upload/logo.png",
        "our-cloud",
      ),
    ).toBe(false);
  });

  it("rejects a publisher's own CDN", () => {
    expect(isOwnCloudinaryAsset("https://publisher.example.com/hero.jpg", "our-cloud")).toBe(false);
  });

  it("rejects http and unparseable values", () => {
    expect(
      isOwnCloudinaryAsset(
        "http://res.cloudinary.com/our-cloud/image/upload/logo.png",
        "our-cloud",
      ),
    ).toBe(false);
    expect(isOwnCloudinaryAsset("not a url", "our-cloud")).toBe(false);
  });
});
