"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import {
  regeneratePlatformPost,
  runContentGeneration,
  GenerationError,
} from "@/lib/content/generate";
import { renderPendingCards } from "@/lib/content/media";
import { logger } from "@/lib/logger";

/**
 * Manual content generation (spec §47).
 *
 * n8n owns the schedule (§44), but the pipeline has to be runnable before any
 * workflow exists — and after a re-selection, someone will want to see the
 * result without waiting for tomorrow's cron.
 */
export interface GenerateFormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** §21: whether this copy came from a real provider or was simulated. */
  mode?: "REAL" | "MOCK";
  /** Per-platform failures. Shown, not swallowed (§52). */
  problems?: string[];
}

export async function generateContent(
  previous: GenerateFormState,
  form: FormData,
): Promise<GenerateFormState> {
  void previous;
  void form;

  // Generating the day's content is a pipeline run, so it sits with the roles
  // that hold automations:manage (§27) — ADMIN and MANAGER.
  const user = await requirePermission("automations:manage");

  try {
    const outcome = await runContentGeneration(user.uid);

    await recordAudit({
      actor: user.uid,
      action: "CONTENT_GENERATED",
      resource: "contentItems",
      status: outcome.status === "FAILED" ? "FAILURE" : "SUCCESS",
      metadata: {
        outcome: outcome.status,
        stories: outcome.stories,
        posts: outcome.posts,
        mode: outcome.mode,
        problems: outcome.problems.length,
      },
    });

    revalidatePath("/content");

    if (outcome.status === "SKIPPED") {
      return { status: "success", mode: outcome.mode, message: outcome.detail ?? "Nothing to do." };
    }

    if (outcome.status === "FAILED") {
      /*
       * §67: nothing was generated, so this does not report a partial success.
       * The reasons come with it, because they are what the person has to act
       * on.
       */
      return {
        status: "error",
        mode: outcome.mode,
        message: "Nothing was generated.",
        problems: outcome.problems,
      };
    }

    return {
      status: "success",
      mode: outcome.mode,
      message: `Generated ${outcome.posts} ${outcome.posts === 1 ? "post" : "posts"} across ${outcome.stories} ${outcome.stories === 1 ? "story" : "stories"}. They are waiting for review.`,
      problems: outcome.problems,
    };
  } catch (error) {
    if (error instanceof GenerationError) {
      // An incomplete brand profile is the common one, and it is fixable by
      // the person reading this (§52).
      return { status: "error", message: error.message };
    }

    const message = error instanceof Error ? error.message : String(error);

    logger.error("Manual content generation failed", { error: message });

    return { status: "error", message };
  }
}

export interface RegenerateFormState {
  status: "idle" | "success" | "error";
  message?: string;
  mode?: "REAL" | "MOCK";
}

/**
 * Regenerate one platform version (§63).
 *
 * §27 gives SOCIAL_MANAGER regeneration explicitly, so this sits under
 * `content:regenerate` rather than under the automation permission — rewriting
 * one caption is content work, not a pipeline run.
 */
export async function regeneratePost(
  previous: RegenerateFormState,
  form: FormData,
): Promise<RegenerateFormState> {
  void previous;

  const user = await requirePermission("content:regenerate");

  const platformPostId = String(form.get("platformPostId") ?? "");

  if (!platformPostId) return { status: "error", message: "No post was specified." };

  try {
    const { version, mode } = await regeneratePlatformPost(platformPostId, user.uid);

    await recordAudit({
      actor: user.uid,
      action: "CONTENT_GENERATED",
      resource: `platformPosts/${platformPostId}`,
      status: "SUCCESS",
      metadata: { version, mode, regenerated: true },
    });

    revalidatePath("/content");

    return { status: "success", mode, message: `Rewritten. This is version ${version}.` };
  } catch (error) {
    if (error instanceof GenerationError) {
      return { status: "error", message: error.message };
    }

    const message = error instanceof Error ? error.message : String(error);

    logger.error("Regeneration failed", { platformPostId, error: message });

    return { status: "error", message };
  }
}

/**
 * Manual card rendering (spec §15).
 *
 * n8n owns the schedule, but a reviewer who has just rewritten a caption wants
 * to see the card that goes with it now, not tomorrow.
 */
export interface RenderFormState {
  status: "idle" | "success" | "error";
  message?: string;
  problems?: string[];
}

export async function renderImages(
  previous: RenderFormState,
  form: FormData,
): Promise<RenderFormState> {
  void previous;
  void form;

  const user = await requirePermission("automations:manage");

  try {
    const outcome = await renderPendingCards();

    await recordAudit({
      actor: user.uid,
      action: "CONTENT_GENERATED",
      resource: "platformPosts",
      status: outcome.status === "FAILED" ? "FAILURE" : "SUCCESS",
      metadata: {
        outcome: outcome.status,
        rendered: outcome.rendered,
        problems: outcome.problems.length,
        missingLogo: outcome.missingLogo,
      },
    });

    revalidatePath("/content");

    if (outcome.status === "SKIPPED") {
      return { status: "success", message: outcome.detail ?? "Nothing to render." };
    }

    if (outcome.status === "FAILED") {
      // §67: nothing was produced, so this is not reported as partial success.
      return { status: "error", message: "No images were rendered.", problems: outcome.problems };
    }

    /*
     * A missing logo is reported rather than hidden: the cards are real and
     * usable, but a person should know they went out without it (§21's spirit
     * — never let the screen imply more than happened).
     */
    const logoNote = outcome.missingLogo
      ? " The brand logo could not be used, so the cards carry colours and type only."
      : "";

    return {
      status: "success",
      message: `Rendered ${outcome.rendered} ${outcome.rendered === 1 ? "image" : "images"}.${logoNote}`,
      problems: outcome.problems,
    };
  } catch (error) {
    if (error instanceof GenerationError) {
      return { status: "error", message: error.message };
    }

    const message = error instanceof Error ? error.message : String(error);

    logger.error("Manual card rendering failed", { error: message });

    return { status: "error", message };
  }
}
