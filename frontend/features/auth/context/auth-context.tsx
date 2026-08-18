"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  refreshAccessToken,
  removeAuthTokens,
  setAuthTokens,
} from "../utils/token-manager";
import {
  createAuthLoginError,
  getLoginRequestError,
  LOGIN_REQUEST_TIMEOUT_MS,
} from "../utils/login-error";
import { hasAuthStateCookie } from "../utils/auth-state-cookie";
import type { User, LoginRequest, AuthContextType } from "../types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE_URL = typeof window === "undefined" ? "" : "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Keep initial render consistent between SSR and client hydration.
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  const router = useRouter();

  // Check authentication status on mount and after login
  const checkAuth = useCallback(async () => {
    const fetchCurrentUser = async () =>
      fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        credentials: "include",
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
    // logout or a rejected refresh. Asking anyway costs two requests to be
    // told what we already know, and the browser logs each 401 as a console
    // error that reads like a fault to anyone with devtools open.
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
        const userData = await response.json();
        setAuthTokens();
        setUser(userData);
      } else if (response.status === 401) {
        const refreshedToken = await refreshAccessToken();
        if (!refreshedToken) {
          // No `removeAuthTokens()` here: only the refresh call can tell a
          // rejected session from one it never reached, and it already tears
          // down in the first case. Clearing here too would turn a network
          // blip into a real sign-out, with a valid refresh cookie still in
          // the jar and the hint gone that would have let it be used.
          setUser(null);
          queryClient.clear();
          return;
        }

        response = await fetchCurrentUser();
        if (response && response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          removeAuthTokens();
          setUser(null);
          queryClient.clear();
        }
      } else if (response.status === 403) {
        removeAuthTokens();
        setUser(null);
        queryClient.clear();
      } else {
        if (process.env.NODE_ENV === "development") {
          console.warn("Auth check failed with status:", response.status);
        }
        setUser(null);
      }
    } catch (error) {
      // Catch any other errors (e.g., JSON parsing)
      if (process.env.NODE_ENV === "development") {
        console.warn("Auth check failed:", error);
      }
      removeAuthTokens();
      setUser(null);
      queryClient.clear();
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  // Initialize auth state on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Authentication initializes from browser token state after hydration.
    void checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (credentials: LoginRequest) => {
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
            if (getLoginRequestError(error, didTimeout).code === "REQUEST_TIMEOUT") {
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

      setAuthTokens();
      queryClient.clear();

      // Fetch user data
      await checkAuth();

      // Redirect to home page
      router.push("/");
    } catch (error) {
      setIsLoading(false);
      throw error;
    }
  }, [checkAuth, queryClient, router]);

  const logout = useCallback(() => {
    void fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      // Best effort logout revocation.
    });

    removeAuthTokens();
    queryClient.clear();
    setUser(null);
    router.push("/sign-in");
  }, [queryClient, router]);

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

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
