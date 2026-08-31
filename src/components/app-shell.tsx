import { MainNav } from "@/components/main-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { roleLabel } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Authenticated application shell.
 *
 * The navigation itself lives in `main-nav.tsx`, which is a client component
 * because it highlights the active route. Everything here stays on the
 * server so the session user is never serialized further than it needs to be.
 */
export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border p-4">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold">AI Social Media</p>
          <p className="text-xs text-muted-foreground">Command Center</p>
        </div>

        <MainNav role={user.role} />

        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-2 px-2">
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

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
