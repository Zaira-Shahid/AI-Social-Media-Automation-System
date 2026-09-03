import { AuditLogScreen } from "@/components/audit-log-screen";
import { listRecentAuditEntries } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";

/**
 * The audit log screen (spec §55, §63 Module 21).
 *
 * Recording has existed since Module 01 — every login, approval, publish,
 * sync and settings change writes an entry — but nothing has ever read it
 * back until now. Read-only: `auditLogs` stays server-only in
 * `firestore.rules` (§33), same posture as `automationRuns`, so this reads
 * through the Admin SDK rather than opening the collection to the browser.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Audit Log" };

const RECENT_LIMIT = 100;

export default async function AuditLogPage() {
  await requirePermission("automations:manage");

  const entries = await listRecentAuditEntries(RECENT_LIMIT);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every recorded action — who did it, what it touched, and whether it succeeded. Never
        secrets, never a token.
      </p>

      <AuditLogScreen entries={entries} />
    </div>
  );
}
