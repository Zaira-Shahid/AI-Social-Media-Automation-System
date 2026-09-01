import "server-only";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import type { BrandSettings, CompanySettings } from "@/lib/brand/schema";
import type { Platform, VisualConcept } from "@/lib/content/schema";
import { logger } from "@/lib/logger";
import { loadFontsFor } from "@/lib/render/fonts";
import { buildCard } from "@/lib/render/templates";

/**
 * Static card rendering (spec §14, §15).
 *
 * §15's pipeline exactly: JSX and a CSS subset through Satori to SVG, then
 * resvg to PNG. Headless Chromium is not used and is not a fallback — it is
 * heavy and unnecessary for text-and-branding cards, and §15 rules it out.
 */

/**
 * Render sizes, per platform.
 *
 * §28 requires storing at final size and avoiding delivery transformations,
 * since both draw from the same credit pool — so the size is decided here,
 * once, and the stored asset is the one that publishes.
 *
 * The square is Instagram's; Meta's own publishing documentation gives 1:1 as
 * the default aspect ratio. The landscape size is **ours**, a conventional
 * 1.91:1 that suits both Facebook and LinkedIn; neither platform's exact
 * recommendation was verified, so it is not presented as theirs (§65).
 */
export const RENDER_SIZES: Record<Platform, { width: number; height: number }> = {
  INSTAGRAM: { width: 1080, height: 1080 },
  FACEBOOK: { width: 1200, height: 630 },
  LINKEDIN: { width: 1200, height: 630 },
};

/**
 * The image format each platform's asset is stored in.
 *
 * **Instagram's Content Publishing API accepts JPEG only** — verified against
 * Meta's documentation on 2026-09-01, which states plainly that "JPEG is the
 * only image format supported". A PNG stored for Instagram would render
 * perfectly, pass review, and then fail at publish time in Module 13.
 *
 * The conversion happens once, at upload, rather than as a delivery
 * transformation on every fetch (§28).
 */
export const STORED_FORMAT: Record<Platform, "png" | "jpg"> = {
  INSTAGRAM: "jpg",
  FACEBOOK: "png",
  LINKEDIN: "png",
};

export interface RenderInput {
  visual: VisualConcept;
  brand: BrandSettings;
  company: CompanySettings;
  platform: Platform;
  /** The company's own logo bytes, already fetched. Never a remote reference. */
  logoDataUri: string | null;
}

/**
 * Render one card to a PNG buffer.
 *
 * Throws rather than returning a placeholder. §67 means a post must never
 * claim an image it does not have, and a grey rectangle that looks like a card
 * is exactly that claim.
 */
export async function renderCard(input: RenderInput): Promise<Buffer> {
  const { width, height } = RENDER_SIZES[input.platform];

  const fonts = await loadFontsFor(
    input.brand.typography.headingFont,
    input.brand.typography.bodyFont,
  );

  const element = buildCard({
    visual: input.visual,
    brand: input.brand,
    companyName: input.company.name,
    logoDataUri: input.logoDataUri,
    width,
    height,
  });

  const svg = await satori(element, { width, height, fonts });

  /*
   * Rendered at exactly the SVG's own size: resvg would happily scale, and a
   * scaled raster of text is softer than one drawn at its final size.
   */
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();

  logger.debug("Rendered a static card", {
    platform: input.platform,
    template: input.visual.template,
    bytes: png.length,
  });

  return Buffer.from(png);
}
