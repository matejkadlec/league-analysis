// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AppRouter = ReturnType<typeof import("next/navigation").useRouter>;

const {
  validatedGet,
  validatedPost,
  validatedPut,
  useAuth,
  replace,
  push,
  pathname,
  search,
} = vi.hoisted(() => ({
  validatedGet: vi.fn<typeof import("@/lib/core/http/api").validatedGet>(),
  validatedPost: vi.fn<typeof import("@/lib/core/http/api").validatedPost>(),
  validatedPut: vi.fn<typeof import("@/lib/core/http/api").validatedPut>(),
  useAuth:
    vi.fn<typeof import("@/features/auth/context/auth-context").useAuth>(),
  replace: vi.fn<AppRouter["replace"]>(),
  push: vi.fn<AppRouter["push"]>(),
  pathname: { current: "/player-overview" },
  search: { current: "" },
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
  validatedPost,
  validatedPut,
}));

// The context module rather than the `@/features/auth` barrel: mocking the
// barrel leaves anything importing by relative path reading the real context.
vi.mock("@/features/auth/context/auth-context", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/auth/context/auth-context")
  >()),
  useAuth,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(search.current),
  useRouter: () => ({ replace, push }),
}));

import {
  PlayerContextProvider,
  usePlayerContext,
} from "@/features/players/context/player-context";
import { playerContextQueryKey } from "@/features/players/player-query";
import type { AuthContextType } from "@/features/auth/types";
import type { ApiResponse } from "@/lib/core/http/api";
import type { Player, PlayerContext } from "@/lib/core/schemas";
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

const SAVED = player("saved-puuid", "SavedPlayer");
const FROM_URL = player("url-puuid", "UrlPlayer");
// A participant clicked inside somebody else's match: has a row, but this
// account does not track them and they are not in the sidebar.
const STRANGER: Player = { ...player("stranger-puuid", "Stranger"), is_tracked: false };

function answer(url: string): ApiResponse<Player | PlayerContext> {
  if (url === "/players/context") {
    return {
      success: true,
      data: { current_player: SAVED },
    };
  }
  if (url === `/players/${FROM_URL.puuid}`) {
    return { success: true, data: FROM_URL };
  }
  if (url === `/players/${STRANGER.puuid}`) {
    return { success: true, data: STRANGER };
  }
  return {
    success: false,
    error: { status: 404, kind: "not-found", message: "No such player." },
  };
}

/**
 * A whole session: a partial stub would only assert today's reading of `useAuth`.
 */
function session(user: AuthContextType["user"]): AuthContextType {
  return {
    user,
    isAuthenticated: user !== null,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    checkAuth: async () => {},
  };
}

const ACCOUNT = {
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
};

/**
 * Hold the persist in flight: its `onSuccess` makes saved and URL agree, so a
 * settled fixture would pass against any implementation.
 */
function holdThePut() {
  validatedPut.mockImplementation(() => new Promise(() => {}));
}

function renderContext() {
  return renderHookWithQueryClient(() => usePlayerContext(), {
    wrap: (children) => (
      <PlayerContextProvider>{children}</PlayerContextProvider>
    ),
  });
}

beforeEach(() => {
  pathname.current = "/player-overview";
  search.current = "";
  replace.mockReset();
  push.mockReset();
  validatedGet.mockReset();
  validatedGet.mockImplementation((_schema: unknown, url: string) =>
    Promise.resolve(answer(url)),
  );
  validatedPut.mockReset();
  validatedPut.mockResolvedValue({
    success: true,
    data: { current_player: FROM_URL },
  });
  validatedPost.mockReset();
  validatedPost.mockResolvedValue({
    success: true,
    data: {
      id: 21,
      puuid: STRANGER.puuid,
      status: "pending",
      match_execution_id: null,
      created_at: "2026-08-16T10:00:00Z",
      updated_at: "2026-08-16T10:00:00Z",
    },
  });
  useAuth.mockReturnValue(session(ACCOUNT));
});

describe("which player the app thinks you are looking at", () => {
  it("lets the URL win over the saved player", async () => {
    // Reading the saved player while a link names one shows the wrong player's data.
    holdThePut();
    search.current = "puuid=url-puuid";
    const { result, queryClient } = renderContext();

    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("url-puuid"),
    );
    // Read from the cache entry: the hook exposes only the resolved current player.
    expect(
      queryClient.getQueryData<PlayerContext>(playerContextQueryKey(1))
        ?.current_player?.puuid,
    ).toBe("saved-puuid");
  });

  it("falls back to the saved player when the URL names nobody", async () => {
    const { result } = renderContext();

    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );
  });

  it("treats an empty `?puuid=` as no player rather than as nobody", async () => {
    // An empty string read as "the URL names a player" makes the saved player vanish.
    search.current = "puuid=";
    const { result } = renderContext();

    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );
  });

  it("does not read the saved player on a page that is not about a player", async () => {
    // `isPlayerCentricPath` stops `?puuid=` counting as a selection off a player route.
    pathname.current = "/settings";
    search.current = "puuid=url-puuid";
    const { result } = renderContext();

    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );
    // Nor does it rewrite the settings URL to carry a player.
    expect(replace).not.toHaveBeenCalled();
  });

  it("puts the saved player into the address bar through the router", async () => {
    // `history.replaceState` would not tell the router, leaving `useSearchParams` empty.
    const { result } = renderContext();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/player-overview?puuid=saved-puuid", {
      scroll: false,
    });
    expect(result.current.currentPlayer?.puuid).toBe("saved-puuid");
  });

  it("leaves an address bar that already names a player alone", async () => {
    // Without the early return on `urlPuuid` the replace overwrites the linked player.
    holdThePut();
    search.current = "puuid=url-puuid";
    const { result } = renderContext();

    // Wait for both queries to land; "the PUT was called" fires while the context
    // query is still undefined.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the other query parameters when it adds the player", async () => {
    search.current = "queue=420";
    renderContext();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0]?.[0]).toContain("queue=420");
    expect(replace.mock.calls[0]?.[0]).toContain("puuid=saved-puuid");
  });
});

describe("persisting the player named in the URL", () => {
  it("saves a player arrived at by link, so the next page remembers them", async () => {
    search.current = "puuid=url-puuid";
    renderContext();

    await waitFor(() => expect(validatedPut).toHaveBeenCalledTimes(1));
    expect(validatedPut.mock.calls[0]?.[1]).toBe("/players/context/current");
    expect(validatedPut.mock.calls[0]?.[2]).toEqual({ puuid: "url-puuid" });
  });

  it("writes the same player once rather than on every render", async () => {
    // Without `persistedUrlPuuidRef`, each `onSuccess` rewrite schedules the next PUT.
    holdThePut();
    search.current = "puuid=url-puuid";
    const { rerender, result } = renderContext();

    await waitFor(() => expect(validatedPut).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(validatedPut).toHaveBeenCalledTimes(1);
    // Still showing the player the URL asked for, with that one write in
    // flight -- a loop would be the only way the rerenders changed anything.
    expect(result.current.currentPlayer?.puuid).toBe("url-puuid");
  });

  it("does not re-save the player who is already current", async () => {
    // Arriving by link at the player already saved is the common case, and it
    // needs no write at all.
    search.current = "puuid=saved-puuid";
    validatedGet.mockImplementation((_schema: unknown, url: string) =>
      Promise.resolve(
        url === "/players/saved-puuid"
          ? { success: true, data: SAVED }
          : answer(url),
      ),
    );
    const { result } = renderContext();

    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );
    expect(validatedPut).not.toHaveBeenCalled();
  });

  it("waits for the player to load before saving them", async () => {
    // `?puuid=` is user input; persisting it unresolved stores a PUUID that never loads.
    search.current = "puuid=missing-puuid";
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(validatedPut).not.toHaveBeenCalled();
  });
});

describe("whether the app says it is still loading", () => {
  it("does not wait on a player query that was never asked for", async () => {
    // React Query v5 derives `isLoading` as `isPending && isFetching`, so a disabled
    // query already reports false without an `!!urlPuuid &&` guard.
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("does not ask the API anything while nobody is signed in", async () => {
    // The signed-out probe was a real bug once already. `enabled` carries it.
    useAuth.mockReturnValue(session(null));
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(validatedGet).not.toHaveBeenCalled();
    expect(result.current.currentPlayer).toBeNull();
  });

  it("does not probe a URL PUUID while nobody is signed in either", async () => {
    // The PUUID guard sits on `queryFn`, so only `enabled` stops an unauthenticated
    // request once `?puuid=` is set.
    search.current = `puuid=${FROM_URL.puuid}`;
    useAuth.mockReturnValue(session(null));
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(validatedGet).not.toHaveBeenCalled();
  });
});

describe("choosing a player from the picker", () => {
  it("saves the choice, seeds its cache entry, and navigates", async () => {
    // `setQueryData` on the player key spares the destination page a skeleton refetch.
    const { result, queryClient } = renderContext();
    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );

    await result.current.selectPlayer(FROM_URL);

    expect(validatedPut).toHaveBeenCalledWith(
      expect.anything(),
      "/players/context/current",
      { puuid: "url-puuid" },
    );
    expect(push).toHaveBeenCalledWith("/player-overview?puuid=url-puuid", {
      scroll: false,
    });
    expect(queryClient.getQueryData(["player", "url-puuid"])).toEqual(FROM_URL);
  });

  it("does not let the stale URL revert an explicit choice", async () => {
    // `selectPlayer` persists before it navigates, so one commit has the context and
    // the URL naming different players; the mocked URL never advances past it.
    search.current = "puuid=saved-puuid";
    validatedGet.mockImplementation((_schema: unknown, url: string) =>
      Promise.resolve(
        url === "/players/saved-puuid"
          ? { success: true, data: SAVED }
          : answer(url),
      ),
    );
    const { result } = renderContext();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.selectPlayer(FROM_URL);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(validatedPut).toHaveBeenCalledTimes(1);
    expect(validatedPut.mock.calls[0]?.[2]).toEqual({ puuid: "url-puuid" });
  });

  it("sends a picker choice made off a player page to the overview", async () => {
    // `playerRoute` redirects a non-player-centric path to one that renders a player.
    pathname.current = "/settings";
    const { result } = renderContext();
    await waitFor(() => expect(validatedGet).toHaveBeenCalled());

    await result.current.selectPlayer(FROM_URL);

    expect(push).toHaveBeenCalledWith("/player-overview?puuid=url-puuid", {
      scroll: false,
    });
    // `/settings` carries no `?puuid=`, so the chosen player can only become
    // current through the record the persist wrote back.
    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("url-puuid"),
    );
  });
});

describe("switching to a participant by PUUID", () => {
  it("starts the target's update and navigates, but never persists a stranger", async () => {
    // The persist effect skips an untracked player, so the next visit keeps the tracked one.
    const { result, rerender } = renderContext();
    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );

    result.current.selectPlayerByPuuid(STRANGER.puuid);

    await waitFor(() =>
      expect(validatedPost).toHaveBeenCalledWith(
        expect.anything(),
        `/players/${STRANGER.puuid}/sync`,
      ),
    );
    expect(push).toHaveBeenCalledWith(
      `/player-overview?puuid=${STRANGER.puuid}`,
      { scroll: false },
    );

    // The navigation happened: the URL now names the stranger.
    search.current = `puuid=${STRANGER.puuid}`;
    rerender();
    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe(STRANGER.puuid),
    );
    expect(validatedPut).not.toHaveBeenCalled();
  });

  it("still persists a tracked player arrived at the same way", async () => {
    // The gate is `is_tracked`, not the click path: switching to somebody in
    // the sidebar is a real choice and keeps being remembered.
    search.current = `puuid=${FROM_URL.puuid}`;
    renderContext();

    await waitFor(() => expect(validatedPut).toHaveBeenCalledTimes(1));
    expect(validatedPut.mock.calls[0]?.[2]).toEqual({ puuid: FROM_URL.puuid });
  });

  it("does nothing when the clicked participant is already current", async () => {
    const { result } = renderContext();
    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );

    result.current.selectPlayerByPuuid("saved-puuid");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(validatedPost).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the provider requirement", () => {
  it("refuses to be used outside its provider rather than returning nothing", () => {
    // The alternative is a null-deref in whichever consumer destructures first, far
    // from the misplaced component.
    expect(() => renderHook(() => usePlayerContext())).toThrow(
      /must be used within PlayerContextProvider/,
    );
  });
});
