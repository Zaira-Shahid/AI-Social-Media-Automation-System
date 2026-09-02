import { AutomationScreen } from "@/components/automation-screen";
import { requirePermission } from "@/lib/auth/current-user";
import { getAutomationStatuses } from "@/lib/automation/status";

/**
 * The Automation Control Center (spec §41, §63 Module 20).
 *
 * §41's five columns per row: ON/OFF, last run, next run, status, last
 * error. "Next run" is answered honestly rather than guessed — this app has
 * no visibility into n8n's actual cron configuration, and §65 forbids
 * inventing one.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Automation" };

export default async function AutomationPage() {
  await requirePermission("automations:manage");

  const statuses = await getAutomationStatuses();

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Automation</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every scheduled workflow, its most recent run, and a switch to turn it off without touching
        n8n. n8n still fires each trigger on schedule; disabling one here means the endpoint declines
        to run rather than n8n never asking.
      </p>

      <AutomationScreen automations={statuses} />
    </div>
  );
}
