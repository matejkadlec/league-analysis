// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoleStatsCard } from "@/features/profile/components/role-stats-card";
import type { LaneStatsItem, LaneStatsResponse } from "@/lib/core/schemas";

/** The display names the backend actually sends, read from its own map. */
function backendLaneNames(): string[] {
  const source = readFileSync(
    join(process.cwd(), "../backend/app/features/matches/match_stats.py"),
    "utf8",
  );
  const map = /LANE_DISPLAY_NAMES: dict\[str, str\] = \{([^}]*)\}/.exec(source);
  if (!map) throw new Error("LANE_DISPLAY_NAMES not found in match_stats.py");
  return [...(map[1] ?? "").matchAll(/:\s*"([^"]+)"/g)].map(
    (entry) => entry[1] ?? "",
  );
}

function lane(name: string, overrides: Partial<LaneStatsItem> = {}) {
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
    // The card's lookup ends in `|| position-middle.svg`, so a rename draws the
    // mid icon under alt text that still reads "Support". Distinctness catches
    // that; "not the fallback" cannot, Mid's own icon being it.
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

  it("colours the win rate figure and the bar under it the same way", () => {
    // Two separate functions carry the same three thresholds, and the two
    // things they colour sit one above the other. A threshold that drifts in one
    // shows a rate in green over a bar in yellow, which reads as a fault.
    const hue = (className: string) =>
      /(green|yellow|rose)-500/.exec(className)?.[1];

    // 51 and 49 are the boundaries themselves: 51.0 is green, 49.0 is not
    // yellow but rose, and only the open interval between them is yellow.
    for (const winRate of [0.0, 0.489, 0.49, 0.495, 0.51, 0.6, 1.0]) {
      const { container } = renderCard([lane("Top", { win_rate: winRate })]);

      const figure = container.querySelector("p.font-bold");
      const bar = container.querySelector<HTMLElement>("[style*='width']");

      expect(
        hue(figure?.className ?? ""),
        `figure at ${winRate}`,
      ).toBeDefined();
      expect(hue(bar?.className ?? ""), `bar at ${winRate}`).toBe(
        hue(figure?.className ?? ""),
      );
      cleanup();
    }
  });

  it("does not size the bar to NaN when no lane has been played", () => {
    // Without the `totalGames > 0` guard the division is 0/0, and the browser
    // drops `width: NaN%` -- a full-width bar saying the player mains every role
    // equally. The count is asserted first so an empty loop cannot pass.
    const { container } = renderCard([
      lane("Top", { games_played: 0, wins: 0, losses: 0 }),
      lane("Mid", { games_played: 0, wins: 0, losses: 0 }),
    ]);

    const bars = container.querySelectorAll<HTMLElement>("[style*='width']");
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
