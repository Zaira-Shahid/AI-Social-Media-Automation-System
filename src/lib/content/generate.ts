import "server-only";

import { getAIProvider } from "@/lib/ai";
import { GROQ_FREE_TIER } from "@/lib/ai/groq";
import type { AIProvider } from "@/lib/ai/provider";
import { getBrandProfile } from "@/lib/brand/store";
import {
  isBrandReadyForWriting,
  type BrandSettings,
  type CompanySettings,
} from "@/lib/brand/schema";
import {
  adaptationEnvelopeSchema,
  coreResponseSchema,
  platformVersionSchema,
  ADAPTATION_JSON_SCHEMA,
  ADAPTATION_SCHEMA_NAME,
  CORE_JSON_SCHEMA,
  CORE_SCHEMA_NAME,
  type PlatformVersion,
} from "@/lib/content/generation-schema";
import {
  PLATFORMS,
  REGENERATABLE_STATUSES,
  type CoreMessage,
  type Platform,
} from "@/lib/content/schema";
import {
  createContentItem,
  createPlatformPost,
  getContentItem,
  getPlatformPost,
  listContentForSelection,
  recordContentVersion,
  replacePlatformPostContent,
} from "@/lib/content/store";
import { validatePlatformVersion } from "@/lib/content/validate";
import { logger } from "@/lib/logger";
import { currentSelectionDate } from "@/lib/news/selection";
import { getNewsItem, getSelectionForDate, markSelectionGenerated } from "@/lib/news/store";
import type { StoredNewsItem } from "@/lib/news/store";

/**
 * AI content generation (spec §12, §13, §14, §17, §30, §47).
 *
 * §12's sequence, in order: load the brand identity, generate the core
 * message, generate the platform versions, validate, store. Nothing here
 * publishes, schedules or approves anything — §10 keeps all of that with a
 * human, and this module's output lands in review.
 */
export const CONTENT_GENERATION_WORKFLOW = "04_news_selection_processing";

/** Pause between calls so a run stays inside the free plan's per-minute limits (§29). */
async function pace(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.ceil(60_000 / GROQ_FREE_TIER.requestsPerMinute)),
  );
}

const CORE_SYSTEM_PROMPT = `You write the substance of a social media post for a company's own channels.

You are given one news story and the company's brand profile. Produce the core
message: the single idea every platform version will be built from.

- headline: the company's own framing of the story. Not the publisher's headline reworded.
- keyTakeaway: one sentence a reader remembers.
- body: two or three short paragraphs in the company's voice.
- sourceReference: how the source is credited in words, e.g. "via TechCrunch".
- angle: why this company is the one talking about this story.

Never invent a fact, a statistic, a quote or a company that is not in the story
you were given. If the story does not support a claim, leave it out. Write in
the brand's tone of voice and for its stated audience.`;

const ADAPTATION_SYSTEM_PROMPT = `You adapt one core message into platform-specific posts.

Do not publish the same text everywhere. Each platform gets its own length,
tone, structure, hook, call to action, hashtags and visual treatment:

- LINKEDIN: professional and insight-driven. Longer is acceptable.
- INSTAGRAM: shorter, visually driven, engaging.
- FACEBOOK: conversational and accessible.

These are defaults, not rules — choose the format that suits the story.

The visual concept describes a static card rendered from the company's own
templates: pick a template, write the few words that appear on the card, and
say which brand colour role to emphasise. Never reference, describe or link to
a photograph, a stock image, or any image from the news article. Never put a
URL anywhere in the visual concept.

Return one entry per requested platform, using the platform name exactly.
Never invent facts beyond the core message you were given.`;

function brandContext(company: CompanySettings, brand: BrandSettings): string {
  /*
   * §11: all generated content uses the one central profile. Only the fields
   * that actually shape the writing go into the prompt — colours and fonts are
   * Module 08's business, and every token spent here is one the free plan's
   * per-minute budget does not have (§29).
   */
  return [
    `Company: ${company.name}`,
    company.industry ? `Industry: ${company.industry}` : "",
    company.description ? `About: ${company.description}` : "",
    `Tone of voice: ${brand.toneOfVoice}`,
    brand.writingStyle ? `Writing style: ${brand.writingStyle}` : "",
    `Audience: ${brand.targetAudience}`,
    brand.brandPositioning ? `Positioning: ${brand.brandPositioning}` : "",
    brand.ctaStyle ? `Call to action style: ${brand.ctaStyle}` : "",
    brand.hashtagRules.style ? `Hashtag style: ${brand.hashtagRules.style}` : "",
    `Use at most ${brand.hashtagRules.maxHashtags} hashtags.`,
    brand.hashtagRules.required.length > 0
      ? `Always include these hashtags: ${brand.hashtagRules.required.join(", ")}.`
      : "",
    brand.hashtagRules.banned.length > 0
      ? `Never use these hashtags: ${brand.hashtagRules.banned.join(", ")}.`
      : "",
    brand.contentRules.length > 0 ? `Content rules:\n- ${brand.contentRules.join("\n- ")}` : "",
    brand.visualRules.length > 0 ? `Visual rules:\n- ${brand.visualRules.join("\n- ")}` : "",
    brand.topicsToAvoid.length > 0 ? `Avoid these topics: ${brand.topicsToAvoid.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The story, as the model sees it.
 *
 * `imageUrl` is deliberately absent. §14 forbids a publisher's image reaching
 * the generator, and the cheapest way to enforce that is for the model never
 * to be told the URL exists — a model cannot echo back what it was not given.
 * `validate.ts` catches the case where it invents one anyway.
 */
function storyContext(item: StoredNewsItem): string {
  const analysis = item.aiAnalysis ?? {};
  const whyItMatters = typeof analysis.whyItMatters === "string" ? analysis.whyItMatters : "";

  return [
    `Headline: ${item.title}`,
    `Source: ${item.sourceName}`,
    `Published: ${item.publishedAt}`,
    `Summary: ${item.summary || "(none provided)"}`,
    whyItMatters ? `Why it matters: ${whyItMatters}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateCore(
  provider: AIProvider,
  item: StoredNewsItem,
  company: CompanySettings,
  brand: BrandSettings,
): Promise<CoreMessage> {
  const result = await provider.complete({
    system: CORE_SYSTEM_PROMPT,
    prompt: `${brandContext(company, brand)}\n\nStory:\n${storyContext(item)}`,
    schema: CORE_JSON_SCHEMA,
    schemaName: CORE_SCHEMA_NAME,
    maxOutputTokens: 1_200,
  });

  // §31: validated before anything reaches the database.
  const parsed = coreResponseSchema.safeParse(result.data);

  if (!parsed.success) {
    throw new Error(`Core message failed validation: ${parsed.error.issues[0]?.message}`);
  }

  return parsed.data;
}

async function generateVersions(
  provider: AIProvider,
  core: CoreMessage,
  company: CompanySettings,
  brand: BrandSettings,
  platforms: readonly Platform[],
): Promise<Map<Platform, PlatformVersion>> {
  const result = await provider.complete({
    system: ADAPTATION_SYSTEM_PROMPT,
    prompt: [
      brandContext(company, brand),
      "",
      `Platforms: ${platforms.join(", ")}`,
      "",
      "Core message:",
      `Headline: ${core.headline}`,
      `Key takeaway: ${core.keyTakeaway}`,
      `Body: ${core.body}`,
      `Source reference: ${core.sourceReference}`,
      core.angle ? `Angle: ${core.angle}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    schema: ADAPTATION_JSON_SCHEMA,
    schemaName: ADAPTATION_SCHEMA_NAME,
    maxOutputTokens: 2_500,
  });

  const envelope = adaptationEnvelopeSchema.safeParse(result.data);

  if (!envelope.success) {
    throw new Error(`Platform versions failed validation: ${envelope.error.issues[0]?.message}`);
  }

  const wanted = new Set<string>(platforms);
  const versions = new Map<Platform, PlatformVersion>();

  for (const raw of envelope.data.versions) {
    /*
     * §31: each entry is validated before anything is kept, and one bad entry
     * is dropped rather than failing the whole response. A model that adds a
     * fourth platform should cost us that entry, not the three it got right.
     */
    const parsed = platformVersionSchema.safeParse(raw);

    if (!parsed.success) {
      logger.warn("Discarding a malformed platform version", {
        reason: parsed.error.issues[0]?.message,
      });
      continue;
    }

    // A version for a platform nobody asked about is discarded rather than
    // stored — §65's rule against invented data covers model output too.
    if (!wanted.has(parsed.data.platform)) {
      logger.warn("Model returned a version for an unrequested platform; ignoring", {
        platform: parsed.data.platform,
      });
      continue;
    }

    versions.set(parsed.data.platform as Platform, parsed.data);
  }

  return versions;
}

export interface GenerationOutcome {
  status: "GENERATED" | "SKIPPED" | "PARTIAL" | "FAILED";
  mode: "REAL" | "MOCK";
  stories: number;
  posts: number;
  /** Per-platform failures, each with the reason. Never swallowed (§52). */
  problems: string[];
  detail: string | null;
}

/** Thrown when generation cannot start at all, and a person has to change something. */
export class GenerationError extends Error {}

/**
 * Generate content for today's selection (§47).
 *
 * Stops before publishing, scheduling and approval — all three belong to a
 * human (§10). Nothing here writes a status beyond IN_REVIEW.
 */
export async function runContentGeneration(actor: string): Promise<GenerationOutcome> {
  const provider = getAIProvider();
  const { company, brand } = await getBrandProfile();

  /*
   * §11: all generated content must use the brand profile. Generating from an
   * unconfigured one would produce generic copy in nobody's voice, and it
   * would do so silently — so this refuses, naming what is missing.
   *
   * The writing gate, not the full one: the logo matters to Module 08's
   * renderer, and refusing to draft copy over an asset the copy never uses
   * would block the pipeline for the wrong reason.
   */
  const configured = isBrandReadyForWriting(company, brand);

  if (!configured.configured) {
    throw new GenerationError(
      `The brand profile is incomplete, so nothing was generated. Missing: ${configured.missing.join(", ")}.`,
    );
  }

  const selection = await getSelectionForDate(currentSelectionDate());

  if (!selection) {
    return {
      status: "SKIPPED",
      mode: provider.mode,
      stories: 0,
      posts: 0,
      problems: [],
      detail: "No stories have been selected for today, so there was nothing to generate.",
    };
  }

  /*
   * Already-generated stories are skipped rather than duplicated. n8n retries
   * a failed step, and a retry that had partly succeeded would otherwise
   * produce a second set of posts for the same story.
   */
  const existing = await listContentForSelection(selection.id);
  const done = new Set(existing.map((item) => item.sourceNewsItemId));
  const pending = selection.storyIds.filter((id) => !done.has(id));

  if (pending.length === 0) {
    return {
      status: "SKIPPED",
      mode: provider.mode,
      stories: 0,
      posts: 0,
      problems: [],
      detail: "Content has already been generated for today's selection.",
    };
  }

  const problems: string[] = [];
  let stories = 0;
  let posts = 0;

  for (const [index, storyId] of pending.entries()) {
    const item = await getNewsItem(storyId);

    if (!item) {
      problems.push("A selected story no longer exists and was skipped.");
      continue;
    }

    try {
      const core = await generateCore(provider, item, company, brand);
      await pace();
      const versions = await generateVersions(provider, core, company, brand, PLATFORMS);

      const contentItemId = await createContentItem({
        sourceNewsItemId: item.id,
        sourceTitle: item.title,
        sourceUrl: item.sourceUrl,
        selectionId: selection.id,
        coreMessage: core,
        generation: {
          // §21/§66: stored, not merely displayed. A simulated draft must
          // never later be mistaken for one a real provider wrote.
          mode: provider.mode,
          provider: provider.name,
          model: provider.model,
          generatedAt: new Date().toISOString(),
        },
      });

      stories += 1;

      for (const platform of PLATFORMS) {
        const version = versions.get(platform);

        if (!version) {
          problems.push(`${platform}: the model returned no version for "${item.title}".`);
          continue;
        }

        const checked = validatePlatformVersion(version, brand);

        if (!checked.ok) {
          // §17: one platform failing never withholds the others.
          problems.push(checked.reason);
          continue;
        }

        const platformPostId = await createPlatformPost({
          contentItemId,
          platform,
          /*
           * §47 ends at IN_REVIEW, and that is what this is: generation
           * finished and validation passed, so the post is waiting for a
           * person. DRAFT stays declared in §17's vocabulary for Module 09's
           * editing, but writing it here and immediately moving would record a
           * state nothing was ever in.
           */
          status: "IN_REVIEW",
          caption: checked.version.caption,
          hashtags: checked.version.hashtags,
          cta: checked.version.cta,
          visual: checked.version.visual,
          // Module 08 renders and uploads the image. Null, explicitly: §67
          // means a post must never claim media it does not have.
          mediaUrl: null,
          mediaPublicId: null,
          lastError: null,
          version: 1,
          // §17: approval is recorded here and nowhere else. Nothing has
          // approved anything yet, and the fields say so rather than being
          // absent and ambiguous.
          approvedBy: null,
          approvedAt: null,
          rejectionNote: null,
          // Scheduling is Module 11. Null is the honest value, and the
          // calendar reads it as "approved work with no slot yet".
          scheduledAt: null,
          // Nothing has been published, and the record says so outright
          // rather than relying on the schema's defaults to fill it in
          // later (§67). Module 16 writes all of these.
          providerPostId: null,
          permalink: null,
          publishedAt: null,
          publishMode: null,
          publishAttempts: 0,
          publishStartedAt: null,
        });

        await recordContentVersion({
          contentItemId,
          platformPostId,
          platform,
          version: 1,
          reason: "INITIAL",
          caption: checked.version.caption,
          hashtags: checked.version.hashtags,
          cta: checked.version.cta,
          visual: checked.version.visual,
          createdAt: new Date().toISOString(),
          createdBy: actor,
          mode: provider.mode,
        });

        posts += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`"${item.title.slice(0, 60)}": ${message}`);
      logger.error("Content generation failed for a story", { storyId, error: message });
    }

    if (index < pending.length - 1) await pace();
  }

  /*
   * The selection is only marked GENERATED when something was actually
   * generated. Marking it after a total failure would lock the day's selection
   * (§46) against the retry that would fix it.
   */
  if (stories > 0) await markSelectionGenerated(selection.id);

  logger.info("Content generation run finished", {
    mode: provider.mode,
    stories,
    posts,
    problems: problems.length,
  });

  return {
    status: stories === 0 ? "FAILED" : problems.length > 0 ? "PARTIAL" : "GENERATED",
    mode: provider.mode,
    stories,
    posts,
    problems,
    detail: null,
  };
}

/**
 * Regenerate one platform post (§63).
 *
 * Only the platform asked for, and only from the core message that already
 * exists: a rewrite of the LinkedIn caption should not quietly change what the
 * story is about, or what the other platforms say.
 */
export async function regeneratePlatformPost(
  platformPostId: string,
  actor: string,
): Promise<{ version: number; mode: "REAL" | "MOCK" }> {
  const post = await getPlatformPost(platformPostId);

  if (!post) throw new GenerationError("That post no longer exists.");

  if (!REGENERATABLE_STATUSES.includes(post.status)) {
    /*
     * §10, §55: replacing the text under an approved or published post would
     * make the approval a record of something nobody agreed to.
     */
    throw new GenerationError(
      `This post is ${post.status.toLowerCase().replace("_", " ")} and can no longer be regenerated.`,
    );
  }

  const item = await getContentItem(post.contentItemId);

  if (!item) throw new GenerationError("The story behind this post no longer exists.");

  const provider = getAIProvider();
  const { company, brand } = await getBrandProfile();

  const versions = await generateVersions(provider, item.coreMessage, company, brand, [
    post.platform,
  ]);

  const version = versions.get(post.platform);

  if (!version) throw new GenerationError("The model returned nothing for that platform.");

  const checked = validatePlatformVersion(version, brand);

  if (!checked.ok) throw new GenerationError(checked.reason);

  const next = post.version + 1;

  await replacePlatformPostContent(platformPostId, {
    caption: checked.version.caption,
    hashtags: checked.version.hashtags,
    cta: checked.version.cta,
    visual: checked.version.visual,
    version: next,
  });

  await recordContentVersion({
    contentItemId: post.contentItemId,
    platformPostId,
    platform: post.platform,
    version: next,
    reason: "REGENERATED",
    caption: checked.version.caption,
    hashtags: checked.version.hashtags,
    cta: checked.version.cta,
    visual: checked.version.visual,
    createdAt: new Date().toISOString(),
    createdBy: actor,
    mode: provider.mode,
  });

  return { version: next, mode: provider.mode };
}
