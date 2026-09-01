import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { SUPPORTED_FONTS } from "@/lib/brand/schema";

/**
 * Font data for Satori (spec §15).
 *
 * §15 is explicit: "Fonts must be supplied explicitly as font data; there is
 * no system font fallback." A brand configured with a font this project does
 * not ship would render as nothing at all, so the set of fonts the brand form
 * offers and the set shipped here are the same list, and a missing file is a
 * loud failure rather than a blank card.
 *
 * **Static weights, not variable fonts.** Verified on 2026-09-01: Satori's
 * bundled opentype.js throws parsing the `fvar` table of the variable builds
 * Google Fonts now publishes, so those are unusable here. The bundled files
 * are Fontsource's latin 400 and 700 WOFF builds — 252 KB for all five
 * families, against roughly 900 KB for a single variable TTF.
 */
export type FontWeight = 400 | 700;

export interface LoadedFont {
  name: string;
  data: Buffer;
  weight: FontWeight;
  style: "normal";
}

/** Filenames are derived, so adding a family is a download plus a schema entry. */
const FILE_NAMES: Record<(typeof SUPPORTED_FONTS)[number], string> = {
  Inter: "inter",
  Roboto: "roboto",
  "Open Sans": "open-sans",
  Lato: "lato",
  Montserrat: "montserrat",
};

const WEIGHTS: FontWeight[] = [400, 700];

/**
 * Read from the repository rather than from a CDN.
 *
 * A render that reaches the network to fetch a font gains a failure mode and a
 * latency spike for nothing — the files never change between deploys.
 */
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

/*
 * Cached for the life of the process. A card render is measured in tens of
 * milliseconds; re-reading a quarter of a megabyte from disk for each one
 * would dominate that.
 */
const cache = new Map<string, LoadedFont[]>();

export async function loadFont(family: (typeof SUPPORTED_FONTS)[number]): Promise<LoadedFont[]> {
  const cached = cache.get(family);

  if (cached) return cached;

  const slug = FILE_NAMES[family];

  const loaded = await Promise.all(
    WEIGHTS.map(async (weight) => {
      const file = path.join(FONT_DIR, `${slug}-${weight}.woff`);

      try {
        return {
          name: family,
          data: await readFile(file),
          weight,
          style: "normal" as const,
        };
      } catch {
        // §15 leaves no fallback, so this cannot be recovered from — and a
        // card rendered with no glyphs is worse than a failed render (§67).
        throw new Error(
          `Font file missing: ${slug}-${weight}.woff. Static post rendering needs it, and Satori has no system font fallback.`,
        );
      }
    }),
  );

  cache.set(family, loaded);

  return loaded;
}

/**
 * Every font one card needs: the heading family and the body family.
 *
 * Deduplicated, because a brand that uses one family for both would otherwise
 * hand Satori the same font twice and load it twice.
 */
export async function loadFontsFor(
  headingFont: (typeof SUPPORTED_FONTS)[number],
  bodyFont: (typeof SUPPORTED_FONTS)[number],
): Promise<LoadedFont[]> {
  if (headingFont === bodyFont) return loadFont(headingFont);

  const [heading, body] = await Promise.all([loadFont(headingFont), loadFont(bodyFont)]);

  return [...heading, ...body];
}
