/**
 * Centralized auth session management.
 *
 * Tokens live in server-set HttpOnly cookies. This module only asks the
 * backend to rotate or drop that session; JavaScript never reads the tokens.
 */

import { clearAuthStateCookie } from "./auth-state-cookie";

let refreshInFlight: Promise<boolean> | null = null;
let sessionHint = false;
// Bumped every time the session is torn down. A refresh that started before
// the teardown can still land after it, and its Set-Cookie response would
// otherwise put the hint back and resurrect a session the user just left.
let sessionEpoch = 0;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getApiBaseUrl(): string {
  return typeof window === "undefined"
    ? process.env.API_INTERNAL_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        "http://localhost:8000"
    : "";
}

export function markAuthSession(active: boolean): void {
  sessionHint = active;
}

export function setAuthTokens(): void {
  markAuthSession(true);
}

export function removeAuthTokens(): void {
  sessionEpoch += 1;
  sessionHint = false;
  // Every path that gives up on a session routes through here, so this is the
  // one place that has to retract the cookie `proxy.ts` routes on. Without it
  // a session the API has stopped honouring still looks live to the server,
  // which admits the visitor to a page the client then cannot render.
  clearAuthStateCookie();
}

export function getAccessToken(): string | null {
  return sessionHint ? "session" : null;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!isBrowser()) {
    return null;
  }

  if (refreshInFlight) {
    const ok = await refreshInFlight;
    return ok ? "cookie" : null;
  }

  const runRefresh = async (): Promise<boolean> => {
    const epoch = sessionEpoch;
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      if (!response.ok) {
        // Only the server refusing the token ends a session. A 502 or 503 is
        // the API being restarted or redeployed, and treating that as a
        // rejection signed people out mid-deploy while their refresh cookie
        // was still perfectly valid.
        if (response.status === 401 || response.status === 403) {
          removeAuthTokens();
        }
        return false;
      }

      if (epoch !== sessionEpoch) {
        // Torn down while this was in flight — a logout, or a probe that gave
        // up. This refresh still succeeded, and rotation means the server has
        // already issued and stored a *new* 30-day refresh token, which the
        // response installed as an HttpOnly cookie. Clearing the hint would
        // only hide it: JS cannot touch that cookie, and nothing has told the
        // server to revoke it. So ask the server to end the session properly.
        clearAuthStateCookie();
        try {
          await fetch(`${getApiBaseUrl()}/api/v1/auth/logout`, {
            method: "POST",
            credentials: "include",
          });
        } catch {
          // Unreachable; the token expires on its own schedule.
        }
        return false;
      }

      markAuthSession(true);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  };

  refreshInFlight = runRefresh();
  const ok = await refreshInFlight;
  return ok ? "cookie" : null;
}

export function hasAuthTokens(): boolean {
  return sessionHint;
}
