import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session.shared";

/**
 * Cheap redirect for requests that carry no session cookie at all.
 *
 * This is NOT the authorization check. The proxy (Next 16's replacement for
 * middleware) runs on the Edge runtime,
 * where the Admin SDK cannot run, so it can see that a cookie exists but not
 * whether it is valid. The real check is `requireUser()` in the protected
 * layout and in server routes (§33).
 *
 * Its job is to save a wasted render and to stop an unauthenticated visitor
 * landing on a flash of application shell.
 */
const PUBLIC_PATHS = ["/login", "/forbidden"];

/**
 * Content-Security-Policy, nonce-based (spec §22 Module 22, §56).
 *
 * Set here rather than as a static header in `next.config.ts`: Next.js's
 * App Router bootstraps every page with its own inline `<script>` tags (RSC
 * hydration data), and a `script-src` with no exception for them breaks
 * every page — confirmed directly, not assumed: a headless run against a
 * built server with a plain `script-src 'self'` threw
 * `InvariantError: Expected a request ID to be defined... self.__next_r`,
 * caused by the browser's console reporting exactly those inline scripts as
 * CSP violations. A static `'unsafe-inline'` would silence that at the cost
 * of most of what `script-src` is for. The documented alternative — a fresh
 * nonce per request, in both the CSP header and (automatically, once Next
 * sees the header) its own inline scripts — is what this does instead.
 *
 * The other origins mirror `getClientAuth()`'s actual calls
 * (`signInWithEmailAndPassword`, `sendPasswordResetEmail` — plain REST, no
 * popup or redirect flow) and Cloudinary, where every card and brand logo
 * lives (§28). `getClientFirestore()` is exported but never called anywhere
 * in this app — everything reads through the Admin SDK on the server — so
 * Firestore's own origin is deliberately not in `connect-src`. Both narrow
 * scopes have to grow the moment either changes.
 *
 * `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST` (the same flag `firebase/client.ts`
 * already reads to decide whether to connect to the emulators at all) adds
 * that host to `connect-src` when it is set. Found by running the actual
 * credentialed e2e suite against this policy, not by inspection: the
 * emulator run talks to `127.0.0.1:9099`/`8080`, not Google's endpoints, and
 * a `connect-src` scoped to production alone made every sign-in in that
 * suite fail with "Could not reach the sign-in service" — the CSP was
 * silently blocking the emulator request. This flag is never set outside
 * local development and the emulator-backed test run (§58), so it never
 * widens what a deployed environment allows.
 */
function contentSecurityPolicy(nonce: string): string {
  const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;
  const connectSrc = ["'self'", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com"];

  if (emulatorHost) {
    connectSrc.push(`http://${emulatorHost}:9099`, `http://${emulatorHost}:8080`);
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://res.cloudinary.com",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function withCsp(request: NextRequest, response: NextResponse): NextResponse {
  const nonce = crypto.randomUUID();
  const policy = contentSecurityPolicy(nonce);

  // Read back via `(await headers()).get('x-nonce')` by anything that needs
  // to put the nonce on a `<script>` it renders itself; Next's own inline
  // scripts pick up the CSP response header's nonce automatically.
  request.headers.set("x-nonce", nonce);
  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy", policy);

  return response;
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return withCsp(request, NextResponse.next({ request }));
  }

  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return withCsp(request, NextResponse.next({ request }));
  }

  const loginUrl = new URL("/login", request.url);
  // Only the path is carried forward, never a full URL, so this cannot be
  // turned into an open redirect.
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  /*
   * Pages only. Next internals, static assets and the whole `/api` tree are
   * excluded.
   *
   * `/api` is excluded deliberately, not for convenience. This proxy answers
   * a missing cookie with a redirect to an HTML login page, which is the
   * wrong answer for any API client: `/api/health` is the n8n keep-warm
   * target that runs before anyone logs in (§28), `/api/auth` is how a
   * session is obtained in the first place, and `/api/webhooks/*` is called
   * by n8n, which has no cookie and authenticates by signature instead (§44).
   * An API route that needs a user checks for one itself and returns 401 —
   * which §33 requires of server code regardless. CSP is meaningless on a
   * JSON response anyway — there is nothing here for a browser to render.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
