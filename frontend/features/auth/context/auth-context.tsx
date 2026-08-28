"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  namesTheEndOfTheSession,
  refreshAccessToken,
  removeAuthTokens,
} from "@/lib/session/token-manager";
import {
  AUTH_PROBE_TIMEOUT_MS,
  createAuthLoginError,
  getLoginRequestError,
  LOGIN_REQUEST_TIMEOUT_MS,
} from "@/lib/session/login-error";
import { UserResponseSchema } from "@/lib/core/schemas";

import { hasAuthStateCookie } from "@/lib/session/auth-state-cookie";
import type { User, LoginRequest, AuthContextType } from "../types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Every auth request goes through the Next.js rewrite, on both sides of
// hydration. The branch that used to be here chose between "" and "".
const API_BASE_URL = "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Keep initial render consistent between SSR and client hydration.
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  const router = useRouter();
  // The account the cache below currently holds data for. A ref rather than
  // reading `user`: `checkAuth` would otherwise have to depend on it, and it
  // is re-created on every identity change as it is.
  const cachedAccountRef = useRef<number | null>(null);

  // Adopt whoever the server says is signed in, dropping the previous
  // account's cached data first: cookies are jar-wide, so a second tab can
  // change who this tab is without any transition running here.
  const adoptUser = useCallback(
    (next: User) => {
      if (
        cachedAccountRef.current !== null &&
        cachedAccountRef.current !== next.id
      ) {
        queryClient.clear();
      }
      cachedAccountRef.current = next.id;
      setUser(next);
    },
    [queryClient],
  );

  // Check authentication status on mount and after login
  const checkAuth = useCallback(async () => {
    // Deliberately does NOT raise `isLoading`: four consumers unmount their
    // whole subtree while it is true, so a re-check would blank the settings
    // page mid-edit. `forceRecheck` in `auth-gate.tsx` drives the re-render.
    const fetchCurrentUser = async () =>
      fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        credentials: "include",
        // A backend that accepts the connection and never answers is not
        // hypothetical on a small host; without a deadline `isLoading` stays
        // true and every surface gated on it renders a white screen for good.
        signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
      }).catch((fetchError) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "Auth check network error (backend may be restarting):",
            fetchError.message,
          );
        }
        return null;
      });

    // No session hint means the backend never issued one, or cleared it on
    // logout or a rejected refresh. Asking anyway costs two requests and logs
    // a 401 that reads like a fault to anyone with devtools open.
    if (!hasAuthStateCookie()) {
      removeAuthTokens();
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      let response = await fetchCurrentUser();

      // If fetch failed (network error), don't remove token - backend may be down
      if (!response) {
        setIsLoading(false);
        return;
      }

      if (response.ok) {
        adoptUser(UserResponseSchema.parse(await response.json()));
      } else if (response.status === 401) {
        const refresh = await refreshAccessToken();
        if (refresh.outcome !== "refreshed") {
          // No `removeAuthTokens()` here: only the refresh call can tell a
          // rejected session from one it never reached, and it already tears
          // down in the first case. Clearing here strands a valid cookie.
          setUser(null);
          queryClient.clear();
          return;
        }

        response = await fetchCurrentUser();
        if (response && response.ok) {
          adoptUser(UserResponseSchema.parse(await response.json()));
        } else {
          // Only a refusal ends the session, and only when the body names one
          // of this API's session-ending codes: the refresh succeeded a moment
          // ago, so a fresh 30-day token is in the jar and a guess strands it.
          if (
            response &&
            (response.status === 401 || response.status === 403) &&
            (await namesTheEndOfTheSession(response))
          ) {
            removeAuthTokens();
          }
          setUser(null);
          queryClient.clear();
        }
      } else if (response.status === 403) {
        // Only if it names the end of the session. A 403 means "not
        // authorized for this", and a challenge in front of the API means
        // nothing about the session at all.
        if (await namesTheEndOfTheSession(response)) {
          removeAuthTokens();
        }
        setUser(null);
        queryClient.clear();
      } else {
        if (process.env.NODE_ENV === "development") {
          console.warn("Auth check failed with status:", response.status);
        }
        setUser(null);
      }
    } catch (error) {
      // The request came back but reading it did not work -- a truncated body,
      // a captive portal, a bad gzip. That says nothing about the session, so
      // no token teardown: that would sign the account out on every device.
      if (process.env.NODE_ENV === "development") {
        console.warn("Auth check failed:", error);
      }
      setUser(null);
      queryClient.clear();
    } finally {
      setIsLoading(false);
    }
  }, [queryClient, adoptUser]);

  // Initialize auth state on mount
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Authentication initializes from browser token state after hydration.
    void checkAuth();
  }, [checkAuth]);

  const login = useCallback(
    async (credentials: LoginRequest) => {
      setIsLoading(true);
      try {
        // OAuth2 password flow requires form-data format
        const formData = new URLSearchParams();
        formData.append("username", credentials.email); // OAuth2 uses 'username' field
        formData.append("password", credentials.password);
        if (credentials.captchaToken) {
          formData.append("captcha_token", credentials.captchaToken);
        }

        const abortController = new AbortController();
        let didTimeout = false;
        const timeoutId = setTimeout(() => {
          didTimeout = true;
          abortController.abort();
        }, LOGIN_REQUEST_TIMEOUT_MS);

        try {
          const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData,
            signal: abortController.signal,
          });

          if (!response.ok) {
            let payload: unknown = null;
            try {
              payload = await response.json();
            } catch (error) {
              if (
                getLoginRequestError(error, didTimeout).code ===
                "REQUEST_TIMEOUT"
              ) {
                throw error;
              }
            }
            throw createAuthLoginError(payload, response.status);
          }

          await response.json();
        } catch (error) {
          throw getLoginRequestError(error, didTimeout);
        } finally {
          clearTimeout(timeoutId);
        }

        queryClient.clear();

        await checkAuth();

        router.push("/");
      } catch (error) {
        setIsLoading(false);
        throw error;
      }
    },
    [checkAuth, queryClient, router],
  );

  const logout = useCallback(
    async (options?: { evenIfTheServerCannotBeReached?: boolean }) => {
      // The default is safe, and that is the whole point of the option: a
      // plain `logout()` changes nothing locally when the server never
      // answered, and only a button under someone's finger passes the flag.
      let serverAnswered = false;
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
          method: "POST",
          credentials: "include",
          // Without a deadline a backend that accepts the connection and hangs
          // makes Sign Out do nothing at all — no teardown, no navigation, no
          // spinner — and every further click stacks another dead request.
          signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
        });
        // Success only. `/auth/logout` carries no auth dependency and cannot
        // answer 401 itself; a 401 minted by the maintenance Worker during a
        // deploy would tear the session down with nothing revoked.
        serverAnswered = response.ok;
        if (!response.ok) {
          // `fetch` only rejects on network failure, so a 5xx arrives here
          // looking like success. Say so rather than reporting a revocation
          // that did not happen.
          console.error("Sign out could not be completed by the server", {
            status: response.status,
          });
        }
      } catch {
        // Unreachable or timed out, so nothing was revoked.
      }

      if (!serverAnswered && !options?.evenIfTheServerCannotBeReached) {
        return;
      }

      removeAuthTokens();
      queryClient.clear();
      setUser(null);
      router.push("/sign-in");
    },
    [queryClient, router],
  );

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      checkAuth,
    }),
    [user, isLoading, login, logout, checkAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
