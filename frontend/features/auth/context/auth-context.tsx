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
  namesTheEndOfTheSession,
  refreshAccessToken,
  removeAuthTokens,
} from "../utils/token-manager";
import {
  AUTH_PROBE_TIMEOUT_MS,
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
    // Deliberately does NOT raise `isLoading`. Four consumers unmount their
    // whole subtree while it is true — the gate, the sidebar, the header, the
    // player context — so raising it on a re-check would blank the settings
    // page mid-edit every time a display-name or email change calls back here,
    // and would blank the retry surface itself for the whole probe timeout.
    // The re-render a completed re-check needs comes from `forceRecheck` in
    // `auth-gate.tsx` instead, which costs nobody their screen.
    const fetchCurrentUser = async () =>
      fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        credentials: "include",
        // A backend that accepts the connection and then never answers is not
        // hypothetical on a small host, and without a deadline this promise
        // never settles: `isLoading` stays true and every surface that gates
        // on it — this gate, the sidebar, the header — renders nothing. A
        // white screen with no spinner and no way out is the symptom this
        // whole change exists to remove, so it must not be reachable by
        // simply waiting.
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
        setUser(userData);
      } else if (response.status === 401) {
        const refresh = await refreshAccessToken();
        if (refresh.outcome !== "refreshed") {
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
          // Only a refusal ends the session, and only 401/403 is a refusal.
          // A null response is a network failure and a 5xx is a redeploy or a
          // blip -- neither is evidence about this session, and this is the
          // worst possible moment to guess: the server honoured the refresh a
          // fraction of a second ago, so it just issued a fresh 30-day token
          // that is now in the jar. Tearing down here clears the hint, bounces
          // the visitor to /sign-in, and leaves that brand-new HttpOnly
          // credential live with nothing asking the server to revoke it. The
          // first probe's own 5xx branch below already declines to guess;
          // these two agreeing is the point.
          // The same rule the refresh call uses: a status is not evidence
          // unless the body names one of this API's session-ending codes.
          // An edge challenge and a 403 about something other than the
          // session both arrive here looking identical to a refusal.
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
      // Reaching here means the request itself came back but reading it did
      // not work -- a body truncated mid-stream, a captive portal answering
      // with HTML, a bad gzip. That says nothing about whether the session is
      // valid, so it gets the same treatment as an unreachable server: no
      // teardown. Tearing down here signed people out over a parse blip while
      // their refresh cookie was still good, and because that also bumps the
      // session epoch it could end the session on every other device too.
      if (process.env.NODE_ENV === "development") {
        console.warn("Auth check failed:", error);
      }
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

        // Fetch user data
        await checkAuth();

        // Redirect to home page
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
      // The default is safe, and that is the whole point of the option.
      //
      // Eight adversarial audits have now walked past the guard on "only the
      // refresh call may end a session", and the last one did it by mounting a
      // keep-alive that called `logout()` on a timer when a refresh failed.
      // `logout()` is reached through React context, so no import rule can see
      // it, and it tore the session down even when its own request never
      // reached the server -- clearing the hint while the 30-day refresh cookie
      // stayed live and unrevoked in the jar. Every lint rule stayed green.
      //
      // Nothing stops a future component calling this. So the unconditional
      // teardown stopped being the default: a caller that just writes
      // `logout()` now sends the request and, if the server never answered,
      // changes nothing locally. That is the right answer for a machine, and
      // it is the shape a machine will naturally write.
      //
      // Only a visitor who asked gets the other behaviour, because only for
      // them is a stranded local session worse than a stranded remote one --
      // being left staring at an account they just asked to leave. Both call
      // sites that pass this flag are a button under someone's finger, and a
      // timer passing it is a lie visible at the call site.
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
        // answer 401 itself, so counting one as "already signed out" would
        // only ever be trusting an edge -- and a maintenance Worker sits in
        // front of this route. A 401 minted there during a deploy would let an
        // automatic logout tear the session down with nothing revoked, which
        // is the exact failure the opt-in above exists to prevent.
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
