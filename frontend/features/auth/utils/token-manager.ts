/**
 * Centralized auth session management.
 *
 * Tokens live in server-set HttpOnly cookies. This module only asks the
 * backend to rotate or drop that session; JavaScript never reads the tokens.
 */

let refreshInFlight: Promise<boolean> | null = null;
let sessionHint = false;

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
  sessionHint = false;
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
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      if (!response.ok) {
        removeAuthTokens();
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
