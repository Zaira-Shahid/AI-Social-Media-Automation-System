import "server-only";

import { getCloudinary } from "@/lib/cloudinary";
import { logger } from "@/lib/logger";
import { ACCEPTED_LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/brand/logo.shared";
import type { BrandLogo } from "@/lib/brand/schema";

/**
 * Brand logo storage (spec §15, §28).
 *
 * Uploads are signed and server-side. Unsigned client-side presets would
 * require handing upload credentials to the browser (§15).
 */

/** Where brand assets live, kept out of the way of generated post images. */
const LOGO_FOLDER = "brand";

export { ACCEPTED_LOGO_TYPES, MAX_LOGO_BYTES };

export type LogoUploadResult = { ok: true; logo: BrandLogo } | { ok: false; error: string };

/**
 * Upload a logo, replacing any previous one.
 *
 * A single eager resize is applied at upload time rather than transforming on
 * delivery. §28 is explicit that transformations draw from the same credit
 * pool as storage and bandwidth, so paying once at upload is cheaper than
 * paying per view — and the logo is fetched on every generated card.
 */
export async function uploadLogo(
  file: File,
  previousPublicId: string | null,
): Promise<LogoUploadResult> {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type as (typeof ACCEPTED_LOGO_TYPES)[number])) {
    return { ok: false, error: "Logo must be a PNG or SVG file." };
  }

  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "Logo must be 2 MB or smaller." };
  }

  if (file.size === 0) {
    return { ok: false, error: "That file is empty." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUri = `data:${file.type};base64,${buffer.toString("base64")}`;

  try {
    const result = await getCloudinary().uploader.upload(dataUri, {
      folder: LOGO_FOLDER,
      resource_type: "image",
      // Overwrite in place: one logo, one asset, no accumulating versions.
      public_id: "logo",
      overwrite: true,
      invalidate: true,
      transformation: [{ width: 1024, height: 1024, crop: "limit" }],
    });

    // Only delete the old asset once the new one is safely stored, and only
    // if it is genuinely a different asset.
    if (previousPublicId && previousPublicId !== result.public_id) {
      await deleteLogo(previousPublicId);
    }

    return {
      ok: true,
      logo: {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
      },
    };
  } catch (error) {
    logger.error("Logo upload failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return { ok: false, error: "Could not upload the logo. Please try again." };
  }
}

/**
 * Remove a stored logo.
 *
 * Never throws. An orphaned asset costs credits but must not fail the save
 * that was otherwise successful — the alternative is a user who cannot change
 * their brand because a deletion failed.
 */
export async function deleteLogo(publicId: string): Promise<void> {
  try {
    await getCloudinary().uploader.destroy(publicId, { invalidate: true });
  } catch (error) {
    logger.warn("Could not delete the previous logo; it will keep consuming credits", {
      publicId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
