// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/features/auth/context/auth-context";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let triggerRecheck: (() => Promise<void>) | null = null;

function AuthStateProbe() {
  const { isLoading, isAuthenticated, checkAuth } = useAuth();
  // Assigned in an effect, not during render: reassigning a module-level
  // binding while rendering is a side effect, and eslint rejects it.
  useEffect(() => {
    triggerRecheck = checkAuth;
  }, [checkAuth]);
  return (
    <span data-testid="state">{`${isLoading ? "loading" : "settled"}:${isAuthenticated}`}</span>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function clearCookies() {
  for (const entry of document.cookie.split("; ")) {
    const name = entry.split("=")[0];
    if (name) {
      document.cookie = `${name}=; max-age=0; path=/`;
    }
  }
}

beforeEach(() => {
  triggerRecheck = null;
  clearCookies();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  clearCookies();
});

describe("re-checking an established session", () => {
  it("never raises isLoading, which would unmount the whole app shell", async () => {
    // Four consumers render null while `isLoading` is true -- the auth gate,
    // the sidebar, the header and the player context. Raising it on a
    // re-check blanked the settings page mid-edit, because that is where the
    // real callers live (display-name and email change), and blanked the
    // retry surface for the full probe timeout.
    //
    // The probe is held open on purpose: a re-check that resolves in the same
    // tick collapses both state writes into one render, so the transient this
    // is about is only observable while the request is still outstanding.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    const settled = () =>
      new Response(JSON.stringify({ id: 1, email: "someone@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(settled());

    const { getByTestId } = renderProvider();
    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:true"),
    );

    let release: (() => void) | null = null;
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(settled());
        }),
    );

    let recheck: Promise<void> | undefined;
    await act(async () => {
      recheck = triggerRecheck?.();
    });

    // Mid-flight: the shell must still be drawn.
    expect(getByTestId("state").textContent).toBe("settled:true");

    await act(async () => {
      release?.();
      await recheck;
    });
    expect(getByTestId("state").textContent).toBe("settled:true");
  });
});

describe("signed-out session probe", () => {
  it("makes no request when the session hint is absent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    // The whole point: a signed-out visit costs zero requests, so the browser
    // has no 401 to log as a console error.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still verifies the session when the hint is present", async () => {
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 1, email: "someone@example.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:true"),
    );
    // A hint outlives the refresh token, so it is a claim to check, never a
    // substitute for checking.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
