import "server-only";

import { redirect } from "next/navigation";

import { can, type Permission, type Role } from "@/lib/auth/roles";
import { verifySession, type SessionUser } from "@/lib/auth/session";

/**
 * Server-side authorization (spec §33).
 *
 * Firestore Security Rules govern the client SDK only — the Admin SDK
 * bypasses them entirely. Every server path therefore has to authorize
 * itself, and this module is where that happens.
 *
 * `proxy.ts` also redirects when the cookie is missing, but that is a
 * convenience, not a check: the Edge runtime cannot run the Admin SDK and so
 * cannot verify anything. Never rely on it for access control.
 */

export type { SessionUser };

/** The current user, or null. Safe to call on a public route. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  return verifySession();
}

/**
 * Require a signed-in user, redirecting to login otherwise.
 *
 * `next` carries the requested path so login can return the user where they
 * were going. It is passed through `encodeURIComponent` and validated on the
 * way back out (see the login page) so it cannot become an open redirect.
 */
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    const target = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
    redirect(target);
  }

  return user;
}

/**
 * Require a signed-in user holding a permission.
 *
 * A user with a valid session but no role claim is treated as unauthorized,
 * not as an error: it means an account was created without provisioning
 * finishing, and the safe reading of a missing claim is "no access".
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();

  if (!user.role || !can(user.role, permission)) {
    redirect("/forbidden");
  }

  return user;
}

/** Require one of a specific set of roles. */
export async function requireRole(...roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireUser();

  if (!user.role || !roles.includes(user.role)) {
    redirect("/forbidden");
  }

  return user;
}
