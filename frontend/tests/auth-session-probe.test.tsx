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
let triggerLogout: (() => Promise<void>) | null = null;

function AuthStateProbe() {
  const { isLoading, isAuthenticated, checkAuth, logout } = useAuth();
  // Assigned in an effect, not during render: reassigning a module-level
  // binding while rendering is a side effect, and eslint rejects it.
  useEffect(() => {
    triggerRecheck = checkAuth;
    triggerLogout = logout;
  }, [checkAuth, logout]);
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
  triggerLogout = null;
  clearCookies();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  clearCookies();
});

describe("signing out", () => {
  it("gives the logout request a deadline", async () => {
    // Without one, a backend that accepts the connection and hangs makes Sign
    // Out do nothing at all -- no teardown, no navigation, no spinner -- and
    // every further click stacks another dead request.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    let seen: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/auth/logout")) {
        seen = init?.signal;
      }
      return new Response("{}", { status: 200 });
    });

    renderProvider();
    await waitFor(() => expect(triggerLogout).not.toBeNull());
    await act(async () => {
      await triggerLogout?.();
    });

    expect(seen).toBeInstanceOf(AbortSignal);
  });
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

describe("a refresh that never reaches the server", () => {
  it("does not end the session", async () => {
    // The branch no ownership rule can police: `auth-context.tsx` is allowed
    // to tear a session down -- for logout, and for a 403. What it must not
    // do is tear down here. The probe 401'd and the refresh could not be
    // delivered, so nothing has said this session is over, and the refresh
    // cookie in the jar may be perfectly good. A teardown on this path is
    // what stranded people: hint gone, bounced to /sign-in, over a redeploy.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/auth/refresh")) {
        throw new Error("offline");
      }
      return new Response("{}", { status: 401 });
    });

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    expect(document.cookie).toContain(AUTH_STATE_COOKIE_NAME);
  });
});

describe("a response that arrives but cannot be read", () => {
  it("is not treated as a rejected session", async () => {
    // A body truncated mid-stream, a captive portal answering with HTML, a
    // bad gzip. None of that says the session ended. Tearing down here signed
    // people out over a parse blip while their refresh cookie was still good
    // -- and because the teardown bumps the session epoch, an in-flight
    // refresh would then ask the server to end the session on every device.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>captive portal</html>", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    expect(document.cookie).toContain(AUTH_STATE_COOKIE_NAME);
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
      expect.objectContaining({
        credentials: "include",
        // A backend that accepts the connection and never answers leaves
        // `isLoading` true forever, and every surface gated on it renders
        // nothing -- the original white screen, reachable by simply waiting.
        // `objectContaining` matches a subset, so without naming the signal
        // this assertion is green with the deadline deleted.
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
