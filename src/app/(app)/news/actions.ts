"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";
import { runNewsRanking } from "@/lib/news/rank";
import { SelectionError, selectStories as runSelection } from "@/lib/news/selection";
import { sendShortlistNotification } from "@/lib/slack/notify";
import { NEWS_SHORTLIST_WORKFLOW } from "@/lib/slack/schema";

/**
 * Manual ranking trigger (spec §46).
 *
 * n8n owns the schedule (§44), but the pipeline has to be runnable before any
 * workflow exists, and someone tuning the brand's preferred topics needs to
 * see the effect without waiting a day.
 */
export interface RankFormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** §21: whether the scores just produced are real or simulated. */
  mode?: "REAL" | "MOCK";
}

export async function rankNow(previous: RankFormState, form: FormData): Promise<RankFormState> {
  // Both arguments are required by useActionState's contract; ranking takes no
  // input of its own.
  void previous;
  void form;

  // Ranking is an automation, so it sits under automations:manage (§27) —
  // ADMIN and MANAGER, not SOCIAL_MANAGER.
  const user = await requirePermission("automations:manage");

  try {
    const { run, shortlisted, rejected, mode } = await runNewsRanking("MANUAL");

    await recordAudit({
      actor: user.uid,
      action: "NEWS_IMPORTED",
      resource: "newsItems",
      status: run.status === "FAILURE" ? "FAILURE" : "SUCCESS",
      metadata: { workflow: run.workflow, shortlisted, rejected, mode },
    });

    revalidatePath("/news");

    if (run.itemsDiscovered === 0) {
      return { status: "success", mode, message: "Nothing new to rank." };
    }

    return {
      status: run.status === "SUCCESS" ? "success" : "error",
      mode,
      message: `Considered ${run.itemsDiscovered}, shortlisted ${shortlisted}, rejected ${rejected}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error("Manual ranking failed", { error: message });

    /*
     * The message is surfaced rather than swallowed. The common failures here
     * are a missing key and a rate limit, and both are things the person
     * standing at the screen can act on — §52: never silently fail.
     */
    return { status: "error", message };
  }
}

/**
 * Manual Slack notification (spec §9).
 *
 * n8n owns the daily schedule (§44), but the shortlist has to be sendable
 * before any workflow exists — and after a re-rank, someone often wants the
 * team to see the new list without waiting until tomorrow.
 */
export interface NotifyFormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** §21: whether a message really reached Slack or was simulated. */
  mode?: "REAL" | "MOCK";
}

export async function notifySlackNow(
  previous: NotifyFormState,
  form: FormData,
): Promise<NotifyFormState> {
  void previous;
  void form;

  // Notifying is an automation, so it sits under automations:manage (§27).
  const user = await requirePermission("automations:manage");

  try {
    const outcome = await sendShortlistNotification("MANUAL");

    await recordAudit({
      actor: user.uid,
      action: "NOTIFICATION_SENT",
      resource: "notificationLogs",
      status: outcome.status === "FAILED" ? "FAILURE" : "SUCCESS",
      metadata: {
        workflow: NEWS_SHORTLIST_WORKFLOW,
        outcome: outcome.status,
        stories: outcome.storyCount,
        mode: outcome.mode,
      },
    });

    revalidatePath("/news");

    /*
     * §67: never say "Slack notification sent" unless it was. Each outcome
     * gets its own wording, and a skip is reported as a skip.
     */
    if (outcome.status === "FAILED") {
      return {
        status: "error",
        mode: outcome.mode,
        message: outcome.detail ?? "Slack refused it.",
      };
    }

    if (outcome.status === "SKIPPED") {
      return {
        status: "success",
        mode: outcome.mode,
        message: outcome.detail ?? "Nothing to send.",
      };
    }

    return {
      status: "success",
      mode: outcome.mode,
      message: `Sent ${outcome.storyCount} ${outcome.storyCount === 1 ? "story" : "stories"} to ${outcome.channel}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The common failure is a missing token or channel, which is something
    // the person at the screen can act on (§52).
    logger.error("Manual Slack notification failed", { error: message });

    return { status: "error", message };
  }
}

/**
 * Human news selection (spec §8, §10, §46).
 *
 * The one place in this system where a person's decision, not a score,
 * determines what happens next.
 */
export interface SelectFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function selectStories(
  previous: SelectFormState,
  form: FormData,
): Promise<SelectFormState> {
  void previous;

  // §27 puts the day's agenda with ADMIN and MANAGER.
  const user = await requirePermission("news:select");

  // Arrives as repeated fields from the checkbox group. Not trusted for
  // count, order or content — `selectStories` re-validates all three (§33).
  const storyIds = form.getAll("storyIds").map(String);

  try {
    const outcome = await runSelection(storyIds, user.uid);

    await recordAudit({
      actor: user.uid,
      action: "NEWS_SELECTED",
      resource: `selectedNews/${outcome.id}`,
      status: "SUCCESS",
      metadata: {
        selectionDate: outcome.selectionDate,
        storyIds: outcome.storyIds,
        replaced: outcome.replaced,
      },
    });

    revalidatePath("/news");

    return {
      status: "success",
      /*
       * §66/§67: the selection is real and is recorded. Content generation is
       * Module 07 and does not exist, so this says what actually happened and
       * what did not, rather than implying a pipeline started.
       */
      message: outcome.replaced
        ? "Selection updated. Content generation is not built yet (Module 07), so nothing has been generated."
        : "Three stories selected. Content generation is not built yet (Module 07), so nothing has been generated.",
    };
  } catch (error) {
    if (error instanceof SelectionError) {
      return { status: "error", message: error.message };
    }

    const message = error instanceof Error ? error.message : String(error);

    logger.error("News selection failed", { error: message });

    return { status: "error", message: "The selection could not be saved. Please try again." };
  }
}
