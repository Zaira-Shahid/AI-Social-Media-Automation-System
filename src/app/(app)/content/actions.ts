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
import {
  approveAllForStory,
  approvePost,
  editPost,
  rejectPost,
  ReviewError,
} from "@/lib/content/review";
import { schedulePost, ScheduleError } from "@/lib/content/schedule";
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

/**
 * Review actions (spec §10, §16, §17, §48).
 *
 * Every one re-checks its permission inside the action. §17 forbids
 * frontend-only status protection, and a hidden button is exactly that.
 */
export interface ReviewFormState {
  status: "idle" | "success" | "error";
  message?: string;
  problems?: string[];
}

export async function approvePlatformPost(
  previous: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  void previous;

  const user = await requirePermission("content:approve");
  const platformPostId = String(form.get("platformPostId") ?? "");

  if (!platformPostId) return { status: "error", message: "No post was specified." };

  try {
    await approvePost(platformPostId, user.uid);

    await recordAudit({
      actor: user.uid,
      action: "CONTENT_APPROVED",
      resource: `platformPosts/${platformPostId}`,
      status: "SUCCESS",
    });

    revalidatePath("/content");

    return { status: "success", message: "Approved." };
  } catch (error) {
    return { status: "error", message: reviewMessage(error, "approve") };
  }
}

export async function rejectPlatformPost(
  previous: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  void previous;

  const user = await requirePermission("content:approve");
  const platformPostId = String(form.get("platformPostId") ?? "");
  const note = String(form.get("note") ?? "");

  if (!platformPostId) return { status: "error", message: "No post was specified." };

  try {
    await rejectPost(platformPostId, user.uid, note);

    await recordAudit({
      actor: user.uid,
      action: "CONTENT_REJECTED",
      resource: `platformPosts/${platformPostId}`,
      status: "SUCCESS",
      metadata: { note: note.slice(0, 300) },
    });

    revalidatePath("/content");

    return { status: "success", message: "Rejected." };
  } catch (error) {
    return { status: "error", message: reviewMessage(error, "reject") };
  }
}

/**
 * Approve every eligible version of one story.
 *
 * §63: a convenience over per-platform approval, never a story-level state.
 * The per-platform refusals come back with it, so nobody is left thinking
 * three were approved when two were.
 */
export async function approveStory(
  previous: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  void previous;

  const user = await requirePermission("content:approve");
  const contentItemId = String(form.get("contentItemId") ?? "");

  if (!contentItemId) return { status: "error", message: "No story was specified." };

  try {
    const outcome = await approveAllForStory(contentItemId, user.uid);

    await recordAudit({
      actor: user.uid,
      action: "CONTENT_APPROVED",
      resource: `contentItems/${contentItemId}`,
      status: outcome.approved > 0 ? "SUCCESS" : "FAILURE",
      metadata: { approved: outcome.approved, problems: outcome.problems.length },
    });

    revalidatePath("/content");

    if (outcome.approved === 0) {
      return {
        status: "error",
        message: "Nothing was approved.",
        problems: outcome.problems,
      };
    }

    return {
      status: "success",
      message: `Approved ${outcome.approved} ${outcome.approved === 1 ? "version" : "versions"}.`,
      problems: outcome.problems,
    };
  } catch (error) {
    return { status: "error", message: reviewMessage(error, "approve") };
  }
}

export async function editPlatformPost(
  previous: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  void previous;

  // §27 gives SOCIAL_MANAGER content editing; MANAGER reviews and approves
  // but does not rewrite.
  const user = await requirePermission("content:edit");
  const platformPostId = String(form.get("platformPostId") ?? "");

  if (!platformPostId) return { status: "error", message: "No post was specified." };

  try {
    const { version } = await editPost(platformPostId, user.uid, {
      caption: String(form.get("caption") ?? ""),
      // Split on whitespace and commas: reviewers type them both ways, and
      // `applyHashtagRules` normalizes whatever arrives.
      hashtags: String(form.get("hashtags") ?? "")
        .split(/[\s,]+/)
        .filter(Boolean),
      cta: String(form.get("cta") ?? ""),
    });

    await recordAudit({
      actor: user.uid,
      action: "CONTENT_EDITED",
      resource: `platformPosts/${platformPostId}`,
      status: "SUCCESS",
      metadata: { version },
    });

    revalidatePath("/content");

    return { status: "success", message: `Saved. This is version ${version}.` };
  } catch (error) {
    return { status: "error", message: reviewMessage(error, "save") };
  }
}

/**
 * Schedule an approved version (§18, §37's Schedule action).
 *
 * The date and time are read as the company's wall clock; `schedulePost`
 * converts them to the UTC instant that gets stored (§54). Nothing here
 * decides whether the post may be scheduled — that is re-read and re-checked
 * inside the transaction, where a second reviewer cannot slip past it.
 */
export async function schedulePlatformPost(
  previous: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  void previous;

  const user = await requirePermission("content:schedule");
  const platformPostId = String(form.get("platformPostId") ?? "");

  if (!platformPostId) return { status: "error", message: "No post was specified." };

  try {
    const outcome = await schedulePost(platformPostId, user.uid, {
      date: String(form.get("date") ?? ""),
      time: String(form.get("time") ?? ""),
    });

    await recordAudit({
      actor: user.uid,
      action: "POST_SCHEDULED",
      resource: `platformPosts/${platformPostId}`,
      status: "SUCCESS",
      metadata: { scheduledAt: outcome.scheduledAt },
    });

    revalidatePath("/content");
    revalidatePath("/calendar");

    return {
      status: "success",
      message: `Scheduled for ${outcome.localDate} at ${outcome.localTime}.`,
    };
  } catch (error) {
    if (error instanceof ScheduleError) return { status: "error", message: error.message };

    return { status: "error", message: reviewMessage(error, "schedule") };
  }
}

/** A refusal a reviewer can act on, or a generic failure that is logged. */
function reviewMessage(error: unknown, verb: string): string {
  if (error instanceof ReviewError) return error.message;

  const message = error instanceof Error ? error.message : String(error);

  logger.error(`Could not ${verb} a platform post`, { error: message });

  return `Could not ${verb} that post. Please try again.`;
}
