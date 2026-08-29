// @vitest-environment jsdom

import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithQueryClient } from "./support/render-support";
import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

import { RecentPerformanceCard } from "@/features/profile/components/recent-performance-card";

const PUUID = "puuid-under-test";

type Stats = {
  total_matches: number;
  win_rate: number;
  avg_kills: number;
  avg_deaths: number;
  avg_assists: number;
  avg_kda: number;
  avg_cs: number;
  avg_vision_score: number;
};

/** A season's worth of games, and the baseline every trend is read against. */
const OVERALL: Stats = {
  total_matches: 200,
  win_rate: 0.5,
  avg_kills: 6,
  avg_deaths: 6,
  avg_assists: 8,
  avg_kda: 2.5,
  avg_cs: 180,
  avg_vision_score: 20,
};

/**
 * The last ten games of a player who is doing better: winning more, dying
 * less, everything else up. Each figure is far enough from its baseline to
 * clear the 5% band on both sides.
 */
const IMPROVED: Stats = {
  total_matches: 10,
  win_rate: 0.7,
  avg_kills: 9,
  avg_deaths: 3,
  avg_assists: 12,
  avg_kda: 5,
  avg_cs: 220,
  avg_vision_score: 30,
};

/** The query string of every stats request the card actually put on the wire. */
const requests: Record<string, string>[] = [];

/**
 * Answers the card's two requests by the query they carry: the one with a
 * `limit` is the recent window, the one without is the whole history.
 */
function respondWith(recent: Stats, overall: Stats) {
  server.use(
    http.get(apiRoute("/matches/player/:puuid/stats"), ({ request, params }) => {
      const query = new URL(request.url).searchParams;
      requests.push(Object.fromEntries(query));
      return HttpResponse.json({
        puuid: params.puuid,
        wins: 0,
        losses: 0,
        ...(query.has("limit") ? recent : overall),
      });
    }),
  );
}

function renderCard() {
  const { queryClient } = renderWithQueryClient(
    <RecentPerformanceCard puuid={PUUID} />,
  );
  return queryClient;
}

/** The verdict word beside one labelled stat. */
function verdictFor(label: string): string {
  const heading = screen.getByText(label);
  const block = heading.parentElement as HTMLElement;
  return within(block)
    .getByText(/improving|declining|stable/)
    .textContent!.trim();
}

describe("the recent performance card", () => {
  beforeEach(() => {
    requests.length = 0;
    respondWith(IMPROVED, OVERALL);
  });

  it("reads fewer deaths as improvement, not decline", async () => {
    // Deaths are the one stat on this card where down is good, and the only call
    // passing `higherIsBetter: false`. Lose it and the card tells a player who
    // halved their deaths that they are declining -- backwards, not just missing.
    const queryClient = renderCard();

    await waitFor(() => expect(verdictFor("Avg Deaths")).toBe("improving"));

    queryClient.clear();
  });

  it("reads every other stat the other way round", async () => {
    // The mirror of the case above: with the same fixture, kills, assists,
    // CS, vision, KDA and win rate all went up and all must read as
    // improvement, which a blanket `higherIsBetter: false` would not give.
    const queryClient = renderCard();

    await waitFor(() => expect(verdictFor("Win Rate")).toBe("improving"));
    for (const label of [
      "KDA",
      "Avg Kills",
      "Avg Assists",
      "Avg CS",
      "Avg Vision",
    ]) {
      expect(verdictFor(label)).toBe("improving");
    }

    queryClient.clear();
  });

  it("compares the last ten games against the whole history", async () => {
    // The card's entire claim is a comparison, and the only thing making the
    // two requests different is the `limit` on one of them. Drop it and every
    // stat reads "stable" forever, with nothing on screen looking broken.
    const queryClient = renderCard();

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests).toContainEqual({ queues: "420", limit: "10" });
    expect(requests).toContainEqual({ queues: "420" });

    queryClient.clear();
  });

  it("calls a small wobble stable rather than a trend", async () => {
    // Ten games is a small sample and the numbers move on their own. The
    // bands exist so the card does not announce a direction every time
    // someone plays an evening.
    respondWith(
      {
        ...OVERALL,
        total_matches: 10,
        win_rate: 0.52,
        avg_kills: 6.2,
        avg_deaths: 5.9,
        avg_assists: 8.2,
        avg_kda: 2.55,
        avg_cs: 185,
        avg_vision_score: 20.5,
      },
      OVERALL,
    );
    const queryClient = renderCard();

    await waitFor(() => expect(verdictFor("Win Rate")).toBe("stable"));
    for (const label of [
      "KDA",
      "Avg Kills",
      "Avg Deaths",
      "Avg Assists",
      "Avg CS",
      "Avg Vision",
    ]) {
      expect(verdictFor(label)).toBe("stable");
    }

    queryClient.clear();
  });

  it("scales the band to the stat rather than using one number for all of them", async () => {
    // CS is counted in the hundreds and win rate in fractions of one, so a fixed
    // threshold cannot serve both. Four CS up on an average of 180 is inside the
    // 5% band; a fixed 0.05 would call it a trend.
    respondWith({ ...OVERALL, total_matches: 10, avg_cs: 184 }, OVERALL);
    const queryClient = renderCard();

    await waitFor(() => expect(verdictFor("Avg CS")).toBe("stable"));

    queryClient.clear();
  });

  it("says there is not enough data instead of a card full of zeros", async () => {
    // A player whose ranked history is empty gets stats back, all of them
    // zero. Without the `total_matches` check the card renders in full: six
    // "stable" verdicts and a badge announcing a comparison with 0 games.
    const empty: Stats = {
      total_matches: 0,
      win_rate: 0,
      avg_kills: 0,
      avg_deaths: 0,
      avg_assists: 0,
      avg_kda: 0,
      avg_cs: 0,
      avg_vision_score: 0,
    };
    respondWith(empty, empty);
    const queryClient = renderCard();

    expect(
      await screen.findByText(
        "Not enough match data to analyze performance trends.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Win Rate")).toBeNull();

    queryClient.clear();
  });
});
