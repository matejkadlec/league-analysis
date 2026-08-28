// @vitest-environment jsdom

import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MatchmakingApi = typeof import("@/features/matchmaking/matchmaking-api");
type AppToast = typeof import("@/lib/core/hooks").appToast;

const { getMatchmakingAnalysisHistory, deleteMatchmakingAnalysisRecord, toast } =
  vi.hoisted(() => ({
    getMatchmakingAnalysisHistory:
      vi.fn<MatchmakingApi["getMatchmakingAnalysisHistory"]>(),
    deleteMatchmakingAnalysisRecord:
      vi.fn<MatchmakingApi["deleteMatchmakingAnalysisRecord"]>(),
    toast: {
      success: vi.fn<AppToast["success"]>(),
      error: vi.fn<AppToast["error"]>(),
      warning: vi.fn<AppToast["warning"]>(),
      info: vi.fn<AppToast["info"]>(),
    },
  }));

vi.mock("@/features/matchmaking/matchmaking-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/matchmaking/matchmaking-api")
  >()),
  getMatchmakingAnalysisHistory,
  deleteMatchmakingAnalysisRecord,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => toast,
}));

import { MatchmakingAnalysisHistory } from "@/features/matchmaking/components/matchmaking-analysis-history";
import { appToast } from "@/lib/core/hooks";
import { createProvidersQueryClient } from "@/components/providers";
import { renderWithQueryClient } from "./support/render-support";

const PUUID = "puuid-under-test";

/**
 * Timestamps are written without a zone on purpose: `formatDateTime` reads
 * them back with `getHours()`, so a `Z`-suffixed fixture would render one
 * clock on a Prague laptop and another in the UTC gate container.
 */
const AHEAD = {
  created_at: "2026-03-04T14:07:00",
  team_avg_winrate: 0.523,
  enemy_avg_winrate: 0.491,
  gap: 0.032,
  params: { match_count: 10, end_date: null },
};

const BEHIND = {
  created_at: "2026-03-03T00:05:00",
  team_avg_winrate: 0.474,
  enemy_avg_winrate: 0.512,
  gap: -0.038,
  params: { match_count: 30, end_date: "2026-02-01" },
};

function answerWith(items: (typeof AHEAD | typeof BEHIND)[]) {
  getMatchmakingAnalysisHistory.mockResolvedValue({
    success: true,
    data: { items },
  });
}

const select = vi.fn<(createdAt: string | null) => void>();

function renderHistory(selectedCreatedAt: string | null = null) {
  return renderWithQueryClient(
    <MatchmakingAnalysisHistory
      puuid={PUUID}
      analyzedPlayerLabel="Sett#EUN"
      selectedCreatedAt={selectedCreatedAt}
      onSelect={select}
    />,
  ).queryClient;
}

/**
 * The table half of the card. Both layouts render in jsdom -- the stacked
 * blocks are hidden by a Tailwind breakpoint no stylesheet applies here -- so
 * every figure is on screen twice and the queries have to say which copy.
 */
async function table() {
  return within(await screen.findByRole("table"));
}

describe("the matchmaking analysis history card", () => {
  beforeEach(() => {
    getMatchmakingAnalysisHistory.mockReset();
    deleteMatchmakingAnalysisRecord.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
    select.mockReset();
    answerWith([AHEAD, BEHIND]);
  });

  afterEach(() => {
    cleanup();
  });

  it("labels each run's Type from its own params", async () => {
    // The backdated day renders in UTC: parsed without the Z suffix it would
    // shift to Jan 31 west of Greenwich and read "through" the wrong day.
    renderHistory();
    const rows = await table();
    expect(rows.getByText("10 · latest")).toBeTruthy();
    expect(rows.getByText("30 · through Feb 1, 2026")).toBeTruthy();
  });

  it("reads a player with no analyses as empty, not as a failure", async () => {
    // A player's first visit is a 404, and letting it through turns the
    // ordinary empty state into "could not be loaded". Rendered on the real
    // provider client: what separates the branches is `queryCache.onError`.
    getMatchmakingAnalysisHistory.mockResolvedValue({
      success: false,
      error: {
        status: 404,
        kind: "not-found",
        message: "The requested item could not be found.",
      },
    });
    const announce = vi.spyOn(appToast, "toast").mockImplementation(() => "");
    const queryClient = createProvidersQueryClient();
    queryClient.setDefaultOptions({ queries: { retry: false } });

    render(
      <QueryClientProvider client={queryClient}>
        <MatchmakingAnalysisHistory
          puuid={PUUID}
          analyzedPlayerLabel="Sett#EUN"
          selectedCreatedAt={null}
          onSelect={select}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(
        "No completed analyses are available for this player yet.",
      ),
    ).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();

    announce.mockRestore();
    queryClient.clear();
  });

  it("says the history could not be loaded when it could not be", async () => {
    getMatchmakingAnalysisHistory.mockResolvedValue({
      success: false,
      error: {
        status: 500,
        kind: "service",
        message:
          "The League Analysis service could not complete the request. Please try again later.",
      },
    });
    const queryClient = renderHistory();

    expect(
      await screen.findByText("Analysis history could not be loaded."),
    ).toBeTruthy();

    queryClient.clear();
  });

  it("colours each win rate by which side the gap favoured", async () => {
    // The gap is printed as an absolute value, so the colour is the only thing
    // on screen saying which team it favoured -- swap the comparison and the card
    // tells someone their team was outmatched in the game it was stronger in.
    const queryClient = renderHistory();

    const rows = await table();
    expect(rows.getByText("52.3%").className).toContain("text-green-400");
    expect(rows.getByText("49.1%").className).toContain("text-red-400");

    // The losing side of the same card, and the sign that is not printed.
    expect(rows.getByText("47.4%").className).toContain("text-red-400");
    expect(rows.getByText("51.2%").className).toContain("text-green-400");
    expect(rows.getByText("3.8%")).toBeTruthy();
    expect(rows.queryByText("-3.8%")).toBeNull();

    queryClient.clear();
  });

  it("reads midnight as 12 AM rather than 0 AM", async () => {
    const queryClient = renderHistory();

    const rows = await table();
    expect(rows.getByText("3.3.2026 12:05 AM")).toBeTruthy();
    expect(rows.getByText("4.3.2026 2:07 PM")).toBeTruthy();

    queryClient.clear();
  });

  it("reloads both sibling panels after a record is deleted", async () => {
    // The results panel beside this card is a separate query keyed on the
    // same player. Nothing else invalidates it, so without this the analysis
    // someone just deleted stays on screen as the current result.
    deleteMatchmakingAnalysisRecord.mockResolvedValue({
      success: true,
      data: { message: "deleted" },
    });
    let resultsRuns = 0;
    let analysisRuns = 0;
    // Numbered answers, so each panel's rendered text says which fetch it is
    // showing rather than only how many went out.
    const resultsQuery = vi.fn<() => Promise<string>>(async () => {
      resultsRuns += 1;
      return `results ${resultsRuns}`;
    });
    const analysisQuery = vi.fn<() => Promise<string>>(async () => {
      analysisRuns += 1;
      return `analysis ${analysisRuns}`;
    });
    function Probe({
      queryKey,
      queryFn,
    }: {
      queryKey: [string, string];
      queryFn: () => Promise<string>;
    }) {
      // Stands in for a sibling panel: same key, and deliberately never
      // stale on its own, so a refetch can only come from the invalidation.
      const { data } = useQuery({ queryKey, queryFn, staleTime: Infinity });
      return <span>{data}</span>;
    }

    const { queryClient } = renderWithQueryClient(
      <>
        <MatchmakingAnalysisHistory
          puuid={PUUID}
          analyzedPlayerLabel="Sett#EUN"
          selectedCreatedAt={null}
          onSelect={select}
        />
        <Probe
          queryKey={["matchmaking-analysis-results", PUUID]}
          queryFn={resultsQuery}
        />
        <Probe
          queryKey={["matchmaking-analysis", PUUID]}
          queryFn={analysisQuery}
        />
      </>,
    );

    await waitFor(() => expect(resultsQuery).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(analysisQuery).toHaveBeenCalledTimes(1));
    const remove = (await table()).getAllByTitle("Delete this analysis");
    fireEvent.click(remove[0]!);

    // The click starts a 300ms fade before the request goes out.
    await waitFor(
      () =>
        expect(deleteMatchmakingAnalysisRecord).toHaveBeenCalledWith(
          PUUID,
          AHEAD.created_at,
        ),
      { timeout: 2000 },
    );
    await waitFor(() => expect(resultsQuery).toHaveBeenCalledTimes(2));
    // The card above the table reads this key. Without it, deleting the run
    // it is showing leaves it offering "Run New Analysis" for a record that
    // no longer exists.
    await waitFor(() => expect(analysisQuery).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("results 2")).toBeTruthy();
    expect(await screen.findByText("analysis 2")).toBeTruthy();

    queryClient.clear();
  });

  it("says so when a delete did not happen", async () => {
    // The row fades out the moment the button is clicked and comes back when
    // the request fails. Without the message that is all the viewer sees: a
    // row that flickered and stayed, with no sign the delete was refused.
    deleteMatchmakingAnalysisRecord.mockResolvedValue({
      success: false,
      error: {
        status: 500,
        kind: "service",
        message:
          "The League Analysis service could not complete the request. Please try again later.",
      },
    });
    const queryClient = renderHistory();

    const rows = await table();
    fireEvent.click(rows.getAllByTitle("Delete this analysis")[0]!);

    await waitFor(() => expect(toast.error).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(rows.getByText("4.3.2026 2:07 PM")).toBeTruthy();

    queryClient.clear();
  });
  it("hands the picked run's timestamp to the result card", async () => {
    // The row is the only way into an older analysis. Send the wrong
    // timestamp and the card opposite shows a run nobody asked for.
    const queryClient = renderHistory();

    const rows = await table();
    const older = rows.getByText("3.3.2026 12:05 AM");
    fireEvent.click(older);

    expect(older.getAttribute("title")).toBe(
      "Show this analysis in the result card",
    );
    expect([...new Set(select.mock.calls.flat())]).toEqual([
      BEHIND.created_at,
    ]);
    queryClient.clear();
  });

  it("marks the picked row apart from the rest", async () => {
    const queryClient = renderHistory(BEHIND.created_at);

    const rows = await table();
    const picked = rows.getByText("3.3.2026 12:05 AM");
    expect(picked.getAttribute("aria-current")).toBe("true");
    expect(
      rows.getByText("4.3.2026 2:07 PM").getAttribute("aria-current"),
    ).toBeNull();
    queryClient.clear();
  });

  it("deletes a row without also opening it", async () => {
    // The delete button sits inside the row that selects on click. Without
    // stopping that bubble, removing a record displays it on the way out.
    deleteMatchmakingAnalysisRecord.mockResolvedValue({
      success: true,
      data: { message: "deleted" },
    });
    const queryClient = renderHistory();

    const rows = await table();
    fireEvent.click(rows.getAllByTitle("Delete this analysis")[0]!);

    await waitFor(
      () => expect(deleteMatchmakingAnalysisRecord).toHaveBeenCalled(),
      { timeout: 2000 },
    );
    expect(deleteMatchmakingAnalysisRecord.mock.calls[0]).toEqual([
      PUUID,
      AHEAD.created_at,
    ]);
    expect(select.mock.calls).toEqual([]);
    queryClient.clear();
  });

  it("lets go of the picked run once it is deleted", async () => {
    // The result card asks for the picked run by timestamp; leaving a deleted
    // one selected leaves that card reporting a 404 forever.
    deleteMatchmakingAnalysisRecord.mockResolvedValue({
      success: true,
      data: { message: "deleted" },
    });
    const queryClient = renderHistory(AHEAD.created_at);

    const rows = await table();
    fireEvent.click(rows.getAllByTitle("Delete this analysis")[0]!);

    await waitFor(() => expect(toast.success).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(select.mock.calls).toEqual([[null]]);
    queryClient.clear();
  });
});
