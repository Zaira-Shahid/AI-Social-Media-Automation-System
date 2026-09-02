import { describe, expect, it } from "vitest";

import { ROLES, can, groupedPermissionsFor, permissionsFor, roleLabel, roleSchema } from "@/lib/auth/roles";

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

  it("puts the daily news selection with ADMIN and MANAGER only", () => {
    // §27 does not name this action, so it follows the roles that already run
    // the pipeline. SOCIAL_MANAGER writes and approves content, but does not
    // set the day's agenda (§8, §46).
    expect(can("ADMIN", "news:select")).toBe(true);
    expect(can("MANAGER", "news:select")).toBe(true);
    expect(can("SOCIAL_MANAGER", "news:select")).toBe(false);
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

  /**
   * The Dashboard's grouped access summary (§35, chore/dashboard-redesign).
   */
  describe("groupedPermissionsFor", () => {
    it("groups every permission a role holds under its own category prefix", () => {
      const groups = groupedPermissionsFor("SOCIAL_MANAGER");

      expect(groups).toEqual([{ category: "Content", permissions: permissionsFor("SOCIAL_MANAGER") }]);
    });

    it("never drops or duplicates a permission across groups", () => {
      for (const role of ROLES) {
        const groups = groupedPermissionsFor(role);
        const flattened = groups.flatMap((group) => group.permissions);

        expect(flattened.sort()).toEqual([...permissionsFor(role)].sort());
      }
    });

    it("orders groups by where their category first appears in PERMISSIONS, not alphabetically", () => {
      const groups = groupedPermissionsFor("ADMIN");

      // "users" precedes "content" in PERMISSIONS but not alphabetically —
      // proves the order is read off PERMISSIONS, not re-sorted.
      const users = groups.findIndex((group) => group.category === "Users");
      const content = groups.findIndex((group) => group.category === "Content");
      expect(users).toBeLessThan(content);
    });

    it("omits a category the role holds nothing in", () => {
      const groups = groupedPermissionsFor("SOCIAL_MANAGER");

      expect(groups.some((group) => group.category === "Automations")).toBe(false);
    });
  });
});
