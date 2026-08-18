export const AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state";
export const AUTH_STATE_COOKIE_VALUE = "1";

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

export function clearAuthStateCookie(): void {
  if (typeof document === "undefined") {
    return;
  }

  // Mirror the attributes `set_auth_cookies` writes. Browsers key a cookie on
  // name, domain and path, so a bare delete usually lands — but "usually" is
  // the wrong guarantee here: a hint that survives its delete is exactly the
  // state where `proxy.ts` admits a visitor the API will refuse.
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax${secure}`;
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
 * writes all three cookies together and clears them together, so no hint means
 * no usable session. The reverse is not guaranteed — the hint outlives the
 * refresh token (30 days against a shorter session), so a `true` still has to
 * be confirmed against /auth/me. `proxy.ts` already routes on exactly this
 * asymmetry, and treating it the same way here keeps client and server from
 * disagreeing about who is signed in.
 */
export function hasAuthStateCookie(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.cookie
    .split("; ")
    .some((entry) => entry === `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}`);
}
