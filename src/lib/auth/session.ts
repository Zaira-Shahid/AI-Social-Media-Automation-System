import "server-only";

import { cookies } from "next/headers";

import { getAdminAuth } from "@/lib/firebase/admin";
import { getServerEnv } from "@/lib/env.server";
import { roleSchema, type Role } from "@/lib/auth/roles";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session.shared";

/**
 * Session cookies (spec §26).
 *
 * Firebase ID tokens last an hour and live in the browser, which makes them
 * a poor fit for server-rendered protected routes. A session cookie is
 * minted from an ID token by the Admin SDK, is httpOnly so no script can
 * read it, and can be revoked centrally.
 */

export { SESSION_COOKIE_NAME, sessionCookieOptions };

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface SessionUser {
  uid: string;
  email: string | null;
  role: Role | null;
}

export function sessionMaxAgeMs(): number {
  return getServerEnv().SESSION_COOKIE_MAX_AGE_DAYS * DAY_IN_MS;
}

/** Exchange a freshly minted ID token for a session cookie and set it. */
export async function createSession(idToken: string): Promise<SessionUser> {
  const expiresIn = sessionMaxAgeMs();
  const auth = getAdminAuth();

  // Verify before minting. `checkRevoked` catches a token belonging to a user
  // who has since been disabled or had their sessions revoked.
  const decoded = await auth.verifyIdToken(idToken, true);

  const cookie = await auth.createSessionCookie(idToken, { expiresIn });

  const store = await cookies();
  store.set({ ...sessionCookieOptions(expiresIn), value: cookie });

  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    role: roleSchema.safeParse(decoded.role).data ?? null,
  };
}

/**
 * Verify the session cookie.
 *
 * `checkRevoked` is deliberately on: without it, a signed-out or disabled
 * user keeps a working session until the cookie's own expiry, which could
 * be two weeks.
 *
 * Returns null rather than throwing. A bad or absent cookie is the normal
 * case for a logged-out visitor, not an error condition.
 */
export async function verifySession(): Promise<SessionUser | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE_NAME)?.value;

  if (!cookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true);

    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      role: roleSchema.safeParse(decoded.role).data ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Clear the cookie and revoke the user's refresh tokens.
 *
 * Revocation is what makes logout mean something on other devices too;
 * clearing the cookie alone only affects this browser.
 */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE_NAME)?.value;

  if (cookie) {
    try {
      const decoded = await getAdminAuth().verifySessionCookie(cookie, false);
      await getAdminAuth().revokeRefreshTokens(decoded.sub);
    } catch {
      // An unverifiable cookie is already useless. Still clear it below.
    }
  }

  store.set({ ...sessionCookieOptions(0), value: "", maxAge: 0 });
}
