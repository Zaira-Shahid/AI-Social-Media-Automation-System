import "server-only";

import { getBrandProfile } from "@/lib/brand/store";
import { GenerationError } from "@/lib/content/generate";
import { STORED_FORMAT, renderCard } from "@/lib/render/card";
import { deleteCard, loadLogoDataUri, uploadCard } from "@/lib/render/assets";
import {
  getPlatformPost,
  listPostsWithoutMedia,
  setPlatformPostMedia,
  setPlatformPostRenderError,
  type StoredPlatformPost,
} from "@/lib/content/store";
import { logger } from "@/lib/logger";

/**
 * Static post image generation (spec §14, §15, §28, §52, §67).
 *
 * Render, upload, then record — in that order, and never out of it. §63 is
 * explicit that "a failed upload must not leave a platform post in a state
 * that claims a usable image exists", so the document is only written once
 * Cloudinary has returned a URL for an asset that is actually stored.
 */

/**
 * How many cards one run renders.
 *
 * A day is nine (three stories, three platforms). The cap is a guard against a
 * backlog spending the Cloudinary credit pool in one run (§28), not a limit
 * anyone should meet in normal use.
 */
export const MAX_CARDS_PER_RUN = 12;

export interface MediaOutcome {
  status: "RENDERED" | "SKIPPED" | "PARTIAL" | "FAILED";
  rendered: number;
  /** Per-card failures, each with its reason. Never swallowed (§52). */
  problems: string[];
  /** True when cards were rendered without the brand logo. */
  missingLogo: boolean;
  detail: string | null;
}

/**
 * Render and store the image for one post.
 *
 * Returns the failure rather than throwing, so one bad card does not stop the
 * eight beside it — §17 gives every platform its own fate, and that applies to
 * its image as much as to its copy.
 */
async function renderOne(
  post: StoredPlatformPost,
  brand: Awaited<ReturnType<typeof getBrandProfile>>,
  logoDataUri: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const png = await renderCard({
      visual: post.visual,
      brand: brand.brand,
      company: brand.company,
      platform: post.platform,
      logoDataUri,
    });

    const uploaded = await uploadCard(png, {
      // Deterministic, so a re-render replaces the asset rather than adding
      // one. Orphans consume credits for the life of the account (§28).
      publicId: post.id,
      format: STORED_FORMAT[post.platform],
    });

    /*
     * Only now is the document written. Between the render and this line the
     * post still says it has no image, which is true — §67's whole point.
     */
    await setPlatformPostMedia(post.id, {
      mediaUrl: uploaded.url,
      mediaPublicId: uploaded.publicId,
    });

    logger.info("Rendered and stored a card", {
      platformPostId: post.id,
      platform: post.platform,
      bytes: uploaded.bytes,
    });

    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await setPlatformPostRenderError(post.id, reason);

    logger.error("Card rendering failed", { platformPostId: post.id, error: reason });

    return { ok: false, reason: `${post.platform}: ${reason}` };
  }
}

/**
 * Render every post still waiting for an image.
 *
 * A missing brand logo does **not** stop this. A card without a logo is still
 * a brand-coloured, correctly typeset card, and refusing to produce any image
 * over one asset would block the pipeline for a cosmetic reason. The run
 * reports it instead. (Module 07's plan note put this more strongly than the
 * behaviour warrants; this is what actually happens.)
 */
export async function renderPendingCards(): Promise<MediaOutcome> {
  const profile = await getBrandProfile();

  if (!profile.company.name) {
    // The company name is rendered on every card, so this one really is
    // required — unlike the logo.
    throw new GenerationError(
      "The company name is not set, so nothing was rendered. Fill it in on the brand screen.",
    );
  }

  const posts = await listPostsWithoutMedia(MAX_CARDS_PER_RUN);

  if (posts.length === 0) {
    return {
      status: "SKIPPED",
      rendered: 0,
      problems: [],
      missingLogo: false,
      detail: "Every generated post already has an image.",
    };
  }

  // Fetched once for the whole run rather than per card: §28 spends bandwidth
  // credits on each fetch.
  const logoDataUri = await loadLogoDataUri(profile.brand.logo);

  const problems: string[] = [];
  let rendered = 0;

  for (const post of posts) {
    const result = await renderOne(post, profile, logoDataUri);

    if (result.ok) rendered += 1;
    else problems.push(result.reason);
  }

  return {
    status: rendered === 0 ? "FAILED" : problems.length > 0 ? "PARTIAL" : "RENDERED",
    rendered,
    problems,
    missingLogo: logoDataUri === null,
    detail: null,
  };
}

/**
 * Re-render one post's image.
 *
 * Used after a caption or concept has been rewritten. The old asset is
 * overwritten in place by the deterministic public id, so nothing is orphaned
 * — `deleteCard` is only needed when a stored id differs from the one this
 * run would write, which happens if the naming scheme ever changes.
 */
export async function renderCardForPost(platformPostId: string): Promise<{ url: string }> {
  const post = await getPlatformPost(platformPostId);

  if (!post) throw new GenerationError("That post no longer exists.");

  const profile = await getBrandProfile();
  const logoDataUri = await loadLogoDataUri(profile.brand.logo);

  if (post.mediaPublicId && post.mediaPublicId !== `posts/${post.id}`) {
    await deleteCard(post.mediaPublicId);
  }

  const result = await renderOne(post, profile, logoDataUri);

  if (!result.ok) throw new GenerationError(result.reason);

  const updated = await getPlatformPost(platformPostId);

  if (!updated?.mediaUrl) {
    // Belt and braces: the write above succeeded, so this should be
    // unreachable. If it is not, the honest answer is a failure, not a URL.
    throw new GenerationError("The image was rendered but could not be read back.");
  }

  return { url: updated.mediaUrl };
}
