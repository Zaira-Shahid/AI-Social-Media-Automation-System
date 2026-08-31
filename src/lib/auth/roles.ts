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
