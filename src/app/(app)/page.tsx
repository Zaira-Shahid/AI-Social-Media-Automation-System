import { DashboardScreen } from "@/components/dashboard-screen";
import { requireUser } from "@/lib/auth/current-user";
import { can, groupedPermissionsFor } from "@/lib/auth/roles";
import { getAutomationStatuses } from "@/lib/automation/status";
import { countPlatformPostsByStatus } from "@/lib/content/store";
import { listRecentWeeklyReports } from "@/lib/reporting/store";

/**
 * The Dashboard (spec §35).
 *
 * Each summary card is fetched only when the signed-in role actually holds
 * the permission its screen requires — the same "do not show what cannot be
 * used" rule the nav already follows — so a card is omitted rather than
 * shown to a role that would hit /forbidden clicking through it.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard" };

export default async function HomePage() {
  const user = await requireUser();
  const role = user.role;

  const [automations, weeklyReport, pendingApprovals] = await Promise.all([
    role && can(role, "automations:manage") ? getAutomationStatuses() : Promise.resolve(null),
    role && (can(role, "analytics:view") || can(role, "strategy:view"))
      ? listRecentWeeklyReports(1).then((reports) => reports[0] ?? null)
      : Promise.resolve(undefined),
    role && can(role, "content:view") ? countPlatformPostsByStatus("IN_REVIEW") : Promise.resolve(null),
  ]);

  return (
    <DashboardScreen
      email={user.email ?? user.uid}
      role={role}
      groups={role ? groupedPermissionsFor(role) : []}
      automations={automations}
      weeklyReport={weeklyReport}
      pendingApprovals={pendingApprovals}
    />
  );
}
