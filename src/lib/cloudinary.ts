import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { getServerEnv } from "@/lib/env.server";

/**
 * Cloudinary is the media store for generated static post images (spec §28).
 * Firebase Storage is deliberately not used — it requires the paid Blaze plan.
 *
 * Uploads are always signed and server-side (§15). Unsigned client-side
 * upload presets are excluded, because they would require exposing upload
 * credentials to the browser.
 *
 * Module 00 only configures and verifies credentials. The upload pipeline
 * itself belongs to Module 08.
 */
let configured = false;

export function getCloudinary() {
  if (!configured) {
    const env = getServerEnv();

    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    configured = true;
  }

  return cloudinary;
}

/**
 * Verify the configured credentials actually authenticate.
 *
 * Uses the lightweight `ping` Admin API call. Intended for setup
 * verification, not for the health-check endpoint — that must stay free of
 * external calls (§28).
 */
export async function verifyCloudinaryCredentials(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    await getCloudinary().api.ping();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Cloudinary error",
    };
  }
}
