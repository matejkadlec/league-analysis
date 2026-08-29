// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OBJECTIVE_DEFINITIONS } from "../features/matches/objective-definitions";
import { TeamObjectiveStats } from "../features/matches/components/objective-icons";

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
    ).toHaveLength(6);

    const expectedSizes = {
      turret: "h-[31px]",
      inhibitor: "h-[22px]",
      dragon: "h-[22px]",
      voidgrub: "h-[22px]",
      herald: "h-[22px]",
      baron: "h-[21px]",
    };
    for (const [objective, sizeClass] of Object.entries(expectedSizes)) {
      expect(
        container.querySelector(
          `[data-objective="${objective}"] [data-icon-source]`,
        )?.className,
      ).toContain(sizeClass);
    }

    const dragon = container.querySelector(
      '[data-objective="dragon"] [data-icon-source]',
    ) as HTMLElement;
    const voidgrub = container.querySelector(
      '[data-objective="voidgrub"] [data-icon-source]',
    ) as HTMLElement;
    expect(voidgrub.className).toBe(dragon.className);
    expect(voidgrub.style.filter).toBe(dragon.style.filter);
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
