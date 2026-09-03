import { StrategyScreen } from "@/components/strategy-screen";
import { getCurrentUser, requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/roles";
import { listRecentWeeklyReports } from "@/lib/reporting/store";
import { listRecentStrategyReports } from "@/lib/strategy/store";

/**
 * The Strategy screen (spec §24, §25, §40, §63 Module 19).
 *
 * §40's list: what worked, what did not work, best/weak topics, best
 * platforms, best formats, AI recommendations, next week's strategy. The
 * first five come from the same weekly reports the Analytics screen reads
 * (Module 18); the last two are this module's own — the current strategy
 * version and the recommendations behind it.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Strategy" };

const RECENT_STRATEGY_LIMIT = 12;
const RECENT_WEEK_LIMIT = 1;

export default async function StrategyPage() {
  await requirePermission("strategy:view");

  const user = await getCurrentUser();
  const versions = await listRecentStrategyReports(RECENT_STRATEGY_LIMIT);
  const [latestWeek] = await listRecentWeeklyReports(RECENT_WEEK_LIMIT);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Strategy</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        What the numbers say worked, and what changes for next week — every recommendation traces
        back to measured analytics, never invented. The strategy can update automatically;
        publishing still always needs a human&apos;s approval.
      </p>

      <StrategyScreen
        current={versions[0] ?? null}
        history={versions}
        latestWeek={latestWeek ?? null}
        canManage={user?.role ? can(user.role, "strategy:manage") : false}
      />
    </div>
  );
}
