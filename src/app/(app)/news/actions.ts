"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";
import { runNewsRanking } from "@/lib/news/rank";

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
