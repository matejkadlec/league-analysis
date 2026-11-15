"use client";

import { Swords } from "lucide-react";

import { MatchWithPlayerData } from "@/lib/core/schemas";
import { formatDateTime } from "@/lib/core/format";
import { useDDragonVersion } from "@/lib/core/riot/data-dragon-context";
import { cn } from "@/lib/core/utils";
import { Separator } from "@/components/ui/separator";
import { getMatchQueueName } from "@/lib/core/riot/queue-catalog";
import { TeamObjectiveStats } from "./objective-icons";
import {
  formatDuration,
  getDaysAgo,
  getMatchOutcome,
  winsStat,
  type SideStatHighlight,
} from "../match-row-format";
import {
  MatchSideColumn,
  MatchSideStats,
  MatchTeamCompositions,
} from "./match-side";

interface MatchRowProps {
  match: MatchWithPlayerData;
  playerPuuid: string;
  /** Make this participant the application's current player. */
  onSelectPlayer: (puuid: string) => void;
}

export function MatchRow({
  match,
  playerPuuid,
  onSelectPlayer,
}: MatchRowProps) {
  const ddragonVersion = useDDragonVersion();
  const participant = match.player_participant;
  const opponent = match.lane_opponent;
  const outcome = getMatchOutcome(match);
  const teamComps = match.team_compositions;
  const teamStats = match.team_stats;

  const csPerMinute = participant
    ? (participant.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  const opponentCsPerMinute = opponent
    ? (opponent.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  const blueTeamStats = teamStats?.blue_team ?? null;
  const redTeamStats = teamStats?.red_team ?? null;
  const playerTeamStats =
    participant?.team_id === 100
      ? blueTeamStats
      : participant?.team_id === 200
        ? redTeamStats
        : null;
  const enemyTeamStats =
    participant?.team_id === 100
      ? redTeamStats
      : participant?.team_id === 200
        ? blueTeamStats
        : null;
  const killParticipation =
    participant && playerTeamStats && playerTeamStats.kills > 0
      ? ((participant.kills + participant.assists) / playerTeamStats.kills) *
        100
      : null;
  const enemyKillParticipation =
    opponent && enemyTeamStats && enemyTeamStats.kills > 0
      ? ((opponent.kills + opponent.assists) / enemyTeamStats.kills) * 100
      : null;

  // Decided here because only the row sees both sides. CS compares the raw
  // `total_cs` integers rather than the `/min` strings: both participants
  // played the same `game_duration`, so the two orderings are the same.
  const playerStatHighlight: SideStatHighlight = {
    kda: winsStat(participant?.kda, opponent?.kda),
    cs: winsStat(participant?.total_cs, opponent?.total_cs),
    vision: winsStat(participant?.vision_score, opponent?.vision_score),
    killParticipation: winsStat(killParticipation, enemyKillParticipation),
  };
  const opponentStatHighlight: SideStatHighlight = {
    kda: winsStat(opponent?.kda, participant?.kda),
    cs: winsStat(opponent?.total_cs, participant?.total_cs),
    vision: winsStat(opponent?.vision_score, participant?.vision_score),
    killParticipation: winsStat(enemyKillParticipation, killParticipation),
  };

  return (
    <div
      className={cn(
        "px-3 py-1.5 rounded border-2 mb-1.5 border-t-1 border-b-1 border-amber-400/20 last:border-b-0 last:mb-0",
        outcome.bgClass,
      )}
    >
      {/* Never scrolls sideways (LGA-108). Below `lg` the eight blocks wrap as
          siblings, matchup first. From `lg` three fixed-width groups wrap as
          units instead: one line at 1920px, two at 1366px, three at 1024px. */}
      <div
        data-testid="match-row-layout"
        className="flex flex-wrap items-center gap-2 lg:justify-center"
      >
        {/* `min-w-0` lets this group take the row's width when its two halves
            cannot share a line, so they wrap inside it instead of overflowing. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-wrap lg:items-center lg:justify-center lg:gap-2">
          <div className="contents lg:flex lg:shrink-0 lg:items-center lg:gap-2">
            <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center lg:w-33 lg:shrink-0">
              <span className="text-sm font-medium text-center">
                {getMatchQueueName(match.queue_id)}
              </span>
              <span className="text-xs text-foreground/75 text-center mt-1">
                Patch {match.game_version.split(".").slice(0, 2).join(".")}
              </span>
            </div>

            <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center lg:w-33 lg:shrink-0">
              <span className="text-sm text-center">
                {formatDateTime(match.game_start_timestamp)}
              </span>
              <span className="text-xs text-center text-foreground/75 mt-1">
                {getDaysAgo(match.game_start_timestamp)}
              </span>
            </div>

            {/* Full width while stacked: a half here would pair the duration
                with the player's stat block and push the opponent's onto the
                next row, breaking the side-by-side reading of the wrap order. */}
            <div className="w-full shrink-0 text-center flex flex-col justify-center lg:w-16">
              {/* The row's tint is the only other outcome signal; colourblind
                  players need the word (WCAG 1.4.1: no colour-only meaning). */}
              <span className="text-[10px] font-semibold uppercase text-foreground/75">
                {outcome.label}
              </span>
              <span>{formatDuration(match.game_duration)}</span>
            </div>
          </div>

          <div
            data-testid="match-row-matchup"
            className="contents lg:flex lg:shrink-0 lg:items-center lg:gap-2"
          >
            {participant && (
              <MatchSideStats
                side="player"
                kda={participant.kda}
                totalCs={participant.total_cs}
                csPerMinute={csPerMinute}
                visionScore={participant.vision_score}
                killParticipation={killParticipation}
                highlight={playerStatHighlight}
              />
            )}

            {/* Content-sized from `lg`: a fixed width here once left 60px of
                nothing between the opponent's champion and their stat block. */}
            <div className="order-first flex w-full items-center gap-0 lg:order-none lg:w-auto lg:shrink-0">
              <MatchSideColumn
                side="player"
                participant={participant}
                ddragonVersion={ddragonVersion}
                emptyChampionFallback={false}
                emptyKdaFallback={false}
                onSelectPlayer={onSelectPlayer}
              />

              <div className="w-8 flex items-center justify-center shrink-0">
                <Swords className="h-5 w-5 text-muted-foreground" />
              </div>

              <MatchSideColumn
                side="opponent"
                participant={opponent}
                ddragonVersion={ddragonVersion}
                emptyChampionFallback
                emptyKdaFallback
                onSelectPlayer={onSelectPlayer}
              />
            </div>

            {opponent && (
              <MatchSideStats
                side="opponent"
                kda={opponent.kda}
                totalCs={opponent.total_cs}
                csPerMinute={opponentCsPerMinute}
                visionScore={opponent.vision_score}
                killParticipation={enemyKillParticipation}
                highlight={opponentStatHighlight}
              />
            )}
          </div>
        </div>

        {/* No per-match LP column: reliable historical per-match LP is not
            obtainable under the current Riot developer-key constraints.
            `match.lp_change` is still stored and still served. */}

        <div className="contents lg:flex lg:shrink-0 lg:items-center lg:gap-2">
          <MatchTeamCompositions
            teamComps={teamComps}
            playerPuuid={playerPuuid}
            ddragonVersion={ddragonVersion}
            onSelectPlayer={onSelectPlayer}
          />

          <div className="flex flex-col items-center justify-center gap-0.5">
            {blueTeamStats && (
              <TeamObjectiveStats stats={blueTeamStats} team="blue" />
            )}
            <Separator className="my-2 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
            {redTeamStats && (
              <TeamObjectiveStats stats={redTeamStats} team="red" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
