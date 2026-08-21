// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatchRow } from "@/features/matches/components/match-row";
import type {
  MatchWithPlayerData,
  PlayerMatchParticipant,
  EnemyLaneOpponent,
  TeamStats,
} from "@/lib/core/schemas";

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
  return { champion_id: 1, champion_name: name, team_position: null, puuid };
}

const MATCH: MatchWithPlayerData = {
  match_id: "EUN1_1",
  platform: "EUN1",
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
  // The two sides carry different kill totals on purpose: every one of the
  // four ways the two stat blocks could be wired to them produces a distinct
  // percentage, so an assertion on the number says which team it was read
  // from. Player 10 of blue's 20 = 50%; opponent 8 of red's 40 = 20%; the
  // crossed wiring would read 25% and 40%.
  team_stats: {
    blue_team: { ...TEAM_STATS, kills: 20 },
    red_team: { ...TEAM_STATS, kills: 40 },
  },
};

function renderRow(overrides: Partial<MatchWithPlayerData> = {}) {
  return render(
    <MatchRow match={{ ...MATCH, ...overrides }} playerPuuid={PLAYER_PUUID} />,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("a match history row", () => {
  it("measures kill participation against the player's own team, not the enemy's", () => {
    // `playerTeamStats` picks blue or red off `participant.team_id`, and the
    // opponent's block reads the mirror. Cross the two and both numbers stay
    // plausible — they are percentages in range, on the right screen — while
    // telling the player they carried a fight they sat out of. There is
    // nothing else on the row to notice it against.
    renderRow();

    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
  });

  it("shows a dash rather than Infinity when the team recorded no kills", () => {
    // A team that got shut out is a real scoreline, not a corrupt row, and
    // `kills` is the denominator. Without the `> 0` guard the row prints
    // "Infinity%" as a kill participation.
    renderRow({
      team_stats: {
        blue_team: { ...TEAM_STATS, kills: 0 },
        red_team: { ...TEAM_STATS, kills: 40 },
      },
    });

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText(/Infinity/)).toBeNull();
    // The opponent's side still has a denominator, so exactly one of the two
    // blocks falls back. Pinning the count is what stops this passing because
    // both went blank.
    expect(screen.getByText("20%")).toBeTruthy();
  });

  // A Tailwind class is asserted here for the same reason the matchmaking
  // history row asserts one: the tint carries the outcome for sighted
  // players, and `getMatchOutcome` derives it and the text label from one
  // branch — so the class and the word are pinned together, and a row whose
  // tint and label disagree cannot pass.
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
    // `remake` is checked before `win`, and the order is the whole point: a
    // remake is annulled, so the winning side did not win anything. Read the
    // other way round the row puts a victory colour behind a voided game.
    const { container } = renderRow({
      player_participant: { ...PARTICIPANT, win: true, remake: true },
    });

    expect(tint(container)).toContain("bg-gray-500/50");
    expect(tint(container)).not.toContain("emerald");
  });

  it("treats an early surrender as a remake even when the participant flag is not set", () => {
    // The two flags come from different places — `remake` off the
    // participant, `early_surrender` off the match — and either one alone
    // means the game was voided. Dropping the match-level half tints a
    // three-minute AFK game as a real defeat.
    const { container } = renderRow({
      early_surrender: true,
      player_participant: { ...PARTICIPANT, win: false, remake: false },
    });

    expect(tint(container)).toContain("bg-gray-500/50");
    expect(tint(container)).not.toContain("rose");
  });

  it("falls back to a neutral tint when the player is not in the match", () => {
    // A row with no `player_participant` is a data gap, not a loss. Without
    // the guard the cascade falls through to the defeat colour and the row
    // reads as a game the player lost — in the tint and, since the outcome
    // word was added, in text too.
    const { container } = renderRow({ player_participant: null });

    expect(tint(container)).toContain("bg-muted/30");
    expect(tint(container)).not.toContain("rose");
    expect(container.textContent).not.toContain("Defeat");
  });

  it("labels a remake's zero as +0 LP rather than a flat 0", () => {
    // `formatMatchLpChange` distinguishes the two, and the row is what feeds
    // it `isRemake`. Pass a constant there and a remake reads as a game that
    // was played and won nothing, which is the thing the player is checking.
    renderRow({
      lp_change: 0,
      early_surrender: true,
      player_participant: { ...PARTICIPANT, remake: false },
    });

    expect(screen.getByText("+0 LP")).toBeTruthy();
  });

  it("does not call a data-gap row's zero a remake's +0", () => {
    // With no participant the row is a data gap, not a played remake — the
    // outcome cell shows a dash, and the LP cell must agree. Computing the
    // remake flag outside getMatchOutcome is what let the two disagree:
    // `early_surrender` alone made isRemake true while the outcome said "—".
    renderRow({
      lp_change: 0,
      early_surrender: true,
      player_participant: null,
    });

    expect(screen.getByText("0 LP")).toBeTruthy();
    expect(screen.queryByText("+0 LP")).toBeNull();
  });

  it("marks an unavailable LP change as unavailable to a screen reader", () => {
    // Sighted readers get a greyed em dash. Without the `aria-label` the
    // accessible name is the dash character alone, which announces as
    // punctuation or as nothing at all.
    renderRow({ lp_change: null });

    expect(screen.getByLabelText("LP change unavailable")).toBeTruthy();
  });

  it("shows a zero KDA as 0.00, not as a perfect game", () => {
    // `kda` is a generated column: 0 kills and 0 assists is 0.00, and 1,715
    // production rows are exactly that. The row used to read it as falsey and
    // print "Perfect" -- the best possible game -- on the worst ones.
    renderRow({ player_participant: { ...PARTICIPANT, kda: 0 } });

    expect(
      screen.getAllByText(/KDA$/).map((element) => element.textContent),
    ).toContain("0.00 KDA");
    expect(screen.queryByText("Perfect")).toBeNull();
  });

  // Both lineups are rendered through the same helper but from two separate
  // call sites, so the comparison that finds the viewer exists twice. A test
  // that only ever puts the player on blue leaves the red call site unwatched.
  it.each([
    ["blue", PLAYER_PUUID, "b1", "Ahri"],
    ["red", "b1", PLAYER_PUUID, "Zed"],
  ])(
    "rings exactly one champion as the player when they are on %s",
    (_side, bluePuuid, redPuuid, expectedChampion) => {
      // Ten icons, and the only thing saying which one is the viewer is the
      // yellow ring. Compare the wrong field and either nobody is highlighted
      // or — worse — the ring lands on a stranger and the row reads as
      // somebody else's game.
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
      expect(ringed[0]?.getAttribute("title")).toBe(expectedChampion);
      // The count above is only meaningful next to the total: without this, a
      // mutation that renders one icon per lineup instead of five would still
      // leave exactly one ringed.
      expect(
        container.querySelectorAll("[title][class*='ring-']"),
      ).toHaveLength(10);
    },
  );

  it("draws a dash instead of a lineup when the match has no team compositions", () => {
    // Older rows predate composition capture. The `—` placeholder is what
    // keeps the row's columns from collapsing; without the guard the two
    // `.map` calls run on `undefined` and the whole row throws, taking the
    // rest of the match list down with it.
    const { container } = renderRow({ team_compositions: null });

    expect(container.querySelectorAll("[title][class*='ring-']")).toHaveLength(
      0,
    );
  });

  it("writes the date, the clock and the duration the way a human reads them", () => {
    // Three hand-rolled formatters, each with the fix everyone forgets:
    // `2:07` not `2:7`, and `21:05` not `21:5`. The duration is seconds from
    // Riot, so 1265 is twenty-one minutes and five seconds.
    renderRow();

    expect(screen.getByText("4.3.2026 2:07 PM")).toBeTruthy();
    expect(screen.getByText("21:05")).toBeTruthy();
  });

  it.each([
    // Midnight is the one hour `hours % 12` turns into 0, which is what the
    // `hours ? hours : 12` line exists for, and noon is the only hour where
    // `>= 12` and `> 12` disagree. Every other hour reads correctly with
    // either line deleted.
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
      // The boundary the label used to get wrong. Counting elapsed 24-hour
      // blocks from 10:00 made last night's 23:00 game "Today" — under a
      // printed date reading the 9th — and pushed "Yesterday" into the 8th.
      // The label and the date above it are two readings of one instant, so
      // they change over at the same local midnight.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 10, 10, 0));
      renderRow({ game_start_timestamp: playedAt.getTime() });

      expect(screen.getByText(expected)).toBeTruthy();
    },
  );

  it("shortens the game version to the patch it was played on", () => {
    // Riot sends a four-part build string. Players compare patches, not
    // builds, so the row keeps two parts — take one and every game in a
    // season collapses onto "Patch 15".
    renderRow({ game_version: "15.16.1.2345" });

    expect(screen.getByText("Patch 15.16")).toBeTruthy();
  });

  it("names the queue the game was played in", () => {
    renderRow({ queue_id: 420 });

    expect(screen.getByText("Ranked Solo/Duo")).toBeTruthy();
  });
});
