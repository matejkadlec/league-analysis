// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SmurfBoostAnalysisResponseSchema,
  type SmurfBoostAnalysisResponse,
} from "@/lib/core/schemas";

type Api = typeof import("@/lib/core/http/api");
type SmurfBoostApi = typeof import("@/features/smurf-boost/smurf-boost-api");
type Toast = typeof import("sonner").toast;

const {
  getLatestSmurfBoostDetection,
  startSmurfBoostDetection,
  toast,
  validatedGet,
  validatedPost,
} = vi.hoisted(() => ({
  getLatestSmurfBoostDetection:
    vi.fn<SmurfBoostApi["getLatestSmurfBoostDetection"]>(),
  startSmurfBoostDetection: vi.fn<SmurfBoostApi["startSmurfBoostDetection"]>(),
  toast: {
    error: vi.fn<Toast["error"]>(),
    info: vi.fn<Toast["info"]>(),
    success: vi.fn<Toast["success"]>(),
    warning: vi.fn<Toast["warning"]>(),
  },
  validatedGet: vi.fn<Api["validatedGet"]>(),
  validatedPost: vi.fn<Api["validatedPost"]>(),
}));

vi.mock("@/features/smurf-boost/smurf-boost-api", () => ({
  getLatestSmurfBoostDetection,
  startSmurfBoostDetection,
}));

// The run button fetches this player's games before comparing them, so the
// player-sync transport is part of this card's behaviour now.
vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
  validatedPost,
}));

vi.mock("sonner", () => ({ toast }));

import { SmurfBoostDetection } from "../features/smurf-boost/components/smurf-boost-detection";
import {
  BAND_LABELS,
  BAND_MEANINGS,
  CONFIDENCE_LABELS,
  DISCLAIMER,
  FAMILY_DESCRIPTIONS,
  FAMILY_TITLES,
  NOTE_LABELS,
} from "../features/smurf-boost/smurf-boost-vocabulary";

const CONSERVATIVE_THRESHOLDS = {
  recent_window_size: 20,
  baseline_window_size: 60,
};

/** Words the model's result wording forbids in any result. */
const FORBIDDEN = [
  "smurf detected",
  "likely boosted",
  "suspicious",
  "clean",
  "legitimate",
  "verified",
  "confirmed",
  "probability",
];

function signal(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    family: "rapid_improvement",
    available: true,
    triggered: false,
    sample_size: 20,
    reason: `Reason for ${id}.`,
    notes: [],
    raw_value: 0.35,
    threshold: 1.2,
    saturation: 3,
    magnitude: 0,
    weight: 0.3,
    contribution: 0,
    ...overrides,
  };
}

function results(overrides: Record<string, unknown> = {}) {
  return {
    model_version: "smurf-boost/v1",
    confidence: 0.9,
    confidence_band: "high",
    recent_games: 20,
    baseline_games: 60,
    eligible_games: 629,
    notes: ["legacy_game_start_timestamps"],
    disclaimer: DISCLAIMER,
    families: [
      {
        family: "rapid_improvement",
        band: "notable_indicators",
        distinct_evidence: 2,
        signals: [
          signal("A1", { triggered: true, raw_value: 1.4 }),
          signal("A2", { triggered: true, raw_value: 0.3, threshold: 0.2 }),
          signal("A3", {
            available: false,
            raw_value: null,
            threshold: null,
            saturation: null,
            magnitude: null,
            contribution: null,
            sample_size: 0,
            reason: "Only 0 of the recent games were on new champions.",
            notes: ["insufficient_novel_sample"],
          }),
          signal("A4"),
        ],
      },
      {
        family: "playing_pattern_change",
        band: "no_unusual_pattern",
        distinct_evidence: 0,
        signals: [signal("B1", { family: "playing_pattern_change" })],
      },
    ],
    ...overrides,
  };
}

/**
 * A stored run as the wire reports it, parsed through the real schema so the
 * fixture splits on its lifecycle: a literal would claim `results` on failure.
 */
function analysis(
  overrides: Record<string, unknown> = {},
): SmurfBoostAnalysisResponse {
  return SmurfBoostAnalysisResponseSchema.parse({
    puuid: "test-puuid",
    created_at: "2026-08-14T20:00:00.000Z",
    status: "completed",
    model_version: "smurf-boost/v1",
    thresholds: CONSERVATIVE_THRESHOLDS,
    eligible_games: 629,
    latest_match_id: "EUN1_1",
    error_code: null,
    error_message: null,
    completed_at: "2026-08-14T20:00:05.000Z",
    is_stale: false,
    results: results(),
    ...overrides,
  });
}

/** The same run reported with too few games for the model to compare. */
function shortHistory() {
  return analysis({
    eligible_games: 27,
    results: results({
      eligible_games: 27,
      recent_games: 20,
      baseline_games: 7,
      confidence: 0.2,
      confidence_band: "low",
      notes: [],
      families: results().families.map((family) => ({
        ...family,
        band: "not_enough_data",
        distinct_evidence: 0,
        signals: [],
      })),
    }),
  });
}

function renderCard(puuid: string | null = "test-puuid") {
  const { queryClient } = renderWithQueryClient(
    <SmurfBoostDetection
      puuid={puuid}
      playerName="Tested Player#EUW"
      playerSelector={<input aria-label="Choose player for comparison" />}
    />,
  );
  return queryClient;
}

function renderCardWithUnmount(puuid = "test-puuid") {
  const { queryClient, unmount } = renderWithQueryClient(
    <SmurfBoostDetection
      puuid={puuid}
      playerName="Tested Player#EUW"
      playerSelector={<input aria-label="Choose player for comparison" />}
    />,
  );
  return { queryClient, unmount };
}

/** The one measurement layout, scoped so page copy cannot satisfy a query. */
function measurements() {
  const list = document.querySelector(
    "#smurf-boost-result [data-testid^='smurf-boost-measurements-']",
  );
  if (!list) {
    throw new Error("the result card rendered no measurements");
  }
  return within(list.parentElement as HTMLElement);
}

function runButton() {
  return screen.getByRole("button", { name: /Run the comparison/ });
}

const RUN_TIMESTAMPS = {
  created_at: "2026-08-24T10:00:00Z",
  updated_at: "2026-08-24T10:00:00Z",
};

function syncRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    puuid: "test-puuid",
    status: "completed",
    ...RUN_TIMESTAMPS,
    ...overrides,
  };
}

/**
 * Ranked solo games the stats endpoint reports as stored. Mutable so a test can
 * raise it between render and fetch, which is what new games look like here.
 */
let storedRankedGames = 84;

function rankedStats(total: number) {
  return {
    puuid: "test-puuid",
    total_matches: total,
    wins: 44,
    losses: 40,
    win_rate: 0.524,
    avg_kills: 6.1,
    avg_deaths: 5.2,
    avg_assists: 8.4,
    avg_kda: 2.8,
    avg_cs: 178.5,
    avg_vision_score: 21.3,
  };
}

/**
 * Answer the player-sync transport as the backend would for a player with no
 * update in flight: nothing active, and any run this card starts finishes.
 */
function noActiveSync(run: ReturnType<typeof syncRun> = syncRun()) {
  validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
    if (path.endsWith("/stats")) {
      return { success: true, data: rankedStats(storedRankedGames) };
    }
    if (path.endsWith("/sync/active")) {
      return { success: true, data: null };
    }
    return { success: true, data: run };
  });
  validatedPost.mockResolvedValue({
    success: true,
    data: syncRun({ status: "pending" }),
  });
}

describe("SmurfBoostDetection", () => {
  beforeEach(() => {
    getLatestSmurfBoostDetection.mockReset();
    startSmurfBoostDetection.mockReset();
    validatedGet.mockReset();
    validatedPost.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());
    storedRankedGames = 84;
    noActiveSync();
  });

  it("shows both families with their own band and never a number", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    renderCard();

    await waitFor(() =>
      // Each family title appears twice: on its tab and again as its
      // panel's heading.
      expect(screen.getAllByText("Rapid Improvement Pattern").length).toBe(2),
    );
    expect(screen.getAllByText("Playing Pattern Change").length).toBe(2);

    // A family reading is one of the five fixed words: a digit would mean the
    // weighted sum reached the screen. Band elements only; signal rows differ.
    const bands = screen.getAllByTestId(/^smurf-boost-band-/);
    expect(bands.length).toBe(2);
    const labels = Object.values(BAND_LABELS);
    for (const band of bands) {
      expect(labels).toContain(band.textContent);
      expect(band.textContent ?? "").not.toMatch(/\d/);
    }
  });

  it("reports confidence and the model version separately from the result", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    renderCard();

    await waitFor(() =>
      expect(screen.getByText("High confidence")).toBeTruthy(),
    );
    expect(
      screen.getByText(
        "How much this comparison can be relied on, separate from what it found.",
      ),
    ).toBeTruthy();
    // The version identifies the formulas; the module name in front of it is
    // the retired product name, which no reader should meet.
    expect(screen.getByText("Model v1")).toBeTruthy();
    expect(screen.queryByText(/smurf-boost/i)).toBeNull();
  });

  it("shows an unavailable area with its reason rather than hiding it", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    renderCard();

    await waitFor(() => expect(measurements().getByText("A3")).toBeTruthy());

    const layout = measurements();
    expect(layout.getAllByText("Not available").length).toBe(1);
    expect(
      layout.getByText("Only 0 of the recent games were on new champions."),
    ).toBeTruthy();
    expect(
      layout.getByText(
        "Too few recent games were on champions with little stored history.",
      ),
    ).toBeTruthy();
  });

  it("renders the exact mandated disclaimer", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    renderCard();

    await waitFor(() => expect(screen.getByText(DISCLAIMER)).toBeTruthy());
  });

  it("keeps the frontend disclaimer identical to the backend's", () => {
    // Two copies of a string the specification calls fixed can drift and put
    // two different "fixed" statements on one screen; nothing else notices.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "../../backend/app/features/smurf_boost_detection/schemas.py"),
      "utf8",
    );
    const block = /DISCLAIMER = \(\n([\s\S]*?)\n\)/.exec(source);
    expect(block).not.toBeNull();
    const backendText = [...(block?.[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((match) => match[1])
      .join("");
    expect(backendText.length).toBeGreaterThan(100);
    expect(DISCLAIMER).toBe(backendText);
  });

  it("uses no accusatory wording in any user-facing string", () => {
    // Checked against the vocabulary itself, not against one rendered mock,
    // so a forbidden word cannot hide in a label this test never renders.
    const strings = [
      DISCLAIMER,
      ...Object.values(FAMILY_TITLES),
      ...Object.values(FAMILY_DESCRIPTIONS),
      ...Object.values(BAND_LABELS),
      ...Object.values(BAND_MEANINGS),
      ...Object.values(CONFIDENCE_LABELS),
      ...Object.values(NOTE_LABELS),
    ];
    expect(strings.length).toBe(30);
    for (const value of strings) {
      for (const word of FORBIDDEN) {
        expect(value.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("keeps a band per family and the confidence when data is short", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: shortHistory(),
    });
    renderCard();

    await waitFor(() =>
      expect(screen.getAllByText("Not enough data").length).toBe(2),
    );
    expect(screen.getAllByText("Rapid Improvement Pattern").length).toBe(2);
    expect(screen.getAllByText("Playing Pattern Change").length).toBe(2);
    expect(screen.getByText("Low confidence")).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    // 20 recent plus a 15-game baseline floor is 35, not the 25 the two
    // floors alone would suggest.
    expect(
      screen.getAllByText(
        /at least 35 in total, which is 8 more than are stored/,
      ).length,
    ).toBe(2);
  });

  it("never calls a value below a threshold it is above", async () => {
    // A4, B1, B3 and B4 each combine their threshold with a second condition,
    // so a gate can fail while the value sits above the number printed beside.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis({
        results: results({
          families: [
            {
              family: "rapid_improvement",
              band: "no_unusual_pattern",
              distinct_evidence: 0,
              signals: [
                signal("A4", {
                  triggered: false,
                  raw_value: 1.5,
                  threshold: 1.2,
                  reason: "The account level gate was not met.",
                }),
                signal("A1", { triggered: false, raw_value: 0.4 }),
              ],
            },
          ],
        }),
      }),
    });
    renderCard();

    await waitFor(() =>
      expect(measurements().getByText("Other conditions not met")).toBeTruthy(),
    );

    const layout = measurements();
    expect(layout.getAllByText("Other conditions not met").length).toBe(1);
    expect(layout.getAllByText("Below threshold").length).toBe(1);
  });

  it("says what each band means, not only what it is called", async () => {
    // A band name on its own is a finding word. The specification fixes the
    // sentence that keeps "Weak indicators" readable as caution.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    renderCard();

    await waitFor(() =>
      expect(screen.getAllByText(BAND_MEANINGS.notable_indicators).length).toBe(
        1,
      ),
    );
  });

  it("falls back to the run's own recent count when the window is missing", async () => {
    // A row written under an older threshold contract can lack the key. The
    // copy must still state a number rather than "at least NaN in total".
    const short = shortHistory();
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: { ...short, thresholds: { baseline_window_size: 60 } },
    });
    renderCard();

    await waitFor(() =>
      expect(screen.getAllByText(/at least 35 in total/).length).toBe(2),
    );
    expect(document.body.textContent ?? "").not.toContain("NaN");
  });

  it("invents no shortfall for a result with no families", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis({ results: results({ families: [] }) }),
    });
    renderCard();

    await waitFor(() => expect(screen.getByText(DISCLAIMER)).toBeTruthy());
    expect(screen.queryByText(/in total/)).toBeNull();
    expect(screen.queryByText("Not enough data")).toBeNull();
  });

  it("offers a first run when the player has never been analysed", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    expect(screen.queryByText("Comparison Result")).toBeNull();
  });

  it("renders the result returned by a run", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(screen.getByText("Notable indicators")).toBeTruthy(),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("reports a run that the backend recorded as failed", async () => {
    // The backend answers a failed run with HTTP 200 and a stored message, so
    // treating that as a success would announce a result that does not exist.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis({
        status: "failed",
        results: null,
        error_code: "analysis_failed",
        error_message: "The analysis did not finish. Please try again.",
      }),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(
        screen.getByText("The analysis did not finish. Please try again."),
      ).toBeTruthy(),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText("Comparison Result")).toBeNull();
  });

  it("shows a stored failed run instead of an empty page", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis({
        status: "failed",
        results: null,
        error_code: "no_eligible_matches",
        error_message: "This player has no stored ranked solo/duo games.",
      }),
    });
    renderCard();

    await waitFor(() =>
      expect(
        screen.getByText("This player has no stored ranked solo/duo games."),
      ).toBeTruthy(),
    );
  });

  it("reports an attached run as still running, not as complete", async () => {
    // A second viewer running the same thresholds is answered with the run
    // already in flight: HTTP 200, status in_progress, no results.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis({
        status: "in_progress",
        results: null,
        completed_at: null,
      }),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(
        screen.getByText(
          "A comparison for this player is running. The result appears here as soon as it finishes.",
        ),
      ).toBeTruthy(),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    expect(screen.queryByText("Comparison Result")).toBeNull();
  });

  it("reports a conflicting run without exposing transport detail", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: {
        message: "An analysis is already running for this player.",
        kind: "conflict",
        status: 409,
      },
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(
        screen.getByText("An analysis is already running for this player."),
      ).toBeTruthy(),
    );
    expect(toast.error).toHaveBeenCalled();
  });

  it("stores a late response under the player it describes", async () => {
    // A run started for one player must never be rendered under another.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis({ puuid: "other-puuid" }),
    });
    const user = userEvent.setup();
    const queryClient = renderCard("test-puuid");

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(
        queryClient.getQueryData(["smurf-boost-detection", "other-puuid"]),
      ).toBeTruthy(),
    );
    expect(
      queryClient.getQueryData(["smurf-boost-detection", "test-puuid"]),
    ).toBeFalsy();
    expect(screen.queryByText("Comparison Result")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says nothing about a run whose card is already gone", async () => {
    // A run can outlive its card and a mutation's options-level callbacks keep
    // firing after unmount, so a guard on the closure's player still matches.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    // A box rather than a plain `let`: TypeScript narrows a variable assigned
    // only inside a callback to `never`, and then refuses to call it.
    const settle: { resolve: (() => void) | null } = { resolve: null };
    startSmurfBoostDetection.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        settle.resolve = resolve;
      });
      return { success: true, data: analysis({ puuid: "test-puuid" }) };
    });

    const user = userEvent.setup();
    const { queryClient, unmount } = renderCardWithUnmount("test-puuid");

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());
    await waitFor(() => expect(settle.resolve).not.toBeNull());

    unmount();
    settle.resolve?.();

    // The response still reaches the cache, so switching back to this player
    // shows the result -- it is only the announcement that is withheld.
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["smurf-boost-detection", "test-puuid"]),
      ).toBeTruthy(),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("offers no run at all until a player is chosen", async () => {
    // The empty state renders this card rather than a "select a player" one,
    // so the search inside it stays reachable.
    renderCard(null);

    await waitFor(() => expect(runButton()).toBeTruthy());
    expect(runButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Choose player for comparison")).toBeTruthy();
    expect(getLatestSmurfBoostDetection).not.toHaveBeenCalled();
    // `/players//sync/active` is a 404 the global query-error toast would
    // report on every mount of the empty state.
    expect(validatedGet).not.toHaveBeenCalled();
  });

  it("fetches this player's games before comparing them", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    // The point of the change: the comparison reads games fetched now, not
    // whatever the scheduled Match Fetcher last happened to store.
    await waitFor(() => expect(validatedPost).toHaveBeenCalled());
    expect(validatedPost).toHaveBeenCalledWith(
      expect.anything(),
      "/players/test-puuid/sync",
    );
    await waitFor(() => expect(startSmurfBoostDetection).toHaveBeenCalled());
    // Before, not merely also: two calls in either order satisfy a bare "both
    // happened", and comparing in parallel with the fetch reads stale games.
    expect(validatedPost.mock.invocationCallOrder[0]).toBeLessThan(
      startSmurfBoostDetection.mock.invocationCallOrder[0]!,
    );
    // `quiet`: the card says "Fetching games..." on its own button, so the
    // hook's own started/finished pair would be a second copy of it.
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("compares on stored games when the fetch is refused outright", async () => {
    // No run exists behind a refused start, so nothing ever polls terminal --
    // the refusal is the only place the comparison can be released.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    validatedPost.mockResolvedValue({
      success: false,
      error: { message: "Player not found", kind: "not-found", status: 404 },
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(screen.getByText("Notable indicators")).toBeTruthy(),
    );
    // A start that never happened has no run to quote, so the card falls back
    // to its own sentence -- but it still says the games are not fresh.
    expect(screen.getByText(/newest games could not be fetched/)).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("compares on stored games when the fetch does not finish", async () => {
    // A busy or rate-limited update is a reason to compare what is stored,
    // not to leave the click that asked for a comparison with nothing.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    noActiveSync(
      syncRun({
        status: "rate_limited",
        error_code: "RIOT_RATE_LIMITED",
        error_message: "The update reached Riot's rate limit.",
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(screen.getByText("Notable indicators")).toBeTruthy(),
    );
    expect(validatedPost).toHaveBeenCalled();
    // The hook's own warning stays silent: two accounts of one click would
    // contradict each other, and its wording is written for the Player Card.
    expect(toast.warning).not.toHaveBeenCalled();
    // Inline, not a toast that disappears, and in the backend's own words:
    // ours would promise a retry an expired key cannot honour.
    expect(
      screen.getByText(/The update reached Riot's rate limit\./),
    ).toBeTruthy();
    expect(
      screen.getByText(/Only the games already stored are available/),
    ).toBeTruthy();
  });

  it("reports a fetch that failed even when nobody here started it", async () => {
    // The card renders an adopted update and says to run the comparison once
    // it finishes, so silence on failure leaves Run reading stale history.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/sync/active")) {
        return { success: true, data: syncRun({ id: 42, status: "running" }) };
      }
      return {
        success: true,
        data: syncRun({
          id: 42,
          status: "failed",
          error_code: "SYNC_BUSY",
          error_message: "Another data update is already running.",
        }),
      };
    });
    renderCard();

    // No promise of a comparison for an update this card did not start.
    await waitFor(() =>
      expect(
        screen.getByText(/Run the comparison once it has finished/),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Another data update is already running\./),
      ).toBeTruthy(),
    );
    // Reported, but still not compared -- nobody asked this card for one.
    expect(startSmurfBoostDetection).not.toHaveBeenCalled();
  });

  it("does not compare on a poll blip mid-fetch", async () => {
    // A failing poll is not a finished fetch -- it backs off and keeps going --
    // so comparing here would present a mid-fetch reading as a fresh one.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    let exactPolls = 0;
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/sync/active")) {
        return { success: true, data: null };
      }
      exactPolls += 1;
      throw new Error("the run could not be read");
    });
    validatedPost.mockResolvedValue({
      success: true,
      data: syncRun({ status: "pending" }),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() => expect(exactPolls).toBeGreaterThan(0));
    expect(startSmurfBoostDetection).not.toHaveBeenCalled();
    expect(screen.queryByText("Notable indicators")).toBeNull();
    expect(screen.queryByText(/newest games could not be fetched/)).toBeNull();
  });

  it("runs no comparison for an update started somewhere else", async () => {
    // The sync hook adopts whatever run is already in flight for the player,
    // so comparing on the back of it announces a result for an unmade click.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/sync/active")) {
        return { success: true, data: syncRun({ id: 42, status: "running" }) };
      }
      // The adopted run is already over by the time the card reads it, so the
      // hook's terminal handling -- and its `onSettled` -- runs at once.
      return { success: true, data: syncRun({ id: 42, status: "completed" }) };
    });
    renderCard();

    // Adoption happened: the card is watching a run it never started.
    await waitFor(() =>
      expect(
        validatedGet.mock.calls.some(
          (call) => String(call[1]) === "/players/test-puuid/sync/42",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(runButton()).toBeTruthy());
    // The comparison fires from behind four awaits, all after the render that
    // re-enables the button, so draining the queue is this negative's anchor.
    await act(async () => {});
    expect(validatedPost).not.toHaveBeenCalled();
    expect(startSmurfBoostDetection).not.toHaveBeenCalled();
  });

  it("can be run a second time without a reload", async () => {
    // The owed comparison has one path back to false; lose it and the button
    // stays disabled on "Comparing games..." for the life of the mount.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    // A fresh run id per start: the hook handles each terminal run once, so
    // repeating an id would deadlock this on the mock rather than on the card.
    let startedRuns = 0;
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/sync/active")) {
        return { success: true, data: null };
      }
      return { success: true, data: syncRun({ id: startedRuns }) };
    });
    validatedPost.mockImplementation(async () => {
      startedRuns += 1;
      return {
        success: true,
        data: syncRun({ id: startedRuns, status: "pending" }),
      };
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());
    await waitFor(() =>
      expect(startSmurfBoostDetection).toHaveBeenCalledTimes(1),
    );

    await waitFor(() =>
      expect(runButton().hasAttribute("disabled")).toBe(false),
    );
    await user.click(runButton());
    await waitFor(() =>
      expect(startSmurfBoostDetection).toHaveBeenCalledTimes(2),
    );
    expect(validatedPost).toHaveBeenCalledTimes(2);
  });

  it("keeps the button shut until the comparison it owes has started", async () => {
    // The hook reports the run finished and only then awaits its cache refresh,
    // so a click in that gap is answered by the *previous* fetch's callback.
    let releaseRefetch = () => {};
    getLatestSmurfBoostDetection
      .mockResolvedValueOnce({
        success: false,
        error: { message: "Not found", kind: "not-found", status: 404 },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRefetch = () => resolve({ success: true, data: analysis() });
          }),
      );
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    // The run is terminal but the refresh behind it has not returned, so the
    // callback that runs the comparison has not fired yet.
    await waitFor(() =>
      expect(getLatestSmurfBoostDetection).toHaveBeenCalledTimes(2),
    );
    const busy = screen.getByRole("button", { name: /Comparing games/ });
    expect(busy.hasAttribute("disabled")).toBe(true);

    releaseRefetch();
    await waitFor(() => expect(startSmurfBoostDetection).toHaveBeenCalled());
  });

  describe("the shortfall the fetching alert quotes", () => {
    /** The run card alone -- the result card says the same sentence. */
    function runCard() {
      return within(document.querySelector("#smurf-boost-run") as HTMLElement);
    }

    /** Click Run and hold the fetch open, so the alert stays on screen. */
    async function fetchInProgress(latest: SmurfBoostAnalysisResponse) {
      getLatestSmurfBoostDetection.mockResolvedValue({
        success: true,
        data: latest,
      });
      noActiveSync(syncRun({ status: "running" }));
      const user = userEvent.setup();
      renderCard();

      await waitFor(() => expect(runButton()).toBeTruthy());
      await user.click(runButton());
      await waitFor(() =>
        expect(
          screen.getByText(/Fetching this player's games from Riot/),
        ).toBeTruthy(),
      );
      // A fetch this card started: the alert may promise the comparison that
      // follows it. The adopted-run test pins the other branch.
      expect(
        screen.getByText(/comparison runs on its own as soon as the fetch/),
      ).toBeTruthy();
    }

    it("names it when the stored history is genuinely short", async () => {
      await fetchInProgress(shortHistory());

      expect(
        runCard().getByText(/27 eligible ranked solo\/duo games stored/),
      ).toBeTruthy();
      expect(runCard().getByText(/8 more than are stored/)).toBeTruthy();
    });

    it("says nothing when the history already covers both windows", async () => {
      // 629 games against a 35-game requirement. Quoted anyway it reads as a
      // warning about a floor the player cleared 594 games ago.
      await fetchInProgress(analysis());

      expect(runCard().queryByText(/eligible ranked solo\/duo/)).toBeNull();
    });

    it("quotes no count from a run that failed", async () => {
      // A failed run writes no eligible-game total, so the column reads 0, and
      // "0 games stored" is false for a player with a full history.
      await fetchInProgress(
        analysis({
          status: "failed",
          eligible_games: 0,
          results: null,
          error_message: "The comparison did not finish.",
          completed_at: null,
        }),
      );

      expect(runCard().queryByText(/eligible ranked solo\/duo/)).toBeNull();
    });
  });

  it("names the pool the comparison draws from before any run", async () => {
    // Without it the page asks for a fetch and a comparison while saying
    // nothing about how much of this player's history it actually holds.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Ranked solo games stored: 84\./)).toBeTruthy(),
    );
  });

  it("names no pool before a player is chosen", async () => {
    // The card renders with no player, and `/matches/player//stats` is a 404
    // -- so the count has to be absent rather than empty or zero.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: false,
      error: { message: "Not found", kind: "not-found", status: 404 },
    });
    renderCard(null);

    await waitFor(() => expect(runButton()).toBeTruthy());
    expect(screen.queryByText(/Ranked solo games stored/)).toBeNull();
  });

  it("reports what the fetch added once it has finished", async () => {
    // How many games are missing is Riot's match list, which arrives only
    // during the fetch, so what the fetch added is the only honest number.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Ranked solo games stored: 84\./)).toBeTruthy(),
    );
    storedRankedGames = 96;
    await user.click(runButton());

    await waitFor(() =>
      expect(screen.getByText(/The last fetch added 12\./)).toBeTruthy(),
    );
  });

  it("quotes no fetch total while the fetch is still running", async () => {
    // Mid-fetch the stored count is still the pre-fetch one, so an ungated
    // reading announces "no new games" under an alert saying it is fetching.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    noActiveSync(syncRun({ status: "running" }));
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(screen.getByText(/Fetching this player/)).toBeTruthy(),
    );
    expect(screen.queryByText(/The last fetch/)).toBeNull();
  });

  it("claims no fetch total when the stored count could not be re-read", async () => {
    // The hook refreshes this player's caches before the callback and swallows
    // a failed refresh, so a stale count would announce "no new games".
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    let statsReads = 0;
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/stats")) {
        statsReads += 1;
        if (statsReads > 1) {
          throw new Error("the stored count could not be re-read");
        }
        return { success: true, data: rankedStats(storedRankedGames) };
      }
      if (path.endsWith("/sync/active")) {
        return { success: true, data: null };
      }
      return { success: true, data: syncRun() };
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Ranked solo games stored: 84\./)).toBeTruthy(),
    );
    await user.click(runButton());

    // Anchored on the comparison the failed refresh does not stop, so the
    // negative below is not merely early.
    await waitFor(() =>
      expect(startSmurfBoostDetection).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText(/The last fetch/)).toBeNull();
  });

  it("subtracts from no baseline when the count was unread at the click", async () => {
    // Clicked before the stored count arrived there is nothing to subtract
    // from; treating the unknown as zero credits the fetch with all history.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    let statsReads = 0;
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/stats")) {
        statsReads += 1;
        if (statsReads === 1) {
          throw new Error("the stored count could not be read");
        }
        return { success: true, data: rankedStats(96) };
      }
      if (path.endsWith("/sync/active")) {
        return { success: true, data: null };
      }
      return { success: true, data: syncRun() };
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    expect(screen.queryByText(/Ranked solo games stored/)).toBeNull();
    await user.click(runButton());

    // The count lands with the post-fetch refresh, so the card can finally
    // name the pool -- but not how much of it this fetch brought.
    await waitFor(() =>
      expect(screen.getByText(/Ranked solo games stored: 96\./)).toBeTruthy(),
    );
    expect(screen.queryByText(/The last fetch/)).toBeNull();
  });

  it("says so when a finished fetch found nothing new", async () => {
    // Silence here is indistinguishable from a fetch that never ran, and the
    // comparison that follows reads the same games as the one before it.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    await waitFor(() =>
      expect(
        screen.getByText(/The last fetch found no new ones\./),
      ).toBeTruthy(),
    );
  });

  it("counts nothing fetched for a fetch that did not finish", async () => {
    // A rate-limited update asked Riot for nothing it can account for, so "no
    // new games" would present a failed fetch as an up-to-date history.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    noActiveSync(syncRun({ status: "rate_limited" }));
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(runButton()).toBeTruthy());
    await user.click(runButton());

    // Anchored on the card reacting to the failed run, so the negative below
    // is not merely early.
    await waitFor(() =>
      expect(
        screen.getByText(/newest games could not be fetched/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/The last fetch/)).toBeNull();
  });

  it("re-reads the stored count for a fetch that did not finish", async () => {
    // A rate-limited run still stored what it got, and the hook refreshes the
    // caches on a completed run only, so this pool would stay pre-click.
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    startSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    noActiveSync(syncRun({ status: "rate_limited" }));
    const user = userEvent.setup();
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Ranked solo games stored: 84\./)).toBeTruthy(),
    );
    storedRankedGames = 96;
    await user.click(runButton());

    await waitFor(() =>
      expect(screen.getByText(/Ranked solo games stored: 96\./)).toBeTruthy(),
    );
    // Still unsaid: a run that did not finish cannot account for what it got.
    expect(screen.queryByText(/The last fetch/)).toBeNull();
  });

  it("marks a result as outdated once newer games exist", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis({ is_stale: true }),
    });
    renderCard();

    await waitFor(() =>
      expect(screen.getByText("New games since this comparison")).toBeTruthy(),
    );
  });
});
