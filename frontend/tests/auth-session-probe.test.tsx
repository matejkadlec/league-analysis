// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "./render-support";
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

/** A complete `UserResponse`; `UserResponseSchema` rejects anything less. */
function userBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "someone@example.com",
    display_name: "Someone",
    is_active: true,
    is_admin: false,
    email_verified: true,
    email_verified_at: null,
    last_login: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let triggerRecheck: (() => Promise<void>) | null = null;
let triggerLogout: AuthContextType["logout"] | null = null;
let triggerLogin: AuthContextType["login"] | null = null;

function AuthStateProbe() {
  const { isLoading, isAuthenticated, checkAuth, logout, login } = useAuth();
  // Assigned in an effect, not during render: reassigning a module-level
  // binding while rendering is a side effect, and eslint rejects it.
  useEffect(() => {
    triggerRecheck = checkAuth;
    triggerLogout = logout;
    triggerLogin = login;
  }, [checkAuth, logout, login]);
  return (
    <span data-testid="state">{`${isLoading ? "loading" : "settled"}:${isAuthenticated}`}</span>
  );
}

function renderProvider() {
  return renderWithQueryClient(
    <AuthProvider>
      <AuthStateProbe />
    </AuthProvider>,
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
  triggerLogin = null;
  clearCookies();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  clearCookies();
});

describe("request deadlines", () => {
  // Asserted as an effect -- the request gives up, at that length -- not as
  // `expect(signal).toBeInstanceOf(AbortSignal)`, which stays green against
  // deadlines that never fire. `deadline-support.ts` says why.
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

describe("a 200 the client cannot read", () => {
  it("does not sign the visitor in on a body that is not a user record", async () => {
    // `GET /auth/me` becomes React state, and `Response.json()` is
    // `Promise<any>`: without a zod parse a renamed field or a captive
    // portal's HTML type-checks into `user`, whose `is_admin` gates /jobs.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1, email: "someone@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
  });
});

describe("re-checking an established session", () => {
  it("never raises isLoading, which would unmount the whole app shell", async () => {
    // Four consumers render null while `isLoading` is true. Raising it on a
    // re-check blanked the settings page mid-edit -- where the real callers
    // live -- and blanked the retry surface for the full probe timeout.

    // The probe is held open on purpose: a re-check that resolves in the same
    // tick collapses both state writes into one render, so the transient this
    // is about is only observable while the request is still outstanding.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    const settled = () =>
      new Response(
        JSON.stringify(userBody({ id: 1, email: "someone@example.com" })),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
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
    // `auth-context.tsx` may tear a session down for logout and for a 403, but
    // not here: the probe 401'd and the refresh was never delivered, so the
    // jar's refresh cookie may still be good.
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
    // A Cloudflare challenge answers a background request with 403 and an HTML
    // body the origin never sees. A bare teardown here signs every visitor out
    // over a challenge while their 30-day refresh token stays live.
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
        JSON.stringify({
          detail: { code: "ACCOUNT_INACTIVE", message: "off" },
        }),
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
    // The server honoured the refresh a moment ago, so a fresh 30-day token is
    // in the jar. Tearing down on the retried probe's 502 clears the hint and
    // leaves that new HttpOnly credential live and unrevoked.
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
    // satisfied by never tearing down at all: `/auth/me` answers 403
    // ACCOUNT_INACTIVE for a deactivated account, which names the end.

    // The first probe has to answer 401, or the refresh is never attempted and
    // this lands in the first-probe 403 branch instead. `probes` is asserted
    // for that reason.
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
        JSON.stringify({
          detail: { code: "ACCOUNT_INACTIVE", message: "off" },
        }),
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

  it("signs the visitor in when the retried probe answers", async () => {
    // The whole point of refreshing: an expired access token should be
    // invisible. Every other test here asserts a teardown that must NOT
    // happen, so all of them pass on a provider that never signs anyone in.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    let probes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/auth/refresh")) {
        return new Response("{}", { status: 200 });
      }
      probes += 1;
      if (probes === 1) {
        return new Response(
          JSON.stringify({ detail: "Your session is invalid or expired." }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify(userBody({ id: 1, email: "user@example.com" })),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const { getByTestId } = renderProvider();

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:true"),
    );
    expect(probes).toBe(2);
    expect(document.cookie).toContain(AUTH_STATE_COOKIE_NAME);
  });

  it("keeps the session when the retried probe refuses without naming why", async () => {
    // `/auth/me`'s own 401 carries a plain-string detail and so does a
    // challenge in front of it, and this one contradicts the refresh the
    // server honoured moments ago. Guessing strands that new 30-day token.
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
      // A 5xx is a redeploy and a 429 is the rate-limit bucket every visitor
      // shares behind the rewrite; neither says anything about this session,
      // so neither may end one.
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
    // `fetchCurrentUser` answers null for a rejected fetch -- the offline tab,
    // the dropped connection, the deadline expiring. Retracting the hint here
    // sends the visitor to /sign-in with a live token they cannot spend.
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
    // A truncated body, a captive portal, a bad gzip: none of it says the
    // session ended. The teardown bumps the session epoch, so an in-flight
    // refresh would then end the session on every device.
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify(userBody({ id: 1, email: "someone@example.com" })),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
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
        // A backend that never answers leaves `isLoading` true forever and
        // every surface gated on it blank. `objectContaining` matches a
        // subset, so without naming the signal a deleted deadline stays green.
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

describe("data cached for one account", () => {
  // The cache holds the account's own data and the QueryClient is created
  // once per tab, so it outlives any number of sessions unless something
  // empties it.
  const cachedPrivateData = { note: "previous account's data" };

  it("is dropped when the session ends", async () => {
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/auth/refresh")) {
        throw new Error("offline");
      }
      return new Response("{}", { status: 401 });
    });

    const { getByTestId, queryClient } = renderProvider();
    queryClient.setQueryData(["matches"], cachedPrivateData);

    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:false"),
    );
    expect(queryClient.getQueryData(["matches"])).toBeUndefined();
  });

  it("is dropped before the next sign-in can read it", async () => {
    // The shared-machine case: sign in as someone else in the same tab and the
    // first paint comes from cache, so the new account's screen is filled with
    // the previous account's data until every query has refetched.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("/auth/login")
        ? new Response("{}", { status: 200 })
        : new Response(
            JSON.stringify(userBody({ id: 2, email: "next@example.com" })),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
    );

    const { getByTestId, queryClient } = renderProvider();
    await waitFor(() =>
      expect(getByTestId("state").textContent).toBe("settled:true"),
    );
    queryClient.setQueryData(["matches"], cachedPrivateData);

    await act(async () => {
      await triggerLogin?.({
        email: "next@example.com",
        password: "secret-password",
      });
    });

    expect(queryClient.getQueryData(["matches"])).toBeUndefined();
  });
});

describe("a login the server refuses", () => {
  it("surfaces what the server said rather than a generic failure", async () => {
    // The helper is unit-tested and the form is tested against a mocked
    // `login`, so the line joining them -- the only place the server's own
    // reason enters the app -- is guarded by nothing else.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { code: "INVALID_CREDENTIALS" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );

    renderProvider();
    await waitFor(() => expect(triggerLogin).not.toBeNull());

    await act(async () => {
      await expect(
        triggerLogin?.({ email: "user@example.com", password: "wrong" }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    });
  });
});

describe("useAuth outside an AuthProvider", () => {
  it("refuses rather than handing back an undefined session", () => {
    // Without the guard the context is `undefined` and the destructure throws
    // "Cannot destructure property" at the caller rather than naming the
    // missing provider, which is what makes it a one-line fix.

    // React logs the thrown render, so the console is silenced for the length
    // of the assertion rather than left to look like a real failure.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<AuthStateProbe />)).toThrow(
      "useAuth must be used within an AuthProvider",
    );

    quiet.mockRestore();
  });
});
