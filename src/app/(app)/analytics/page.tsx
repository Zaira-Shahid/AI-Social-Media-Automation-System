import { AnalyticsScreen } from "@/components/analytics-screen";
import { requirePermission } from "@/lib/auth/current-user";
import { getServerEnv } from "@/lib/env.server";
import { getWeeklyReport, listRecentWeeklyReports } from "@/lib/reporting/store";

/**
 * The Analytics screen (spec §23, §39, §63 Module 18).
 *
 * Read-only: everything on this page comes from `weeklyReports`, which only
 * `runWeeklyAnalysis` ever writes. There is nothing here for a user to do
 * except look, which is why this page has no client component.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Analytics" };

const RECENT_LIMIT = 12;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("analytics:view");

  const params = await searchParams;
  const raw = Array.isArray(params.week) ? params.week[0] : params.week;

  const recent = await listRecentWeeklyReports(RECENT_LIMIT);

  // An unrecognised week in the URL falls back to the most recent report
  // rather than an error — same reasoning the Content screen's status filter
  // uses: the honest response to a filter that names nothing is the default view.
  const selected = (raw && recent.find((week) => week.id === raw)) || recent[0] || null;
  const report = selected ? await getWeeklyReport(selected.id) : null;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Weekly performance, computed from measured platform analytics. A number is either what the
        platform reported or a post is left out of the comparison — never invented (§22).
      </p>

      <AnalyticsScreen
        report={report}
        recent={recent}
        selectedId={selected?.id ?? null}
        timeZone={getServerEnv().APP_TIMEZONE}
      />
    </div>
  );
}
