export const AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state";
export const AUTH_STATE_COOKIE_VALUE = "1";

const hintListeners = new Set<() => void>();

/**
 * The cookie is not reactive, so without this a consumer decides on its last
 * render and leaves the signed-in shell up over an API refusing every call.
 */
export function subscribeToAuthStateCookie(listener: () => void): () => void {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
}

/**
 * The hint outlives its session whenever the refresh token is revoked, rotated or
 * lost, and `proxy.ts` keeps admitting the visitor to routes the API refuses.
 */
export function clearAuthStateCookie(): void {
  if (typeof document === "undefined") {
    return;
  }

  // A cookie's identity includes its domain, so a delete naming the wrong one
  // matches nothing; cover host-only and every parent domain.
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
 * A `false` is trustworthy; a `true` still needs /auth/me, because a revoked or
 * rotated refresh token never touches this cookie.
 */
export function hasAuthStateCookie(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.cookie
    .split("; ")
    .some((entry) => entry === `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}`);
}
