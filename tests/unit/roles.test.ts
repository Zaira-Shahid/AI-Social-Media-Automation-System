import { describe, expect, it } from "vitest";

import { ROLES, can, permissionsFor, roleLabel, roleSchema } from "@/lib/auth/roles";

/**
 * Permission matrix tests (spec §27, §58).
 *
 * Denials are asserted as explicitly as grants. A regression that widens a
 * role is silent unless something is watching for it.
 */
describe("roles", () => {
  it("accepts only the three defined roles", () => {
    for (const role of ROLES) {
      expect(roleSchema.safeParse(role).success).toBe(true);
    }

    expect(roleSchema.safeParse("SUPERADMIN").success).toBe(false);
    expect(roleSchema.safeParse("admin").success).toBe(false);
    expect(roleSchema.safeParse(undefined).success).toBe(false);
  });

  it("grants ADMIN every permission", () => {
    expect(can("ADMIN", "users:manage")).toBe(true);
    expect(can("ADMIN", "brand:manage")).toBe(true);
    expect(can("ADMIN", "integrations:manage")).toBe(true);
    expect(can("ADMIN", "settings:manage")).toBe(true);
    expect(can("ADMIN", "strategy:manage")).toBe(true);
  });

  it("denies MANAGER the administrative permissions", () => {
    expect(can("MANAGER", "users:manage")).toBe(false);
    expect(can("MANAGER", "brand:manage")).toBe(false);
    expect(can("MANAGER", "integrations:manage")).toBe(false);
    expect(can("MANAGER", "settings:manage")).toBe(false);
    expect(can("MANAGER", "strategy:manage")).toBe(false);
  });

  it("grants MANAGER review, approval, analytics and strategy viewing (§27)", () => {
    expect(can("MANAGER", "content:view")).toBe(true);
    expect(can("MANAGER", "content:approve")).toBe(true);
    expect(can("MANAGER", "analytics:view")).toBe(true);
    expect(can("MANAGER", "strategy:view")).toBe(true);
  });

  it("denies SOCIAL_MANAGER everything outside content work", () => {
    expect(can("SOCIAL_MANAGER", "users:manage")).toBe(false);
    expect(can("SOCIAL_MANAGER", "brand:manage")).toBe(false);
    expect(can("SOCIAL_MANAGER", "analytics:view")).toBe(false);
    expect(can("SOCIAL_MANAGER", "strategy:view")).toBe(false);
    expect(can("SOCIAL_MANAGER", "automations:manage")).toBe(false);
  });

  it("grants SOCIAL_MANAGER content editing, regeneration and scheduling (§27)", () => {
    expect(can("SOCIAL_MANAGER", "content:edit")).toBe(true);
    expect(can("SOCIAL_MANAGER", "content:regenerate")).toBe(true);
    expect(can("SOCIAL_MANAGER", "content:approve")).toBe(true);
    expect(can("SOCIAL_MANAGER", "content:schedule")).toBe(true);
  });

  it("gives only ADMIN the ability to manage users", () => {
    const withUserManagement = ROLES.filter((role) => can(role, "users:manage"));
    expect(withUserManagement).toEqual(["ADMIN"]);
  });

  it("lists no permission twice for a role", () => {
    for (const role of ROLES) {
      const permissions = permissionsFor(role);
      expect(new Set(permissions).size).toBe(permissions.length);
    }
  });

  it("labels roles for display", () => {
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(roleLabel("SOCIAL_MANAGER")).toBe("Social Manager");
  });
});
