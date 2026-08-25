export const AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state";
export const AUTH_STATE_COOKIE_VALUE = "1";

const hintListeners = new Set<() => void>();

/**
 * Subscribe to teardowns of the session hint. The cookie is not reactive, so
 * a consumer deciding on it is otherwise deciding on its last render, leaving
 * the signed-in shell up over an API refusing every call.
 */
export function subscribeToAuthStateCookie(listener: () => void): () => void {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
}

/**
 * Drop a hint the session behind it no longer honours. The hint outlives its
 * session whenever the refresh token is revoked, rotated out or lost, and
 * `proxy.ts` goes on admitting the visitor to routes the API will refuse.
 */
export function clearAuthStateCookie(): void {
  if (typeof document === "undefined") {
    return;
  }

  // A cookie's identity is its name, domain and path, so a delete naming the
  // wrong domain matches nothing. This deletes the host-only cookie and every
  // parent domain the current host could have been given one under.
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
 * Whether the browser is carrying the backend's session hint. A `false` is
 * trustworthy; a `true` still has to be confirmed against /auth/me, because a
 * revoked or rotated refresh token never touches this cookie.
 */
export function hasAuthStateCookie(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.cookie
    .split("; ")
    .some((entry) => entry === `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}`);
}
