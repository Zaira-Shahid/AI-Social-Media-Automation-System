import type { BrandSettings } from "@/lib/brand/schema";
import type { PlatformVersion } from "@/lib/content/generation-schema";
import { MAX_HASHTAGS, PLATFORM_LIMITS, type Platform } from "@/lib/content/schema";

/**
 * Business rules applied to generated content (spec §11, §14, §31).
 *
 * §31's pattern is AI → structured output → Zod → **business rules** →
 * database. This is that step, and it is pure so every rule can be tested
 * directly rather than inferred from a live generation run.
 */

/**
 * §14's image sourcing rule, as code.
 *
 * §14 is explicit that this "must be enforced as a validation rule in code,
 * not merely documented", and says why: republishing a publisher's image
 * without a licence risks takedown and the loss of the company's own accounts.
 *
 * Two defences, because one is not enough. The article's `imageUrl` is never
 * put into a prompt in the first place, so the model cannot echo it back — and
 * this check rejects any URL that appears in a visual concept regardless of
 * where it came from. A model that invents a plausible image URL is exactly
 * the failure this has to catch.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;

export function containsUrl(value: string): boolean {
  return URL_PATTERN.test(value);
}

/** Normalize one hashtag: no leading '#', no spaces, no empty results. */
export function normalizeHashtag(tag: string): string {
  return tag.trim().replace(/^#+/, "").replace(/\s+/g, "").toLowerCase();
}

/**
 * Apply the brand's hashtag rules (§11).
 *
 * Deterministic repair rather than rejection, because these are the brand's
 * own rules and the correct answer is knowable: drop what is banned, add what
 * is required, remove duplicates, and cap the result. Rejecting a post because
 * the model returned a banned tag would throw away good copy over something
 * the code can simply fix.
 *
 * The cap is the stricter of the brand's own maximum and the platform ceiling.
 */
export function applyHashtagRules(
  hashtags: string[],
  rules: BrandSettings["hashtagRules"],
): string[] {
  const banned = new Set(rules.banned.map(normalizeHashtag));

  const cleaned = hashtags
    .map(normalizeHashtag)
    .filter((tag) => tag.length > 0 && !banned.has(tag));

  // Required tags go first, so a tight cap never drops the ones the brand
  // insists on.
  const required = rules.required.map(normalizeHashtag).filter((tag) => !banned.has(tag));

  const ordered = [...required, ...cleaned];
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const tag of ordered) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    unique.push(tag);
  }

  return unique.slice(0, Math.min(rules.maxHashtags, MAX_HASHTAGS));
}

export type ValidationResult =
  { ok: true; version: PlatformVersion } | { ok: false; reason: string };

/**
 * Check and repair one platform version.
 *
 * A failure here fails **that platform only**. §17 makes each platform's
 * status independent, and a caption that is too long for LinkedIn is not a
 * reason to withhold the Instagram post that is fine.
 *
 * Nothing is silently truncated. A caption over the limit is refused with a
 * reason a human can act on, because a machine-trimmed caption can lose the
 * call to action and still look finished (§67).
 */
export function validatePlatformVersion(
  version: PlatformVersion,
  brand: BrandSettings,
): ValidationResult {
  const platform = version.platform as Platform;
  const limit = PLATFORM_LIMITS[platform];

  const caption = version.caption.trim();

  if (caption.length === 0) {
    return { ok: false, reason: `${platform}: the generated caption was empty.` };
  }

  const hashtags = applyHashtagRules(version.hashtags, brand.hashtagRules);

  /*
   * Hashtags are counted against the caption limit because they are published
   * as part of it. Checking the caption alone would pass a post that the
   * platform then rejects at publish time, which is the worst place to find
   * out (§52).
   */
  const rendered =
    hashtags.length > 0 ? `${caption}\n\n${hashtags.map((t) => `#${t}`).join(" ")}` : caption;

  if (rendered.length > limit.captionChars) {
    return {
      ok: false,
      reason: `${platform}: the caption and hashtags come to ${rendered.length} characters, over the ${limit.captionChars} limit (${limit.source}).`,
    };
  }

  // §14, enforced rather than documented.
  const visualText = `${version.visual.headline} ${version.visual.supportingText}`;

  if (containsUrl(visualText)) {
    return {
      ok: false,
      reason: `${platform}: the visual concept contains a URL. Generated cards use our own templates and branding only (§14).`,
    };
  }

  return { ok: true, version: { ...version, caption, hashtags } };
}
