// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchmakingAnalysisActiveCard } from "@/features/matchmaking/components/matchmaking-analysis-active-card";

function renderCard(
  overrides: Partial<
    Parameters<typeof MatchmakingAnalysisActiveCard>[0]
  > = {},
) {
  const props = {
    analyzedPlayerLabel: "Analyzed#ONE",
    phase: "running" as const,
    progressPercentage: 42.4,
    authoritativeProgress: 42,
    totalPlayers: 100,
    estimatedMinutesRemaining: null,
    animProgress: null,
    cancelPending: false,
    onCancel: vi.fn<() => void>(),
    ...overrides,
  };
  const view = render(<MatchmakingAnalysisActiveCard {...props} />);
  return { ...view, props };
}

describe("the active matchmaking analysis card", () => {
  it("reports authoritative progress, its rounded share, and a way out", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();

    // The header counter is the backend's own number; the percentage below
    // the bar is the same progress rounded for reading (42.4 -> 42).
    expect(screen.getByText("42 / 100 players")).toBeTruthy();
    expect(screen.getByText("Analyzing 42 of 100 players")).toBeTruthy();
    expect(screen.getByText("42% complete")).toBeTruthy();

    const cancel = screen.getByRole("button", { name: "Cancel Analysis" });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    await user.click(cancel);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("estimates the remaining time only when it has one, with a singular", () => {
    const { rerender } = renderCard({ estimatedMinutesRemaining: 3 });
    expect(
      screen.getByText("Analyzing 42 of 100 players (~3 minutes remaining)"),
    ).toBeTruthy();

    rerender(
      <MatchmakingAnalysisActiveCard
        analyzedPlayerLabel="Analyzed#ONE"
        phase="running"
        progressPercentage={42.4}
        authoritativeProgress={42}
        totalPlayers={100}
        estimatedMinutesRemaining={1}
        animProgress={null}
        cancelPending={false}
        onCancel={vi.fn<() => void>()}
      />,
    );
    expect(
      screen.getByText("Analyzing 42 of 100 players (~1 minute remaining)"),
    ).toBeTruthy();

    rerender(
      <MatchmakingAnalysisActiveCard
        analyzedPlayerLabel="Analyzed#ONE"
        phase="running"
        progressPercentage={42.4}
        authoritativeProgress={42}
        totalPlayers={100}
        estimatedMinutesRemaining={null}
        animProgress={null}
        cancelPending={false}
        onCancel={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText("Analyzing 42 of 100 players")).toBeTruthy();
  });

  it("locks the cancel control while the cancellation is in flight", async () => {
    const user = userEvent.setup();
    const { props } = renderCard({ cancelPending: true });

    const cancel = screen.getByRole("button", {
      name: "Cancelling...",
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    await user.click(cancel);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Cancel Analysis" }),
    ).toBeNull();
  });

  it("withdraws the cancel button entirely once cancelling takes over", () => {
    renderCard({ phase: "cancelling" });

    expect(screen.getByText("Cancelling analysis...")).toBeTruthy();
    // No way to request a second cancellation of the same run: the only
    // button left is the dead spinner.
    const stuck = screen.getByRole("button", {
      name: "Cancelling...",
    }) as HTMLButtonElement;
    expect(stuck.disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Cancel Analysis" }),
    ).toBeNull();
  });

  it("walks the completion animation's three messages in order", () => {
    const shared = {
      analyzedPlayerLabel: "Analyzed#ONE",
      progressPercentage: 0,
      authoritativeProgress: 100,
      totalPlayers: 100,
      estimatedMinutesRemaining: null,
      cancelPending: false,
      onCancel: vi.fn<() => void>(),
    };
    const at = (animProgress: number) => (
      <MatchmakingAnalysisActiveCard
        {...shared}
        phase="completing-fast"
        animProgress={animProgress}
      />
    );
    const { rerender } = render(at(0));

    expect(screen.getByText("Starting analysis...")).toBeTruthy();

    rerender(at(50));
    expect(screen.getByText("Fetching matches from the database...")).toBeTruthy();

    rerender(at(100));
    expect(screen.getByText("Analysis finished successfully")).toBeTruthy();
  });
});
