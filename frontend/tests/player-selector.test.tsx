// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { discoverPlayer, searchPlayerSuggestions, toast } = vi.hoisted(() => ({
  discoverPlayer: vi.fn(),
  searchPlayerSuggestions: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/features/players/player-api", () => ({
  discoverPlayer,
  searchPlayerSuggestions,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
}));

import { PlayerSelector } from "@/features/players/components/player-selector";

const player = {
  puuid: "selected-player-puuid",
  game_name: "Selected",
  tag_line: "TAG",
  platform: "euw1",
  created_at: "2026-08-13T00:00:00Z",
  updated_at: "2026-08-13T00:00:00Z",
};

function renderSelector(onPlayerSelected = vi.fn()) {
  renderWithQueryClient(
    <PlayerSelector
      id="test-player-selector"
      ariaLabel="Choose test player"
      onPlayerSelected={onPlayerSelected}
    />,
  );
  return onPlayerSelected;
}

describe("PlayerSelector", () => {
  beforeEach(() => {
    discoverPlayer.mockReset();
    searchPlayerSuggestions.mockReset();
    toast.mockReset();
  });

  afterEach(() => cleanup());

  it("selects a saved suggestion through the shared non-tracking contract", async () => {
    searchPlayerSuggestions.mockResolvedValue({
      success: true,
      data: [player],
    });
    const onPlayerSelected = renderSelector();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Choose test player"), "Selected");
    const savedSuggestion = await screen.findByRole("option", {
      name: "Selected#TAG (EUW)",
    });
    expect(
      screen.queryByRole("button", {
        name: "Search Riot for this Name#Tag",
      }),
    ).toBeNull();
    await user.click(savedSuggestion);

    await waitFor(() => expect(onPlayerSelected).toHaveBeenCalledWith(player));
    expect(discoverPlayer).not.toHaveBeenCalled();
  });

  it("keeps exact Riot discovery available beside fuzzy saved suggestions", async () => {
    const discoveredPlayer = {
      ...player,
      puuid: "discovered-player-puuid",
      game_name: "Target",
      tag_line: "NEW",
    };
    searchPlayerSuggestions.mockResolvedValue({
      success: true,
      data: [player],
    });
    discoverPlayer.mockResolvedValue({ success: true, data: discoveredPlayer });
    const onPlayerSelected = renderSelector();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Choose test player"), "Target#NEW");
    expect(
      await screen.findByRole("option", { name: "Selected#TAG (EUW)" }),
    ).not.toBeNull();
    await user.click(
      await screen.findByRole("button", {
        name: "Search Riot for this Name#Tag",
      }),
    );
    expect(await screen.findByText("Select player server")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Select player" }));

    await waitFor(() => {
      expect(discoverPlayer).toHaveBeenCalledWith({
        game_name: "Target",
        tag_line: "NEW",
        platform: "eun1",
      });
      expect(onPlayerSelected).toHaveBeenCalledWith(discoveredPlayer);
    });
  });
});
