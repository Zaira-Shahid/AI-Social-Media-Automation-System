import { MainNav } from "@/components/main-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { roleLabel } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Authenticated application shell (chore/dashboard-redesign).
 *
 * The navigation itself lives in `main-nav.tsx`, which is a client component
 * because it highlights the active route. Everything here stays on the
 * server so the session user is never serialized further than it needs to be.
 *
 * The sidebar uses its own `--sidebar` tokens rather than the page
 * background, so it reads as a distinct panel instead of a border floating
 * in the same color as the content beside it.
 */
export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            A
          </div>
          <div className="ml-2.5 min-w-0">
            <p className="truncate text-sm font-semibold">AI Social Media</p>
            <p className="truncate text-xs text-muted-foreground">Command Center</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <MainNav role={user.role} />
        </div>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2.5 rounded-md px-2 py-1.5">
            <p className="truncate text-xs font-medium" title={user.email ?? undefined}>
              {user.email ?? user.uid}
            </p>
            {/*
              A missing role means provisioning did not finish. Say so rather
              than rendering a blank line, since it explains why the account
              can reach nothing.
            */}
            <p className="text-xs text-muted-foreground">
              {user.role ? roleLabel(user.role) : "No role assigned"}
            </p>
          </div>

          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
