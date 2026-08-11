// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTrackingStatus, trackPlayer, untrackPlayer, toast } = vi.hoisted(
  () => ({
    getTrackingStatus: vi.fn(),
    trackPlayer: vi.fn(),
    untrackPlayer: vi.fn(),
    toast: vi.fn(),
  }),
);

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock("@/lib/core/api", () => ({
  getTrackingStatus,
  trackPlayer,
  untrackPlayer,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
}));

import { TrackPlayerButton } from "@/features/players/components/track-player-button";

function renderButton() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TrackPlayerButton puuid="player-1" playerName="Player One" />
    </QueryClientProvider>,
  );
}

describe("TrackPlayerButton", () => {
  beforeEach(() => {
    getTrackingStatus.mockReset();
    trackPlayer.mockReset();
    untrackPlayer.mockReset();
    toast.mockReset();
    trackPlayer.mockResolvedValue({ success: true, data: {} });
    untrackPlayer.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => cleanup());

  it("presents tracked state first and exposes the untrack action", async () => {
    getTrackingStatus
      .mockResolvedValueOnce({
        success: true,
        data: { is_tracked: true },
      })
      .mockResolvedValue({
        success: true,
        data: { is_tracked: false },
      });
    renderButton();

    const button = await screen.findByRole("button", { name: "Untrack player" });
    expect(button.getAttribute("data-tracking-state")).toBe("tracked");
    expect(screen.getByText("Tracked")).not.toBeNull();
    expect(screen.getByText("Untrack")).not.toBeNull();

    await userEvent.click(button);
    expect(untrackPlayer).toHaveBeenCalledWith("player-1");
    await waitFor(() =>
      expect(button.getAttribute("data-tracking-state")).toBe("untracked"),
    );
    expect(screen.getByText("Untracked")).not.toBeNull();
  });

  it("presents untracked state first and exposes the track action", async () => {
    getTrackingStatus
      .mockResolvedValueOnce({
        success: true,
        data: { is_tracked: false },
      })
      .mockResolvedValue({
        success: true,
        data: { is_tracked: true },
      });
    renderButton();

    const button = await screen.findByRole("button", { name: "Track player" });
    expect(button.getAttribute("data-tracking-state")).toBe("untracked");
    expect(screen.getByText("Untracked")).not.toBeNull();
    expect(screen.getByText("Track")).not.toBeNull();

    await userEvent.click(button);
    expect(trackPlayer).toHaveBeenCalledWith("player-1");
    await waitFor(() =>
      expect(button.getAttribute("data-tracking-state")).toBe("tracked"),
    );
    expect(screen.getByText("Tracked")).not.toBeNull();
  });

  it("keeps the prior state when a mutation fails", async () => {
    getTrackingStatus.mockResolvedValue({
      success: true,
      data: { is_tracked: true },
    });
    untrackPlayer.mockResolvedValue({
      success: false,
      error: { message: "Unable to untrack" },
    });
    renderButton();

    const button = await screen.findByRole("button", { name: "Untrack player" });
    await userEvent.click(button);

    await waitFor(() =>
      expect(button.getAttribute("data-tracking-state")).toBe("tracked"),
    );
    expect(screen.getByText("Tracked")).not.toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Failed to untrack player",
        variant: "error",
      }),
    );
  });
});
