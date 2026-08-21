/**
 * Centralized auth session management.
 *
 * Tokens live in server-set HttpOnly cookies. This module only asks the
 * backend to rotate or drop that session; JavaScript never reads the tokens.
 */

import { clearAuthStateCookie } from "./auth-state-cookie";
import { AUTH_PROBE_TIMEOUT_MS } from "./login-error";

/**
 * What a refresh attempt found out, and the reason this is not a boolean.
 *
 * A guard saying "only `refreshAccessToken` may decide a session is over" has
 * now been walked past seven times by adversarial review. Six of those were
 * about the *shape* of the calling code, and were answered with better lint
 * rules and then with tests that assert the effect. The seventh was not: this
 * function returned a falsy value for a rejected session and for a server it
 * never reached, and it is the one import every file in the repo is allowed to
 * make. `if (!(await refreshAccessToken())) logout()` therefore reads as
 * correct code, is invisible to any import rule, and signs people out over a
 * redeploy. The signal was the hole, not the callers.
 *
 * So the distinction the whole design turns on is now in the return type, and
 * every variant is an object -- a stale `if (!result)` is dead code rather
 * than a teardown, which is the direction a mistake here should fail in.
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
 * The codes this API uses when it means "this session is over".
 *
 * A status alone is not evidence of that, and treating it as evidence is a
 * live hazard rather than a theoretical one. Cloudflare fronts these routes:
 * a WAF rule, a bot-fight challenge, an access policy or "I'm Under Attack"
 * mode all answer a background request with 403 and an HTML body, and the
 * origin never sees it. `logout()` already refuses to trust an edge-minted
 * status for exactly this reason; the call the whole design rests on was
 * still trusting one.
 *
 * A 403 from our own API is not proof either. It means "not authorized for
 * this", which is not "your session is over" -- an audit added an
 * `email_verified` gate to the one dependency every protected route shares,
 * four ordinary lines completing a half-built feature, and every signed-in
 * visitor was signed out by it while their refresh token stayed live and
 * unrevoked. Signing in again worked, and stranded one more token each time.
 *
 * So a refusal has to name itself. Both refusals `/auth/refresh` can issue do
 * (`router.py`), and anything else -- an edge challenge, a new 403 about
 * something other than the session -- reports as nothing learned, which
 * leaves the session alone and shows the visitor a way forward.
 */
const SESSION_ENDING_CODES = new Set([
  "INVALID_REFRESH_TOKEN",
  "ACCOUNT_INACTIVE",
]);

export async function namesTheEndOfTheSession(
  response: Response,
): Promise<boolean> {
  // Any JSON media type, not the exact string: an audit answered errors as
  // RFC 9457 `application/problem+json`, a change that keeps `detail.code`
  // intact and reads as a tidy-up, and a strict match would have quietly
  // stopped every genuine sign-out from working. A challenge page is not
  // served as any flavour of JSON, which is the distinction that matters.
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
        // Only the server refusing the token ends a session. A 502 or 503 is
        // the API being restarted or redeployed, and treating that as a
        // rejection signed people out mid-deploy while their refresh cookie
        // was still perfectly valid. And a 401 or 403 only counts when the
        // body names one of this API's session-ending codes: see
        // `namesTheEndOfTheSession` for the two ways a status lies.
        const refused =
          (response.status === 401 || response.status === 403) &&
          (await namesTheEndOfTheSession(response));
        if (refused && epoch === sessionEpoch) {
          // Only if this refresh still belongs to the session on screen. A
          // rejection that arrives after a teardown is about the session that
          // ended, and tearing down again would take out whoever signed in
          // since -- on a shared machine, the next person, moments after they
          // signed in successfully.
          removeAuthTokens();
          return { outcome: "refused" };
        }
        if (refused) {
          // A refusal aimed at a session that has already ended, so it says
          // nothing about the one on screen. Reporting the status here would
          // undo the distinction this type exists for: `api.ts` re-encodes it,
          // `normalizeApiError` reads 401 as `kind: "authentication"`, and the
          // caller is back to treating somebody else's refusal as its own.
          return { outcome: "unreachable" };
        }
        if (response.status === 401 || response.status === 403) {
          // A status that named nothing. Whoever sent it, it was not this
          // API's refusal path, so nothing was learned about the session --
          // and reporting the status would have `normalizeApiError` read it
          // back as `kind: "authentication"`, which is the same lie one layer
          // down.
          return { outcome: "unreachable" };
        }
        // Not a refusal at all. The status travels with it so a rate limit is
        // not reported as an unreachable server -- `/auth/refresh` is rate
        // limited into a single shared bucket, so a 429 here is ordinary, and
        // "check that the backend is running" is the wrong thing to say about
        // a backend that is running and answering.
        return { outcome: "unavailable", status: response.status };
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

  // Cleared here rather than in a `finally` inside `runRefresh`. A `finally`
  // in there runs before this assignment does whenever the body settles
  // synchronously, so the reset would land first and the assignment second,
  // leaving a settled promise cached forever and every later refresh
  // short-circuiting on it without touching the network: token refresh
  // silently dead for the tab. Nothing in the current body can settle that
  // early -- the whole thing is inside a `try` and awaits a fetch -- so this
  // is about the next edit, not about a live bug.
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
