/**
 * Centralized auth session management.
 *
 * Tokens live in server-set HttpOnly cookies. This module only asks the
 * backend to rotate or drop that session; JavaScript never reads the tokens.
 */

import { clearAuthStateCookie } from "./auth-state-cookie";
import { AUTH_PROBE_TIMEOUT_MS } from "./login-error";

/**
 * What a refresh attempt found out. Never a boolean: every variant is an
 * object, so a stale `if (!result)` is dead code rather than a teardown.
 *
 */
export type SessionRefresh =
  /** The session is current; the cookies were rotated. */
  | { outcome: "refreshed" }
  /** This session is over, and the hint has already been retracted. */
  | { outcome: "refused" }
  /** The server answered about this session, but not about whether it is
   *  valid -- a 5xx, a rate limit. Never a refusal status: those are either a
   *  refusal or, if they arrive after a teardown, about nothing. */
  | { outcome: "unavailable"; status: number }
  /** Nothing was learned: unreachable, the deadline passed, or the answer
   *  turned out to be about a session that had already ended. */
  | { outcome: "unreachable" };

/**
 * The codes this API uses when it means "this session is over". A status
 * alone is never evidence: an edge challenge and an authorization failure
 * both answer 403, so a refusal has to name itself here.
 *
 */
const SESSION_ENDING_CODES = new Set([
  "INVALID_REFRESH_TOKEN",
  "ACCOUNT_INACTIVE",
]);

export async function namesTheEndOfTheSession(
  response: Response,
): Promise<boolean> {
  // Any JSON media type, not the exact string: an audit moved errors to RFC
  // 9457 `application/problem+json`, which keeps `detail.code` intact, and a
  // strict match would have stopped every genuine sign-out. A challenge page
  // is no flavour of JSON, which is the distinction that matters.
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
// Bumped every time the session is torn down. A refresh that started before
// the teardown can still land after it, and its Set-Cookie response would
// otherwise put the hint back and resurrect a session the user just left.
let sessionEpoch = 0;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function removeAuthTokens(): void {
  sessionEpoch += 1;
  // Every path that gives up on a session routes through here, so this is the
  // one place that has to retract the cookie `proxy.ts` routes on. Without it
  // a session the API has stopped honouring still looks live to the server,
  // which admits the visitor to a page the client then cannot render.
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
        // settles strands the caller exactly as a probe that never settles
        // would.
        signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
      });

      if (!response.ok) {
        // Only the server refusing the token ends a session: a 502 is a
        // redeploy, and reading that as a rejection signed people out with a
        // valid refresh cookie. A 401 or 403 counts only when the body names
        // a session-ending code -- see `namesTheEndOfTheSession`.
        const refused =
          (response.status === 401 || response.status === 403) &&
          (await namesTheEndOfTheSession(response));
        if (refused && epoch === sessionEpoch) {
          // Only if this refresh still belongs to the session on screen: a
          // rejection landing after a teardown is about the session that
          // ended, and acting on it would sign out whoever signed in since --
          // on a shared machine, the next person.
          removeAuthTokens();
          return { outcome: "refused" };
        }
        if (refused) {
          // A refusal aimed at a session that already ended says nothing about
          // the one on screen. Reporting its status would have
          // `normalizeApiError` read 401 back as `kind: "authentication"`, and
          // the caller would treat somebody else's refusal as its own.
          return { outcome: "unreachable" };
        }
        if (response.status === 401 || response.status === 403) {
          // A status that named nothing did not come from this API's refusal
          // path, so nothing was learned. Reporting it would have
          // `normalizeApiError` read it back as `kind: "authentication"`.
          return { outcome: "unreachable" };
        }
        // Not a refusal. The status travels with it so a rate limit is not
        // reported as an unreachable server: `/auth/refresh` shares one rate
        // bucket, so a 429 is ordinary and "check that the backend is
        // running" is the wrong thing to say about one that is.
        return { outcome: "unavailable", status: response.status };
      }

      if (epoch !== sessionEpoch) {
        // Torn down while in flight, but this refresh succeeded and the
        // browser has already committed the rotated HttpOnly cookies over
        // anyone who signed in since. Ending the session server-side is the
        // only sound exit.
        clearAuthStateCookie();
        try {
          await fetch("/api/v1/auth/logout", {
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
        // The session this refresh belonged to is over either way, and the
        // line above has just ended the rotated one too.
        return { outcome: "refused" };
      }

      return { outcome: "refreshed" };
    } catch {
      return { outcome: "unreachable" };
    }
  };

  // Cleared here, not in a `finally` inside `runRefresh`: that runs before
  // this assignment whenever the body settles synchronously, caching a settled
  // promise forever and killing refresh for the tab.
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
