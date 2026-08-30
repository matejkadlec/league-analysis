// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchmakingAnalysisStartCard } from "@/features/matchmaking/components/matchmaking-analysis-start-card";

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
    matchCount: 10,
    onMatchCountChange: vi.fn<(count: number) => void>(),
    endDate: null as string | null,
    onEndDateChange: vi.fn<(date: string | null) => void>(),
    onStart: vi.fn<() => void>(),
    ...overrides,
  };
  const view = render(<MatchmakingAnalysisStartCard {...props} />);
  return { ...view, props };
}

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

function customInput(): HTMLInputElement {
  return screen.getByLabelText("Custom match count");
}

describe("the matchmaking analysis start card", () => {
  it("marks the chosen preset and only it as pressed", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();

    expect(pressed("10")).toBe("true");
    expect(pressed("20")).toBe("false");
    expect(pressed("30")).toBe("false");
    expect(pressed("Custom")).toBe("false");

    await user.click(screen.getByRole("button", { name: "20" }));
    expect(props.onMatchCountChange).toHaveBeenCalledWith(20);
  });

  it("reveals a custom count that respects the backend's bounds", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();

    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(customInput()).toBeTruthy();

    // An in-range integer reports as it is typed.
    fireEvent.change(customInput(), { target: { value: "25" } });
    expect(props.onMatchCountChange).toHaveBeenCalledWith(25);

    // Out-of-range values never reach the parent while typing; the blur
    // clamps them into the window the backend accepts (10-100).
    fireEvent.change(customInput(), { target: { value: "500" } });
    expect(props.onMatchCountChange).not.toHaveBeenCalledWith(500);
    fireEvent.blur(customInput());
    expect(props.onMatchCountChange).toHaveBeenLastCalledWith(100);
    expect(customInput().value).toBe("100");

    fireEvent.change(customInput(), { target: { value: "5" } });
    expect(props.onMatchCountChange).not.toHaveBeenCalledWith(5);
    fireEvent.blur(customInput());
    expect(props.onMatchCountChange).toHaveBeenLastCalledWith(10);
  });

  it("recognises a custom count it was mounted with", () => {
    // A restored or deep-linked count of 25 is not any preset, so the card
    // must open in custom mode rather than highlighting nothing.
    renderCard({ matchCount: 25 });

    expect(pressed("Custom")).toBe("true");
    expect(pressed("10")).toBe("false");
    expect(pressed("20")).toBe("false");
    expect(pressed("30")).toBe("false");
    expect(customInput().value).toBe("25");
  });

  it("warns about long runs only when one is configured", () => {
    const { rerender } = renderCard({ matchCount: 20 });
    const warning = /Larger runs analyze many more players/;
    expect(screen.queryByText(warning)).toBeNull();

    const card = (matchCount: number) => (
      <MatchmakingAnalysisStartCard
        playerSelector={<input aria-label="Choose player for analysis" />}
        analysisFailure={null}
        startPending={false}
        startLabel="Start Analysis"
        matchCount={matchCount}
        onMatchCountChange={vi.fn<(count: number) => void>()}
        endDate={null}
        onEndDateChange={vi.fn<(date: string | null) => void>()}
        onStart={vi.fn<() => void>()}
      />
    );
    rerender(card(30));
    expect(screen.getByText(warning)).toBeTruthy();

    rerender(card(20));
    expect(screen.queryByText(warning)).toBeNull();
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
        matchCount={10}
        onMatchCountChange={vi.fn<(count: number) => void>()}
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
