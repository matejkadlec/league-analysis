// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

/** Six tracked players as the API serves them, whole enough for the schema
 * the list parses the response with. */
const trackedPlayers = Array.from({ length: 6 }, (_, index) => ({
  puuid: `player-${index + 1}`,
  game_name: `Player ${index + 1}`,
  tag_line: `T${index + 1}`,
  platform: "eun1",
  summoner_level: 100 + index,
  profile_icon_id: 4568,
  created_at: "2026-08-09T00:00:00Z",
  updated_at: "2026-08-09T00:00:00Z",
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<typeof import("sonner").toast.success>(),
    error: vi.fn<typeof import("sonner").toast.error>(),
  },
}));

import { TrackedPlayersList } from "@/features/players/components/tracked-players-list";

function renderList() {
  renderWithQueryClient(
    <TrackedPlayersList selectedPlayerPuuid="player-1" />,
  );
}

describe("TrackedPlayersList", () => {
  beforeEach(() => {
    server.use(
      http.get(apiRoute("/players/tracked/list"), () =>
        HttpResponse.json(trackedPlayers),
      ),
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
    // The cap is a row count, not pixels; spelled as arithmetic so a sixth row in
    // view reads as a wrong count rather than a wrong constant.
    const VISIBLE_ROWS = 5;
    const ROW_HEIGHT_PX = 88;
    const ROW_GAP_PX = 12;
    expect(scrollRegion.style.maxHeight).toBe(
      `${VISIBLE_ROWS * ROW_HEIGHT_PX + (VISIBLE_ROWS - 1) * ROW_GAP_PX}px`,
    );
    expect(scrollRegion.parentElement?.id).toBe("tracked-players");
  });
});
