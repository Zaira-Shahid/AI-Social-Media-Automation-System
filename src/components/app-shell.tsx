import {
  BarChart3,
  CalendarDays,
  FileText,
  Home,
  Newspaper,
  Palette,
  Settings,
  Share2,
  Target,
  Workflow,
} from "lucide-react";

import { SignOutButton } from "@/components/sign-out-button";
import { roleLabel } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Navigation structure from spec §34.
 *
 * Module 00 renders the shell only — every destination is inert. Screens are
 * built in their own modules (§35–§43).
 */
const NAVIGATION = [
  { label: "Dashboard", icon: Home },
  { label: "News", icon: Newspaper },
  { label: "Content", icon: FileText },
  { label: "Calendar", icon: CalendarDays },
  { label: "Analytics", icon: BarChart3 },
  { label: "Strategy", icon: Target },
  { label: "Automation", icon: Workflow },
  { label: "Social Accounts", icon: Share2 },
  { label: "Brand", icon: Palette },
  { label: "Settings", icon: Settings },
] as const;

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border p-4">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold">AI Social Media</p>
          <p className="text-xs text-muted-foreground">Command Center</p>
        </div>

        <nav aria-label="Main" className="flex-1">
          <ul className="space-y-1">
            {NAVIGATION.map(({ label, icon: Icon }) => (
              <li key={label}>
                <span
                  aria-disabled="true"
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </nav>

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
