import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Check if path is a static asset or internal Next.js route
function isStaticOrInternal(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".") || // Static files like .js, .css, .ico, etc.
    pathname === "/favicon.ico"
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets and internal routes
  if (isStaticOrInternal(pathname)) {
    return NextResponse.next();
  }

  // Authentication and route protection are enforced client-side by AuthGate.
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
