"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  getAccessToken,
  refreshAccessToken,
  removeAuthTokens,
  setAuthTokens,
} from "../utils/token-manager";
import type {
  AuthResponse,
  User,
  LoginRequest,
  AuthContextType,
  AuthLoginError,
} from "../types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function createAuthLoginError(payload: unknown): AuthLoginError {
  const fallbackMessage = "Login failed";
  const error = new Error(fallbackMessage) as AuthLoginError;

  if (!payload || typeof payload !== "object") {
    return error;
  }

  const detail = (payload as { detail?: unknown }).detail;

  if (typeof detail === "string") {
    error.message = detail;
    return error;
  }

  if (!detail || typeof detail !== "object") {
    return error;
  }

  const detailObject = detail as {
    code?: unknown;
    message?: unknown;
    locked_until?: unknown;
  };

  if (typeof detailObject.code === "string") {
    error.code = detailObject.code;
  }

  if (typeof detailObject.message === "string") {
    error.message = detailObject.message;
  }

  if (typeof detailObject.locked_until === "string") {
    error.lockedUntil = detailObject.locked_until;
  }

  return error;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Keep initial render consistent between SSR and client hydration.
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  const router = useRouter();

  // Check authentication status on mount and after login
  const checkAuth = useCallback(async () => {
    let accessToken = getAccessToken();
    if (!accessToken) {
      accessToken = await refreshAccessToken();
    }

    if (!accessToken) {
      setUser(null);
      setIsLoading(false);
      removeAuthTokens();
      queryClient.clear();
      return;
    }

    const fetchCurrentUser = async (token: string) =>
      fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch((fetchError) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "Auth check network error (backend may be restarting):",
            fetchError.message,
          );
        }
        return null;
      });

    try {
      let response = await fetchCurrentUser(accessToken);

      // If fetch failed (network error), don't remove token - backend may be down
      if (!response) {
        setIsLoading(false);
        return;
      }

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else if (response.status === 401) {
        const refreshedToken = await refreshAccessToken();
        if (!refreshedToken) {
          removeAuthTokens();
          setUser(null);
          queryClient.clear();
          return;
        }

        response = await fetchCurrentUser(refreshedToken);
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
    checkAuth();
  }, [checkAuth]);

  const login = async (credentials: LoginRequest) => {
    setIsLoading(true);
    try {
      // OAuth2 password flow requires form-data format
      const formData = new URLSearchParams();
      formData.append("username", credentials.email); // OAuth2 uses 'username' field
      formData.append("password", credentials.password);
      if (credentials.captchaToken) {
        formData.append("captcha_token", credentials.captchaToken);
      }

      const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData,
      });

      if (!response.ok) {
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        throw createAuthLoginError(payload);
      }

      const data = (await response.json()) as AuthResponse;

      setAuthTokens(data.access_token, data.refresh_token);
      queryClient.clear();

      // Fetch user data
      await checkAuth();

      // Redirect to home page
      router.push("/");
    } catch (error) {
      setIsLoading(false);
      throw error;
    }
  };

  const logout = () => {
    const accessToken = getAccessToken();
    if (accessToken) {
      void fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }).catch(() => {
        // Best effort logout revocation.
      });
    }

    removeAuthTokens();
    queryClient.clear();
    setUser(null);
    router.push("/sign-in");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
