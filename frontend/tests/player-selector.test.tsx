// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { discoverPlayer, searchPlayerSuggestions, toast } = vi.hoisted(() => ({
  discoverPlayer: vi.fn(),
  searchPlayerSuggestions: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/core/api", () => ({
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerSelector
        id="test-player-selector"
        ariaLabel="Choose test player"
        onPlayerSelected={onPlayerSelected}
      />
    </QueryClientProvider>,
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
    await user.click(
      await screen.findByRole("option", { name: "Selected#TAG (EUW)" }),
    );

    await waitFor(() => expect(onPlayerSelected).toHaveBeenCalledWith(player));
    expect(discoverPlayer).not.toHaveBeenCalled();
  });

  it("asks for a server before discovering an unknown Riot ID", async () => {
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [] });
    discoverPlayer.mockResolvedValue({ success: true, data: player });
    const onPlayerSelected = renderSelector();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Choose test player"),
      "Selected#TAG",
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Search Riot for this Name#Tag",
      }),
    );
    expect(await screen.findByText("Select player server")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Select player" }));

    await waitFor(() => {
      expect(discoverPlayer).toHaveBeenCalledWith({
        game_name: "Selected",
        tag_line: "TAG",
        platform: "eun1",
      });
      expect(onPlayerSelected).toHaveBeenCalledWith(player);
    });
  });
});
