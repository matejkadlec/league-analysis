// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLatestSmurfBoostDetection, startSmurfBoostDetection, toast } =
  vi.hoisted(() => ({
    getLatestSmurfBoostDetection: vi.fn(),
    startSmurfBoostDetection: vi.fn(),
    toast: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    },
  }));

vi.mock("@/features/smurf-boost/smurf-boost-api", () => ({
  getLatestSmurfBoostDetection,
  startSmurfBoostDetection,
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

function analysis(overrides: Record<string, unknown> = {}) {
  return {
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
  };
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
      playerSelector={<input aria-label="Choose player for comparison" />}
    />,
  );
  return queryClient;
}

function renderCardWithUnmount(puuid = "test-puuid") {
  const { queryClient, unmount } = renderWithQueryClient(
    <SmurfBoostDetection
      puuid={puuid}
      playerSelector={<input aria-label="Choose player for comparison" />}
    />,
  );
  return { queryClient, unmount };
}

/**
 * Every measurement is rendered twice: a table from `sm` up, and stacked blocks
 * below it. There is no CSS here, so both are in the DOM and an unscoped query
 * matches two elements. Assertions about a single measurement name the layout
 * they are checking; `mobileMeasurements` covers the other one.
 */
function tableMeasurements() {
  const table = document.querySelector("#smurf-boost-result table");
  if (!table) {
    throw new Error("the result card rendered no measurement table");
  }
  return within(table as HTMLElement);
}

function mobileMeasurements() {
  const list = document.querySelector(
    "#smurf-boost-result [data-testid^='smurf-boost-measurements-stacked-']",
  );
  if (!list) {
    throw new Error("the result card rendered no stacked measurements");
  }
  return within(list as HTMLElement);
}

function runButton() {
  return screen.getByRole("button", { name: /Run the comparison/ });
}

describe("SmurfBoostDetection", () => {
  beforeEach(() => {
    getLatestSmurfBoostDetection.mockReset();
    startSmurfBoostDetection.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());
  });

  it("shows both families with their own band and never a number", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    renderCard();

    await waitFor(() =>
      expect(screen.getByText("Rapid Improvement Pattern")).toBeTruthy(),
    );
    expect(screen.getByText("Playing Pattern Change")).toBeTruthy();

    // A family reading is one of the five fixed words and nothing else. A digit
    // here would mean the internal weighted sum had reached the screen. A raw
    // win rate may still be a percentage inside a signal row, which is data
    // rather than a verdict, so this is checked on the band element alone.
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
    // the retired product name, and this was the last place it reached a
    // reader on the page.
    expect(screen.getByText("Model v1")).toBeTruthy();
    expect(screen.queryByText(/smurf-boost/i)).toBeNull();
  });

  it("shows an unavailable area with its reason rather than hiding it", async () => {
    getLatestSmurfBoostDetection.mockResolvedValue({
      success: true,
      data: analysis(),
    });
    renderCard();

    await waitFor(() =>
      expect(tableMeasurements().getByText("A3")).toBeTruthy(),
    );

    for (const layout of [tableMeasurements(), mobileMeasurements()]) {
      expect(layout.getAllByText("Not available").length).toBe(1);
      expect(
        layout.getByText("Only 0 of the recent games were on new champions."),
      ).toBeTruthy();
      expect(
        layout.getByText(
          "Too few recent games were on champions with little stored history.",
        ),
      ).toBeTruthy();
    }
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
    // Two copies of a string the specification calls fixed can drift apart and
    // put two different "fixed" statements on one screen. This is the only
    // check that would notice.
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
    expect(screen.getByText("Rapid Improvement Pattern")).toBeTruthy();
    expect(screen.getByText("Playing Pattern Change")).toBeTruthy();
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
    // A4, B1, B3 and B4 each combine their threshold with a second condition.
    // A gate can fail while the measured value sits above the number printed
    // beside it, and "Below threshold" on that row would simply be false.
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
      expect(
        tableMeasurements().getByText("Other conditions not met"),
      ).toBeTruthy(),
    );

    // Both presentations must reach the same verdict; a stacked block that
    // still said "Below threshold" would be just as untrue on a phone.
    for (const layout of [tableMeasurements(), mobileMeasurements()]) {
      expect(layout.getAllByText("Other conditions not met").length).toBe(1);
      expect(layout.getAllByText("Below threshold").length).toBe(1);
    }
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
    // The backend answers a failed run with HTTP 200 and a stored, reviewed
    // message. Treating that as a success would announce a result that does
    // not exist.
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
    // The card is remounted per player and its own search switches players,
    // so a run can outlive the card that started it. A mutation's
    // options-level callbacks keep running after unmount, and the guard that
    // used to sit there compared against the unmounted closure's player --
    // matching, and announcing "Comparison complete" over whoever the page
    // was showing by then.
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
    // so the search inside it stays reachable. With no player there is
    // nothing to read and nothing to run.
    renderCard(null);

    await waitFor(() => expect(runButton()).toBeTruthy());
    expect(runButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Choose player for comparison")).toBeTruthy();
    expect(getLatestSmurfBoostDetection).not.toHaveBeenCalled();
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
