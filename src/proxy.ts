import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_ROUTE, SESSION_COOKIE_NAME } from "@/config/auth";

/**
 * Request proxy - the first gate for every non-API page.
 *
 * Next 16 successor to `middleware.ts` (that convention is deprecated). Runs
 * before routing and performs the CHEAP check only: does a session cookie
 * exist? Unauthenticated visitors are redirected to /login with a `next`
 * hint. The authoritative validation - token signature, user still exists,
 * account still active - happens in the (dashboard) layout and in the
 * `requireAuth()`/`requireRole()` helpers used by API routes.
 *
 * Public by design (excluded via matcher): /api (routes return their own
 * 401 JSON), /login, /signup, and static assets. To add a future public
 * page, extend the matcher exclusion list.
 */

export default function proxy(request: NextRequest): NextResponse {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_ROUTE;
  loginUrl.search = "";
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Gate every page except API routes, /login, /signup and files with
  // extensions.
  matcher: ["/((?!api|_next|favicon.ico|login|signup|.*\\..*).*)"],
};
