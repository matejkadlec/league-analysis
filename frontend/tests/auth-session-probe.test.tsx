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
import { AUTH_PROBE_TIMEOUT_MS } from "@/features/auth/utils/login-error";
import type { AuthContextType } from "@/features/auth/types";
import {
  hangingFetch,
  installDrivableAbortDeadlines,
} from "./deadline-support";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let triggerRecheck: (() => Promise<void>) | null = null;
let triggerLogout: AuthContextType["logout"] | null = null;

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

describe("request deadlines", () => {
  // Asserted as an effect -- the request actually gives up, at that length --
  // rather than as `expect(signal).toBeInstanceOf(AbortSignal)`, which four
  // tests used to do. Replacing every deadline in the auth path with a signal
  // that never fires kept all of them green while restoring the reported
  // symptom. See `deadline-support.ts` for why fake timers alone cannot see
  // `AbortSignal.timeout`.
  let restoreDeadlines: (() => void) | null = null;

  afterEach(() => {
    restoreDeadlines?.();
    restoreDeadlines = null;
    vi.useRealTimers();
  });

  it("gives up on the session probe at the deadline, not never", async () => {
    // A backend that accepts the connection and never answers leaves
    // `isLoading` true forever, and every surface gated on it renders nothing:
    // the original white screen, reachable by simply waiting.
    vi.useFakeTimers();
    restoreDeadlines = installDrivableAbortDeadlines();
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch());

    const { getByTestId } = renderProvider();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS - 100);
    });
    // Still waiting: a shorter deadline would have settled this already, and
    // the spinner it shows is the honest answer while the request is live.
    expect(getByTestId("state").textContent).toBe("loading:false");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(getByTestId("state").textContent).toBe("settled:false");
  });

  it("gives up on the logout request at the deadline, not never", async () => {
    // Without one, Sign Out does nothing at all -- no teardown, no navigation,
    // and the promise both buttons drive their spinner from never settles, so
    // every further click stacks another dead request.
    vi.useFakeTimers();
    restoreDeadlines = installDrivableAbortDeadlines();
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch());

    renderProvider();
    await act(async () => {
      await Promise.resolve();
    });
    expect(triggerLogout).not.toBeNull();

    let settled = false;
    const pending = triggerLogout?.().then(() => {
      settled = true;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS - 100);
    });
    expect(settled).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await pending;
    });
    expect(settled).toBe(true);
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

describe("the first probe answering 403", () => {
  it("keeps the session when the 403 names nothing", async () => {
    // A Cloudflare WAF rule, a bot-fight challenge or "I'm Under Attack" mode
    // answers a background request with 403 and an HTML body, and the origin
    // never sees it. This is the branch that sees it first, and it had no
    // test at all: a bare teardown here signs every visitor out over a
    // challenge while their 30-day refresh token stays live and unrevoked.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    let refreshes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/auth/refresh")) {
        refreshes += 1;
        return new Response("{}", { status: 200 });
      }
      return new Response("<html>Access denied</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    });

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    // A 403 is not a 401, so there is nothing to retry with a refresh.
    expect(refreshes).toBe(0);
    expect(document.cookie).toContain(AUTH_STATE_COOKIE_NAME);
  });

  it("ends the session when the 403 names the end of it", async () => {
    // The other half: `/auth/me` answers 403 ACCOUNT_INACTIVE for a
    // deactivated account, and that is a refusal this API issued about this
    // session.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { code: "ACCOUNT_INACTIVE", message: "off" } }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    expect(document.cookie).not.toContain(AUTH_STATE_COOKIE_NAME);
  });
});

describe("a probe that fails right after a refresh the server honoured", () => {
  it("does not end the session over a 5xx", async () => {
    // The worst possible moment to guess. The server accepted the refresh a
    // fraction of a second ago, so it has just issued a fresh 30-day token
    // that is now in the jar. If the retried probe comes back 502 -- a
    // redeploy, a DB blip -- tearing down here clears the hint, bounces the
    // visitor to /sign-in, and leaves that brand-new HttpOnly credential live
    // with nothing asking the server to revoke it. The first probe's 5xx
    // branch already declines to guess; these two agreeing is the point.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    let probes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/refresh")) {
        return new Response("{}", { status: 200 });
      }
      probes += 1;
      return new Response("{}", { status: probes === 1 ? 401 : 502 });
    });

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    expect(probes).toBe(2);
    expect(document.cookie).toContain(AUTH_STATE_COOKIE_NAME);
  });

  it("does end the session when the retried probe names a refusal", async () => {
    // The other half, so the branch is pinned in both directions rather than
    // being satisfied by never tearing down at all. `/auth/me` answers 403
    // ACCOUNT_INACTIVE for a deactivated account, and that names the end of
    // the session.
    //
    // The first probe has to answer 401, or the refresh is never attempted and
    // this lands in the first-probe 403 branch instead -- which is how an
    // earlier version of this test passed while asserting nothing about the
    // path its own describe block names. `probes` is asserted for that reason.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    let probes = 0;
    let refreshes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/auth/refresh")) {
        refreshes += 1;
        return new Response("{}", { status: 200 });
      }
      probes += 1;
      if (probes === 1) {
        // What `/auth/me` really answers for an expired access token: a
        // plain-string detail, which names nothing and sends us to refresh.
        return new Response(
          JSON.stringify({ detail: "Your session is invalid or expired." }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ detail: { code: "ACCOUNT_INACTIVE", message: "off" } }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    });

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    expect(refreshes).toBe(1);
    expect(probes).toBe(2);
    expect(document.cookie).not.toContain(AUTH_STATE_COOKIE_NAME);
  });

  it("keeps the session when the retried probe refuses without naming why", async () => {
    // `/auth/me`'s own 401 carries a plain-string detail, and so does a
    // challenge in front of it -- and this particular 401 arrives moments
    // after the server honoured a refresh, so it contradicts what the API
    // just said. Guessing here would retract the hint and strand the 30-day
    // token that refresh had just issued. The visitor gets the way out
    // instead: the "Can't reach the server" surface, with Retry and Sign out.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    let probes = 0;
    let refreshes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/auth/refresh")) {
        refreshes += 1;
        return new Response("{}", { status: 200 });
      }
      probes += 1;
      if (probes === 1) {
        return new Response(
          JSON.stringify({ detail: "Your session is invalid or expired." }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("<html>Access denied</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    });

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    expect(refreshes).toBe(1);
    expect(probes).toBe(2);
    expect(document.cookie).toContain(AUTH_STATE_COOKIE_NAME);
  });
});

describe("the first probe failing without saying anything", () => {
  it.each([500, 502, 503, 429])(
    "keeps the session when the probe answers %i",
    async (status) => {
      // The branch the retried-probe test above says it agrees with -- and
      // nothing held it there. A 5xx is a redeploy, a 429 is the shared
      // rate-limit bucket every visitor shares behind the rewrite; neither
      // says a word about this session, and the refresh cookie beside the
      // hint may be perfectly good for another 30 days. Adding a teardown
      // here is the natural "make the failure branches consistent" commit,
      // because the 403 branch beside it does tear down -- and it passed the
      // whole suite.
      document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status }),
      );

      const { getByTestId } = renderProvider();

      await waitFor(() =>
        expect(getByTestId("state").textContent).toBe("settled:false"),
      );
      expect(document.cookie).toContain(AUTH_STATE_COOKIE_NAME);
    },
  );

  it("keeps the session when the probe never reaches the server", async () => {
    // `fetchCurrentUser` answers null for a rejected fetch, which is the
    // offline tab, the dropped connection and the deadline expiring. The
    // visitor gets the retry surface; retracting the hint here would send
    // them to /sign-in instead, with a live token they cannot spend.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

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
