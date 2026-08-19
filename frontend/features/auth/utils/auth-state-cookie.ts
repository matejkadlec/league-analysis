export const AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state";
export const AUTH_STATE_COOKIE_VALUE = "1";

const hintListeners = new Set<() => void>();

/**
 * Subscribe to teardowns of the session hint.
 *
 * The cookie is not reactive and nothing else changes when a session is given
 * up: the axios interceptor can clear the hint without React hearing about it,
 * because no state it renders from moved. Consumers that decide on the hint
 * were therefore deciding on whatever they read at their last render, which
 * left the whole signed-in shell on screen over an API refusing every call.
 *
 * Only teardowns are announced. The backend sets the hint with `Set-Cookie`,
 * which no client code can observe -- but every path that gives it up runs
 * through `clearAuthStateCookie`, and that is the direction that strands
 * somebody.
 */
export function subscribeToAuthStateCookie(listener: () => void): () => void {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
}

/**
 * Drop a hint the session behind it no longer honours.
 *
 * The hint can outlive its session: it is written for the refresh token's
 * lifetime, but that token can be revoked, rotated out, or lost with the row
 * it lived in, and the cookie in the browser knows none of that. Left alone,
 * `proxy.ts` keeps believing it and keeps admitting the visitor to routes the
 * API will refuse — so clearing it is what turns a dead session back into a
 * plain signed-out one.
 */
export function clearAuthStateCookie(): void {
  if (typeof document === "undefined") {
    return;
  }

  // A cookie's identity is its name, domain and path, and a delete that does
  // not name all three matches nothing. Path is `/` on both sides. Domain is
  // the one that bites: the backend writes this cookie host-only today, but
  // the day someone shares the session across subdomains -- a `COOKIE_DOMAIN`
  // for `dev.` and `www.`, in Python, in another directory -- this delete
  // starts writing a host-only cookie that expires instantly and matches
  // nothing, while the real hint sits there untouched. `/auth/refresh`
  // answers a refusal with no Set-Cookie at all, so this is the only thing
  // that retracts the hint on the one path that matters, and a hint that
  // survives its own delete leaves the visitor on "Can't reach the server"
  // forever with `proxy.ts` still admitting them.
  //
  // So it deletes the host-only cookie and every parent domain the current
  // host could have been given one under. Each is a single expired write that
  // matches nothing if no such cookie exists; the browser rejects the ones
  // that are not this host's suffixes, which is also a no-op.
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const base = `${AUTH_STATE_COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax${secure}`;
  document.cookie = base;
  const labels = location.hostname.split(".");
  for (let i = 0; i + 2 <= labels.length; i += 1) {
    const domain = labels.slice(i).join(".");
    // A single label is a TLD and browsers refuse it; two or more is the
    // shortest thing a cookie can legitimately be scoped to.
    document.cookie = `${base}; domain=${domain}`;
    document.cookie = `${base}; domain=.${domain}`;
  }
  for (const listener of hintListeners) {
    listener();
  }
}

/**
 * Whether the browser is carrying the backend's session hint.
 *
 * The access and refresh tokens are HttpOnly, so client code cannot see them.
 * This cookie is the readable companion the backend sets beside them, holding
 * only "1" — enough to answer "is anyone signed in?" without asking the API.
 *
 * A `false` here is trustworthy in the direction that matters: the backend
 * only ever writes this cookie beside a session it just issued, so no hint
 * means no usable session. The reverse is not guaranteed, and not because of
 * the lifetimes — the hint and the refresh token are written with the same
 * 30 days. It is that the token can be revoked, rotated out, or lost with the
 * row it lived in, and none of that touches the cookie; a rejected refresh
 * answers 401 with no Set-Cookie at all, so the jar survives it intact. A
 * `true` therefore still has to be confirmed against /auth/me. `proxy.ts`
 * already routes on exactly this asymmetry, and treating it the same way here
 * keeps client and server from disagreeing about who is signed in.
 */
export function hasAuthStateCookie(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.cookie
    .split("; ")
    .some((entry) => entry === `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}`);
}
