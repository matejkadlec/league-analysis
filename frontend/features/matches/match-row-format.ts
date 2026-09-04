import type { MatchWithPlayerData, ParticipantRunes } from "@/lib/core/schemas";
import { formatRiotId } from "@/features/players";

export interface MatchSideParticipant {
  champion_name: string;
  champion_level: number;
  kills: number;
  deaths: number;
  assists: number;
  summoner1_id?: number | null | undefined;
  summoner2_id?: number | null | undefined;
  runes?: ParticipantRunes | null | undefined;
  // Optional because the two shapes this stands in for differ: the API
  // identifies the lane opponent but not the current player's own
  // participant. An unidentified side is also an unswitchable one.
  puuid?: string | undefined;
  game_name?: string | undefined;
  tag_line?: string | undefined;
}

/**
 * The Riot ID and PUUID of a participant it is possible to switch to, or
 * `null` for one it is not.
 */
export function switchTarget(
  participant: MatchSideParticipant | null | undefined,
): { puuid: string; riotId: string } | null {
  if (!participant?.puuid || !participant.game_name) return null;
  return {
    puuid: participant.puuid,
    riotId: formatRiotId({
      game_name: participant.game_name,
      tag_line: participant.tag_line ?? "",
    }),
  };
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// `numeric: "auto"` is what produces "today"/"yesterday" natively; only the
// capitalisation is ours.
const dayFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function getDaysAgo(timestamp: number): string {
  // Calendar days apart, not elapsed 24-hour blocks: the absolute date above
  // is a local calendar day. Rounding rather than flooring keeps the 23- and
  // 25-hour days either side of a DST change on whole numbers.
  const diffDays = Math.round(
    (startOfLocalDay(Date.now()) - startOfLocalDay(timestamp)) / 86_400_000,
  );
  const formatted = dayFormatter.format(-diffDays, "day");
  return diffDays < 2
    ? formatted.charAt(0).toUpperCase() + formatted.slice(1)
    : formatted;
}

/**
 * How the game went, decided once for both signals the row shows: the tint
 * and the outcome word (WCAG 1.4.1 — colour is never the only carrier). A
 * remake is annulled; a missing participant is a data gap, so no verdict word.
 */
export function getMatchOutcome(
  // Only the two fields the verdict actually reads, so the rules are unit
  // testable without standing up a whole match.
  match: Pick<MatchWithPlayerData, "player_participant" | "early_surrender">,
): {
  label: string;
  bgClass: string;
} {
  const participant = match.player_participant;

  if (!participant) return { label: "—", bgClass: "bg-muted/30" };
  if (participant.remake || match.early_surrender)
    return { label: "Remake", bgClass: "bg-gray-500/50" };
  if (participant.win)
    return { label: "Victory", bgClass: "bg-emerald-700/30" };
  return { label: "Defeat", bgClass: "bg-rose-600/30" };
}

/** Which of one side's four statistics beat the other side's. */
export interface SideStatHighlight {
  kda: boolean;
  cs: boolean;
  vision: boolean;
  killParticipation: boolean;
}

/**
 * Whether this side wins one lane comparison. Compared on the canonical
 * numbers, never the rendered strings, so two values that round to the same
 * text still separate. A missing value or an exact tie leaves it unhighlighted.
 */
export function winsStat(
  mine: number | null | undefined,
  theirs: number | null | undefined,
): boolean {
  return mine != null && theirs != null && mine > theirs;
}
