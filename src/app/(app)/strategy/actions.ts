"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";
import { runStrategyOptimization } from "@/lib/strategy/optimize";

/**
 * Manual strategy optimization (spec §24).
 *
 * n8n owns the weekly schedule (§44, `10_strategy_optimization`), but the
 * same reasoning as `content/actions.ts`'s manual generation applies here:
 * after Module 18 saves a new weekly report, someone will want to see an
 * updated strategy without waiting for the next scheduled run.
 *
 * `runStrategyOptimization` records its own audit entry — this action does
 * not duplicate it.
 */
export interface RegenerateStrategyFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function regenerateStrategy(
  previous: RegenerateStrategyFormState,
  form: FormData,
): Promise<RegenerateStrategyFormState> {
  void previous;
  void form;

  // §27: strategy:manage, ADMIN only — a step above merely viewing it.
  const user = await requirePermission("strategy:manage");

  try {
    const outcome = await runStrategyOptimization(user.uid);

    revalidatePath("/strategy");

    if (outcome.postsAnalyzed === 0) {
      return {
        status: "success",
        message: `Version ${outcome.version} saved, but there was no measured data across the last ${outcome.weeksAnalyzed} week(s) to recommend anything from.`,
      };
    }

    return {
      status: "success",
      message: `Version ${outcome.version} generated from ${outcome.postsAnalyzed} measured post(s) across ${outcome.weeksAnalyzed} week(s).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error("Manual strategy optimization failed", { error: message });

    return { status: "error", message: "Could not generate a new strategy." };
  }
}
