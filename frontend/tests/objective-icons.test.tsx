// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  OBJECTIVE_DEFINITIONS,
  TeamObjectiveStats,
} from "../features/matches/components/objective-icons";

const stats = {
  kills: 25,
  deaths: 18,
  assists: 40,
  turrets: 8,
  inhibitors: 2,
  dragons: 4,
  voidgrubs: 3,
  rift_heralds: 1,
  barons: 2,
};

describe("Match History objective icons", () => {
  afterEach(() => cleanup());

  it("keeps the semantic order and exposes every count accessibly", () => {
    const { container } = render(
      <TeamObjectiveStats stats={stats} team="blue" />,
    );

    expect(OBJECTIVE_DEFINITIONS.map((objective) => objective.label)).toEqual([
      "Turrets",
      "Inhibitors",
      "Dragons",
      "Voidgrubs",
      "Rift Herald",
      "Barons",
    ]);
    expect(
      [...container.querySelectorAll("[data-objective]")].map((element) =>
        element.getAttribute("data-objective"),
      ),
    ).toEqual([
      "turret",
      "inhibitor",
      "dragon",
      "voidgrub",
      "herald",
      "baron",
    ]);
    expect(screen.getByRole("img", { name: "Turrets: 8" })).not.toBeNull();
    expect(screen.getByRole("img", { name: "Inhibitors: 2" })).not.toBeNull();
    expect(screen.getByRole("img", { name: "Dragons: 4" })).not.toBeNull();
    expect(screen.getByRole("img", { name: "Voidgrubs: 3" })).not.toBeNull();
    expect(
      screen.getByRole("img", { name: "Rift Herald: 1" }),
    ).not.toBeNull();
    expect(screen.getByRole("img", { name: "Barons: 2" })).not.toBeNull();
    expect(
      container.querySelectorAll('[data-icon-source="riot-match-history"]'),
    ).toHaveLength(5);
    expect(
      container.querySelector('[data-objective="voidgrub"] svg'),
    ).not.toBeNull();
  });

  it("preserves unknown timeline counts", () => {
    render(
      <TeamObjectiveStats
        stats={{ ...stats, inhibitors: null, voidgrubs: undefined }}
        team="red"
      />,
    );

    expect(screen.getByRole("img", { name: "Inhibitors: ?" })).not.toBeNull();
    expect(
      screen.getByRole("img", { name: "Voidgrubs: ?" }),
    ).not.toBeNull();
  });
});
