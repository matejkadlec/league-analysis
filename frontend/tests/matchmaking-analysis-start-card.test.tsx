// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatchmakingAnalysisStartCard } from "@/features/matchmaking/components/matchmaking-analysis-start-card";
import { ANALYSIS_MATCH_COUNT } from "@/features/matchmaking/matchmaking-progress";

import { documentedColdRuns } from "./support/matchmaking-cost-table";

function renderCard(
  overrides: Partial<
    Parameters<typeof MatchmakingAnalysisStartCard>[0]
  > = {},
) {
  const props = {
    playerSelector: <input aria-label="Choose player for analysis" />,
    analysisFailure: null as string | null,
    startPending: false,
    startLabel: "Start Analysis" as const,
    endDate: null as string | null,
    onEndDateChange: vi.fn<(date: string | null) => void>(),
    onStart: vi.fn<() => void>(),
    ...overrides,
  };
  const view = render(<MatchmakingAnalysisStartCard {...props} />);
  return { ...view, props };
}

/** The card with the session's own end-date state, as the page renders it. */
function StatefulCard() {
  const [endDate, setEndDate] = useState<string | null>(null);
  return (
    <MatchmakingAnalysisStartCard
      playerSelector={<input aria-label="Choose player for analysis" />}
      analysisFailure={null}
      startPending={false}
      startLabel="Start Analysis"
      endDate={endDate}
      onEndDateChange={setEndDate}
      onStart={vi.fn<() => void>()}
    />
  );
}

const endDateInput = () =>
  screen.getByLabelText("Last day to include (optional)") as HTMLInputElement;

/** Freeze the clock at `now` in the viewer time zone `zone`. */
function viewerAt(now: string, zone: string) {
  vi.stubEnv("TZ", zone);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the matchmaking analysis start card", () => {
  it("offers no match-count choice and names the fixed count", () => {
    // LGA-140: every run analyzes the same ten matches; the presets and the
    // custom input are gone, and the API refuses any other count.
    renderCard();

    expect(screen.queryByText("Matches to analyze")).toBeNull();
    expect(screen.queryByRole("button", { name: "Custom" })).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(
      screen.getByText(
        new RegExp(`across their last ${ANALYSIS_MATCH_COUNT} ranked matches`),
      ),
    ).toBeTruthy();
  });

  it("states the documented cold-cache duration before a run starts", () => {
    // The cost table in docs/matchmaking-analysis.md, which the backend's
    // formulas are held to as well (LGA-147).
    const [documented] = documentedColdRuns();
    renderCard();

    expect(documented?.matchCount).toBe(ANALYSIS_MATCH_COUNT);
    expect(
      screen.getByTestId("matchmaking-expected-duration").textContent,
    ).toContain(`up to about ${documented?.duration} when`);
  });

  it("refuses a last day after today instead of sending it", async () => {
    // `max` on a date input stops the picker, not the keyboard, and the
    // backend then analysed "the matches before a day nobody has played".
    const user = userEvent.setup();
    const { props } = renderCard({ endDate: "2999-01-01" });

    const start = screen.getByRole("button", { name: "Start Analysis" });
    expect(screen.getByRole("alert").textContent).toBe(
      "The last day to include cannot be after today.",
    );
    expect(start).toHaveProperty("disabled", true);
    await user.click(start);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it.each([
    // LGA-142: after 11:00 in Prague, UTC+14 is already on the next day, and
    // the card used to offer it; the API would take it and run "Latest".
    ["2026-11-15T12:00:00Z", "Europe/Prague", "2026-11-15", "2026-11-16"],
    // Half an hour after the viewer's midnight, their new day is selectable.
    ["2026-11-15T23:30:00Z", "Europe/Prague", "2026-11-16", "2026-11-17"],
    ["2026-11-15T06:00:00Z", "America/Los_Angeles", "2026-11-14", "2026-11-15"],
    // At UTC+14 the viewer's today is the API's bound, never past it.
    ["2026-11-15T10:00:00Z", "Pacific/Kiritimati", "2026-11-16", "2026-11-17"],
  ])(
    "at %s in %s accepts %s as the last day and refuses %s",
    (now, zone, lastAllowed, firstRefused) => {
      viewerAt(now, zone);

      renderCard({ endDate: lastAllowed });
      expect(endDateInput().max).toBe(lastAllowed);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Start Analysis" }),
      ).toHaveProperty("disabled", false);
      cleanup();

      renderCard({ endDate: firstRefused });
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Start Analysis" }),
      ).toHaveProperty("disabled", true);
    },
  );

  it("moves the bound on when a card left open passes midnight", () => {
    // The clock is read again on every change, not once per mount: the new
    // day is accepted without reloading the page.
    viewerAt("2026-11-15T22:30:00Z", "Europe/Prague");
    render(<StatefulCard />);
    expect(endDateInput().max).toBe("2026-11-15");

    vi.setSystemTime(new Date("2026-11-15T23:30:00Z"));
    fireEvent.change(endDateInput(), { target: { value: "2026-11-16" } });

    expect(endDateInput().max).toBe("2026-11-16");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Start Analysis" }),
    ).toHaveProperty("disabled", false);
  });

  it("starts a run for a last day that has already happened", async () => {
    const user = userEvent.setup();
    const { props } = renderCard({ endDate: "2026-08-01" });

    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start Analysis" }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it("shows the failure the last run left, and a start that cannot double-fire", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderCard({
      analysisFailure: "The analysis did not finish. Please try again.",
    });
    expect(
      screen.getByText("The analysis did not finish. Please try again."),
    ).toBeTruthy();

    const start = screen.getByRole("button", { name: "Start Analysis" });
    await user.click(start);
    expect(props.onStart).toHaveBeenCalledTimes(1);

    // Pending means an in-flight request: the label owns up to it and the
    // button refuses a second click.
    rerender(
      <MatchmakingAnalysisStartCard
        playerSelector={<input aria-label="Choose player for analysis" />}
        analysisFailure={null}
        startPending
        startLabel="Start Analysis"
        endDate={null}
        onEndDateChange={vi.fn<(date: string | null) => void>()}
        onStart={props.onStart}
      />,
    );
    const pending = screen.getByRole("button", {
      name: "Starting...",
    }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    await user.click(pending);
    expect(props.onStart).toHaveBeenCalledTimes(1);

    cleanup();

    // After a completed run the same card offers a fresh analysis.
    renderCard({ startLabel: "Run New Analysis" });
    expect(
      screen.getByRole("button", { name: "Run New Analysis" }),
    ).toBeTruthy();
  });

  it("lets the end date be set to Latest again", async () => {
    const user = userEvent.setup();
    const { props } = renderCard({ endDate: "2026-08-01" });

    expect(
      (screen.getByLabelText("Last day to include (optional)") as HTMLInputElement)
        .value,
    ).toBe("2026-08-01");

    await user.click(screen.getByRole("button", { name: "Latest" }));
    expect(props.onEndDateChange).toHaveBeenCalledWith(null);
  });
});
