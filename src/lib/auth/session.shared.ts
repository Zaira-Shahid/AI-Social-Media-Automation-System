/**
 * Session values needed on both runtimes.
 *
 * `session.ts` is `server-only` and loads the Admin SDK, which cannot run on
 * the Edge runtime where `proxy.ts` executes. Anything both sides need —
 * and anything worth unit-testing without a request context — lives here.
 */

/**
 * `__session` is not an arbitrary name. Several hosts (Firebase Hosting and
 * other CDN front-ends) strip every cookie except this one from cached
 * responses. Using it costs nothing today and avoids a confusing outage if
 * the deployment target ever changes.
 */
export const SESSION_COOKIE_NAME = "__session";

/**
 * Cookie attributes.
 *
 * `secure` is off in development only, because localhost is served over
 * plain HTTP and the browser would otherwise silently drop the cookie —
 * which presents as "login succeeds but the app still says logged out".
 */
export function sessionCookieOptions(maxAgeMs: number) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}
