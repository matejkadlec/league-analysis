// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { validatedGet, usePlayerSyncRun } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
  usePlayerSyncRun: vi.fn(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
}));

vi.mock("@/features/players/use-player-sync-run", () => ({
  usePlayerSyncRun,
}));

vi.mock("@/features/players/components/track-player-button", () => ({
  TrackPlayerButton: () => <span>Track</span>,
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import { PlayerCard } from "@/features/players/components/player-card";
import { RecentPerformanceCard } from "@/features/profile/components/recent-performance-card";
import type { Player } from "@/lib/core/schemas";
import { renderWithQueryClient } from "./render-support";

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

beforeEach(() => {
  validatedGet.mockReset();
  validatedGet.mockResolvedValue({ success: true, data: stats });
  usePlayerSyncRun.mockReturnValue({ isUpdating: false, startSync: vi.fn() });
});

afterEach(cleanup);

it("asks for one player's ranked aggregate once per page, not once per card", async () => {
  // Both cards mount on /player-overview. They used to hold two query keys
  // for the byte-identical request, so every visit fetched the same
  // aggregate twice.
  const { queryClient } = renderWithQueryClient(
    <>
      <PlayerCard player={player} />
      <RecentPerformanceCard puuid={PUUID} lastUpdated={null} />
    </>,
  );

  await waitFor(() =>
    expect(validatedGet.mock.calls.length).toBeGreaterThanOrEqual(2),
  );

  const unlimited = validatedGet.mock.calls.filter(
    (call: unknown[]) =>
      typeof call[1] === "string" &&
      call[1].endsWith(`/${PUUID}/stats`) &&
      (call[2] as { limit?: number } | undefined)?.limit === undefined,
  );

  expect(unlimited).toHaveLength(1);
  queryClient.clear();
});
