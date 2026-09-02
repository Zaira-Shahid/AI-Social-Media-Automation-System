"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import {
  ANALYTICS_SYNC_WORKFLOW,
  AUTOMATIONS,
  PUBLISHING_WORKFLOW,
  SCHEDULING_WORKFLOW,
} from "@/lib/automation/schema";
import { setAutomationEnabled } from "@/lib/automation/store";
import { runAnalyticsSync } from "@/lib/analytics/sync";
import { runContentGeneration } from "@/lib/content/generate";
import { runSchedulingCheck } from "@/lib/content/schedule";
import { logger } from "@/lib/logger";
import { runNewsDiscovery } from "@/lib/news/ingest";
import { runDuePublishing } from "@/lib/publishing/publish";
import { runWeeklyAnalysis } from "@/lib/reporting/weekly";
import { sendShortlistNotification } from "@/lib/slack/notify";
import { NEWS_SHORTLIST_WORKFLOW } from "@/lib/slack/schema";
import { runStrategyOptimization } from "@/lib/strategy/optimize";

/**
 * Enable/disable controls (spec §41, §63 Module 20).
 *
 * n8n still fires every trigger on schedule; what this toggles is whether
 * the endpoint itself runs its pipeline when asked (`automation/gate.ts`).
 */
export interface ToggleAutomationFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function toggleAutomation(
  previous: ToggleAutomationFormState,
  form: FormData,
): Promise<ToggleAutomationFormState> {
  void previous;

  const user = await requirePermission("automations:manage");

  const workflow = String(form.get("workflow") ?? "");
  const nextEnabled = form.get("enabled") === "true";

  // The workflow has to be one of §41's known rows — never an arbitrary
  // string a form could be made to submit.
  const known = AUTOMATIONS.some((definition) => definition.workflow === workflow);

  if (!known) {
    return { status: "error", message: "Unknown automation." };
  }

  try {
    await setAutomationEnabled(workflow, nextEnabled, user.uid);

    await recordAudit({
      actor: user.uid,
      action: "SETTINGS_CHANGED",
      resource: `automationSettings/${workflow}`,
      status: "SUCCESS",
      metadata: { workflow, enabled: nextEnabled },
    });

    revalidatePath("/automation");

    return { status: "success", message: nextEnabled ? "Enabled." : "Disabled." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error("Could not change an automation's enabled state", { workflow, error: message });

    return { status: "error", message: "Could not save that change." };
  }
}

/**
 * Manual re-run — the actual "retry handling" §63 Module 21 asks for (spec
 * §52's "retry when safe").
 *
 * Every one of these functions already records its own automation run and
 * (on `FAILURE`) its own Slack alert (`automation/store.ts`), so this action
 * only has to dispatch and refresh the screen — not duplicate either.
 *
 * Deliberately calls the same engine function each webhook calls, not a
 * second implementation of it: two paths that are supposed to do the same
 * thing drift the moment one of them changes and the other does not.
 */
export interface RunNowFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

const RUNNERS: Record<string, (actor: string) => Promise<void>> = {
  // Ranking has no row of its own on the Automation screen — Module 20
  // folded it under "Daily News Discovery" (§41 names eight rows, not
  // eleven workflows) — so a manual re-run re-runs discovery only.
  "01_daily_news_discovery": async () => {
    await runNewsDiscovery("MANUAL");
  },
  [NEWS_SHORTLIST_WORKFLOW]: async () => {
    await sendShortlistNotification("MANUAL");
  },
  "04_news_selection_processing": async (actor) => {
    await runContentGeneration(actor);
  },
  [SCHEDULING_WORKFLOW]: async () => {
    await runSchedulingCheck(new Date(), "MANUAL");
  },
  [PUBLISHING_WORKFLOW]: async () => {
    await runDuePublishing();
  },
  [ANALYTICS_SYNC_WORKFLOW]: async () => {
    await runAnalyticsSync();
  },
  "09_weekly_performance_analysis": async () => {
    await runWeeklyAnalysis();
  },
  "10_strategy_optimization": async (actor) => {
    await runStrategyOptimization(actor);
  },
};

export async function runAutomationNow(
  previous: RunNowFormState,
  form: FormData,
): Promise<RunNowFormState> {
  void previous;

  const user = await requirePermission("automations:manage");

  const workflow = String(form.get("workflow") ?? "");
  const runner = RUNNERS[workflow];

  if (!runner) {
    return { status: "error", message: "Unknown automation." };
  }

  try {
    await runner(user.uid);

    revalidatePath("/automation");

    return { status: "success", message: "Run finished — see the run history below." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The engine already recorded its own FAILURE run and Slack alert; this
    // is only what the button itself shows.
    logger.error("Manual automation run failed", { workflow, error: message });

    revalidatePath("/automation");

    return { status: "error", message: `Run failed: ${message}` };
  }
}
