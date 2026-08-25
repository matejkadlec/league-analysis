// Regression fixture for `house/edge-isolation-syntax`, the guard on
// `proxy.ts`. Same contract as the sibling fixture: a suppressed case the
// rule must flag, an unsuppressed case it must not.

// oxlint-disable-next-line house/edge-isolation-syntax
import { edgeSession } from "@/lib/auth/edge-session";

// Accepted -- the three specifiers the edge may import.
import { NextResponse } from "next/server";
import { AUTH_STATE_COOKIE_NAME } from "@/features/auth/utils/auth-state-cookie";
import { isPublicRoute } from "@/features/auth/utils/public-routes";

declare const request: { nextUrl: { pathname: string } };

// MUST flag: a module loaded dynamically evades the import allowlist.
export const dynamicHelper = async () =>
  // oxlint-disable-next-line house/edge-isolation-syntax
  import("@/lib/core/api");

// MUST flag: a re-export loads a module the allowlist never sees.
// oxlint-disable-next-line house/edge-isolation-syntax
export { edgeSession as reexported } from "@/lib/auth/edge-session";

// MUST flag: `no-restricted-globals` sees a bare `fetch`, not a member call.
export const memberFetch = async () =>
  // oxlint-disable-next-line house/edge-isolation-syntax
  globalThis.fetch("/api/session");

// Accepted -- routing on the hint is the whole job.
export const proxy = () =>
  isPublicRoute(request.nextUrl.pathname)
    ? NextResponse.next()
    : NextResponse.redirect(new URL("/sign-in", "https://example.test"));

export const constants = [AUTH_STATE_COOKIE_NAME, edgeSession];
