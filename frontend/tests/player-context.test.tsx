// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  validatedGet: vi.fn(),
  validatedPost: vi.fn(),
  validatedPut: vi.fn(),
  useAuth: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  pathname: { current: "/player-overview" },
  search: { current: "" },
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
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
import type { Player, PlayerContext } from "@/lib/core/schemas";
import { renderHookWithQueryClient } from "./render-support";

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

function answer(url: string) {
  if (url === "/players/context") {
    return {
      success: true,
      data: { current_player: SAVED, tracked_players: [SAVED] },
    };
  }
  if (url === `/players/${FROM_URL.puuid}`) {
    return { success: true, data: FROM_URL };
  }
  if (url === `/players/${STRANGER.puuid}`) {
    return { success: true, data: STRANGER };
  }
  return { success: false, error: { status: 404, kind: "not_found" } };
}

/**
 * Leave the persist round-trip in flight for the rest of the test.
 *
 * Its `onSuccess` overwrites the saved player with the one from the URL, so
 * once it resolves the two agree and several of these assertions would pass
 * against any implementation. The window before it lands -- which is exactly
 * when someone opens a shared link -- is the one worth testing, and no test
 * here needs it to close.
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
    data: { current_player: FROM_URL, tracked_players: [SAVED] },
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
  useAuth.mockReturnValue({
    user: { id: 1, is_admin: false, is_active: true },
    isAuthenticated: true,
    isLoading: false,
  });
});

describe("which player the app thinks you are looking at", () => {
  it("lets the URL win over the saved player", async () => {
    // A shared or bookmarked link carries `?puuid=`, and the saved player is
    // whoever this account looked at last. Read the saved one while a URL is
    // present and a link to someone's profile silently shows a different
    // player's data under that person's name in the address bar.
    //
    // The persist round-trip is held open on purpose. Once it resolves the
    // saved player *becomes* the URL player and the two readings agree, so a
    // fixture that lets it settle passes against reading either one.
    holdThePut();
    search.current = "puuid=url-puuid";
    const { result, queryClient } = renderContext();

    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("url-puuid"),
    );
    // And the saved player really is still someone else at this point --
    // read from the context query's own cache entry, because the hook
    // deliberately exposes only the resolved current player.
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
    // A link that carries the parameter with nothing after it. The empty
    // string reaches the context and reads as "the URL names a player", so
    // the account's saved player vanished and the page asked them to pick
    // one.
    search.current = "puuid=";
    const { result } = renderContext();

    await waitFor(() =>
      expect(result.current.currentPlayer?.puuid).toBe("saved-puuid"),
    );
  });

  it("does not read the saved player on a page that is not about a player", async () => {
    // `isPlayerCentricPath` is what stops `?puuid=` on, say, the settings page
    // being treated as a player selection. The URL parameter is only meaningful
    // on the three routes that render a player.
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
    // Landing on a player page with no `?puuid=` restores the last player. It
    // has to go through `router.replace` rather than
    // `window.history.replaceState`: the latter changes the address bar
    // without telling the router, so `useSearchParams` elsewhere keeps
    // returning nothing and every sidebar link is built without the player.
    const { result } = renderContext();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/player-overview?puuid=saved-puuid", {
      scroll: false,
    });
    expect(result.current.currentPlayer?.puuid).toBe("saved-puuid");
  });

  it("leaves an address bar that already names a player alone", async () => {
    // The early return on `urlPuuid` is what stops this effect fighting the
    // URL it just wrote. Without it the replace runs on every render with the
    // saved player, overwriting the player the link asked for.
    holdThePut();
    search.current = "puuid=url-puuid";
    const { result } = renderContext();

    // Wait for both queries to have *landed*, not merely to have been
    // issued: the effect cannot run before `savedPlayer` exists, so asserting
    // on the first request only proves the test was quicker than the fetch.
    // `isLoading` ORs in the context query's, so false is that proof. Not
    // "the PUT was called" -- that fires as soon as the URL player resolves,
    // while the context query is still undefined, which would be the race
    // this wait exists to avoid.
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
    // `persistedUrlPuuidRef` is the whole guard. Both effects depend on
    // `contextQuery.data`, which this mutation's `onSuccess` rewrites, so
    // without the ref each success schedules the next write -- a PUT loop
    // against the account's own settings for as long as the page is open.
    // The PUT is held open here for the same reason: once it resolves,
    // `current_player` equals `urlPuuid` and the *other* guard stops the
    // second write. The ref is what covers the window in between, so a
    // fixture that lets the request settle cannot see it at all.
    holdThePut();
    search.current = "puuid=url-puuid";
    const { rerender } = renderContext();

    await waitFor(() => expect(validatedPut).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(validatedPut).toHaveBeenCalledTimes(1);
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
    // The URL is user input: `?puuid=` can name a player who does not exist.
    // Persisting it before the fetch resolves stores a PUUID the account can
    // never load, and every later page starts by failing.
    search.current = "puuid=missing-puuid";
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(validatedPut).not.toHaveBeenCalled();
  });
});

describe("whether the app says it is still loading", () => {
  it("does not wait on a player query that was never asked for", async () => {
    // With no `?puuid=` the URL player query is disabled. React Query v5
    // derives `isLoading` as `isPending && isFetching`, so a disabled query
    // reports false and needs no `!!urlPuuid &&` guard in the provider —
    // this pins that pages still leave their skeleton state without one.
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("does not ask the API anything while nobody is signed in", async () => {
    // The signed-out probe was a real bug once already. `enabled` carries it.
    useAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(validatedGet).not.toHaveBeenCalled();
    expect(result.current.currentPlayer).toBeNull();
  });

  it("does not probe a URL PUUID while nobody is signed in either", async () => {
    // The case above leaves `?puuid=` empty, so it passes whether or not the
    // auth half of the URL query's `enabled` survives. This one does not: the
    // PUUID guard moved onto `queryFn` as `skipToken`, and dropping
    // `enabled: isAuthenticated` as newly redundant would send an
    // unauthenticated `/players/{puuid}` on every signed-out visit to
    // `/player-overview?puuid=...`.
    search.current = `puuid=${FROM_URL.puuid}`;
    useAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
    const { result } = renderContext();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(validatedGet).not.toHaveBeenCalled();
  });
});

describe("choosing a player from the picker", () => {
  it("saves the choice, seeds its cache entry, and navigates", async () => {
    // `setQueryData` on the player key is why the destination page renders the
    // player immediately instead of flashing a skeleton: the picker already
    // holds the whole record, so refetching it is a round trip for data it
    // just had.
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
    // `selectPlayer` persists first and navigates second, so there is a
    // commit where the context already names the chosen player while the URL
    // still names the previous one. The persist effect used to read that
    // stale URL as a link naming somebody else and PUT the previous player
    // straight back — the dialog choice was silently reverted (and then
    // accidentally re-corrected by a third PUT once the URL caught up, which
    // is why three PUTs looked like success). The mocked URL never advances
    // here, so the stale window lasts the whole test: exactly one PUT, for
    // the chosen player, may happen.
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
    // `playerRoute` redirects anything that is not a player-centric path, so
    // picking a player from the settings sidebar lands somewhere that shows
    // one rather than reloading settings with a parameter it ignores.
    pathname.current = "/settings";
    const { result } = renderContext();
    await waitFor(() => expect(validatedGet).toHaveBeenCalled());

    await result.current.selectPlayer(FROM_URL);

    expect(push).toHaveBeenCalledWith("/player-overview?puuid=url-puuid", {
      scroll: false,
    });
  });
});

describe("switching to a participant by PUUID", () => {
  it("starts the target's update and navigates, but never persists a stranger", async () => {
    // The whole flow of clicking an enemy laner: the update starts so their
    // history can fill, the page switches — and when the URL then names
    // them, the persist effect skips an untracked player, so tomorrow's
    // visit still defaults to the last *tracked* player, not to a stranger
    // with no sidebar entry to switch back from.
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
    // The alternative is a `null` context and a `Cannot read properties of
    // null` from whichever consumer happens to destructure first, nowhere near
    // the component that was rendered in the wrong place.
    expect(() => renderHook(() => usePlayerContext())).toThrow(
      /must be used within PlayerContextProvider/,
    );
  });
});
