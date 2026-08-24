import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";
import { isPublicRoute } from "@/features/auth/utils/public-routes";

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
  // Match all routes except static files and api routes
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
