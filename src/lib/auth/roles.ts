import { z } from "zod";

/**
 * Roles and permissions (spec §27).
 *
 * Shared by client and server. Nothing secret lives here — this module
 * decides what a role *may* do, never whether the caller actually holds
 * that role. That answer comes from the Firebase Auth custom claim, which
 * only the Admin SDK can set (§33).
 *
 * §27 requires permissions to be defined explicitly, so they are enumerated
 * rather than derived from a hierarchy. A hierarchy would quietly grant a
 * role something nobody decided to grant it.
 */
export const ROLES = ["ADMIN", "MANAGER", "SOCIAL_MANAGER"] as const;

export const roleSchema = z.enum(ROLES);

export type Role = z.infer<typeof roleSchema>;

export const PERMISSIONS = [
  "users:manage",
  "brand:manage",
  "integrations:manage",
  "automations:manage",
  "settings:manage",
  "sources:manage",
  "news:select",
  "content:view",
  "content:edit",
  "content:regenerate",
  "content:approve",
  "content:schedule",
  "analytics:view",
  "strategy:view",
  "strategy:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The permission matrix from §27.
 *
 * `news:select` is not named in §27, which lists roles rather than every
 * action. Choosing the day's three stories (§8, §46) is an editorial decision
 * about what the company talks about, so it sits with the roles that already
 * run the pipeline — ADMIN and MANAGER, the same pair that holds
 * `automations:manage`. SOCIAL_MANAGER writes and approves the content, but
 * does not set the agenda.
 *
 * §27 qualifies two SOCIAL_MANAGER abilities as "where permitted" and one
 * MANAGER ability as "manage workflows where permitted". Those qualifiers
 * describe per-resource conditions that later modules impose on top of the
 * permission (for example, a platform post's own state deciding whether it
 * is still schedulable). They are not a reason to withhold the permission
 * here — a role either can attempt the action or cannot.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: [
    "users:manage",
    "brand:manage",
    "integrations:manage",
    "automations:manage",
    "settings:manage",
    "sources:manage",
    "news:select",
    "content:view",
    "content:edit",
    "content:regenerate",
    "content:approve",
    "content:schedule",
    "analytics:view",
    "strategy:view",
    "strategy:manage",
  ],
  MANAGER: [
    "content:view",
    "content:approve",
    "news:select",
    "automations:manage",
    "analytics:view",
    "strategy:view",
  ],
  SOCIAL_MANAGER: [
    "content:view",
    "content:edit",
    "content:regenerate",
    "content:approve",
    "content:schedule",
  ],
};

/** Does this role hold this permission? The only place a role check is expressed. */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Every permission held by a role. Useful for rendering, never for authorizing. */
export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Human label for a role, for display only. */
export function roleLabel(role: Role): string {
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** Human label for a permission's category (the part before the colon), for display only. */
const CATEGORY_LABELS: Record<string, string> = {
  users: "Users",
  brand: "Brand",
  integrations: "Integrations",
  automations: "Automations",
  settings: "Settings",
  sources: "Sources",
  news: "News",
  content: "Content",
  analytics: "Analytics",
  strategy: "Strategy",
};

export interface PermissionGroup {
  category: string;
  permissions: readonly Permission[];
}

/**
 * A role's permissions grouped by their own category prefix (§27's "users:manage",
 * "content:edit", …), for the Dashboard's access summary.
 *
 * The grouping is read off the permission strings themselves, not a second
 * taxonomy declared here — there is exactly one place a permission's
 * category can drift from this list, and it is `PERMISSIONS` above.
 */
export function groupedPermissionsFor(role: Role): PermissionGroup[] {
  const groups = new Map<string, Permission[]>();

  for (const permission of permissionsFor(role)) {
    const [category] = permission.split(":");
    const list = groups.get(category) ?? [];
    list.push(permission);
    groups.set(category, list);
  }

  // PERMISSIONS' own order, so the groups read in one stable, meaningful
  // order rather than whatever order a Map happens to iterate in.
  const order = [...new Set(PERMISSIONS.map((permission) => permission.split(":")[0]))];

  return order
    .filter((category) => groups.has(category))
    .map((category) => ({
      category: CATEGORY_LABELS[category] ?? category,
      permissions: groups.get(category)!,
    }));
}
