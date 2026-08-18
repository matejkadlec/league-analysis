// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/features/auth/context/auth-context";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function AuthStateProbe() {
  const { isLoading, isAuthenticated } = useAuth();
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

describe("signed-out session probe", () => {
  beforeEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    clearCookies();
  });

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
