// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Router = ReturnType<typeof import("next/navigation").useRouter>;

const { validatedGet, useAuth, replace, push, pathname, search } = vi.hoisted(
  () => ({
    validatedGet: vi.fn<typeof import("@/lib/core/http/api").validatedGet>(),
    useAuth: vi.fn<typeof import("@/features/auth").useAuth>(),
    replace: vi.fn<Router["replace"]>(),
    push: vi.fn<Router["push"]>(),
    pathname: { current: "/rank-manipulation" },
    search: { current: "" },
  }),
);

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
}));

vi.mock("@/features/auth", () => ({ useAuth }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(search.current),
  useRouter: () => ({ replace, push }),
}));

import {
  PlayerContextProvider,
  usePlayerContext,
} from "@/features/players/context/player-context";
import { useAnalyzedPlayer } from "@/features/players/components/use-analyzed-player";
import type { AuthContextType } from "@/features/auth/types";
import type { Player } from "@/lib/core/schemas";
import { renderHookWithQueryClient } from "./support/render-support";

function player(puuid: string, name: string): Player {
  return {
    puuid,
    game_name: name,
    tag_line: "EUNE",
    platform: "eun1",
    summoner_level: 300,
    profile_icon_id: 1,
    is_tracked: true,
    analyzed_matches: 0,
    total_matches: 0,
    last_playstyle_analysis: null,
    last_matchmaking_analysis: null,
    profile_synced_at: null,
    league_synced_at: null,
    match_synced_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };
}

/** The whole context value, not the three fields the provider reads today. */
const SIGNED_IN: AuthContextType = {
  user: {
    id: 1,
    email: "user@example.com",
    display_name: "User",
    is_active: true,
    is_admin: false,
    email_verified: true,
    email_verified_at: null,
    last_login: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
  isAuthenticated: true,
  isLoading: false,
  login: async () => {},
  logout: async () => {},
  checkAuth: async () => {},
};

const CURRENT = player("current-puuid", "CurrentPlayer");
const SOMEBODY_ELSE = player("other-puuid", "SomebodyElse");

/** Every URL `validatedGet` was asked for, in order. */
function requestedUrls(): string[] {
  return validatedGet.mock.calls.map((call) => call[1] as string);
}

beforeEach(() => {
  pathname.current = "/rank-manipulation";
  search.current = "";
  replace.mockReset();
  push.mockReset();
  validatedGet.mockReset();
  validatedGet.mockImplementation((_schema: unknown, url: string) =>
    Promise.resolve(
      url === "/players/context"
        ? { success: true, data: { current_player: CURRENT } }
        : url === `/players/${CURRENT.puuid}`
          ? { success: true, data: CURRENT }
          : url === `/players/${SOMEBODY_ELSE.puuid}`
            ? { success: true, data: SOMEBODY_ELSE }
            : {
                success: false,
                error: {
                  status: 404,
                  kind: "not-found",
                  message: "Player not found",
                },
              },
    ),
  );
  useAuth.mockReturnValue(SIGNED_IN);
});

/** Both hooks under the real provider, the way a page mounts them. */
function mountPage() {
  return renderHookWithQueryClient(
    () => ({
      context: usePlayerContext(),
      analyzed: useAnalyzedPlayer(),
    }),
    {
      wrap: (children) => (
        <PlayerContextProvider>{children}</PlayerContextProvider>
      ),
    },
  );
}

describe("the current player the context already answered with", () => {
  it("is not fetched a second time to analyze them", async () => {
    // `/players/context` returns the whole player, and the default analyzed
    // player *is* that player, so `GET /players/{puuid}` asks the API for a
    // row the page is already holding. Every visit paid for it.
    const { result } = mountPage();

    await waitFor(() =>
      expect(result.current.analyzed.analyzedPlayer).toEqual(CURRENT),
    );

    expect(requestedUrls()).toEqual(["/players/context"]);
  });

  it("is still fetched when the URL names somebody else", async () => {
    // The positive control: seeding must not turn into serving the current
    // player for a `?puuid=` that names a different one. Without this,
    // never fetching at all would pass the test above.
    search.current = `puuid=${SOMEBODY_ELSE.puuid}`;

    const { result } = mountPage();

    await waitFor(() =>
      expect(result.current.analyzed.analyzedPlayer).toEqual(SOMEBODY_ELSE),
    );

    expect(requestedUrls()).toContain(`/players/${SOMEBODY_ELSE.puuid}`);
  });
});
