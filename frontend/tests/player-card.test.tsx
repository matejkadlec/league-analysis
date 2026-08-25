// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Player } from "@/lib/core/schemas";

const { validatedGet, usePlayerSyncRun, startSync } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
  usePlayerSyncRun: vi.fn(),
  startSync: vi.fn(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
}));

vi.mock("@/features/players/use-player-sync-run", () => ({
  usePlayerSyncRun,
}));

// The track button runs its own queries; its behaviour is not this card's.
vi.mock("@/features/players/components/track-player-button", () => ({
  TrackPlayerButton: () => <span>Track</span>,
}));

// The freshness *wiring* is under test — which timestamps feed the label —
// not the clock arithmetic, which tests/relative-time.test.tsx owns.
vi.mock("@/lib/core/use-relative-time", () => ({
  useRelativeTime: () => "3 hours ago",
}));

// A pass-through <img> so the src the card chose and its onError retry are
// both observable; the real next/image needs a loader jsdom does not have.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError?: () => void;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} onError={onError} />
  ),
}));

import { PlayerCard } from "@/features/players/components/player-card";
import { renderWithQueryClient } from "./render-support";

function player(overrides: Partial<Player> = {}): Player {
  return {
    puuid: "p-1",
    game_name: "Hide on bush",
    tag_line: "KR1",
    platform: "eun1",
    summoner_level: 512,
    profile_icon_id: 123,
    is_tracked: false,
    analyzed_matches: 0,
    total_matches: 0,
    profile_synced_at: "2026-08-19T08:00:00Z",
    league_synced_at: "2026-08-19T08:00:00Z",
    match_synced_at: "2026-08-19T08:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-19T08:00:00Z",
    ...overrides,
  };
}

const league = {
  puuid: "p-1",
  queue_type: "RANKED_SOLO_5x5",
  tier: "GOLD",
  rank: "II",
  league_points: 42,
  wins: 60,
  losses: 40,
  created_at: "2026-08-19T08:00:00Z",
  // Post-parse shape: the schema has already normalized the API's percent to
  // a fraction. Deliberately disagrees with the stats fixture's 0.6 so an
  // assertion can tell which source the ranked branch rendered.
  win_rate: 0.555,
  total_games: 100,
  display_rank: "Gold II",
};

const stats = {
  puuid: "p-1",
  total_matches: 25,
  wins: 15,
  losses: 10,
  win_rate: 0.6,
  avg_kills: 5,
  avg_deaths: 4,
  avg_assists: 7,
  avg_kda: 3,
  avg_cs: 180,
  avg_vision_score: 22,
};

// `/players/{puuid}/league` answers an unranked player with a 200 carrying
// `null`, so `leagueData: null` is a *successful* empty response here.
// `failLeagueWith` covers the failure case separately.
function answerWith({
  leagueData = league as typeof league | null,
  statsData = stats as typeof stats | null,
} = {}) {
  validatedGet.mockImplementation(async (_schema, url: string) => {
    if (url.endsWith("/league")) {
      return { success: true, data: leagueData };
    }
    return { success: true, data: statsData };
  });
}

function failLeagueWith(status: number) {
  validatedGet.mockImplementation(async (_schema, url: string) => {
    if (url.endsWith("/league")) {
      return {
        success: false,
        error: { status, message: "The service is unavailable." },
      };
    }
    return { success: true, data: stats };
  });
}

function renderCard(p: Player = player(), onRefreshAll?: () => void) {
  return renderWithQueryClient(
    <PlayerCard player={p} {...(onRefreshAll && { onRefreshAll })} />,
  );
}

function profileIcon() {
  return screen.getByAltText("Profile Icon") as HTMLImageElement;
}

beforeEach(() => {
  validatedGet.mockReset();
  answerWith();
  startSync.mockReset();
  usePlayerSyncRun.mockReset();
  usePlayerSyncRun.mockReturnValue({ isUpdating: false, startSync });
});


describe("what the card says about the player", () => {
  it("shows the rank, the LP and the ranked win rate once the league lands", async () => {
    renderCard();

    expect(await screen.findByText("Gold II")).toBeTruthy();
    expect(screen.getByText("42 LP")).toBeTruthy();
    // 60W/40L from the league row, not recomputed from match stats.
    expect(screen.getByText("60W")).toBeTruthy();
    expect(screen.getByText("40L")).toBeTruthy();
    // The league's own figure, not the match-stats 60% — the fixtures
    // disagree precisely so this line can tell them apart.
    expect(screen.getByText("55.5%")).toBeTruthy();
  });

  it("falls back to unranked match stats when there is no league row", async () => {
    answerWith({ leagueData: null });
    renderCard();

    expect(await screen.findByText("(unranked)")).toBeTruthy();
    expect(screen.queryByText(/LP$/)).toBeNull();
  });

  it("does not pass a failed league request off as unranked", async () => {
    // The card cannot tell the viewer anything useful here, so the failure has
    // to reach the QueryCache toast -- which only happens if the query ends in
    // `error`. Swallowing it to `null` renders the unranked branch instead.
    failLeagueWith(500);
    const { queryClient } = renderCard();

    await waitFor(() => {
      expect(queryClient.getQueryState(["player-league", "p-1"])?.status).toBe(
        "error",
      );
    });
    expect(screen.queryByText("(unranked)")).toBeNull();
  });

  it("counts games only when there are games to count", async () => {
    renderCard();
    expect(await screen.findByText("Played 25 games")).toBeTruthy();

    cleanup();
    answerWith({ statsData: { ...stats, total_matches: 0 } });
    renderCard();
    expect(await screen.findByText("Gold II")).toBeTruthy();
    expect(screen.queryByText(/Played/)).toBeNull();
  });

  it("asks for ranked-solo stats, not the player's whole match history", () => {
    // The queue filter lives only in this inline queryFn. Dropped, the card
    // blends ARAM and normals into a number labelled as ranked form.
    renderCard();

    const statsCall = validatedGet.mock.calls.find(([, url]) =>
      String(url).endsWith("/stats"),
    );
    expect(statsCall?.[1]).toBe("/matches/player/p-1/stats");
    expect(statsCall?.[2]).toEqual({ queues: "420" });
  });
});

describe("the freshness line", () => {
  it("reads Updated only when every sync has completed", async () => {
    renderCard();
    expect(await screen.findByText("Updated 3 hours ago")).toBeTruthy();
  });

  it("says so when any of the three syncs has never run", () => {
    // The label is fed by the *oldest complete* of profile, league and match
    // sync. Dropping one from that list makes a player whose matches never
    // synced claim to be up to date — the lie the label exists to prevent.
    renderCard(player({ match_synced_at: null }));

    expect(screen.getByText("Not fully synced yet")).toBeTruthy();
  });
});

describe("the profile icon", () => {
  it("tries the versioned icon first and falls back to icon 29 when it 404s", () => {
    renderCard();

    expect(profileIcon().src).toContain("/img/profileicon/123.png");
    fireEvent.error(profileIcon());
    expect(profileIcon().src).toContain("/img/profileicon/29.png");
  });

  it("retries the real icon when the player changes theirs", () => {
    // The failure is remembered per puuid+icon, not forever. A player who
    // picks a new icon after ours 404'd gets the new icon tried, not the
    // fallback carried over.
    const view = renderCard();
    fireEvent.error(profileIcon());
    expect(profileIcon().src).toContain("/29.png");

    view.rerender(<PlayerCard player={player({ profile_icon_id: 456 })} />);
    expect(profileIcon().src).toContain("/img/profileicon/456.png");
  });
});

describe("the update button", () => {
  it("starts a sync and hands completion to the page's refresh", () => {
    const onRefreshAll = vi.fn();
    renderCard(player(), onRefreshAll);

    fireEvent.click(screen.getByRole("button", { name: /Update/ }));
    expect(startSync).toHaveBeenCalledTimes(1);

    // The card does not refetch anything itself; the page-wide refresh it was
    // given must ride the sync's completion or the button updates nothing.
    expect(usePlayerSyncRun).toHaveBeenCalledWith("p-1", {
      onCompleted: onRefreshAll,
    });
  });

  it("cannot be pressed again while the sync is running", () => {
    usePlayerSyncRun.mockReturnValue({ isUpdating: true, startSync });
    renderCard();

    const button = screen.getByRole("button", {
      name: /Update/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
