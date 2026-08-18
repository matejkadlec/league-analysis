/**
 * Centralized auth session management.
 *
 * Tokens live in server-set HttpOnly cookies. This module only asks the
 * backend to rotate or drop that session; JavaScript never reads the tokens.
 */

import { clearAuthStateCookie } from "./auth-state-cookie";
import { AUTH_PROBE_TIMEOUT_MS } from "./login-error";

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
        // Same deadline as the probe that calls this: a refresh that never
        // settles strands the caller exactly as a probe that never settles
        // would.
        signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
      });

      if (!response.ok) {
        // Only the server refusing the token ends a session. A 502 or 503 is
        // the API being restarted or redeployed, and treating that as a
        // rejection signed people out mid-deploy while their refresh cookie
        // was still perfectly valid.
        if (
          (response.status === 401 || response.status === 403) &&
          epoch === sessionEpoch
        ) {
          // Only if this refresh still belongs to the session on screen. A
          // rejection that arrives after a teardown is about the session that
          // ended, and tearing down again would take out whoever signed in
          // since -- on a shared machine, the next person, moments after they
          // signed in successfully.
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
        // Unconditional, even when somebody has signed in since the
        // teardown. It is tempting to skip this to avoid ending their
        // session -- but this response has already ended it: /auth/refresh
        // answers 200 with Set-Cookie for all three cookies under the same
        // names and path, so the browser committed them the moment the
        // headers arrived, and the jar now holds the *rotated* session, not
        // theirs. Their HttpOnly cookies are gone and JavaScript cannot put
        // them back. Leaving it here would show them a signed-in shell with
        // their own name on it while every request carried somebody else's
        // credentials. Sending them back to sign in is the only sound exit.
        clearAuthStateCookie();
        try {
          await fetch(`${getApiBaseUrl()}/api/v1/auth/logout`, {
            method: "POST",
            credentials: "include",
            // `refreshInFlight` is only cleared in the outer `finally`, so a
            // hang here would leave every later refresh awaiting a promise
            // that never settles — token refresh silently dead for the tab.
            signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
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
