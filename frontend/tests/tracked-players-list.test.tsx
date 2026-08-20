// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Spread the real module rather than listing exports: a literal factory omits
// anything the component starts importing later -- `unwrap` was already such a
// straggler, and its absence surfaced as a render timeout rather than an error.
vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  api: { delete: vi.fn() },
  validatedGet,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { TrackedPlayersList } from "@/features/players/components/tracked-players-list";

function renderList() {
  renderWithQueryClient(
    <TrackedPlayersList selectedPlayerPuuid="player-1" />,
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
