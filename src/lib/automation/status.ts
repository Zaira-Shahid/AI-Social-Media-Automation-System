import "server-only";

import { AUTOMATIONS } from "@/lib/automation/schema";
import { getAutomationSetting, listRecentRuns } from "@/lib/automation/store";
import { logger } from "@/lib/logger";
import { NEWS_SHORTLIST_WORKFLOW } from "@/lib/slack/schema";
import { listNotifications } from "@/lib/slack/store";

/**
 * One normalized status per §41 row (spec §63 Module 20/21).
 *
 * Every automation but one records to `automationRuns`. Slack Notification
 * is the exception — Module 05 already gives it its own `notificationLogs`
 * collection, with its own richer vocabulary (SENT/FAILED/SKIPPED) — and
 * this reads that directly rather than making Module 05 double-write into a
 * second collection just to fit this screen's shape.
 */
export interface AutomationRunView {
  status: string;
  startedAt: string;
  finishedAt: string;
  error: string | null;
  trigger: "WEBHOOK" | "MANUAL";
}

export interface AutomationStatusView {
  workflow: string;
  label: string;
  enabled: boolean;
  lastRun: AutomationRunView | null;
  /** Recent history, newest first — §63 Module 21's "run history". Excludes `lastRun`'s own entry. */
  recentRuns: AutomationRunView[];
}

const RUN_HISTORY_LIMIT = 5;

async function runsForRow(
  workflow: string,
): Promise<{ lastRun: AutomationRunView | null; recentRuns: AutomationRunView[] }> {
  if (workflow === NEWS_SHORTLIST_WORKFLOW) {
    const recent = await listNotifications(workflow, RUN_HISTORY_LIMIT + 1);
    const views = recent.map((entry) => ({
      status: entry.status,
      startedAt: entry.sentAt,
      finishedAt: entry.sentAt,
      error: entry.detail,
      trigger: entry.trigger,
    }));

    return { lastRun: views[0] ?? null, recentRuns: views.slice(1) };
  }

  const recent = await listRecentRuns(workflow, RUN_HISTORY_LIMIT + 1);
  const views = recent.map((run) => ({
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    trigger: run.trigger,
  }));

  return { lastRun: views[0] ?? null, recentRuns: views.slice(1) };
}

/** Every §41 row's current state, in the spec's order. */
export async function getAutomationStatuses(): Promise<AutomationStatusView[]> {
  return Promise.all(
    AUTOMATIONS.map(async (definition) => {
      const [setting, runs] = await Promise.all([
        getAutomationSetting(definition.workflow),
        runsForRow(definition.workflow).catch((error) => {
          // One workflow's read failing must not blank the other seven rows.
          logger.warn("Could not read an automation's run history", {
            workflow: definition.workflow,
            error: error instanceof Error ? error.message : String(error),
          });
          return { lastRun: null, recentRuns: [] };
        }),
      ]);

      return {
        workflow: definition.workflow,
        label: definition.label,
        enabled: setting.enabled,
        lastRun: runs.lastRun,
        recentRuns: runs.recentRuns,
      };
    }),
  );
}
