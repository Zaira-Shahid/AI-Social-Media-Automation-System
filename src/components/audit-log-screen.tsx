import type { StoredAuditEntry } from "@/lib/audit";
import { cn } from "@/lib/utils";

/**
 * The audit log table (spec §55, §63 Module 21).
 *
 * §55's fields, in order: actor, action, resource, timestamp, status,
 * metadata. Read-only — there is nothing here for a person to do except
 * look, which is the point of an audit trail.
 */
function StatusBadge({ status }: { status: "SUCCESS" | "FAILURE" }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        status === "SUCCESS" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </span>
  );
}

export function AuditLogScreen({ entries }: { entries: StoredAuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No audited actions have been recorded yet.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-normal">When</th>
            <th className="py-2 pr-4 font-normal">Action</th>
            <th className="py-2 pr-4 font-normal">Actor</th>
            <th className="py-2 pr-4 font-normal">Resource</th>
            <th className="py-2 pr-4 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b last:border-0 align-top">
              <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                {new Date(entry.occurredAt).toLocaleString()}
              </td>
              <td className="py-2 pr-4 font-medium">{entry.action}</td>
              <td className="py-2 pr-4">{entry.actor}</td>
              <td className="py-2 pr-4 break-all">
                {entry.resource}
                {entry.metadata ? (
                  <div className="mt-1 text-xs text-muted-foreground break-all">
                    {JSON.stringify(entry.metadata)}
                  </div>
                ) : null}
              </td>
              <td className="py-2 pr-4">
                <StatusBadge status={entry.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
