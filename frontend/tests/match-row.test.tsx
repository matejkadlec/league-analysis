// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatchRow } from "@/features/matches/components/match-row";
import type {
  MatchWithPlayerData,
  PlayerMatchParticipant,
  EnemyLaneOpponent,
  TeamStats,
} from "@/lib/core/schemas";

type SelectPlayer = ComponentProps<typeof MatchRow>["onSelectPlayer"];

const PLAYER_PUUID = "player-puuid";

/** A local-time moment, so the row's local-time getters have a known answer. */
const GAME_START = new Date(2026, 2, 4, 14, 7).getTime();

const TEAM_STATS: TeamStats = {
  kills: 20,
  deaths: 15,
  assists: 30,
  turrets: 5,
  inhibitors: 1,
  dragons: 2,
  barons: 1,
  rift_heralds: 1,
  voidgrubs: 3,
};

const PARTICIPANT: PlayerMatchParticipant = {
  champion_id: 103,
  champion_name: "Ahri",
  champion_level: 16,
  team_position: "MIDDLE",
  team_id: 100,
  win: true,
  remake: false,
  kills: 4,
  deaths: 2,
  assists: 6,
  kda: 5,
  total_cs: 210,
  vision_score: 24,
  total_damage_dealt_to_champions: 24000,
  summoner1_id: 4,
  summoner2_id: 14,
  runes: { primary_style: 8200, sub_style: 8300, keystone: 8214 },
};

const OPPONENT: EnemyLaneOpponent = {
  puuid: "opponent-puuid",
  game_name: "Shadow",
  tag_line: "EUN1",
  champion_id: 238,
  champion_name: "Zed",
  champion_level: 15,
  kills: 4,
  deaths: 5,
  assists: 4,
  kda: 1.6,
  total_cs: 190,
  vision_score: 14,
  total_damage_dealt_to_champions: 21000,
  summoner1_id: 4,
  summoner2_id: 12,
  runes: { primary_style: 8100, sub_style: 8000, keystone: 8112 },
};

function champ(name: string, puuid: string) {
  return {
    champion_id: 1,
    champion_name: name,
    team_position: null,
    puuid,
    game_name: name,
    tag_line: "EUN1",
  };
}

const MATCH: MatchWithPlayerData = {
  match_id: "EUN1_1",
  platform: "eun1",
  game_creation_timestamp: GAME_START - 60_000,
  game_start_timestamp: GAME_START,
  game_start_timestamp_source: "riot_game_start",
  game_duration: 1265,
  queue_id: 420,
  game_version: "15.16.1.2345",
  map_id: 11,
  game_mode: "CLASSIC",
  game_type: "MATCHED_GAME",
  game_end_timestamp: GAME_START + 1_265_000,
  early_surrender: false,
  surrender: false,
  game_result: "Win",
  fully_analyzed: true,
  created_at: "2026-03-04T00:00:00Z",
  updated_at: "2026-03-04T00:00:00Z",
  player_participant: PARTICIPANT,
  lane_opponent: OPPONENT,
  lp_change: 18,
  team_compositions: {
    blue_team: [
      champ("Ahri", PLAYER_PUUID),
      champ("Garen", "b2"),
      champ("Lulu", "b3"),
      champ("Jinx", "b4"),
      champ("LeeSin", "b5"),
    ],
    red_team: [
      champ("Zed", "r1"),
      champ("Darius", "r2"),
      champ("Thresh", "r3"),
      champ("Caitlyn", "r4"),
      champ("Elise", "r5"),
    ],
  },
  // Different totals on purpose, so each wiring gives a distinct percentage:
  // 10 of blue's 20 = 50%, 8 of red's 40 = 20%; crossed reads 25% and 40%.
  team_stats: {
    blue_team: { ...TEAM_STATS, kills: 20 },
    red_team: { ...TEAM_STATS, kills: 40 },
  },
};

function renderRow(
  overrides: Partial<MatchWithPlayerData> = {},
  onSelectPlayer: SelectPlayer = vi.fn<SelectPlayer>(),
) {
  return render(
    <MatchRow
      match={{ ...MATCH, ...overrides }}
      playerPuuid={PLAYER_PUUID}
      onSelectPlayer={onSelectPlayer}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("a match history row", () => {
  it("measures kill participation against the player's own team, not the enemy's", () => {
    // Crossed, both numbers stay plausible percentages and nothing else on the
    // row contradicts them.
    renderRow();

    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
  });

  it("shows a dash rather than Infinity when the team recorded no kills", () => {
    // A shut-out team is a real scoreline and `kills` is the denominator:
    // without the `> 0` guard the row prints "Infinity%".
    renderRow({
      team_stats: {
        blue_team: { ...TEAM_STATS, kills: 0 },
        red_team: { ...TEAM_STATS, kills: 40 },
      },
    });

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText(/Infinity/)).toBeNull();
    // Only one side loses its denominator; pinning the count stops this passing
    // when both blocks go blank.
    expect(screen.getByText("20%")).toBeTruthy();
  });

  // The tint carries the outcome for sighted players, and `getMatchOutcome`
  // derives it and the label from one branch, so they cannot disagree.
  const tint = (container: HTMLElement) =>
    container.firstElementChild?.className ?? "";

  it.each([
    ["win", { win: true, remake: false }, false],
    ["defeat", { win: false, remake: false }, false],
  ] as const)(
    "tints a plain %s with its own colour",
    (_label, flags, earlySurrender) => {
      const { container } = renderRow({
        early_surrender: earlySurrender,
        player_participant: { ...PARTICIPANT, ...flags },
      });

      expect(tint(container)).toContain(
        flags.win ? "bg-emerald-700/30" : "bg-rose-600/30",
      );
      // The outcome must also exist as text - the tint alone is a WCAG 1.4.1
      // (colour-only meaning) failure for red/green colourblind players.
      expect(
        container.textContent?.includes(flags.win ? "Victory" : "Defeat"),
      ).toBe(true);
    },
  );

  it("labels a remake with the word, not only the grey tint", () => {
    const { container } = renderRow({
      player_participant: { ...PARTICIPANT, win: true, remake: true },
    });

    expect(container.textContent).toContain("Remake");
    expect(container.textContent).not.toContain("Victory");
  });

  it("tints a won remake as a remake, not as a victory", () => {
    // `remake` is checked before `win`: a remake is annulled, so the winning
    // side did not win anything.
    const { container } = renderRow({
      player_participant: { ...PARTICIPANT, win: true, remake: true },
    });

    expect(tint(container)).toContain("bg-gray-500/50");
    expect(tint(container)).not.toContain("emerald");
  });

  it("treats an early surrender as a remake even when the participant flag is not set", () => {
    // `remake` comes off the participant, `early_surrender` off the match, and
    // either one alone means the game was voided.
    const { container } = renderRow({
      early_surrender: true,
      player_participant: { ...PARTICIPANT, win: false, remake: false },
    });

    expect(tint(container)).toContain("bg-gray-500/50");
    expect(tint(container)).not.toContain("rose");
  });

  it("falls back to a neutral tint when the player is not in the match", () => {
    // No `player_participant` is a data gap, not a loss; without the guard the
    // cascade falls through to the defeat colour.
    const { container } = renderRow({ player_participant: null });

    expect(tint(container)).toContain("bg-muted/30");
    expect(tint(container)).not.toContain("rose");
    expect(container.textContent).not.toContain("Defeat");
  });

  it("shows the game length but never a per-match LP number", () => {
    // Per-match LP is not obtainable under a Riot developer key, so `lp_change`
    // still arrives but must not reach the screen.
    const { container } = renderRow({ lp_change: 18 });

    expect(container.textContent).not.toContain("LP");
    expect(screen.getByText("21:05")).toBeTruthy();
    expect(container.textContent).toContain("Victory");
  });

  it("shows a zero KDA as 0.00, not as a perfect game", () => {
    // `kda` is a generated column: 0 kills and 0 assists is 0.00, so reading it
    // as falsey prints "Perfect" on the worst games.
    renderRow({ player_participant: { ...PARTICIPANT, kda: 0 } });

    expect(
      screen.getAllByText(/KDA$/).map((element) => element.textContent),
    ).toContain("0.00 KDA");
    expect(screen.queryByText("Perfect")).toBeNull();
  });

  // Both lineups render through one helper from two call sites, so a test that
  // only ever puts the player on blue leaves the red one unwatched.
  it.each([
    ["blue", PLAYER_PUUID, "b1", "Ahri"],
    ["red", "b1", PLAYER_PUUID, "Zed"],
  ])(
    "rings exactly one champion as the player when they are on %s",
    (_side, bluePuuid, redPuuid, expectedChampion) => {
      // Ten icons, and only the yellow ring says which is the viewer: compare
      // the wrong field and the ring lands on a stranger.
      const { container } = renderRow({
        team_compositions: {
          blue_team: [
            champ("Ahri", bluePuuid),
            ...MATCH.team_compositions!.blue_team.slice(1),
          ],
          red_team: [
            champ("Zed", redPuuid),
            ...MATCH.team_compositions!.red_team.slice(1),
          ],
        },
      });

      const ringed = container.querySelectorAll(".ring-yellow-400");
      expect(ringed).toHaveLength(1);
      // The champion travels on the image's `alt`: these icons carry a Riot ID
      // tooltip, so a wrapper `title` would reach neither kind of reader.
      expect(ringed[0]?.querySelector("img")?.getAttribute("alt")).toBe(
        expectedChampion,
      );
      // Without the total, a mutation rendering one icon per lineup instead of
      // five would still leave exactly one ringed.
      expect(container.querySelectorAll("[class*='ring-']")).toHaveLength(10);
      // And exactly the viewer's own is inert; the other nine switch player.
      expect(container.querySelectorAll("button[class*='ring-']")).toHaveLength(
        9,
      );
    },
  );

  it("draws a dash instead of a lineup when the match has no team compositions", () => {
    // Older rows predate composition capture; without the guard the two `.map`
    // calls run on `undefined` and take the whole match list down.
    const { container } = renderRow({ team_compositions: null });

    expect(container.querySelectorAll("[title][class*='ring-']")).toHaveLength(
      0,
    );
    // The placeholder is the point: dropping it for `null` leaves the icon
    // assertion above green while the column silently renders nothing.
    const compositions = container.querySelector("div[class*='w-37']");
    expect(compositions?.textContent).toBe("—");
  });

  it("writes the date, the clock and the duration the way a human reads them", () => {
    // Hand-rolled formatters: `2:07` not `2:7`, `21:05` not `21:5`. The
    // duration is Riot seconds, so 1265 is twenty-one minutes and five.
    renderRow();

    expect(screen.getByText("4.3.2026 2:07 PM")).toBeTruthy();
    expect(screen.getByText("21:05")).toBeTruthy();
  });

  it.each([
    // Midnight is the one hour `hours % 12` turns into 0, and noon the only
    // hour where `>= 12` and `> 12` disagree.
    [new Date(2026, 2, 4, 0, 0), "4.3.2026 12:00 AM"],
    [new Date(2026, 2, 4, 12, 0), "4.3.2026 12:00 PM"],
    [new Date(2026, 2, 4, 23, 59), "4.3.2026 11:59 PM"],
  ])("writes a game started at %s as %s", (startedAt, expected) => {
    renderRow({ game_start_timestamp: startedAt.getTime() });

    expect(screen.getByText(expected)).toBeTruthy();
  });

  it.each([
    [2, "Today"],
    [26, "Yesterday"],
    [24 * 5 + 2, "5 days ago"],
  ])("calls a game %i hours old %s", (hoursAgo, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0));
    renderRow({
      game_start_timestamp: Date.now() - hoursAgo * 60 * 60 * 1000,
    });

    expect(screen.getByText(expected)).toBeTruthy();
  });

  it.each([
    [new Date(2026, 2, 10, 0, 30), "Today"],
    [new Date(2026, 2, 9, 23, 0), "Yesterday"],
    [new Date(2026, 2, 8, 23, 59), "2 days ago"],
  ])(
    "puts a game played at %s in the band its own date is in",
    (playedAt, expected) => {
      // Counting elapsed 24-hour blocks from 10:00 makes last night's 23:00
      // game "Today" under a printed date reading the 9th.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 10, 10, 0));
      renderRow({ game_start_timestamp: playedAt.getTime() });

      expect(screen.getByText(expected)).toBeTruthy();
    },
  );

  it("shortens the game version to the patch it was played on", () => {
    // Riot sends a four-part build string; keep two parts or every game in a
    // season collapses onto "Patch 15".
    renderRow({ game_version: "15.16.1.2345" });

    expect(screen.getByText("Patch 15.16")).toBeTruthy();
  });

  it("names the queue the game was played in", () => {
    renderRow({ queue_id: 420 });

    expect(screen.getByText("Ranked Solo/Duo")).toBeTruthy();
  });

  // Spans in document order, so index 0 is the player's. `selector` keeps the
  // ancestor `div` -- whose text also ends in "Kill Particip." -- out.
  const statClasses = (pattern: RegExp) =>
    screen
      .getAllByText(pattern, { selector: "span" })
      .map((span) => span.className);

  it("colours the better side of each stat and neither side of a tie", () => {
    // The comparison must see both sides: derived from one it would highlight
    // whatever the player had, and a tie would light up both blocks.
    renderRow({
      lane_opponent: { ...OPPONENT, total_cs: PARTICIPANT.total_cs },
    });

    // KDA 5.00 against 1.60, vision 24 against 14, kill participation 50%
    // against 20%: the player's side wins all three outright.
    expect(statClasses(/KDA$/)).toEqual(["text-yellow-500", ""]);
    expect(statClasses(/Vision Score$/)).toEqual([
      "mt-0.5 text-yellow-500",
      "mt-0.5",
    ]);
    expect(statClasses(/Kill Particip\.$/)).toEqual([
      "mt-0.5 text-yellow-500",
      "mt-0.5",
    ]);
    // Tied CS, so neither -- including the `/min` parenthetical, which is
    // highlighted with the total it is derived from.
    expect(statClasses(/min\)$/)).toEqual(["mt-0.5", "mt-0.5"]);
  });

  it("labels the rune icons with the keystone and the secondary tree", () => {
    // The primary icon is the keystone, so labelling it with its tree puts
    // "Sorcery" on a Summon Aery icon; the secondary icon really is a tree.
    renderRow();

    expect(screen.getByAltText("Summon Aery")).toBeTruthy();
    expect(screen.getByAltText("Electrocute")).toBeTruthy();
    expect(screen.queryByAltText("Sorcery")).toBeNull();
    expect(screen.getByAltText("Inspiration")).toBeTruthy();
    expect(screen.getByAltText("Precision")).toBeTruthy();
    // Both laners took Flash; the player added Ignite, the opponent Teleport.
    expect(screen.getAllByAltText("Flash")).toHaveLength(2);
    expect(screen.getByAltText("Ignite")).toBeTruthy();
    expect(screen.getByAltText("Teleport")).toBeTruthy();
    expect(screen.queryByAltText("Summoner Spell")).toBeNull();
  });

  it("offers one keyboard stop per rune or spell group, not per icon", () => {
    // The names must stay keyboard-reachable without a stop per icon: each
    // side's rune pair and spell pair is one group, so 2 sides x 2 groups.
    const { container } = renderRow();

    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(4);
  });

  it("falls back to the tree when the keystone is one we have no name for", () => {
    // Tooltip and icon read the same keystone table, so an unknown one must
    // drop both to the tree rather than name a rune the icon does not show.
    renderRow({
      player_participant: {
        ...PARTICIPANT,
        runes: { primary_style: 8200, sub_style: 8300, keystone: 999999 },
      },
    });

    expect(screen.getByAltText("Sorcery")).toBeTruthy();
  });

  it("names participants by Riot ID and switches to the one clicked", async () => {
    const onSelectPlayer = vi.fn<SelectPlayer>();
    const user = userEvent.setup();
    renderRow({}, onSelectPlayer);

    // The champion is what the icon already is; whose game it was is what the
    // row never said.
    const garen = screen.getByRole("button", {
      name: "Garen \u2014 view Garen#EUN1",
    });
    // Label and art must name the same participant: a Riot ID over somebody
    // else's champion sends the click somewhere the row did not offer.
    expect(garen.querySelector("img")?.getAttribute("alt")).toBe("Garen");
    await user.click(garen);

    expect(onSelectPlayer).toHaveBeenCalledTimes(1);
    expect(onSelectPlayer).toHaveBeenCalledWith("b2");
  });

  it("switches to the lane opponent from the matchup portrait", async () => {
    const onSelectPlayer = vi.fn<SelectPlayer>();
    const user = userEvent.setup();
    renderRow({}, onSelectPlayer);

    const portrait = screen.getByRole("button", {
      name: "Zed \u2014 view Shadow#EUN1",
    });
    // The enemy composition icon shows the same champion under their own Riot
    // ID; only the matchup portrait pairs Zed with the lane opponent.
    expect(portrait.querySelector("img")?.getAttribute("alt")).toBe("Zed");
    await user.click(portrait);

    expect(onSelectPlayer).toHaveBeenCalledWith("opponent-puuid");
  });

  it("leaves the current player's own icons inert", async () => {
    const onSelectPlayer = vi.fn<SelectPlayer>();
    const user = userEvent.setup();
    renderRow({}, onSelectPlayer);

    // The viewer's own icon carries the Riot ID like every other, but switching
    // to the current player is a redundant refresh, so it is not a control.
    expect(
      screen.queryByRole("button", { name: /view Ahri#EUN1/ }),
    ).toBeNull();

    // Their own matchup portrait likewise -- the API does not identify it, so
    // there is nothing to switch to. Only the opponent's is a button.
    const portraits = screen.getAllByAltText("Ahri");
    for (const portrait of portraits) {
      expect(portrait.closest("button")).toBeNull();
    }
    // Nothing above was clickable, so nothing could have fired.
    await user.click(screen.getAllByAltText("Ahri")[0]!);
    expect(onSelectPlayer).not.toHaveBeenCalled();
  });
});
