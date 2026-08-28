// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./support/render-support";

type TokenManager = typeof import("../lib/session/token-manager");
type Router = ReturnType<typeof import("next/navigation").useRouter>;

const { refreshAccessToken, removeAuthTokens, routerPush } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn<TokenManager["refreshAccessToken"]>(),
  removeAuthTokens: vi.fn<TokenManager["removeAuthTokens"]>(),
  routerPush: vi.fn<Router["push"]>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("../lib/session/token-manager", () => ({
  refreshAccessToken,
  removeAuthTokens,
}));

import { AuthProvider, useAuth } from "../features/auth/context/auth-context";
import type { AuthContextType } from "../features/auth/types";

/** A cache entry under a key that carries no account dimension. */
const ACCOUNT_SCOPED_KEY = ["card-preferences"];

function account(id: number) {
  return {
    id,
    email: `account-${id}@example.test`,
    display_name: `Account ${id}`,
    is_active: true,
    is_admin: false,
    email_verified: true,
    email_verified_at: "2026-08-01T00:00:00Z",
    last_login: "2026-08-22T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };
}

function CheckAuthProbe({
  onReady,
}: {
  onReady: (checkAuth: AuthContextType["checkAuth"]) => void;
}) {
  const { checkAuth } = useAuth();

  useEffect(() => {
    onReady(checkAuth);
  }, [checkAuth, onReady]);

  return null;
}

/**
 * Mounts the provider against a `/auth/me` that answers with `accounts` in
 * order, and returns the cache plus a way to re-check.
 */
async function mountAs(accounts: number[]) {
  const answers = [...accounts];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const id = answers.length > 1 ? answers.shift()! : answers[0]!;
      return {
        ok: true,
        status: 200,
        json: async () => account(id),
      } as Response;
    }),
  );

  let recheck: AuthContextType["checkAuth"] | undefined;
  const { queryClient } = renderWithQueryClient(
    <AuthProvider>
      <CheckAuthProbe
        onReady={(checkAuth) => {
          recheck = checkAuth;
        }}
      />
    </AuthProvider>,
  );

  // Let the mount probe adopt the first account.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return { queryClient, recheck: () => recheck!() };
}

describe("the cache when the signed-in account changes", () => {
  beforeEach(() => {
    refreshAccessToken.mockReset();
    removeAuthTokens.mockReset();
    routerPush.mockReset();
    // The provider skips the probe entirely without the session hint.
    document.cookie = "league_analysis_auth_state=1";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("drops the previous account's data when a different account answers", async () => {
    // Cookies are jar-wide, so signing in as somebody else in a second tab
    // changes who this tab is without `login` or `logout` running here -- and
    // the cached answers carry no account in their key.
    const { queryClient, recheck } = await mountAs([1, 2]);
    queryClient.setQueryData(ACCOUNT_SCOPED_KEY, "account one's thresholds");

    await act(async () => {
      await recheck();
    });

    expect(queryClient.getQueryData(ACCOUNT_SCOPED_KEY)).toBeUndefined();
  });

  it("keeps it when the same account answers again", async () => {
    // The half that makes the first assertion mean something: clearing on
    // every re-check would pass that test too, and would throw the whole cache
    // away each time the settings page saves a display name.
    const { queryClient, recheck } = await mountAs([3]);
    queryClient.setQueryData(ACCOUNT_SCOPED_KEY, "account three's thresholds");

    await act(async () => {
      await recheck();
    });

    expect(queryClient.getQueryData(ACCOUNT_SCOPED_KEY)).toBe(
      "account three's thresholds",
    );
  });
});
