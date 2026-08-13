// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addTrackedPlayer, searchPlayerSuggestions, toast, validatedGet } =
  vi.hoisted(() => ({
    addTrackedPlayer: vi.fn(),
    searchPlayerSuggestions: vi.fn(),
    toast: vi.fn(),
    validatedGet: vi.fn(),
  }));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock("@/lib/core/api", () => ({
  addTrackedPlayer,
  searchPlayerSuggestions,
  validatedGet,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
}));

import { PlayerSearch } from "../features/players/components/player-search";

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PlayerSearch onPlayerFound={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("PlayerSearch tracking feedback", () => {
  beforeEach(() => {
    addTrackedPlayer.mockReset();
    searchPlayerSuggestions.mockReset();
    toast.mockReset();
    validatedGet.mockReset();
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [] });
    validatedGet.mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => cleanup());

  it("does not render an unexpected technical tracking error", async () => {
    addTrackedPlayer.mockResolvedValue({
      success: false,
      error: {
        message: "Internal server error adding tracked player",
        status: 500,
      },
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByLabelText("Player Name"), "SomeName#1234");
    await user.click(screen.getByRole("button", { name: "Search Player" }));
    await user.click(await screen.findByRole("button", { name: "Track Player" }));

    expect(
      await screen.findByText("Failed to track player. Please try again."),
    ).not.toBeNull();
    expect(
      screen.queryByText("Internal server error adding tracked player"),
    ).toBeNull();
  });

  it("uses the rate-limit warning toast instead of an inline tracking error", async () => {
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
    await user.click(screen.getByRole("button", { name: "Search Player" }));
    await user.click(await screen.findByRole("button", { name: "Track Player" }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "Unable to add player for tracking",
        description:
          "We couldn't load this player's information. Please try again in a few minutes.",
        variant: "warning",
      });
    });
  });
});
