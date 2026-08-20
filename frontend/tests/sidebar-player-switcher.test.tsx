// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { discoverPlayer, searchPlayerSuggestions, selectPlayer, toast } =
  vi.hoisted(() => ({
    discoverPlayer: vi.fn(),
    searchPlayerSuggestions: vi.fn(),
    selectPlayer: vi.fn(),
    toast: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/match-history",
  useSearchParams: () => new URLSearchParams("puuid=current-puuid"),
}));

const currentPlayer = {
  puuid: "current-puuid",
  game_name: "Current",
  tag_line: "ONE",
  platform: "eun1",
  created_at: "2026-08-09T00:00:00Z",
  updated_at: "2026-08-09T00:00:00Z",
};

vi.mock("@/features/players/context/player-context", () => ({
  usePlayerContext: () => ({
    currentPlayer,
    trackedPlayers: [
      currentPlayer,
      { ...currentPlayer, puuid: "recent-1", game_name: "Recent One" },
      { ...currentPlayer, puuid: "recent-2", game_name: "Recent Two" },
      { ...currentPlayer, puuid: "recent-3", game_name: "Recent Three" },
      { ...currentPlayer, puuid: "recent-4", game_name: "Hidden Four" },
    ],
    selectPlayer,
    isLoading: false,
  }),
}));

vi.mock("@/features/players/components/tracked-players-list", () => ({
  TrackedPlayersList: () => <div>Complete tracked list</div>,
}));

vi.mock("@/features/players/player-api", () => ({
  discoverPlayer,
  searchPlayerSuggestions,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
}));

import { SidebarPlayerSwitcher } from "@/features/players/components/sidebar-player-switcher";

function renderSwitcher(manageOpen = false, onManageOpenChange = vi.fn()) {
  renderWithQueryClient(
    <SidebarPlayerSwitcher
      manageOpen={manageOpen}
      onManageOpenChange={onManageOpenChange}
    />,
  );
}

describe("SidebarPlayerSwitcher", () => {
  beforeEach(() => {
    discoverPlayer.mockReset();
    searchPlayerSuggestions.mockReset();
    selectPlayer.mockReset();
    toast.mockReset();
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [] });
    selectPlayer.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("shows only the current player and opens its dialog without a link", async () => {
    const user = userEvent.setup();
    const onManageOpenChange = vi.fn();
    renderSwitcher(false, onManageOpenChange);

    const currentPlayerButton = screen.getByRole("button", {
      name: "Current#ONE",
    });
    expect(currentPlayerButton.getAttribute("aria-haspopup")).toBe("dialog");
    expect(
      currentPlayerButton.parentElement?.parentElement?.className,
    ).toContain("pb-3");
    expect(screen.queryByRole("link", { name: "Current#ONE" })).toBeNull();
    expect(screen.queryByText("Recent One#ONE")).toBeNull();
    expect(screen.queryByText("Recent Three#ONE")).toBeNull();
    expect(screen.queryByText("Hidden Four#ONE")).toBeNull();

    await user.click(currentPlayerButton);
    expect(onManageOpenChange).toHaveBeenCalledWith(true);
  });

  it("uses the Tracked Players dialog title", () => {
    renderSwitcher(true);

    expect(
      screen.getByRole("heading", { name: "Tracked Players" }),
    ).not.toBeNull();
    expect(
      screen.getByText("View, add or remove tracked players."),
    ).not.toBeNull();
    expect(screen.queryByText("Manage Tracked Players")).toBeNull();
  });

  it("asks for a server only after an unknown one-field Riot ID is submitted", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    expect(screen.queryByText("Select player server")).toBeNull();
    await user.type(screen.getByLabelText("Search for player"), "Unknown#TAG");
    await waitFor(() => expect(searchPlayerSuggestions).toHaveBeenCalled());
    await user.click(
      await screen.findByRole("button", {
        name: "Search Riot for this Name#Tag",
      }),
    );

    expect(await screen.findByText("Select player server")).not.toBeNull();
  });
});
