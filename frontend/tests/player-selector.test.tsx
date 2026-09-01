// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { discoverPlayer, searchPlayerSuggestions, toast } = vi.hoisted(() => ({
  discoverPlayer:
    vi.fn<typeof import("@/features/players/player-api").discoverPlayer>(),
  searchPlayerSuggestions:
    vi.fn<
      typeof import("@/features/players/player-api").searchPlayerSuggestions
    >(),
  toast: vi.fn<ReturnType<typeof import("@/lib/core/hooks").useToast>["toast"]>(),
}));

vi.mock("@/features/players/player-api", () => ({
  discoverPlayer,
  searchPlayerSuggestions,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
}));

import { PlayerSelector } from "@/features/players/components/player-selector";
import { RIOT_ID_SEARCH_MAX_LENGTH } from "@/features/players/riot-id";
import type { Player } from "@/lib/core/schemas";

type SelectPlayer = ComponentProps<typeof PlayerSelector>["onPlayerSelected"];

const player: Player = {
  puuid: "selected-player-puuid",
  game_name: "Selected",
  tag_line: "TAG",
  platform: "euw1",
  summoner_level: 300,
  profile_icon_id: 1,
  is_tracked: false,
  analyzed_matches: 0,
  total_matches: 0,
  created_at: "2026-08-13T00:00:00Z",
  updated_at: "2026-08-13T00:00:00Z",
};

function renderSelector(
  onPlayerSelected: SelectPlayer = vi.fn<SelectPlayer>(),
  initialSearchValue = "",
) {
  renderWithQueryClient(
    <PlayerSelector
      id="test-player-selector"
      ariaLabel="Choose test player"
      onPlayerSelected={onPlayerSelected}
      initialSearchValue={initialSearchValue}
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


  it("lets a seeded box be typed over rather than appended to", async () => {
    // The box keeps the chosen name and offers no clear button, so without
    // selecting on focus the next search reads "Selected#TAGnewname".
    const user = userEvent.setup();
    renderSelector(vi.fn(), "Selected#TAG");

    const box = screen.getByLabelText("Choose test player");
    await user.click(box);
    await user.keyboard("Other#TWO");

    expect((box as HTMLInputElement).value).toBe("Other#TWO");
  });

  it("does not read Enter on a seeded box as an unknown Riot ID", async () => {
    // The seeded value parses as a Riot ID and its suggestions start only on
    // focus, so an immediate Enter can open discovery for the chosen player.
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    renderSelector(vi.fn(), "Selected#TAG");

    const box = screen.getByLabelText("Choose test player");
    await user.click(box);
    await user.keyboard("{Enter}");

    expect(discoverPlayer).not.toHaveBeenCalled();
    expect(screen.queryByText(/server/i)).toBeNull();
  });

  it("leaves an unseeded box's half-typed query alone on refocus", async () => {
    // The sidebar switcher is never seeded. Selecting its text on focus would
    // arm the next keystroke to wipe a query the user is still building.
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    renderSelector();

    const box = screen.getByLabelText("Choose test player");
    await user.click(box);
    await user.keyboard("Sear");
    await user.tab();
    await user.click(box);
    await user.keyboard("ch");

    expect((box as HTMLInputElement).value).toBe("Search");
  });

  it("still reaches discovery for a name typed over a seeded box", async () => {
    // The Enter guard must refuse only the seeded value; any wider and adding
    // an untracked player stops working.
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    renderSelector(vi.fn(), "Selected#TAG");

    const box = screen.getByLabelText("Choose test player");
    await user.click(box);
    await user.keyboard("Target#NEW");
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("button", { name: /Select player/ }),
    ).toBeTruthy();
  });

  it("stops typing at what the suggestions query accepts", () => {
    // Past `q`'s bound the query 422s and the shared QueryCache toasts an
    // error, which is a worse answer to a long paste than no results.
    renderSelector();

    expect(
      (screen.getByLabelText("Choose test player") as HTMLInputElement)
        .maxLength,
    ).toBe(RIOT_ID_SEARCH_MAX_LENGTH);
  });

  it("keeps the chosen player in a box that was seeded with one", async () => {
    // Both analysis pages analyse the player named in the box, so clearing it
    // on selection leaves a result whose subject is nowhere on screen.
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [player] });
    renderSelector(vi.fn(), "Previous#ONE");
    const user = userEvent.setup();

    const box = screen.getByLabelText("Choose test player");
    expect((box as HTMLInputElement).value).toBe("Previous#ONE");

    await user.clear(box);
    await user.type(box, "Selected");
    await user.click(
      await screen.findByRole("option", { name: "Selected#TAG (EUW)" }),
    );

    await waitFor(() =>
      expect((box as HTMLInputElement).value).toBe("Selected#TAG"),
    );
  });

  it("empties an unseeded box on selection", async () => {
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [player] });
    renderSelector();
    const user = userEvent.setup();

    const box = screen.getByLabelText("Choose test player");
    await user.type(box, "Selected");
    await user.click(
      await screen.findByRole("option", { name: "Selected#TAG (EUW)" }),
    );

    await waitFor(() => expect((box as HTMLInputElement).value).toBe(""));
  });

  it("asks for no suggestions until the box has focus", async () => {
    // A seeded box holds a Riot ID from first render but its list shows only
    // while focused, so an ungated query spends a request per mount.
    searchPlayerSuggestions.mockResolvedValue({ success: true, data: [player] });

    // Past the 250ms debounce: before it elapses an ungated query has not
    // fired either, so an immediate assertion would pass either way.
    vi.useFakeTimers();
    try {
      renderSelector(vi.fn(), "Previous#ONE");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(searchPlayerSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole("option")).toBeNull();

    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Choose test player"));
    await waitFor(() => expect(searchPlayerSuggestions).toHaveBeenCalled());
    // The list is what the request is for, and it only exists once focused.
    expect(
      await screen.findByRole("option", { name: "Selected#TAG (EUW)" }),
    ).toBeTruthy();
  });

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
