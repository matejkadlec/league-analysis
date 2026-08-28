import { afterEach, describe, expect, it, vi } from "vitest";

import type { MatchWithPlayerData } from "@/lib/core/schemas";
import {
  formatDuration,
  getDaysAgo,
  getMatchOutcome,
  switchTarget,
  winsStat,
} from "@/features/matches/components/match-row-format";

/**
 * These four are pure and only reachable through a full `MatchRow` render in
 * `match-row.test.tsx`, which cannot move the clock or omit a participant.
 */

type Participant = NonNullable<MatchWithPlayerData["player_participant"]>;

const PARTICIPANT: Participant = {
  champion_id: 103,
  champion_name: "Ahri",
  champion_level: 15,
  team_position: "MIDDLE",
  team_id: 100,
  win: true,
  remake: false,
  kills: 8,
  deaths: 2,
  assists: 12,
  kda: 10,
  total_cs: 200,
  vision_score: 24,
  total_damage_dealt_to_champions: 25_000,
  summoner1_id: 4,
  summoner2_id: 14,
  runes: null,
};

function outcome(
  participant: Participant | null,
  early_surrender = false,
): string {
  return getMatchOutcome({ player_participant: participant, early_surrender })
    .label;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getDaysAgo", () => {
  // Local midnight, not elapsed hours, is what separates the bands -- so the
  // interesting case is a match nine hours ago that still reads "Yesterday".
  function at(now: Date, then: Date): string {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    return getDaysAgo(then.getTime());
  }

  it("calls the same calendar day today, whatever the hour", () => {
    expect(at(new Date(2026, 2, 4, 8, 0), new Date(2026, 2, 4, 0, 1))).toBe(
      "Today",
    );
    expect(at(new Date(2026, 2, 4, 23, 59), new Date(2026, 2, 4, 8, 0))).toBe(
      "Today",
    );
  });

  it("crosses to yesterday on the calendar boundary, not after 24 hours", () => {
    // Nine hours apart, one calendar day: flooring elapsed time would say
    // "Today" here, which is the bug the local-midnight rounding prevents.
    expect(at(new Date(2026, 2, 4, 8, 0), new Date(2026, 2, 3, 23, 0))).toBe(
      "Yesterday",
    );
    // Nearly 48 hours apart, still one calendar day.
    expect(at(new Date(2026, 2, 4, 23, 59), new Date(2026, 2, 3, 0, 1))).toBe(
      "Yesterday",
    );
  });

  it("counts plainly from two days back, uncapitalised", () => {
    expect(at(new Date(2026, 2, 4, 12, 0), new Date(2026, 2, 2, 12, 0))).toBe(
      "2 days ago",
    );
    expect(at(new Date(2026, 2, 4, 0, 1), new Date(2026, 2, 2, 23, 59))).toBe(
      "2 days ago",
    );
    expect(at(new Date(2026, 2, 4, 12, 0), new Date(2026, 1, 25, 12, 0))).toBe(
      "7 days ago",
    );
  });
});

describe("getMatchOutcome", () => {
  it("gives no verdict when the participant is missing", () => {
    // A data gap, not a loss: the row must not call it a defeat.
    expect(outcome(null)).toBe("—");
  });

  it("annuls a remake from either side's flag", () => {
    expect(outcome({ ...PARTICIPANT, remake: true })).toBe("Remake");
    expect(outcome(PARTICIPANT, true)).toBe("Remake");
  });

  it("prefers the remake verdict over a win or a loss", () => {
    expect(outcome({ ...PARTICIPANT, win: true, remake: true })).toBe("Remake");
    expect(outcome({ ...PARTICIPANT, win: false }, true)).toBe("Remake");
  });

  it("reads the win flag for every completed game", () => {
    expect(outcome(PARTICIPANT)).toBe("Victory");
    expect(outcome({ ...PARTICIPANT, win: false })).toBe("Defeat");
  });
});

describe("winsStat", () => {
  it("needs both numbers and a strict lead", () => {
    expect(winsStat(5, 3)).toBe(true);
    expect(winsStat(3, 5)).toBe(false);
    // An exact tie highlights neither side.
    expect(winsStat(5, 5)).toBe(false);
    expect(winsStat(null, 3)).toBe(false);
    expect(winsStat(5, undefined)).toBe(false);
    // 0 is a real value, not a missing one.
    expect(winsStat(0, -1)).toBe(true);
  });
});

describe("switchTarget", () => {
  it("refuses a participant the API did not identify", () => {
    expect(switchTarget(null)).toBeNull();
    expect(switchTarget({ ...PARTICIPANT, game_name: "Zed" })).toBeNull();
    expect(switchTarget({ ...PARTICIPANT, puuid: "p1" })).toBeNull();
  });

  it("assembles the Riot ID, tolerating a missing tag", () => {
    expect(
      switchTarget({
        ...PARTICIPANT,
        puuid: "p1",
        game_name: "Zed",
        tag_line: "EUN1",
      }),
    ).toEqual({ puuid: "p1", riotId: "Zed#EUN1" });
    // No tag line is still switchable; the ID is just the game name.
    expect(
      switchTarget({ ...PARTICIPANT, puuid: "p1", game_name: "Zed" })?.riotId,
    ).toBe("Zed");
  });
});

describe("formatDuration", () => {
  it("pads the seconds so the column stays aligned", () => {
    expect(formatDuration(1265)).toBe("21:05");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(3600)).toBe("60:00");
  });
});
