"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { AUTOMATIONS } from "@/lib/automation/schema";
import { setAutomationEnabled } from "@/lib/automation/store";
import { logger } from "@/lib/logger";

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
