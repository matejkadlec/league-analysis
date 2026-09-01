// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChampionStatsCard } from "@/features/profile/components/champion-stats-card";
import type {
  ChampionStatsItem,
  ChampionStatsResponse,
} from "@/lib/core/schemas";

function champion(
  name: string,
  overrides: Partial<ChampionStatsItem> = {},
): ChampionStatsItem {
  return {
    champion_name: name,
    champion_id: 1,
    games_played: 10,
    wins: 5,
    losses: 5,
    win_rate: 0.5,
    avg_kills: 5,
    avg_deaths: 5,
    avg_assists: 5,
    avg_kda: 2,
    ...overrides,
  };
}

/** Twelve champions, so there are three pages of five. */
function twelve(prefix = "Champ"): ChampionStatsItem[] {
  return Array.from({ length: 12 }, (_, index) =>
    champion(`${prefix}${index + 1}`),
  );
}

function renderCard(
  champions: ChampionStatsItem[],
  dataSourceKey = "puuid:queue:420",
) {
  const stats: ChampionStatsResponse = {
    puuid: "puuid",
    total_champions: champions.length,
    champions,
  };
  return render(
    <ChampionStatsCard stats={stats} dataSourceKey={dataSourceKey} />,
  );
}

const next = () => screen.getByLabelText("Next champions");
const previous = () => screen.getByLabelText("Previous champions");
const isDisabled = (button: HTMLElement) =>
  (button as HTMLButtonElement).disabled;

/** The rank number rendered to the left of each champion on screen. */
function visibleRanks(container: HTMLElement): string[] {
  return [...container.querySelectorAll("span.w-4")].map(
    (rank) => rank.textContent ?? "",
  );
}


describe("the top champions card", () => {
  it("returns to the first page when the data behind it changes", async () => {
    // Page number is component state, not remounted on player change, hence
    // `dataSourceKey`. The second list must be longer than the page reached.
    const user = userEvent.setup();
    const { container, rerender } = renderCard(twelve(), "player-a");

    await user.click(next());
    await user.click(next());
    expect(visibleRanks(container)).toEqual(["11", "12"]);

    const twenty = Array.from({ length: 20 }, (_, index) =>
      champion(`Other${index + 1}`),
    );
    rerender(
      <ChampionStatsCard
        stats={{ puuid: "puuid", total_champions: 20, champions: twenty }}
        dataSourceKey="player-b"
      />,
    );

    expect(visibleRanks(container)).toEqual(["1", "2", "3", "4", "5"]);
    expect(screen.getByRole("status").textContent).toContain("1–5 of 20");
  });

  it("numbers champions by their place in the whole list, not on the page", async () => {
    // Restarting the rank per page opens the second page with another "1",
    // which reads as the best champion twice.
    const user = userEvent.setup();
    const { container } = renderCard(twelve());

    await user.click(next());

    expect(visibleRanks(container)).toEqual(["6", "7", "8", "9", "10"]);
  });

  it("stops at both ends", async () => {
    // Both buttons stay in the layout and only change state, so a wrong
    // comparison is invisible until someone clicks past the end.
    const user = userEvent.setup();
    renderCard(twelve());

    expect(isDisabled(previous())).toBe(true);
    expect(isDisabled(next())).toBe(false);

    await user.click(next());
    expect(isDisabled(previous())).toBe(false);
    expect(isDisabled(next())).toBe(false);

    await user.click(next());
    expect(isDisabled(next())).toBe(true);
  });

  it("counts the page it is showing out of the whole list", async () => {
    // `startIndex` is zero-based and the label is not, and the last page is
    // short. Both are places to be off by one in front of the reader.
    const user = userEvent.setup();
    renderCard(twelve());
    expect(screen.getByRole("status").textContent).toContain("1–5 of 12");

    await user.click(next());
    await user.click(next());
    expect(screen.getByRole("status").textContent).toContain("11–12 of 12");
  });

  it("colours a KDA by the thresholds it claims", () => {
    // Each band needs a value just under its threshold, or a threshold moved
    // into the gap between two bands still passes.
    const { container } = renderCard([
      champion("Green", { avg_kda: 3 }),
      champion("JustUnderGreen", { avg_kda: 2.99 }),
      champion("Yellow", { avg_kda: 2 }),
      champion("JustUnderYellow", { avg_kda: 1.99 }),
    ]);

    const kdas = [...container.querySelectorAll("span")]
      .filter((span) => /^\d+\.\d\d$/.test(span.textContent ?? ""))
      .map((span) => span.className);

    expect(kdas).toHaveLength(4);
    expect(kdas[0]).toContain("green-500");
    expect(kdas[1]).toContain("yellow-500");
    expect(kdas[2]).toContain("yellow-500");
    expect(kdas[3]).toContain("rose-500");
  });

  it("says so rather than drawing an empty card when there are no champions", () => {
    renderCard([]);

    expect(
      screen.getByText(/Not enough match data to analyze champion performance/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Next champions")).toBeNull();
  });
});
