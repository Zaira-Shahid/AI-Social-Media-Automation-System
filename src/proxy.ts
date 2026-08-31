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

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  // Only the path is carried forward, never a full URL, so this cannot be
  // turned into an open redirect.
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  /*
   * Everything except Next internals, static assets, and the health endpoint.
   *
   * `/api/health` must stay reachable without a session: it is the n8n
   * keep-warm target and runs before anyone logs in (§28). `/api/auth` is
   * excluded because it is how a session is obtained in the first place.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/auth).*)"],
};
