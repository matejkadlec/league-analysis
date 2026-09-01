// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PerformanceFigures } from "@/features/profile/components/performance-figures";
import type { PerformanceStats } from "@/lib/core/schemas";

function stats(overrides: Partial<PerformanceStats> = {}): PerformanceStats {
  return {
    wins: 15,
    losses: 10,
    win_rate: 0.6,
    avg_kills: 5,
    avg_deaths: 4,
    avg_assists: 7,
    avg_kda: 3,
    ...overrides,
  };
}

describe("the shared performance figures", () => {
  it("states the averages every grouping ends with, at fixed precision", () => {
    render(<PerformanceFigures stats={stats()} />);

    // The K/D/A line carries one decimal, the ratio two, the rate is a
    // percent, and the record is the raw W/L pair.
    expect(screen.getByText("5.0 / 4.0 / 7.0")).toBeTruthy();
    expect(screen.getByText("3.00")).toBeTruthy();
    expect(screen.getByText("KDA")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("15W 10L")).toBeTruthy();
  });

  it("colours KDA and win rate by the thresholds they claim", () => {
    // The shared colour helpers' boundaries, relied on everywhere else: green
    // at >= 51% and >= 3.0 KDA, rose below 49% and under 2.0 KDA.
    render(<PerformanceFigures stats={stats({ avg_kda: 3, win_rate: 0.51 })} />);
    expect(screen.getByText("3.00").className).toContain("text-green-500");
    expect(screen.getByText("51%").className).toContain("text-green-500");

    cleanup();

    render(
      <PerformanceFigures stats={stats({ avg_kda: 1.99, win_rate: 0.49 })} />,
    );
    expect(screen.getByText("1.99").className).toContain("text-rose-500");
    expect(screen.getByText("49%").className).toContain("text-rose-500");
  });
});
