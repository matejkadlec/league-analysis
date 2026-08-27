// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { trackPlayer, untrackPlayer, toast } = vi.hoisted(() => ({
  trackPlayer: vi.fn(),
  untrackPlayer: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock("@/features/players/player-api", () => ({
  trackPlayer,
  untrackPlayer,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
}));

import { TrackPlayerButton } from "@/features/players/components/track-player-button";

function renderButton(isTracked: boolean) {
  return renderWithQueryClient(
    <TrackPlayerButton
      puuid="player-1"
      playerName="Player One"
      isTracked={isTracked}
    />,
  );
}

describe("TrackPlayerButton", () => {
  beforeEach(() => {
    trackPlayer.mockReset();
    untrackPlayer.mockReset();
    toast.mockReset();
    trackPlayer.mockResolvedValue({ success: true, data: {} });
    untrackPlayer.mockResolvedValue({ success: true, data: {} });
  });

  it("presents tracked state and exposes the untrack action", async () => {
    renderButton(true);

    const button = screen.getByRole("button", { name: "Untrack player" });
    expect(button.getAttribute("data-tracking-state")).toBe("tracked");

    await userEvent.click(button);
    expect(untrackPlayer).toHaveBeenCalledWith("player-1");
  });

  it("presents untracked state and exposes the track action", async () => {
    renderButton(false);

    const button = screen.getByRole("button", { name: "Track player" });
    expect(button.getAttribute("data-tracking-state")).toBe("untracked");
    expect(screen.getByText("Untracked")).not.toBeNull();

    await userEvent.click(button);
    expect(trackPlayer).toHaveBeenCalledWith("player-1");
  });

  it("invalidates the player query so the card it reads its state from refetches", async () => {
    // The button no longer owns the tracked flag: it renders what the player
    // read handed it, so this invalidation is the whole mechanism by which the
    // toggle changes appearance after a successful mutation.
    const { queryClient } = renderButton(false);
    queryClient.setQueryData(["player", "player-1"], { puuid: "player-1" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(screen.getByRole("button", { name: "Track player" }));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["player", "player-1"],
      }),
    );
    // The cache entry the card reads is the observable: a call that went out
    // against a key nothing is stored under leaves it fresh.
    expect(
      queryClient.getQueryState(["player", "player-1"])?.isInvalidated,
    ).toBe(true);
  });

  it("keeps the prior state when a mutation fails", async () => {
    untrackPlayer.mockResolvedValue({
      success: false,
      error: { message: "Unable to untrack" },
    });
    renderButton(true);

    const button = screen.getByRole("button", { name: "Untrack player" });
    await userEvent.click(button);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Player could not be removed from tracking",
          variant: "error",
        }),
      ),
    );
    expect(button.getAttribute("data-tracking-state")).toBe("tracked");
    expect(screen.getByText("Tracked")).not.toBeNull();
  });
});
