import "server-only";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import {
  automationRunSchema,
  automationSettingSchema,
  AUTOMATION_RUNS_COLLECTION,
  AUTOMATION_SETTINGS_COLLECTION,
  DEFAULT_AUTOMATION_SETTING,
  type AutomationRun,
  type AutomationSetting,
} from "@/lib/automation/schema";

/**
 * Firestore access for the Automation Control Center (spec §32, §33, §41,
 * §63 Module 20).
 *
 * Admin SDK only. `firestore.rules` denies every client read and write on
 * both collections — same posture as `automationRuns` has had since Module
 * 03, and the same reasoning as `auditLogs`: a run's `error` can carry
 * detail an operator needs and nobody else should read, and a client that
 * could write `automationSettings` could turn an automation off without
 * going through the permission check the server action enforces.
 */
function runs() {
  return getAdminFirestore().collection(AUTOMATION_RUNS_COLLECTION);
}

function settings() {
  return getAdminFirestore().collection(AUTOMATION_SETTINGS_COLLECTION);
}

/**
 * Record one automation's run.
 *
 * Never throws — the same rule `recordAudit` and the original
 * `recordAutomationRun` (Module 03) both follow: a run that succeeded must
 * not be reported as failed because its own bookkeeping failed afterwards.
 */
export async function recordAutomationRun(run: AutomationRun): Promise<void> {
  const parsed = automationRunSchema.safeParse(run);

  if (!parsed.success) {
    logger.error("Refusing to store a malformed automation run", {
      workflow: run.workflow,
      reason: parsed.error.issues[0]?.message,
    });
    return;
  }

  try {
    await runs().add(parsed.data);
  } catch (error) {
    logger.error("Failed to record an automation run", {
      workflow: run.workflow,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseRun(id: string, data: unknown): AutomationRun | null {
  const parsed = automationRunSchema.safeParse(data);

  if (!parsed.success) {
    logger.warn("Stored automation run did not match the schema; skipping", { id });
    return null;
  }

  return parsed.data;
}

/** The most recent run of one workflow, or null if it has never run. */
export async function getLatestRun(workflow: string): Promise<AutomationRun | null> {
  const snapshot = await runs()
    .where("workflow", "==", workflow)
    .orderBy("startedAt", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  return parseRun(snapshot.docs[0].id, snapshot.docs[0].data());
}

/** Recent runs of one workflow, newest first — run history for the screen. */
export async function listRecentRuns(workflow: string, limit: number): Promise<AutomationRun[]> {
  const snapshot = await runs()
    .where("workflow", "==", workflow)
    .orderBy("startedAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((document) => parseRun(document.id, document.data()))
    .filter((run): run is AutomationRun => run !== null);
}

/** Whether one workflow is enabled — on by default, until an ADMIN turns it off. */
export async function getAutomationSetting(workflow: string): Promise<AutomationSetting> {
  const snapshot = await settings().doc(workflow).get();

  if (!snapshot.exists) return DEFAULT_AUTOMATION_SETTING;

  const parsed = automationSettingSchema.safeParse(snapshot.data());

  return parsed.success ? parsed.data : DEFAULT_AUTOMATION_SETTING;
}

/** Every workflow that has ever been toggled, keyed by workflow — for the screen's one read. */
export async function listAutomationSettings(): Promise<Record<string, AutomationSetting>> {
  const snapshot = await settings().get();
  const result: Record<string, AutomationSetting> = {};

  for (const document of snapshot.docs) {
    const parsed = automationSettingSchema.safeParse(document.data());

    if (parsed.success) result[document.id] = parsed.data;
  }

  return result;
}

export async function setAutomationEnabled(
  workflow: string,
  enabled: boolean,
  actor: string,
): Promise<void> {
  const setting: AutomationSetting = { enabled, updatedBy: actor, updatedAt: new Date().toISOString() };

  await settings().doc(workflow).set(setting);

  logger.info("Automation enabled state changed", { workflow, enabled, actor });
}
