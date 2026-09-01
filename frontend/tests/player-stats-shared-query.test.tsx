// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

type UsePlayerSyncRun =
  typeof import("@/features/players/components/use-player-sync-run").usePlayerSyncRun;

const { usePlayerSyncRun } = vi.hoisted(() => ({
  usePlayerSyncRun: vi.fn<UsePlayerSyncRun>(),
}));

vi.mock("@/features/players/components/use-player-sync-run", () => ({
  usePlayerSyncRun,
}));

vi.mock("@/features/players/components/track-player-button", () => ({
  TrackPlayerButton: () => <span>Track</span>,
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // oxlint-disable-next-line next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import { PlayerCard } from "@/features/players/components/player-card";
import { RecentPerformanceCard } from "@/features/profile/components/recent-performance-card";
import type { Player } from "@/lib/core/schemas";
import { renderWithQueryClient } from "./support/render-support";

const PUUID = "p-1";

const stats = {
  puuid: PUUID,
  total_matches: 40,
  wins: 22,
  losses: 18,
  win_rate: 0.55,
  avg_kills: 6,
  avg_deaths: 4,
  avg_assists: 8,
  avg_kda: 3.5,
  avg_cs: 180,
  avg_vision_score: 20,
};

const player: Player = {
  puuid: PUUID,
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
};

/** The query string of every ranked-aggregate request that reached the API. */
const statsRequests: Record<string, string>[] = [];

beforeEach(() => {
  statsRequests.length = 0;
  server.use(
    http.get(apiRoute(`/matches/player/${PUUID}/stats`), ({ request }) => {
      statsRequests.push(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      return HttpResponse.json(stats);
    }),
  );
  usePlayerSyncRun.mockReturnValue({
    isUpdating: false,
    isFetchingMatches: false,
    startSync: vi.fn<ReturnType<UsePlayerSyncRun>["startSync"]>(),
  });
});

afterEach(cleanup);

it("asks for one player's ranked aggregate once per page, not once per card", async () => {
  // Both cards mount on /player-overview, so two query keys for the
  // byte-identical request means every visit fetches the aggregate twice.
  const { queryClient } = renderWithQueryClient(
    <>
      <PlayerCard player={player} />
      <RecentPerformanceCard puuid={PUUID} lastUpdated={null} />
    </>,
  );

  await waitFor(() => expect(statsRequests.length).toBeGreaterThanOrEqual(2));

  const unlimited = statsRequests.filter((query) => !("limit" in query));

  expect(unlimited).toHaveLength(1);
  queryClient.clear();
});
