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
  endLocalSession,
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
  // Which account the query cache holds. A ref, not `user`, so `checkAuth`
  // need not depend on identity.
  const cachedAccountRef = useRef<number | null>(null);

  // Cookies are jar-wide, so another tab can change who this tab is with no
  // transition running here: drop the previous account's cache on any change.
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
    // Must not raise `isLoading`: consumers unmount their whole subtree while
    // it is true, so a re-check would blank the settings page mid-edit.

    // `forceRecheck` in `auth-gate.tsx` drives the re-render instead.
    const fetchCurrentUser = async () =>
      fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        credentials: "include",
        // Without a deadline a hung backend pins `isLoading` true forever,
        // white-screening every surface gated on it.
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

    // No session hint means there is no session; asking anyway costs two
    // requests and logs a 401 that reads like a fault.
    if (!hasAuthStateCookie()) {
      endLocalSession();
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
          // No `endLocalSession()`: refresh already tore down a rejected
          // session, and clearing an unreachable one strands a valid cookie.
          setUser(null);
          queryClient.clear();
          return;
        }

        response = await fetchCurrentUser();
        if (response && response.ok) {
          adoptUser(UserResponseSchema.parse(await response.json()));
        } else {
          // Refresh just succeeded, so a fresh 30-day token is in the jar: end
          // the session only when the body names a session-ending code.
          if (
            response &&
            (response.status === 401 || response.status === 403) &&
            (await namesTheEndOfTheSession(response))
          ) {
            endLocalSession();
          }
          setUser(null);
          queryClient.clear();
        }
      } else if (response.status === 403) {
        // A 403 can also come from a challenge in front of the API, so only an
        // explicit end-of-session code ends the session.
        if (await namesTheEndOfTheSession(response)) {
          endLocalSession();
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
      // A body that would not parse says nothing about the session; tearing the
      // token down here would sign the account out on every device.
      if (process.env.NODE_ENV === "development") {
        console.warn("Auth check failed:", error);
      }
      setUser(null);
      queryClient.clear();
    } finally {
      setIsLoading(false);
    }
  }, [queryClient, adoptUser]);

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
      // The default is safe: a plain `logout()` changes nothing locally when
      // the server never answered; only a deliberate click passes the flag.
      let serverAnswered = false;
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
          method: "POST",
          credentials: "include",
          // Without a deadline a hung backend makes Sign Out do nothing at all,
          // and every further click stacks another dead request.
          signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
        });
        // Success only: `/auth/logout` cannot answer 401 itself, so a 401 from
        // the maintenance Worker would tear down a session nothing revoked.
        serverAnswered = response.ok;
        if (!response.ok) {
          // `fetch` resolves on 5xx, so say the revocation failed rather than
          // report one that did not happen.
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

      endLocalSession();
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
