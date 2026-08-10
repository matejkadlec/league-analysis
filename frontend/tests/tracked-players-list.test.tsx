// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
}));

const trackedPlayers = Array.from({ length: 6 }, (_, index) => ({
  puuid: `player-${index + 1}`,
  game_name: `Player ${index + 1}`,
  tag_line: `T${index + 1}`,
  platform: "eun1",
  created_at: "2026-08-09T00:00:00Z",
  updated_at: "2026-08-09T00:00:00Z",
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock("@/lib/core/api", () => ({
  api: { delete: vi.fn() },
  validatedGet,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { TrackedPlayersList } from "@/features/players/components/tracked-players-list";

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <TrackedPlayersList selectedPlayerPuuid="player-1" />
    </QueryClientProvider>,
  );
}

describe("TrackedPlayersList", () => {
  beforeEach(() => {
    validatedGet.mockReset();
    validatedGet.mockImplementation(
      async (_schema: unknown, path: string) => ({
        success: true,
        data: path === "/players/tracked/list" ? trackedPlayers : null,
      }),
    );
  });

  afterEach(() => cleanup());

  it("renders players directly and scrolls after five rows", async () => {
    renderList();

    await screen.findByText("Player 6");

    expect(screen.queryByText("Tracked Players")).toBeNull();
    expect(screen.queryByLabelText("Search tracked players")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /expand|collapse/i }),
    ).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(6);

    const scrollRegion = screen.getByTestId("tracked-players-scroll-region");
    await waitFor(() =>
      expect(scrollRegion.className).toContain("overflow-y-auto"),
    );
    expect(scrollRegion.style.maxHeight).toBe("488px");
    expect(scrollRegion.parentElement?.id).toBe("tracked-players");
  });
});
