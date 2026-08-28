// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CardPreference } from "@/lib/core/schemas";

type SmurfBoostApi = typeof import("@/features/smurf-boost/smurf-boost-api");
type Toast = typeof import("sonner").toast;

const {
  getCardPreferences,
  getSmurfBoostPresets,
  resetCardPreference,
  updateCardPreference,
  toast,
} = vi.hoisted(() => ({
  getCardPreferences: vi.fn<SmurfBoostApi["getCardPreferences"]>(),
  getSmurfBoostPresets: vi.fn<SmurfBoostApi["getSmurfBoostPresets"]>(),
  resetCardPreference: vi.fn<SmurfBoostApi["resetCardPreference"]>(),
  updateCardPreference: vi.fn<SmurfBoostApi["updateCardPreference"]>(),
  toast: {
    error: vi.fn<Toast["error"]>(),
    info: vi.fn<Toast["info"]>(),
    success: vi.fn<Toast["success"]>(),
    warning: vi.fn<Toast["warning"]>(),
  },
}));

vi.mock("@/features/smurf-boost/smurf-boost-api", () => ({
  getCardPreferences,
  getSmurfBoostPresets,
  resetCardPreference,
  updateCardPreference,
}));

vi.mock("sonner", () => ({ toast }));

import { SmurfBoostSettingsDialog } from "../features/smurf-boost/components/smurf-boost-settings-card";
import { THRESHOLD_FIELDS } from "../features/smurf-boost/smurf-boost-settings";

/** The Conservative preset exactly as the live API emits it. */
const CONSERVATIVE = {
  recentWindowSize: 20,
  baselineWindowSize: 60,
  a1StepChangeThreshold: 1.2,
  a2WinRateSurgeThreshold: 0.2,
  a3NovelChampionThreshold: 1.2,
  a3MinimumNovelGames: 8,
  a4SummonerLevelGate: 45,
  a4PerformanceThreshold: 1.2,
  b1WinRateDeltaThreshold: 0.3,
  b1CompositeFlatCeiling: 0.05,
  b2ConsistencyShiftThreshold: 1.15,
  b3BimodalityThreshold: 0.65,
  b3TailFraction: 0.3,
  b4HighRateFloor: 0.62,
  b4DropThreshold: 0.2,
};

const SENSITIVE = {
  ...CONSERVATIVE,
  recentWindowSize: 15,
  baselineWindowSize: 30,
  a1StepChangeThreshold: 0.8,
  a2WinRateSurgeThreshold: 0.12,
  a3MinimumNovelGames: 5,
};

function preferences(
  overrides: Partial<CardPreference> = {},
): CardPreference[] {
  return [
    // The response carries every card, and Top Champions carries a role list.
    // A numeric-only shape would reject the whole catalog.
    {
      cardId: "profile.top-champions",
      version: 1,
      settings: { queueId: 420, displayLimit: 5, includedRoles: [] },
      isDefault: true,
      requiresRecovery: false,
      updatedAt: null,
    },
    {
      cardId: "profile.smurf-boost-detection",
      version: 1,
      // The effective settings include the card's fixed queueId, which the
      // write contract forbids.
      settings: { queueId: 420, ...CONSERVATIVE },
      isDefault: true,
      requiresRecovery: false,
      updatedAt: null,
      ...overrides,
    },
  ];
}

/** Renders the trigger and opens the dialog, where every setting now lives. */
async function renderCard() {
  const { queryClient } = renderWithQueryClient(<SmurfBoostSettingsDialog />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: /Detection Settings/ }),
  );
  return queryClient;
}

/**
 * The thresholds are grouped into tabs, so typing into a field first opens
 * the tab that holds it. Every group stays mounted while inactive, so the
 * querySelector below finds the input either way.
 */
function tabFor(name: string): string {
  if (/^a\d/.test(name)) {
    return "Rapid Improvement Pattern";
  }
  if (/^b\d/.test(name)) {
    return "Playing Pattern Change";
  }
  return "Games Compared";
}

async function typeValue(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  value: string,
) {
  await user.click(screen.getByRole("tab", { name: tabFor(name) }));
  const input = document.querySelector(
    `#smurf-boost-${name}`,
  ) as HTMLInputElement;
  await user.clear(input);
  await user.type(input, value);
}

describe("SmurfBoostSettingsCard", () => {
  beforeEach(() => {
    getCardPreferences.mockReset();
    getSmurfBoostPresets.mockReset();
    resetCardPreference.mockReset();
    updateCardPreference.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());

    getCardPreferences.mockResolvedValue({
      success: true,
      data: preferences(),
    });
    getSmurfBoostPresets.mockResolvedValue({
      success: true,
      data: {
        default_preset: "conservative",
        presets: [
          { name: "conservative", thresholds: CONSERVATIVE },
          { name: "sensitive", thresholds: SENSITIVE },
        ],
      },
    });
  });


  it("offers every configurable threshold with its allowed range", async () => {
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("Recent games compared")).toBeTruthy(),
    );
    for (const field of THRESHOLD_FIELDS) {
      const input = document.querySelector(`#smurf-boost-${field.name}`);
      expect(input, `${field.name} has no input`).toBeTruthy();
      expect(screen.getByLabelText(field.label)).toBeTruthy();
      // Inside the loop, and read off each field's own help text: the range
      // was asserted for recentWindowSize alone, so suppressing it on the
      // eleven float thresholds -- whose bounds nobody could guess -- passed.
      const help = document.querySelector(`#smurf-boost-${field.name}-help`);
      expect(
        help?.textContent,
        `${field.name} does not state its allowed range`,
      ).toContain(`Allowed: ${field.min} to ${field.max}.`);
    }
    expect(
      screen.getByText(/How many of the newest eligible games count as recent/),
    ).toBeTruthy();
  });

  it("marks the preset the stored settings match", async () => {
    await renderCard();

    await waitFor(() =>
      expect(screen.getByTestId("smurf-boost-preset-conservative")).toBeTruthy(),
    );
    expect(
      screen
        .getByTestId("smurf-boost-preset-conservative")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("smurf-boost-preset-sensitive")
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByText("Shipped defaults")).toBeTruthy();
  });

  it("applies a preset without the fields the write contract forbids", async () => {
    updateCardPreference.mockResolvedValue({
      success: true,
      data: {
        cardId: "profile.smurf-boost-detection",
        version: 1,
        settings: { queueId: 420, ...SENSITIVE },
        isDefault: false,
        requiresRecovery: false,
        updatedAt: "2026-08-14T22:00:00.000Z",
      },
    });
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByTestId("smurf-boost-preset-sensitive")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("smurf-boost-preset-sensitive"));

    await waitFor(() => expect(updateCardPreference).toHaveBeenCalled());
    const firstCall = updateCardPreference.mock.calls[0];
    if (!firstCall) {
      throw new Error("updateCardPreference was not called");
    }
    const [cardId, sent] = firstCall;
    expect(cardId).toBe("profile.smurf-boost-detection");
    expect(Object.keys(sent)).not.toContain("queueId");
    expect(Object.keys(sent).length).toBe(THRESHOLD_FIELDS.length);
    expect(sent.recentWindowSize).toBe(15);

    await waitFor(() => expect(screen.getByText("Your settings")).toBeTruthy());
    expect(toast.success).toHaveBeenCalled();
  });

  it("refuses a value outside the range the backend enforces", async () => {
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("B3 share counted as a tail")).toBeTruthy(),
    );
    await typeValue(user, "b3TailFraction", "0.9");

    await waitFor(() =>
      expect(
        screen.getByText(
          "B3 share counted as a tail must be between 0.15 and 0.4.",
        ),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /Save thresholds/ }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(updateCardPreference).not.toHaveBeenCalled();
  });

  it("refuses a set the backend's cross-field rule would reject", async () => {
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("Recent games compared")).toBeTruthy(),
    );
    await typeValue(user, "recentWindowSize", "10");
    await typeValue(user, "a3MinimumNovelGames", "15");

    await waitFor(() =>
      expect(
        screen.getByText(
          "A3 rarely played games needed cannot exceed the recent games compared.",
        ),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /Save thresholds/ }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("reports a rejected write without leaking the server's own words", async () => {
    // The real 422 body is a Pydantic report naming a model class and a schema
    // URL. `normalizeApiError` replaces it before any component sees it, so
    // what reaches this card is already the shared safe sentence.
    updateCardPreference.mockResolvedValue({
      success: false,
      error: {
        message:
          "The request could not be completed. Check the information and try again.",
        kind: "validation",
        code: "VALIDATION_ERROR",
        status: 422,
      },
    });
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("A1 performance step")).toBeTruthy(),
    );
    await typeValue(user, "a1StepChangeThreshold", "1.1");
    await user.click(screen.getByRole("button", { name: /Save thresholds/ }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "The request could not be completed. Check the information and try again.",
        ),
      ).toBeTruthy(),
    );
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("pydantic");
    expect(body).not.toContain("SmurfBoostDetectionMutableSettingsWriteV1");
    expect(toast.error).toHaveBeenCalled();
  });

  it("treats a cleared field as missing rather than as zero", async () => {
    // One threshold legitimately allows zero, so `Number("")` would make an
    // empty field look like a valid setting and save it.
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("B1 performance treated as flat")).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("tab", { name: "Playing Pattern Change" }),
    );
    const input = document.querySelector(
      "#smurf-boost-b1CompositeFlatCeiling",
    ) as HTMLInputElement;
    await user.clear(input);

    await waitFor(() =>
      expect(
        screen.getByText("B1 performance treated as flat needs a number."),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /Save thresholds/ }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("does not write an override for an edit that changes nothing", async () => {
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("Recent games compared")).toBeTruthy(),
    );
    await typeValue(user, "recentWindowSize", "35");
    expect(
      screen.getByRole("button", { name: /Save thresholds/ }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);

    await typeValue(user, "recentWindowSize", "20");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Save thresholds/ }).hasAttribute(
          "disabled",
        ),
      ).toBe(true),
    );
    // The preset already in use is not an action either: clicking it would
    // store an override identical to the defaults and change the badge.
    expect(
      screen
        .getByTestId("smurf-boost-preset-conservative")
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(updateCardPreference).not.toHaveBeenCalled();
  });

  it("points assistive technology at both sides of the cross-field rule", async () => {
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("Recent games compared")).toBeTruthy(),
    );
    await typeValue(user, "recentWindowSize", "10");
    await typeValue(user, "a3MinimumNovelGames", "15");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    for (const name of ["recentWindowSize", "a3MinimumNovelGames"]) {
      const input = document.querySelector(
        `#smurf-boost-${name}`,
      ) as HTMLInputElement;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toContain(
        "smurf-boost-cross-error",
      );
    }
  });

  it("resets to the shipped defaults through the card's own endpoint", async () => {
    resetCardPreference.mockResolvedValue({
      success: true,
      data: {
        cardId: "profile.smurf-boost-detection",
        version: 1,
        settings: { queueId: 420, ...CONSERVATIVE },
        isDefault: true,
        requiresRecovery: false,
        updatedAt: null,
      },
    });
    const user = userEvent.setup();
    await renderCard();

    await waitFor(() =>
      expect(screen.getByLabelText("Recent games compared")).toBeTruthy(),
    );
    await typeValue(user, "recentWindowSize", "35");
    await user.click(screen.getByRole("button", { name: /Reset to defaults/ }));

    await waitFor(() =>
      expect(resetCardPreference).toHaveBeenCalledWith(
        "profile.smurf-boost-detection",
      ),
    );
    await waitFor(() =>
      expect(
        (
          document.querySelector(
            "#smurf-boost-recentWindowSize",
          ) as HTMLInputElement
        ).value,
      ).toBe("20"),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("says the comparison falls back to defaults when settings cannot load", async () => {
    getCardPreferences.mockResolvedValue({
      success: false,
      error: { message: "boom", kind: "service", status: 500 },
    });
    await renderCard();

    await waitFor(() =>
      expect(
        screen.getByText(
          "Your settings could not be loaded, so the comparison runs with the shipped defaults.",
        ),
      ).toBeTruthy(),
    );
  });

  it("still offers the thresholds when the presets cannot load", async () => {
    getSmurfBoostPresets.mockResolvedValue({
      success: false,
      error: { message: "boom", kind: "service", status: 500 },
    });
    await renderCard();

    await waitFor(() =>
      expect(
        screen.getByText(
          "The presets could not be loaded. You can still edit each threshold below.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByLabelText("Recent games compared")).toBeTruthy();
  });
});
