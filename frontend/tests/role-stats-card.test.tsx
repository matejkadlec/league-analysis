// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoleStatsCard } from "@/features/profile/components/role-stats-card";
import type {
  LaneDisplayName,
  LaneStatsItem,
  LaneStatsResponse,
} from "@/lib/core/schemas";

/** The display names the backend actually sends, read from its own map. */
function backendLaneNames(): LaneDisplayName[] {
  const source = readFileSync(
    join(process.cwd(), "../backend/app/features/matches/match_stats.py"),
    "utf8",
  );
  const map = /LANE_DISPLAY_NAMES: dict\[[^\]]+\] = \{([^}]*)\}/.exec(source);
  if (!map) throw new Error("LANE_DISPLAY_NAMES not found in match_stats.py");
  return [...(map[1] ?? "").matchAll(/:\s*"([^"]+)"/g)].map(
    (entry) => entry[1] as LaneDisplayName,
  );
}

function lane(name: LaneDisplayName, overrides: Partial<LaneStatsItem> = {}) {
  return {
    lane: name,
    games_played: 10,
    wins: 5,
    losses: 5,
    win_rate: 0.5,
    avg_kills: 5,
    avg_deaths: 5,
    avg_assists: 5,
    avg_kda: 2,
    ...overrides,
  } satisfies LaneStatsItem;
}

function renderCard(lanes: LaneStatsItem[]) {
  const stats: LaneStatsResponse = {
    puuid: "puuid",
    total_lanes: lanes.length,
    lanes,
  };
  return render(<RoleStatsCard stats={stats} />);
}

function iconSources(): string[] {
  return screen
    .getAllByRole("img")
    .map((image) => image.getAttribute("src") ?? "");
}


describe("the role performance card", () => {
  it("gives every lane the backend can send its own icon", () => {
    // The lookup ends in `|| position-middle.svg`, so distinctness is the only
    // check that catches a rename: Mid's own icon is the fallback.
    const names = backendLaneNames();
    expect(names.length).toBeGreaterThan(1);

    renderCard(names.map((name) => lane(name)));
    const sources = iconSources();

    expect(sources).toHaveLength(names.length);
    expect(new Set(sources).size).toBe(names.length);
  });

  it("points every icon at a file that is actually there", () => {
    // `next/image` renders a broken image rather than failing the build, and
    // nothing else in the gate opens `public/`. A renamed asset ships.
    renderCard(backendLaneNames().map((name) => lane(name)));

    for (const source of iconSources()) {
      expect(
        existsSync(join(process.cwd(), "public", source)),
        `missing asset: ${source}`,
      ).toBe(true);
    }
  });

  it("does not size the bar to NaN when no lane has been played", () => {
    // Without the `totalGames > 0` guard the division is 0/0 and the browser
    // drops `width: NaN%`, leaving a full-width bar for every role.
    const { container } = renderCard([
      lane("Top", { games_played: 0, wins: 0, losses: 0 }),
      lane("Mid", { games_played: 0, wins: 0, losses: 0 }),
    ]);

    const bars = container.querySelectorAll<HTMLElement>("[style*='width']");
    // Asserted first so an empty `bars` cannot pass the loop below vacuously.
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar.style.width).toBe("0%");
    }
  });

  it("says so rather than drawing an empty card when there are no lanes", () => {
    renderCard([]);

    expect(
      screen.getByText(/Not enough match data to analyze role performance/),
    ).toBeTruthy();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("counts a single game in the singular", () => {
    renderCard([lane("Top", { games_played: 1, wins: 1, losses: 0 })]);

    expect(screen.getByText("(1 game)")).toBeTruthy();
  });
});
