// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AppRouter = ReturnType<typeof import("next/navigation").useRouter>;
type PlayerContextValue = ReturnType<
  typeof import("@/features/players/context/player-context").usePlayerContext
>;

const { validatedGet, usePlayerContext, replace, push, pathname, search } =
  vi.hoisted(() => ({
    validatedGet: vi.fn<typeof import("@/lib/core/http/api").validatedGet>(),
    usePlayerContext:
      vi.fn<
        typeof import("@/features/players/context/player-context").usePlayerContext
      >(),
    replace: vi.fn<AppRouter["replace"]>(),
    push: vi.fn<AppRouter["push"]>(),
    pathname: { current: "/matchmaking-analysis" },
    search: { current: "" },
  }));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
}));

// The context module rather than the `@/features/players` barrel: the hook
// imports it by relative path, which a barrel mock would not intercept.
vi.mock("@/features/players/context/player-context", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/players/context/player-context")
  >()),
  usePlayerContext,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(search.current),
  useRouter: () => ({ replace, push }),
}));

import { useAnalyzedPlayer } from "@/features/players/components/use-analyzed-player";
import { playerQueryKey } from "@/features/players/player-query";
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

const REFERENCE = player("reference-puuid", "ReferencePlayer");
const ANALYZED = player("analyzed-puuid", "AnalyzedPlayer");

// The whole context value: the mock is typed against the real hook, so a
// partial object would only agree with today's reading of it.
function context(
  selectPlayer: PlayerContextValue["selectPlayer"],
): PlayerContextValue {
  return {
    currentPlayer: REFERENCE,
    isLoading: false,
    selectPlayer,
    selectPlayerByPuuid: () => {},
  };
}

beforeEach(() => {
  pathname.current = "/matchmaking-analysis";
  search.current = "";
  replace.mockReset();
  push.mockReset();
  validatedGet.mockReset();
  validatedGet.mockImplementation((_schema: unknown, url: string) =>
    Promise.resolve(
      url === `/players/${ANALYZED.puuid}`
        ? { success: true, data: ANALYZED }
        : url === `/players/${REFERENCE.puuid}`
          ? { success: true, data: REFERENCE }
          : {
              success: false,
              error: {
                status: 404,
                kind: "not-found",
                message: "No such player.",
              },
            },
    ),
  );
  usePlayerContext.mockReturnValue(
    context(vi.fn<PlayerContextValue["selectPlayer"]>()),
  );
});

describe("the analyzed player scope", () => {
  it("seeds the default through the router, not a raw history write", async () => {
    // `window.history.replaceState` puts the PUUID in the address bar without
    // telling the router, so every other `useSearchParams` reader keeps
    // answering "no player". Seeding has to be a navigation.
    const { result } = renderHookWithQueryClient(() => useAnalyzedPlayer());

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(
      `/matchmaking-analysis?puuid=${REFERENCE.puuid}`,
      { scroll: false },
    );
    await waitFor(() =>
      expect(result.current.analyzedPlayer?.puuid).toBe(REFERENCE.puuid),
    );
  });

  it("stops seeding once the URL carries a player", async () => {
    // The effect's only loop guard is this early return: it re-runs on the
    // navigation it just caused, and a guard that did not see its own write
    // land would replace forever.
    search.current = `puuid=${ANALYZED.puuid}`;
    const { result } = renderHookWithQueryClient(() => useAnalyzedPlayer());

    await waitFor(() =>
      expect(result.current.analyzedPlayer?.puuid).toBe(ANALYZED.puuid),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("treats a valueless `?puuid=` as absent rather than as a selection", async () => {
    // `searchParams.get` answers `""` for it, and `"" ?? fallback` keeps the
    // empty string -- so a malformed link used to suppress the saved player
    // and render the empty state instead of the default.
    search.current = "puuid=";
    const { result } = renderHookWithQueryClient(() => useAnalyzedPlayer());

    await waitFor(() =>
      expect(result.current.analyzedPlayer?.puuid).toBe(REFERENCE.puuid),
    );
    expect(replace).toHaveBeenCalledWith(
      `/matchmaking-analysis?puuid=${REFERENCE.puuid}`,
      { scroll: false },
    );
  });

  it("selects into the URL and the cache, never into global context", async () => {
    // The page says this choice will not change or track the reference
    // player. Routing the selection through `usePlayerContext.selectPlayer`
    // would persist it to the account, which is the thing being avoided.
    search.current = `puuid=${REFERENCE.puuid}`;
    const selectPlayer = vi.fn<PlayerContextValue["selectPlayer"]>();
    usePlayerContext.mockReturnValue(context(selectPlayer));
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useAnalyzedPlayer(),
    );

    result.current.selectAnalyzedPlayer(ANALYZED);

    expect(push).toHaveBeenCalledWith(
      `/matchmaking-analysis?puuid=${ANALYZED.puuid}`,
      { scroll: false },
    );
    expect(selectPlayer).not.toHaveBeenCalled();
    // Seeded, so the destination renders the name without a second fetch.
    expect(queryClient.getQueryData(playerQueryKey(ANALYZED.puuid))).toEqual(
      ANALYZED,
    );
  });
});
