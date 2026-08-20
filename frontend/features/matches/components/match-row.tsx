"use client";

import Image from "next/image";
import { Swords } from "lucide-react";

import {
  MatchWithPlayerData,
  ParticipantRunes,
  TeamChampion,
  TeamStats,
} from "@/lib/core/schemas";
import {
  getChampionIconUrl,
  getChampionDisplayName,
  getSummonerSpellIconUrlById,
  getKeystoneIconUrlById,
  getRuneStyleIconUrl,
  getRuneStyleName,
} from "@/lib/core/data-dragon";
import { formatDateTime } from "@/lib/core/format";
import { useDDragonVersion } from "@/lib/core/data-dragon-context";
import { formatMatchLpChange } from "../utils/lp-change";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { getMatchQueueName } from "../queue-catalog";
import { TeamObjectiveStats } from "./objective-icons";

interface MatchRowProps {
  match: MatchWithPlayerData;
  playerPuuid: string;
}

interface MatchSideParticipant {
  champion_name: string;
  champion_level: number;
  kills: number;
  deaths: number;
  assists: number;
  summoner1_id?: number | null | undefined;
  summoner2_id?: number | null | undefined;
  runes?: ParticipantRunes | null | undefined;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// `numeric: "auto"` is what produces "today"/"yesterday" natively; only the
// capitalisation is ours.
const dayFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function getDaysAgo(timestamp: number): string {
  const diffDays = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  const formatted = dayFormatter.format(-diffDays, "day");
  return diffDays < 2
    ? formatted.charAt(0).toUpperCase() + formatted.slice(1)
    : formatted;
}

/**
 * The row's background tint, which is the only thing on it that says how the
 * game went — there is no "VICTORY" or "DEFEAT" text anywhere in the row.
 *
 * The remake check comes before the win check on purpose: a remake is
 * annulled, so neither side won it.
 */
function getResultBgClass(match: MatchWithPlayerData): string {
  const participant = match.player_participant;

  if (!participant) return "bg-muted/30";
  if (participant.remake || match.early_surrender) return "bg-gray-500/50";
  if (participant.win) return "bg-emerald-700/30";
  return "bg-rose-600/30";
}

function renderSummonerSpell(
  spellId: number | null | undefined,
  ddragonVersion: string,
) {
  if (!spellId) return <div className="h-5 w-5 bg-muted rounded" />;
  const url = getSummonerSpellIconUrlById(spellId, ddragonVersion);
  if (!url) return <div className="h-5 w-5 bg-muted rounded" />;
  return (
    <div className="relative rounded-sm h-5 w-5 overflow-hidden shrink-0 border border-black/30">
      <Image
        src={url}
        alt="Summoner Spell"
        fill
        sizes="20px"
        className="object-cover"
        unoptimized
      />
    </div>
  );
}

function renderRunes(
  runes:
    | {
        primary_style?: number | null | undefined;
        sub_style?: number | null | undefined;
        keystone?: number | null | undefined;
      }
    | null
    | undefined,
) {
  if (!runes) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="h-7 w-7 bg-muted rounded-full" />
        <div className="h-5 w-5 bg-muted rounded mx-auto" />
      </div>
    );
  }

  const keystoneIconUrl = runes.keystone
    ? getKeystoneIconUrlById(runes.keystone)
    : null;
  const primaryStyleIconUrl = keystoneIconUrl
    ? keystoneIconUrl
    : runes.primary_style
      ? getRuneStyleIconUrl(runes.primary_style)
      : null;
  const subStyleIconUrl = runes.sub_style
    ? getRuneStyleIconUrl(runes.sub_style)
    : null;
  const primaryStyleName = runes.primary_style
    ? getRuneStyleName(runes.primary_style)
    : null;
  const subStyleName = runes.sub_style
    ? getRuneStyleName(runes.sub_style)
    : null;

  return (
    <div className="flex flex-col gap-0.5 items-center">
      <div
        className="relative h-7 w-7 rounded-full overflow-hidden shrink-0 mb-1"
        title={primaryStyleName || "Primary rune style"}
      >
        {primaryStyleIconUrl ? (
          <Image
            src={primaryStyleIconUrl}
            alt={primaryStyleName || "Primary rune style"}
            fill
            sizes="28px"
            className="object-contain"
            unoptimized
          />
        ) : (
          <div className="h-full w-full bg-muted" />
        )}
      </div>
      <div
        className="relative h-4 w-4 rounded overflow-hidden shrink-0"
        title={subStyleName || "Secondary rune style"}
      >
        {subStyleIconUrl ? (
          <Image
            src={subStyleIconUrl}
            alt={subStyleName || "Secondary rune style"}
            fill
            sizes="16px"
            className="object-contain"
            unoptimized
          />
        ) : (
          <div className="h-full w-full bg-muted" />
        )}
      </div>
    </div>
  );
}

function renderTeamStatsRow(stats: TeamStats | null, team: "blue" | "red") {
  if (!stats) return null;
  return <TeamObjectiveStats stats={stats} team={team} />;
}

function renderTeamChampIcon(
  champ: TeamChampion,
  isCurrentPlayer: boolean,
  teamColor: "blue" | "red",
  ddragonVersion: string,
) {
  const borderColor = isCurrentPlayer
    ? "ring-2 ring-yellow-400"
    : teamColor === "blue"
      ? "ring-1 ring-blue-500"
      : "ring-1 ring-red-500";

  return (
    <div
      key={champ.puuid}
      className={`relative h-6 w-6 rounded overflow-hidden shrink-0 ${borderColor}`}
      title={getChampionDisplayName(champ.champion_name)}
    >
      <Image
        src={getChampionIconUrl(champ.champion_name, ddragonVersion)}
        alt={getChampionDisplayName(champ.champion_name)}
        fill
        sizes="24px"
        className="object-cover"
        unoptimized
      />
    </div>
  );
}

function MatchSideStats({
  kda,
  totalCs,
  csPerMinute,
  visionScore,
  killParticipation,
}: {
  kda: number | null | undefined;
  totalCs: number;
  csPerMinute: string;
  visionScore: number;
  killParticipation: number | null;
}) {
  return (
    <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center text-xs lg:ml-2 lg:w-25 lg:shrink-0">
      <span>
        <span className="font-medium">{kda?.toFixed(2) ?? "Perfect"}</span> KDA
      </span>
      <span className="mt-0.5">
        <span className="font-medium">{totalCs}</span> CS ({csPerMinute}/min)
      </span>
      <span className="mt-0.5">
        <span className="font-medium">{visionScore}</span> Vision Score
      </span>
      <span className="mt-0.5">
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

function MatchSideColumn({
  participant,
  ddragonVersion,
  emptyChampionFallback,
  emptyKdaFallback,
}: {
  participant: MatchSideParticipant | null | undefined;
  ddragonVersion: string;
  emptyChampionFallback: boolean;
  emptyKdaFallback: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 lg:w-40 lg:flex-none">
      {/* Below `lg` the two sides split one phone width, and the rune icons
          are the detail worth trading for a readable champion name. */}
      <div className="hidden lg:block">{renderRunes(participant?.runes)}</div>

      <div className="flex flex-col items-center gap-0.5">
        <div className="relative h-[52px] w-[52px] rounded overflow-hidden shrink-0">
          {participant ? (
            <Image
              src={getChampionIconUrl(
                participant.champion_name,
                ddragonVersion,
              )}
              alt={participant.champion_name}
              fill
              sizes="52px"
              className="object-cover"
              unoptimized
            />
          ) : emptyChampionFallback ? (
            <div className="h-full w-full bg-muted" />
          ) : null}
        </div>
        <div className="flex gap-0.5">
          {renderSummonerSpell(participant?.summoner1_id, ddragonVersion)}
          {renderSummonerSpell(participant?.summoner2_id, ddragonVersion)}
        </div>
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
          // the same win/loss tint that failed 4.5:1, it just never rendered
          // under the axe fixtures, which always serve full participants.
          <span className="text-xs text-foreground/75">—</span>
        ) : null}
      </div>
    </div>
  );
}

function MatchTeamCompositions({
  teamComps,
  playerPuuid,
  ddragonVersion,
}: {
  teamComps: MatchWithPlayerData["team_compositions"];
  playerPuuid: string;
  ddragonVersion: string;
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
                ),
              )}
            </div>
          </div>
          {/* text-foreground/75 like the rest of the row: muted-foreground
              composites to 3.1-4.4:1 on the win/loss tints, under the 4.5:1
              the earlier contrast fix cites. axe filed these under
              results.incomplete (alpha-stacked backgrounds), which the spec
              does not assert, so the green gate proved nothing here. */}
          <div className="text-center text-xs text-foreground/75">Vs</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-red-900/30 rounded px-1 py-0.5">
              {teamComps.red_team.map((champ) =>
                renderTeamChampIcon(
                  champ,
                  champ.puuid === playerPuuid,
                  "red",
                  ddragonVersion,
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

export function MatchRow({ match, playerPuuid }: MatchRowProps) {
  const ddragonVersion = useDDragonVersion();
  const participant = match.player_participant;
  const opponent = match.lane_opponent;
  const resultBgClass = getResultBgClass(match);
  const teamComps = match.team_compositions;
  const teamStats = match.team_stats;

  const csPerMinute = participant
    ? (participant.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  const opponentCsPerMinute = opponent
    ? (opponent.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  const getBlueTeamStats = () => teamStats?.blue_team || null;
  const getRedTeamStats = () => teamStats?.red_team || null;

  const blueTeamStats = getBlueTeamStats();
  const redTeamStats = getRedTeamStats();
  const playerTeamStats =
    participant?.team_id === 100 ? blueTeamStats : redTeamStats;
  const enemyTeamStats =
    participant?.team_id === 100
      ? redTeamStats
      : participant?.team_id === 200
        ? blueTeamStats
        : null;
  const isRemake = Boolean(participant?.remake || match.early_surrender);
  const displayedLpChange = match.lp_change;

  const killParticipation =
    participant && playerTeamStats && playerTeamStats.kills > 0
      ? ((participant.kills + participant.assists) / playerTeamStats.kills) *
        100
      : null;
  const enemyKillParticipation =
    opponent && enemyTeamStats && enemyTeamStats.kills > 0
      ? ((opponent.kills + opponent.assists) / enemyTeamStats.kills) * 100
      : null;

  return (
    <div
      className={`px-3 py-1.5 rounded border-2 mb-1.5 border-t-1 border-b-1 border-amber-400/20 last:border-b-0 last:mb-0 ${resultBgClass}`}
    >
      {/*
        Below `lg` the blocks wrap instead of holding their desktop widths, and
        the matchup jumps to the front so the two stat blocks end up adjacent —
        left one the player's, right one the opponent's, same as on desktop.
      */}
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center lg:w-35 lg:shrink-0">
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

        {participant && (
          <MatchSideStats
            kda={participant.kda}
            totalCs={participant.total_cs}
            csPerMinute={csPerMinute}
            visionScore={participant.vision_score}
            killParticipation={killParticipation}
          />
        )}

        <div className="order-first flex w-full items-center gap-0 lg:order-none lg:w-[420px]">
          <MatchSideColumn
            participant={participant}
            ddragonVersion={ddragonVersion}
            emptyChampionFallback={false}
            emptyKdaFallback={false}
          />

          <div className="w-10 flex items-center justify-center shrink-0">
            <Swords className="h-5 w-5 text-muted-foreground" />
          </div>

          <MatchSideColumn
            participant={opponent}
            ddragonVersion={ddragonVersion}
            emptyChampionFallback
            emptyKdaFallback
          />
        </div>

        {opponent && (
          <MatchSideStats
            kda={opponent.kda}
            totalCs={opponent.total_cs}
            csPerMinute={opponentCsPerMinute}
            visionScore={opponent.vision_score}
            killParticipation={enemyKillParticipation}
          />
        )}

        <div className="w-16 shrink-0 text-center flex flex-col justify-center">
          {/* The row's tint is the only other outcome signal; colourblind
              players need the word (WCAG 1.4.1: no colour-only meaning). */}
          <span className="text-[10px] font-semibold uppercase text-foreground/75">
            {isRemake ? "Remake" : participant?.win ? "Victory" : "Defeat"}
          </span>
          <span className="">{formatDuration(match.game_duration)}</span>
        </div>

        <div className="w-12 mr-2 shrink-0 text-center flex flex-col justify-center">
          {displayedLpChange !== null && displayedLpChange !== undefined ? (
            <span
              className={`text-xs font-medium ${
                displayedLpChange > 0
                  ? "text-emerald-500"
                  : displayedLpChange < 0
                    ? "text-rose-500"
                    : // A remake's LP change of exactly 0 is a real outcome,
                      // rendered on the same tinted row - same contrast
                      // reasoning as the Vs divider above.
                      "text-foreground/75"
              }`}
            >
              {formatMatchLpChange(displayedLpChange, isRemake)}
            </span>
          ) : (
            <span
              className="text-xs font-medium text-foreground/75"
              aria-label="LP change unavailable"
            >
              {formatMatchLpChange(displayedLpChange, isRemake)}
            </span>
          )}
        </div>

        <MatchTeamCompositions
          teamComps={teamComps}
          playerPuuid={playerPuuid}
          ddragonVersion={ddragonVersion}
        />

        <div className="flex flex-col items-center justify-center gap-0.5">
          {blueTeamStats && renderTeamStatsRow(blueTeamStats, "blue")}
          <Separator className="my-2 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          {redTeamStats && renderTeamStatsRow(redTeamStats, "red")}
        </div>
      </div>
    </div>
  );
}
