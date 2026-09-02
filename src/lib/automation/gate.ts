import "server-only";

import { getAutomationSetting } from "@/lib/automation/store";

/**
 * The enable/disable half of the Automation Control Center (§41, §63 Module 20).
 *
 * n8n still fires every trigger on its own schedule — this app has no way to
 * reach into n8n's cron config, and §65 forbids pretending otherwise. What
 * "OFF" means here is that the endpoint itself declines to run its pipeline
 * when asked, and says so rather than silently succeeding at nothing.
 */
export async function isWorkflowEnabled(workflow: string): Promise<boolean> {
  const setting = await getAutomationSetting(workflow);

  return setting.enabled;
}
