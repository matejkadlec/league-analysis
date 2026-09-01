"use client";

import type { MatchWithPlayerData } from "@/lib/core/schemas";
import { getChampionDisplayName } from "@/lib/core/riot/data-dragon";
import { cn } from "@/lib/core/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type {
  MatchSideParticipant,
  SideStatHighlight,
} from "../match-row-format";
import {
  ChampionPortrait,
  renderRunes,
  renderSummonerSpells,
  renderTeamChampIcon,
} from "./match-row-icons";

export function MatchSideStats({
  kda,
  totalCs,
  csPerMinute,
  visionScore,
  killParticipation,
  highlight,
}: {
  kda: number;
  totalCs: number;
  csPerMinute: string;
  visionScore: number;
  killParticipation: number | null;
  highlight: SideStatHighlight;
}) {
  // Yellow marks the better side, but encodes nothing the numbers do not
  // already say (WCAG 1.4.1): a scan aid, not a state.
  const lead = (wins: boolean) => (wins ? " text-yellow-500" : "");
  return (
    <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center text-xs lg:ml-2 lg:w-25 lg:shrink-0">
      <span className={lead(highlight.kda).trim()}>
        <span className="font-medium">{kda.toFixed(2)}</span> KDA
      </span>
      <span className={cn("mt-0.5", lead(highlight.cs))}>
        <span className="font-medium">{totalCs}</span> CS ({csPerMinute}/min)
      </span>
      <span className={cn("mt-0.5", lead(highlight.vision))}>
        <span className="font-medium">{visionScore}</span> Vision Score
      </span>
      <span className={cn("mt-0.5", lead(highlight.killParticipation))}>
        <span className="font-medium">
          {killParticipation !== null
            ? `${killParticipation.toFixed(0)}%`
            : "—"}
        </span>{" "}
        Kill Particip.
      </span>
    </div>
  );
}

export function MatchSideColumn({
  participant,
  ddragonVersion,
  emptyChampionFallback,
  emptyKdaFallback,
  onSelectPlayer,
}: {
  participant: MatchSideParticipant | null | undefined;
  ddragonVersion: string;
  emptyChampionFallback: boolean;
  emptyKdaFallback: boolean;
  onSelectPlayer: (puuid: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 lg:w-48 lg:flex-none">
      {/* Below `lg` the two sides split one phone width, and the rune icons
          are the detail worth trading for a readable champion name. */}
      <div className="hidden lg:block">{renderRunes(participant?.runes)}</div>

      <div className="flex flex-col items-center gap-0.5">
        <ChampionPortrait
          participant={participant}
          ddragonVersion={ddragonVersion}
          emptyChampionFallback={emptyChampionFallback}
          onSelectPlayer={onSelectPlayer}
        />
        {renderSummonerSpells(
          [participant?.summoner1_id, participant?.summoner2_id],
          ddragonVersion,
        )}
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm font-medium truncate cursor-default">
                {participant
                  ? getChampionDisplayName(participant.champion_name)
                  : "—"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {participant
                  ? getChampionDisplayName(participant.champion_name)
                  : "—"}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="text-xs text-foreground/75">
          {participant ? `Lv ${participant.champion_level}` : "—"}
        </span>
        {participant ? (
          <span className="text-xs">
            {participant.kills} / {participant.deaths} / {participant.assists}
          </span>
        ) : emptyKdaFallback ? (
          // text-foreground/75 like the other row text: this fallback sits on
          // the same win/loss tint that failed 4.5:1 under muted-foreground.
          <span className="text-xs text-foreground/75">—</span>
        ) : null}
      </div>
    </div>
  );
}

export function MatchTeamCompositions({
  teamComps,
  playerPuuid,
  ddragonVersion,
  onSelectPlayer,
}: {
  teamComps: MatchWithPlayerData["team_compositions"];
  playerPuuid: string;
  ddragonVersion: string;
  onSelectPlayer: (puuid: string) => void;
}) {
  return (
    <div className="flex w-37 flex-col items-center justify-center gap-0.5 lg:mr-1">
      {teamComps ? (
        <>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-blue-900/30 rounded px-1 py-0.5">
              {teamComps.blue_team.map((champ) =>
                renderTeamChampIcon(
                  champ,
                  champ.puuid === playerPuuid,
                  "blue",
                  ddragonVersion,
                  onSelectPlayer,
                ),
              )}
            </div>
          </div>
          {/* text-foreground/75 like the rest of the row: muted-foreground
              composites to 3.1-4.4:1 on the win/loss tints, under 4.5:1. */}
          <div className="text-center text-xs text-foreground/75">Vs</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-red-900/30 rounded px-1 py-0.5">
              {teamComps.red_team.map((champ) =>
                renderTeamChampIcon(
                  champ,
                  champ.puuid === playerPuuid,
                  "red",
                  ddragonVersion,
                  onSelectPlayer,
                ),
              )}
            </div>
          </div>
        </>
      ) : (
        // Same contrast reasoning as the KDA fallback above.
        <div className="text-xs text-foreground/75 text-center">—</div>
      )}
    </div>
  );
}
