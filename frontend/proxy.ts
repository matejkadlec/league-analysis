import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/lib/session/auth-state-cookie";
import { isPublicRoute } from "@/features/auth/public-routes";

// The edge asks nobody anything: it routes on the hint cookie alone and makes
// no requests, because one unanswered probe cannot tell "signed out" from
// "unreachable" and it has no way to refresh.
function isStaticOrInternal(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/client-error-report" ||
    pathname.includes(".") ||
    pathname === "/favicon.ico"
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticOrInternal(pathname)) {
    return NextResponse.next();
  }

  const hasAuthHint =
    request.cookies.get(AUTH_STATE_COOKIE_NAME)?.value ===
    AUTH_STATE_COOKIE_VALUE;
  const isSignInRoute =
    pathname === "/sign-in" || pathname.startsWith("/sign-in/");

  if (hasAuthHint && isSignInRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!hasAuthHint && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
