"use client";

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
import Link from "next/link";
import { usePathname } from "next/navigation";

import { can, type Permission, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

/**
 * Navigation from spec §34.
 *
 * Entries without an `href` are destinations later modules will build. They
 * render as inert text rather than links, because a link that goes nowhere is
 * worse than a label that plainly is not ready yet.
 *
 * Entries with a `permission` are hidden from roles that lack it. Showing a
 * link that bounces the user to /forbidden teaches them nothing except that
 * the app is broken.
 */
interface NavItem {
  label: string;
  icon: typeof Home;
  href?: string;
  permission?: Permission;
  /**
   * Sub-destinations. §34 fixes the top-level list, so anything that is not on
   * it — source management, for one — hangs off the entry it belongs to rather
   * than being invented as an eleventh top-level item.
   */
  children?: { label: string; href: string; permission?: Permission }[];
}

const NAVIGATION: NavItem[] = [
  { label: "Dashboard", icon: Home, href: "/" },
  {
    label: "News",
    icon: Newspaper,
    href: "/news",
    permission: "content:view",
    children: [{ label: "Sources", href: "/news/sources", permission: "sources:manage" }],
  },
  { label: "Content", icon: FileText, href: "/content", permission: "content:view" },
  { label: "Calendar", icon: CalendarDays, href: "/calendar", permission: "content:view" },
  { label: "Analytics", icon: BarChart3, href: "/analytics", permission: "analytics:view" },
  { label: "Strategy", icon: Target, href: "/strategy", permission: "strategy:view" },
  { label: "Automation", icon: Workflow, href: "/automation", permission: "automations:manage" },
  {
    label: "Social Accounts",
    icon: Share2,
    href: "/social-accounts",
    permission: "content:view",
  },
  { label: "Brand", icon: Palette, href: "/brand", permission: "brand:manage" },
  { label: "Settings", icon: Settings },
];

const BASE_ITEM = "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm";

export function MainNav({ role }: { role: Role | null }) {
  const pathname = usePathname();

  const allowed = (permission?: Permission) =>
    !permission || (role !== null && can(role, permission));

  const visible = NAVIGATION.map((item) => ({
    ...item,
    children: item.children?.filter((child) => allowed(child.permission)) ?? [],
  }))
    // An entry with no route of its own and no reachable children is dropped
    // entirely rather than left as a label that does nothing for this role.
    .filter((item) => allowed(item.permission))
    .filter((item) => item.href !== undefined || item.children.length > 0 || !item.permission);

  return (
    <nav aria-label="Main" className="flex-1">
      <ul className="space-y-1">
        {visible.map(({ label, icon: Icon, href, children }) => {
          const active = href !== undefined && pathname === href;

          return (
            <li key={label}>
              {href ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    BASE_ITEM,
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={cn(BASE_ITEM, "cursor-default text-muted-foreground")}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </span>
              )}

              {children.length > 0 ? (
                <ul className="mt-1 ml-6 space-y-1">
                  {children.map((child) => {
                    const childActive = pathname === child.href;

                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          aria-current={childActive ? "page" : undefined}
                          className={cn(
                            "block rounded-md px-2 py-1 text-sm",
                            childActive
                              ? "bg-muted font-medium text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
