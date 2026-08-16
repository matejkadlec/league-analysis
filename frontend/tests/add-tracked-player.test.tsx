// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addTrackedPlayer, searchPlayerSuggestions, toast, trackPlayer } =
  vi.hoisted(() => ({
    addTrackedPlayer: vi.fn(),
    searchPlayerSuggestions: vi.fn(),
    toast: vi.fn(),
    trackPlayer: vi.fn(),
  }));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock("@/lib/core/api", () => ({
  addTrackedPlayer,
  searchPlayerSuggestions,
  trackPlayer,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
}));

import { AddTrackedPlayer } from "../features/players/components/add-tracked-player";

const savedPlayer = {
  puuid: "saved-player-puuid",
  game_name: "Imagine Dragon",
  tag_line: "ASOL",
  platform: "eun1",
  created_at: "2026-08-08T00:00:00Z",
  updated_at: "2026-08-08T00:00:00Z",
};

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <AddTrackedPlayer />
    </QueryClientProvider>,
  );
}

describe("AddTrackedPlayer", () => {
  beforeEach(() => {
    addTrackedPlayer.mockReset();
    searchPlayerSuggestions.mockReset();
    toast.mockReset();
    trackPlayer.mockReset();
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => cleanup());

  it("parses manual Name#Tag input before calling the existing add endpoint", async () => {
    addTrackedPlayer.mockResolvedValue({ success: true, data: savedPlayer });
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByLabelText("Player Name"),
      "Imagine Dragon#ASOL",
    );
    await user.click(screen.getByRole("button", { name: "Track Player" }));

    await waitFor(() => {
      expect(addTrackedPlayer).toHaveBeenCalledWith({
        game_name: "Imagine Dragon",
        tag_line: "ASOL",
        platform: "eun1",
      });
    });
    expect(trackPlayer).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Player added for tracking",
        variant: "success",
      }),
    );
  });

  it("keeps partial input neutral and disabled until it resolves to a saved player", async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByLabelText("Player Name");
    const trackButton = screen.getByRole("button", { name: "Track Player" });
    expect((trackButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, "S");

    expect((trackButton as HTMLButtonElement).disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(
      screen.queryByText("Player Name must be in Name#Tag format."),
    ).toBeNull();
  });

  it("uses a saved player's canonical PUUID for a name-only match", async () => {
    searchPlayerSuggestions.mockResolvedValue({
      success: true,
      data: [savedPlayer],
    });
    trackPlayer.mockResolvedValue({ success: true, data: savedPlayer });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByLabelText("Player Name"), "Imagine");
    await screen.findByRole("button", { name: "Imagine Dragon#ASOL" });
    await user.click(screen.getByRole("button", { name: "Track Player" }));

    await waitFor(() => {
      expect(trackPlayer).toHaveBeenCalledWith("saved-player-puuid");
    });
    expect(addTrackedPlayer).not.toHaveBeenCalled();
  });

  it("shows a neutral server-specific message when the Riot player is missing", async () => {
    addTrackedPlayer.mockResolvedValue({
      success: false,
      error: {
        code: "PLAYER_NOT_FOUND",
        message: "Player not found",
        status: 404,
      },
    });
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByLabelText("Player Name");
    await user.type(input, "SomeName#1234");
    await user.click(screen.getByRole("button", { name: "Track Player" }));

    expect(
      await screen.findByText(
        "Player SomeName#1234 wasn't found on server EUNE.",
      ),
    ).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("shows the specified warning toast when Riot is rate limited", async () => {
    addTrackedPlayer.mockResolvedValue({
      success: false,
      error: {
        message: "Riot API rate limit reached",
        status: 429,
      },
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByLabelText("Player Name"), "SomeName#1234");
    await user.click(screen.getByRole("button", { name: "Track Player" }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "Unable to add player for tracking",
        description:
          "We couldn't load this player's information. Please try again in a few minutes.",
        variant: "warning",
      });
    });
  });

  it("uses the existing invalid Riot API key error toast", async () => {
    addTrackedPlayer.mockResolvedValue({
      success: false,
      error: {
        message:
          "Riot data is temporarily unavailable. Please contact an administrator.",
        code: "RIOT_API_KEY_INVALID",
        status: 503,
      },
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByLabelText("Player Name"), "SomeName#1234");
    await user.click(screen.getByRole("button", { name: "Track Player" }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "Player tracking is temporarily unavailable",
        description:
          "The Riot API key is invalid or expired. Please contact an administrator.",
        variant: "error",
      });
    });
  });
});
