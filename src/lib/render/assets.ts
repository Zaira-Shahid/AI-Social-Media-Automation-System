import "server-only";

import { getServerEnv } from "@/lib/env.server";
import { getCloudinary } from "@/lib/cloudinary";
import { logger } from "@/lib/logger";
import type { BrandLogo } from "@/lib/brand/schema";

/**
 * Brand assets for the renderer (spec §14, §15, §28).
 *
 * §14 allows exactly two sources for anything appearing in a generated post:
 * our own templates, and company-owned Cloudinary assets. This module is the
 * only place an image enters the pipeline, and it refuses anything that is not
 * from our own Cloudinary account — the rule is enforced here rather than
 * trusted to the templates, because the templates have no way to check where a
 * URL came from.
 */

/** Where generated cards are stored, kept apart from brand assets. */
export const POST_FOLDER = "posts";

/**
 * Is this URL an asset in our own Cloudinary account?
 *
 * Host and cloud name both, because `res.cloudinary.com` serves every account
 * on the platform — matching the host alone would accept somebody else's
 * asset, which is precisely what §14 exists to prevent.
 */
export function isOwnCloudinaryAsset(url: string, cloudName: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "res.cloudinary.com") return false;

  return parsed.pathname.startsWith(`/${cloudName}/`);
}

/*
 * Cached for the life of the process, keyed by URL. A logo is fetched once and
 * reused across every card in a run: §28 spends bandwidth credits on each
 * fetch, and a nine-card day would otherwise pay for nine identical downloads.
 */
const logoCache = new Map<string, string>();

/**
 * Satori renders SVG through the same image path as a raster, and support is
 * uneven. Asking Cloudinary for a PNG once is more reliable than discovering
 * at render time that a card came out blank — and it is a single conversion,
 * not a per-delivery transformation (§28).
 */
function rasterUrl(url: string): string {
  if (!url.toLowerCase().endsWith(".svg")) return url;

  return url.replace("/upload/", "/upload/f_png/");
}

/**
 * Fetch the brand logo and inline it as a data URI.
 *
 * Returns null rather than throwing when the logo cannot be fetched. A card
 * without its logo is still a usable, brand-coloured card; failing the whole
 * render over it would turn a cosmetic problem into no content at all.
 */
export async function loadLogoDataUri(logo: BrandLogo | null): Promise<string | null> {
  if (!logo) return null;

  const cloudName = getServerEnv().CLOUDINARY_CLOUD_NAME;

  if (!isOwnCloudinaryAsset(logo.url, cloudName)) {
    // §14 is a legal constraint, so this is refused loudly rather than
    // rendered and explained afterwards.
    logger.error("Refusing a brand logo that is not hosted in our Cloudinary account", {
      host: (() => {
        try {
          return new URL(logo.url).hostname;
        } catch {
          return "unparseable";
        }
      })(),
    });

    return null;
  }

  const url = rasterUrl(logo.url);
  const cached = logoCache.get(url);

  if (cached) return cached;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      logger.warn("Could not fetch the brand logo for rendering", { status: response.status });
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;

    logoCache.set(url, dataUri);

    return dataUri;
  } catch (error) {
    logger.warn("Could not fetch the brand logo for rendering", {
      error: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

export interface UploadedCard {
  url: string;
  publicId: string;
  bytes: number;
}

/**
 * Store a rendered card (§15, §28).
 *
 * Signed and server-side, like every upload in this system — an unsigned
 * preset would mean handing upload credentials to a browser.
 *
 * The asset is stored at its final size and in its final format, with no
 * delivery transformation attached: §28 charges transformations from the same
 * credit pool as storage and bandwidth, so a URL that transforms on every
 * fetch is paid for on every fetch.
 */
export async function uploadCard(
  png: Buffer,
  options: { publicId: string; format: "png" | "jpg" },
): Promise<UploadedCard> {
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;

  const result = await getCloudinary().uploader.upload(dataUri, {
    folder: POST_FOLDER,
    resource_type: "image",
    /*
     * Deterministic and overwritten in place, so re-rendering a post replaces
     * its image instead of accumulating one asset per attempt. Each orphan
     * would keep consuming credits for the life of the account.
     */
    public_id: options.publicId,
    overwrite: true,
    invalidate: true,
    // One eager conversion at upload, not a transformation on every view.
    format: options.format,
  });

  return { url: result.secure_url, publicId: result.public_id, bytes: result.bytes };
}

/**
 * Remove a stored card.
 *
 * Never throws. An orphaned asset costs credits, but failing the operation
 * that was otherwise successful costs more.
 */
export async function deleteCard(publicId: string): Promise<void> {
  try {
    await getCloudinary().uploader.destroy(publicId, { invalidate: true });
  } catch (error) {
    logger.warn("Could not delete a generated card; it will keep consuming credits", {
      publicId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
