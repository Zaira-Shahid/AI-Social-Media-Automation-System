import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardList, TrendingUp, Workflow } from "lucide-react";

import type { PermissionGroup } from "@/lib/auth/roles";
import { roleLabel, type Role } from "@/lib/auth/roles";
import type { AutomationStatusView } from "@/lib/automation/status";
import type { StoredWeeklyReport } from "@/lib/reporting/store";
import { cn } from "@/lib/utils";

/**
 * The Dashboard (spec §35, polish pass beyond the numbered modules).
 *
 * §35 lists eight things a real operations dashboard shows; this pass adds
 * the three a first screen most needs to answer at a glance — is anything
 * broken, how did last week go, what is waiting on a human — rather than
 * all eight at once. The rest (today's news, scheduled posts, recent
 * activity) already have their own screens reachable from the nav; this is
 * a front door to them, not a duplicate of each one.
 */

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
  href,
}: {
  icon: typeof Workflow;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "warning" | "good";
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-md",
            tone === "warning"
              ? "bg-destructive/10 text-destructive"
              : tone === "good"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Link>
  );
}

function AutomationCard({ automations }: { automations: AutomationStatusView[] }) {
  const enabled = automations.filter((a) => a.enabled).length;
  const failing = automations.filter((a) => a.lastRun?.status === "FAILURE").length;

  return (
    <SummaryCard
      icon={failing > 0 ? AlertTriangle : Workflow}
      label="Automation health"
      value={`${enabled}/${automations.length} enabled`}
      detail={
        failing > 0
          ? `${failing} last failed a run — see Automation.`
          : "No automation's last run failed."
      }
      tone={failing > 0 ? "warning" : "good"}
      href="/automation"
    />
  );
}

function WeeklyReportCard({ report }: { report: StoredWeeklyReport | null }) {
  if (!report) {
    return (
      <SummaryCard
        icon={TrendingUp}
        label="This week's performance"
        value="No report yet"
        detail="Runs automatically once a week has published posts to measure (§23)."
        href="/analytics"
      />
    );
  }

  return (
    <SummaryCard
      icon={TrendingUp}
      label="This week's performance"
      value={`${report.postsAnalyzed} post${report.postsAnalyzed === 1 ? "" : "s"} analyzed`}
      detail={
        report.bestPlatform
          ? `Best platform: ${report.bestPlatform}. Week of ${report.windowStart.slice(0, 10)}.`
          : `Week of ${report.windowStart.slice(0, 10)}.`
      }
      tone="good"
      href="/analytics"
    />
  );
}

function ApprovalsCard({ pending }: { pending: number }) {
  return (
    <SummaryCard
      icon={pending > 0 ? ClipboardList : CheckCircle2}
      label="Pending approval"
      value={String(pending)}
      detail={pending > 0 ? "Waiting in the review queue." : "Nothing is waiting on a review."}
      tone={pending > 0 ? "warning" : "good"}
      href="/content"
    />
  );
}

export function DashboardScreen({
  email,
  role,
  groups,
  automations,
  weeklyReport,
  pendingApprovals,
}: {
  email: string;
  role: Role | null;
  groups: PermissionGroup[];
  /** null when the viewer lacks `automations:manage` — the card is omitted, not shown empty. */
  automations: AutomationStatusView[] | null;
  /** undefined when the viewer lacks both `analytics:view` and `strategy:view`; null means no report has run yet. */
  weeklyReport: StoredWeeklyReport | null | undefined;
  /** null when the viewer lacks `content:view`. */
  pendingApprovals: number | null;
}) {
  const hasAnyCard =
    automations !== null || weeklyReport !== undefined || pendingApprovals !== null;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Signed in as {email}.</p>

      {hasAnyCard ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {automations ? <AutomationCard automations={automations} /> : null}
          {weeklyReport !== undefined ? <WeeklyReportCard report={weeklyReport} /> : null}
          {pendingApprovals !== null ? <ApprovalsCard pending={pendingApprovals} /> : null}
        </div>
      ) : null}

      <section className="mt-8 rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Your access</h2>

        {role ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Role: {roleLabel(role)}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {groups.map((group) => (
                <div key={group.category}>
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.category}
                  </h3>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {group.permissions.map((permission) => (
                      <li
                        key={permission}
                        className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                      >
                        {permission}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Empty state (§59): an account with no claim is provisioned but unfinished. */
          <p className="mt-2 text-sm text-muted-foreground">
            No role has been assigned to this account yet, so nothing is accessible. Ask an
            administrator to finish provisioning it.
          </p>
        )}
      </section>
    </div>
  );
}
