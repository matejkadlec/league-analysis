export const AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state";
export const AUTH_STATE_COOKIE_VALUE = "1";

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
