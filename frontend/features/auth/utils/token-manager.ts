/**
 * Centralized auth token management.
 *
 * Security design:
 * - Uses localStorage for auth tokens.
 * - Uses a non-sensitive cookie hint for server-side route UX redirects.
 * - Refresh token rotation is handled via /api/v1/auth/refresh.
 */

import {
  AUTH_STATE_COOKIE_MAX_AGE_SECONDS,
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "./auth-state-cookie";

const ACCESS_TOKEN_KEY = "auth_access_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";

let refreshInFlight: Promise<string | null> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

function setAuthStateCookie(): void {
  if (!isBrowser()) {
    return;
  }

  document.cookie =
    `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; ` +
    `Path=/; Max-Age=${AUTH_STATE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function clearAuthStateCookie(): void {
  if (!isBrowser()) {
    return;
  }

  document.cookie =
    `${AUTH_STATE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function setAuthTokens(accessToken: string, refreshToken: string): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  setAuthStateCookie();
}

export function removeAuthTokens(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  clearAuthStateCookie();
}

export function getAccessToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

  if (accessToken && refreshToken) {
    setAuthStateCookie();
  }

  return accessToken;
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) {
    return null;
  }
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!isBrowser()) {
    return null;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  const runRefresh = async (): Promise<string | null> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        removeAuthTokens();
        return null;
      }

      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        typeof (payload as { access_token?: unknown }).access_token !== "string" ||
        typeof (payload as { refresh_token?: unknown }).refresh_token !== "string"
      ) {
        removeAuthTokens();
        return null;
      }

      const newAccessToken = (payload as { access_token: string }).access_token;
      const newRefreshToken = (payload as { refresh_token: string }).refresh_token;
      setAuthTokens(newAccessToken, newRefreshToken);
      return newAccessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  };

  refreshInFlight = runRefresh();
  return refreshInFlight;
}

export function hasAuthTokens(): boolean {
  return getAccessToken() !== null && getRefreshToken() !== null;
}
