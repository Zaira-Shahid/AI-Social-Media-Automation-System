import "server-only";

import { AUTOMATIONS } from "@/lib/automation/schema";
import { getAutomationSetting, getLatestRun } from "@/lib/automation/store";
import { logger } from "@/lib/logger";
import { NEWS_SHORTLIST_WORKFLOW } from "@/lib/slack/schema";
import { listNotifications } from "@/lib/slack/store";

/**
 * One normalized status per §41 row (spec §63 Module 20).
 *
 * Every automation but one records to `automationRuns`. Slack Notification
 * is the exception — Module 05 already gives it its own `notificationLogs`
 * collection, with its own richer vocabulary (SENT/FAILED/SKIPPED) — and
 * this reads that directly rather than making Module 05 double-write into a
 * second collection just to fit this screen's shape.
 */
export interface AutomationStatusView {
  workflow: string;
  label: string;
  enabled: boolean;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string;
    error: string | null;
    trigger: "WEBHOOK" | "MANUAL";
  } | null;
}

async function latestForRow(workflow: string): Promise<AutomationStatusView["lastRun"]> {
  if (workflow === NEWS_SHORTLIST_WORKFLOW) {
    const [latest] = await listNotifications(workflow, 1);

    if (!latest) return null;

    return {
      status: latest.status,
      startedAt: latest.sentAt,
      finishedAt: latest.sentAt,
      error: latest.detail,
      trigger: latest.trigger,
    };
  }

  const run = await getLatestRun(workflow);

  if (!run) return null;

  return {
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    trigger: run.trigger,
  };
}

/** Every §41 row's current state, in the spec's order. */
export async function getAutomationStatuses(): Promise<AutomationStatusView[]> {
  return Promise.all(
    AUTOMATIONS.map(async (definition) => {
      const [setting, lastRun] = await Promise.all([
        getAutomationSetting(definition.workflow),
        latestForRow(definition.workflow).catch((error) => {
          // One workflow's read failing must not blank the other seven rows.
          logger.warn("Could not read an automation's latest run", {
            workflow: definition.workflow,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
      ]);

      return {
        workflow: definition.workflow,
        label: definition.label,
        enabled: setting.enabled,
        lastRun,
      };
    }),
  );
}
