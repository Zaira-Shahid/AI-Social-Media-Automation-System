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
const NAVIGATION: {
  label: string;
  icon: typeof Home;
  href?: string;
  permission?: Permission;
}[] = [
  { label: "Dashboard", icon: Home, href: "/" },
  { label: "News", icon: Newspaper },
  { label: "Content", icon: FileText },
  { label: "Calendar", icon: CalendarDays },
  { label: "Analytics", icon: BarChart3 },
  { label: "Strategy", icon: Target },
  { label: "Automation", icon: Workflow },
  { label: "Social Accounts", icon: Share2 },
  { label: "Brand", icon: Palette, href: "/brand", permission: "brand:manage" },
  { label: "Settings", icon: Settings },
];

const BASE_ITEM = "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm";

export function MainNav({ role }: { role: Role | null }) {
  const pathname = usePathname();

  const visible = NAVIGATION.filter(
    (item) => !item.permission || (role !== null && can(role, item.permission)),
  );

  return (
    <nav aria-label="Main" className="flex-1">
      <ul className="space-y-1">
        {visible.map(({ label, icon: Icon, href }) => {
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
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
