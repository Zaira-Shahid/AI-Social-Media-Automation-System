import { roleLabel } from "@/lib/auth/roles";
import type { StoredProfile } from "@/lib/settings/store";
import { cn } from "@/lib/utils";

/**
 * The Settings screen (spec §34's nav list — the one item on it no module
 * was ever assigned to build).
 *
 * Scoped deliberately narrow: an ADMIN-only, read-only view of the two
 * things that were previously configurable only outside the app —
 * provisioned accounts and the env-sourced operational values other
 * screens already trust. Nothing here writes anything. §26's "no signup
 * route, ever" stays exactly as strict as it already was: this screen adds
 * visibility, not a second way to create or change an account.
 */
function StatusBadge({ status }: { status: "ACTIVE" | "DISABLED" }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        status === "ACTIVE" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </span>
  );
}

function UsersSection({ users }: { users: StoredProfile[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-medium">Users</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every provisioned account. There is no signup route, by design (§26) — creating an
        account, changing a role, or disabling one is a CLI-only action:{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run provision:user</code>.
        This list is read-only.
      </p>

      {users.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No accounts have been provisioned yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-normal">Email</th>
                <th className="py-2 pr-4 font-normal">Name</th>
                <th className="py-2 pr-4 font-normal">Role</th>
                <th className="py-2 pr-4 font-normal">Status</th>
                <th className="py-2 pr-4 font-normal">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.uid} className="border-b last:border-0">
                  <td className="py-2 pr-4">{user.email}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{user.displayName ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {user.role ? (
                      roleLabel(user.role)
                    ) : (
                      <span className="text-muted-foreground">Not assigned</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {user.updatedAt ? new Date(user.updatedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AppConfigSection({
  appConfig,
}: {
  appConfig: { timezone: string; sessionCookieMaxAgeDays: number; appBaseUrl: string };
}) {
  const rows = [
    { label: "Timezone", value: appConfig.timezone, env: "APP_TIMEZONE" },
    {
      label: "Session length",
      value: `${appConfig.sessionCookieMaxAgeDays} day${appConfig.sessionCookieMaxAgeDays === 1 ? "" : "s"}`,
      env: "SESSION_COOKIE_MAX_AGE_DAYS",
    },
    { label: "App base URL", value: appConfig.appBaseUrl, env: "APP_BASE_URL" },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-medium">Application configuration</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Set through environment variables, not this screen — changing one means updating the
        deployment&apos;s configuration and redeploying, not editing here.
      </p>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md border border-border p-3">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="mt-1 text-sm font-medium">{row.value}</dd>
            <dd className="mt-1 font-mono text-xs text-muted-foreground">{row.env}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function SettingsScreen({
  users,
  appConfig,
}: {
  /** null when the signed-in role lacks `users:manage` — the section is omitted, not shown empty. */
  users: StoredProfile[] | null;
  appConfig: { timezone: string; sessionCookieMaxAgeDays: number; appBaseUrl: string };
}) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Accounts and operational configuration, for reference — not a control panel.
      </p>

      <div className="mt-6 space-y-6">
        {users ? <UsersSection users={users} /> : null}
        <AppConfigSection appConfig={appConfig} />
      </div>
    </div>
  );
}
