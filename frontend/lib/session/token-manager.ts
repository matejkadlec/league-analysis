/**
 * Tokens live in server-set HttpOnly cookies: this module only asks the
 * backend to rotate or drop a session, and never reads a token.
 */

import { clearAuthStateCookie } from "./auth-state-cookie";
import { AUTH_PROBE_TIMEOUT_MS } from "./login-error";

/**
 * Never a boolean: every variant is an object, so a stale `if (!result)` is
 * dead code rather than a teardown.
 */
export type SessionRefresh =
  /** The session is current; the cookies were rotated. */
  | { outcome: "refreshed" }
  /** This session is over, and the hint has already been retracted. */
  | { outcome: "refused" }
  /** The server answered, but not about validity (a 5xx, a rate limit); never
   *  a refusal status. */
  | { outcome: "unavailable"; status: number }
  /** Nothing was learned -- unreachable, timed out, or about a session already
   *  ended; `cause` carries any thrown value, for reporting only. */
  | { outcome: "unreachable"; cause?: unknown };

/**
 * A status alone is never evidence: an edge challenge and an authorization
 * failure both answer 403, so a refusal has to name itself here.
 */
const SESSION_ENDING_CODES = new Set([
  "INVALID_REFRESH_TOKEN",
  "ACCOUNT_INACTIVE",
]);

export async function namesTheEndOfTheSession(
  response: Response,
): Promise<boolean> {
  // Any JSON media type, not the exact string: `application/problem+json`
  // keeps `detail.code`, while a challenge page is no flavour of JSON.
  if (
    !/^application\/([\w.+-]+\+)?json/i.test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    return false;
  }
  try {
    // `clone()` so a caller that also reads this body still can.
    const body: unknown = await response.clone().json();
    const detail = (body as { detail?: unknown }).detail;
    const code =
      typeof detail === "object" && detail !== null
        ? (detail as { code?: unknown }).code
        : undefined;
    return typeof code === "string" && SESSION_ENDING_CODES.has(code);
  } catch {
    // An unreadable body says nothing, and guessing here is what this whole
    // function exists to stop.
    return false;
  }
}

let refreshInFlight: Promise<SessionRefresh> | null = null;
// Bumped on teardown: a refresh that started earlier can still land after it,
// and its Set-Cookie would resurrect the session the user just left.
let sessionEpoch = 0;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function endLocalSession(): void {
  sessionEpoch += 1;
  // Retracts the cookie `proxy.ts` routes on; without it the server admits
  // the visitor to a page the client cannot render.
  clearAuthStateCookie();
}

export async function refreshAccessToken(): Promise<SessionRefresh> {
  if (!isBrowser()) {
    return { outcome: "unreachable" };
  }

  if (refreshInFlight) {
    return await refreshInFlight;
  }

  const runRefresh = async (): Promise<SessionRefresh> => {
    const epoch = sessionEpoch;
    try {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
        // Same deadline as the probe that calls this: a refresh that never
        // settles strands the caller just as a stalled probe would.
        signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
      });

      if (!response.ok) {
        // A 401 or 403 ends the session only when the body names a
        // session-ending code: a bare status can be a redeploy or a challenge.
        const refused =
          (response.status === 401 || response.status === 403) &&
          (await namesTheEndOfTheSession(response));
        if (refused && epoch === sessionEpoch) {
          // A rejection landing after a teardown is about the session that
          // ended; acting on it signs out whoever signed in since.
          endLocalSession();
          return { outcome: "refused" };
        }
        if (refused) {
          // Says nothing about the session on screen, and reporting the status
          // would have `normalizeApiError` read 401 back as authentication.
          return { outcome: "unreachable" };
        }
        if (response.status === 401 || response.status === 403) {
          // A status that named nothing did not come from this API's refusal
          // path, and reporting it would read back as authentication.
          return { outcome: "unreachable" };
        }
        // The status travels along so a rate limit is not reported as an
        // unreachable server: `/auth/refresh` shares one bucket, 429 is normal.
        return { outcome: "unavailable", status: response.status };
      }

      if (epoch !== sessionEpoch) {
        // Torn down in flight, but the browser has already committed the
        // rotated cookies over anyone who signed in since, so end server-side.
        clearAuthStateCookie();
        try {
          await fetch("/api/v1/auth/logout", {
            method: "POST",
            credentials: "include",
            // `refreshInFlight` clears only in the outer `finally`, so a hang
            // here strands every later refresh on a promise that never settles.
            signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
          });
        } catch {
          // Unreachable; the token expires on its own schedule.
        }
        // The session this refresh belonged to is over either way, and the
        // line above has just ended the rotated one too.
        return { outcome: "refused" };
      }

      return { outcome: "refreshed" };
    } catch (error) {
      return { outcome: "unreachable", cause: error };
    }
  };

  // Cleared in the outer `finally`, not inside `runRefresh`: that would run
  // before this assignment on a synchronous settle and cache it forever.
  const attempt = runRefresh();
  refreshInFlight = attempt;
  try {
    return await attempt;
  } finally {
    if (refreshInFlight === attempt) {
      refreshInFlight = null;
    }
  }
}
