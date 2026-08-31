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

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-border p-4">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold">AI Social Media</p>
          <p className="text-xs text-muted-foreground">Command Center</p>
        </div>

        <nav aria-label="Main">
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
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
