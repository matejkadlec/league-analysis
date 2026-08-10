"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  ListRestart,
  Swords,
  Crown,
  Eye,
  Flame,
  Landmark,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";

import {
  MatchListWithPlayerDataResponseSchema,
  MatchWithPlayerData,
  TeamChampion,
  MatchStatsResponseSchema,
  TeamStats,
} from "@/lib/core/schemas";
import { validatedGet, api } from "@/lib/core/api";
import {
  getChampionIconUrl,
  getChampionDisplayName,
  getSummonerSpellIconUrlById,
  getKeystoneIconUrlById,
  getRuneStyleIconUrl,
  getRuneStyleName,
} from "@/lib/core/data-dragon";
import { useDDragonVersion } from "@/lib/core/data-dragon-context";
import { getMatchHistoryErrorMessage } from "../utils/match-history-error";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useRelativeTime } from "@/lib/core/use-relative-time";

interface MatchHistoryProps {
  puuid: string;
  lastUpdated?: string | null;
}

// Queue names mapping
const QUEUE_NAMES: Record<number, string> = {
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  400: "Normal Draft",
  430: "Normal Blind",
  450: "ARAM",
};

type MatchHistoryQueueFilter = "ALL" | 420 | 440 | 400;

const MATCH_HISTORY_QUEUE_FILTERS = [
  { id: "ALL" as const, label: "All Queues", widthClass: "w-[96px]" },
  { id: 420 as const, label: "Ranked Solo/Duo", widthClass: "w-[140px]" },
  { id: 440 as const, label: "Ranked Flex", widthClass: "w-[96px]" },
  { id: 400 as const, label: "Normal Draft", widthClass: "w-[100px]" },
];

// Format time as "H:MM AM/PM"
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  return `${hours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

// Format date as "D.M.YYYY"
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}

// Format date and time as "D.M.YYYY H:MM AM/PM"
function formatDateTime(timestamp: number): string {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

// Format duration as "MM:SS"
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Calculate days ago from timestamp
function getDaysAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

// Get queue name
function getQueueName(queueId: number): string {
  return QUEUE_NAMES[queueId] || `Queue ${queueId}`;
}

// Get result text and color
function getResultInfo(match: MatchWithPlayerData): {
  text: string;
  colorClass: string;
  bgClass: string;
} {
  const participant = match.player_participant;

  if (!participant) {
    return {
      text: "Unknown",
      colorClass: "text-muted-foreground",
      bgClass: "bg-muted/30",
    };
  }

  if (participant.remake || match.early_surrender) {
    return {
      text: "REMAKE",
      colorClass: "text-gray-500",
      bgClass: "bg-gray-500/50",
    };
  }

  if (participant.win) {
    return {
      text: "VICTORY",
      colorClass: "text-emerald-500",
      bgClass: "bg-emerald-700/30",
    };
  }

  return {
    text: "DEFEAT",
    colorClass: "text-rose-500",
    bgClass: "bg-rose-600/30",
  };
}

// Match row component
function MatchRow({
  match,
  playerPuuid,
}: {
  match: MatchWithPlayerData;
  playerPuuid: string;
}) {
  const ddragonVersion = useDDragonVersion();
  const participant = match.player_participant;
  const opponent = match.lane_opponent;
  const result = getResultInfo(match);
  const teamComps = match.team_compositions;
  const teamStats = match.team_stats;

  // Calculate CS per minute
  const csPerMinute = participant
    ? (participant.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  // Calculate opponent CS per minute
  const opponentCsPerMinute = opponent
    ? (opponent.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  // Get player's team stats (blue or red based on team_id)
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
  const displayedLpChange = match.lp_change ?? (isRemake ? 0 : null);

  const killParticipation =
    participant && playerTeamStats && playerTeamStats.kills > 0
      ? ((participant.kills + participant.assists) / playerTeamStats.kills) *
        100
      : null;
  const enemyKillParticipation =
    opponent && enemyTeamStats && enemyTeamStats.kills > 0
      ? ((opponent.kills + opponent.assists) / enemyTeamStats.kills) * 100
      : null;

  // Render summoner spell icon - bigger and with border radius
  const renderSummonerSpell = (spellId: number | null | undefined) => {
    if (!spellId) return <div className="h-5 w-5 bg-muted rounded" />;
    const url = getSummonerSpellIconUrlById(spellId, ddragonVersion);
    if (!url) return <div className="h-5 w-5 bg-muted rounded" />;
    return (
      <div className="relative rounded-sm h-5 w-5 overflow-hidden shrink-0 border border-black/30">
        <Image
          src={url}
          alt="Summoner Spell"
          fill
          className="object-cover"
          unoptimized
        />
      </div>
    );
  };

  // Render runes (primary style + secondary style) - primary is circle, secondary is square
  const renderRunes = (
    runes:
      | {
          primary_style?: number | null;
          sub_style?: number | null;
          keystone?: number | null;
        }
      | null
      | undefined,
  ) => {
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
              className="object-contain"
              unoptimized
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
        </div>
      </div>
    );
  };

  // Voidgrub SVG icon component
  const VoidgrubIcon = ({ color }: { color: string }) => (
    <svg
      viewBox="0 0 16 16"
      className="h-5 w-5"
      fill={color}
      fillRule="evenodd"
      clipRule="evenodd"
    >
      <path d="M8 1 6.333 2.42s-.87.798-1.151.798H3.928c-.928 0-2.261.978-2.557 2.68-.074.429-.098 1.282.56 2.168L1 8.812s1.333.71 1.667 2.131C3 12.363 5.088 13.704 6.9 14.088l1.08.881V15L8 14.985l.019.015v-.031l1.08-.881c1.813-.384 3.901-1.724 4.234-3.145.334-1.42 1.667-2.13 1.667-2.13l-.931-.747c.658-.886.637-1.726.56-2.169-.296-1.701-1.629-2.68-2.557-2.68h-1.254c-.28 0-1.151-.797-1.151-.797zm.149 3.245a.2.2 0 0 0-.298 0L5.434 6.93a.2.2 0 0 0 .021.29c.275.228.818.687 1.007.914.21.255-1.316 1.405-1.862 1.804a.202.202 0 0 0-.026.304l1.84 1.88a.2.2 0 0 0 .285 0l1.158-1.183a.2.2 0 0 1 .286 0L9.3 12.122a.2.2 0 0 0 .286 0l1.84-1.88a.202.202 0 0 0-.026-.304c-.546-.399-2.073-1.549-1.862-1.804.189-.227.732-.686 1.007-.913a.2.2 0 0 0 .021-.29z" />
    </svg>
  );

  // Render objective icon with team color
  // Turret icon is 30% bigger (h-[26px] w-[26px] instead of h-5 w-5 which is 20px)
  // To adjust turret size: change the h-[26px] w-[26px] values (26px = 20px * 1.3)
  const renderObjectiveIcon = (
    objective:
      "turret" | "inhibitor" | "dragon" | "voidgrub" | "herald" | "baron",
    count: number | null | undefined,
    title: string,
    team: "blue" | "red",
  ) => {
    // Turret gets 30% bigger size
    const isTurret = objective === "turret";
    const iconSizeClass = isTurret ? "h-[26px] w-[26px]" : "h-5 w-5";
    const objectiveColorClass =
      team === "blue" ? "text-cyan-400" : "text-rose-500";

    // Display '?' for null/undefined counts (timeline data unavailable)
    const displayCount =
      count === null || count === undefined ? "?" : String(count);

    return (
      // Added 'w-full' and 'justify-center' to center within the grid column
      <div
        className="flex w-full h-full items-center justify-center"
        title={title}
      >
        {objective === "voidgrub" ? (
          <VoidgrubIcon color={team === "blue" ? "#0A96AA" : "#BE1E37"} />
        ) : (
          <>
            {objective === "turret" && (
              <Landmark className={`${iconSizeClass} ${objectiveColorClass}`} />
            )}
            {objective === "inhibitor" && (
              <Shield className={`${iconSizeClass} ${objectiveColorClass}`} />
            )}
            {objective === "dragon" && (
              <Flame className={`${iconSizeClass} ${objectiveColorClass}`} />
            )}
            {objective === "herald" && (
              <Eye className={`${iconSizeClass} ${objectiveColorClass}`} />
            )}
            {objective === "baron" && (
              <Crown className={`${iconSizeClass} ${objectiveColorClass}`} />
            )}
          </>
        )}
        {/* Added 'w-5' and 'text-center' to reserve fixed space for 1 or 2 digits */}
        <span className="w-5 text-center text-xs">{displayCount}</span>
      </div>
    );
  };

  // Render team stats row with team color
  const renderTeamStatsRow = (
    stats: TeamStats | null,
    team: "blue" | "red",
  ) => {
    if (!stats) return null;
    return (
      <div className="grid grid-cols-6 h-full w-full gap-1.5 text-xs">
        {renderObjectiveIcon("turret", stats.turrets, "Turrets", team)}
        {renderObjectiveIcon("inhibitor", stats.inhibitors, "Inhibitors", team)}
        {renderObjectiveIcon("dragon", stats.dragons, "Dragons", team)}
        {renderObjectiveIcon("voidgrub", stats.voidgrubs, "Voidgrubs", team)}
        {renderObjectiveIcon(
          "herald",
          stats.rift_heralds,
          "Rift Heralds",
          team,
        )}
        {renderObjectiveIcon("baron", stats.barons, "Barons", team)}
      </div>
    );
  };

  // Render a champion icon for team compositions
  const renderTeamChampIcon = (
    champ: TeamChampion,
    isCurrentPlayer: boolean,
    teamColor: "blue" | "red",
  ) => {
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
          className="object-cover"
          unoptimized
        />
      </div>
    );
  };

  return (
    <div
      className={`px-3 py-1.5 rounded border-2 mb-1.5 border-t-1 border-b-1 border-amber-400/20 last:border-b-0 last:mb-0 ${result.bgClass}`}
    >
      <div className="flex items-center gap-2">
        {/* Column 1: Queue Type & Patch - WIDER, CENTERED VERTICALLY */}
        <div className="w-35 shrink-0 flex flex-col justify-center">
          <span className="text-sm font-medium text-center">
            {getQueueName(match.queue_id)}
          </span>
          <span className="text-xs text-muted-foreground text-center mt-1">
            Patch {match.game_version.split(".").slice(0, 2).join(".")}
          </span>
        </div>

        {/* Column 2: Date & Time */}
        <div className="w-33 shrink-0 flex flex-col justify-center">
          <span className="text-sm text-center">
            {formatDateTime(match.game_start_timestamp)}
          </span>
          <span className="text-xs text-center text-muted-foreground mt-1">
            {getDaysAgo(match.game_start_timestamp)}
          </span>
        </div>

        {/* Column 3: Player Stats (KDA, CS, Vision, Damage) */}
        {participant && (
          <div className="w-25 shrink-0 flex flex-col justify-center text-xs ml-2">
            <span>
              <span className="font-medium">
                {participant.kda?.toFixed(2) ?? "Perfect"}
              </span>{" "}
              KDA
            </span>
            <span className="mt-0.5">
              <span className="font-medium">{participant.total_cs}</span> CS (
              {csPerMinute}/min)
            </span>
            <span className="mt-0.5">
              <span className="font-medium">{participant.vision_score}</span>{" "}
              Vision Score
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
        )}

        {/* Column 4: Champion vs Champion - with runes, summoners below champ, bigger icons */}
        <div className="flex items-center gap-0 w-[420px]">
          {/* Subcolumn 1: Player Champion with runes */}
          <div className="w-40 flex items-center gap-2">
            {/* Runes */}
            {renderRunes(participant?.runes)}

            {/* Champion icon with summoner spells below */}
            <div className="flex flex-col items-center gap-0.5">
              {/* Champion icon - 1.3x larger (h-13 w-13 = 52px instead of 40px) */}
              <div className="relative h-[52px] w-[52px] rounded overflow-hidden shrink-0">
                {participant && (
                  <Image
                    src={getChampionIconUrl(
                      participant.champion_name,
                      ddragonVersion,
                    )}
                    alt={participant.champion_name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                )}
              </div>
              {/* Summoner spells - horizontal row below champion */}
              <div className="flex gap-0.5">
                {renderSummonerSpell(participant?.summoner1_id)}
                {renderSummonerSpell(participant?.summoner2_id)}
              </div>
            </div>

            {/* Champion name and stats */}
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
              <span className="text-xs text-muted-foreground">
                {participant ? `Lv ${participant.champion_level}` : "—"}
              </span>
              {participant && (
                <span className="text-xs">
                  {participant.kills} / {participant.deaths} /{" "}
                  {participant.assists}
                </span>
              )}
            </div>
          </div>

          {/* Subcolumn 2: Swords Icon */}
          <div className="w-10 flex items-center justify-center shrink-0">
            <Swords className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Subcolumn 3: Enemy Champion with runes */}
          <div className="w-40 flex items-center gap-2">
            {/* Runes */}
            {renderRunes(opponent?.runes)}

            {/* Champion icon with summoner spells below */}
            <div className="flex flex-col items-center gap-0.5">
              {/* Champion icon - 1.3x larger */}
              <div className="relative h-[52px] w-[52px] rounded overflow-hidden shrink-0">
                {opponent ? (
                  <Image
                    src={getChampionIconUrl(
                      opponent.champion_name,
                      ddragonVersion,
                    )}
                    alt={opponent.champion_name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="h-full w-full bg-muted" />
                )}
              </div>
              {/* Summoner spells - horizontal row below champion */}
              <div className="flex gap-0.5">
                {renderSummonerSpell(opponent?.summoner1_id)}
                {renderSummonerSpell(opponent?.summoner2_id)}
              </div>
            </div>

            {/* Champion name and stats */}
            <div className="flex flex-col flex-1 min-w-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm font-medium truncate cursor-default">
                      {opponent
                        ? getChampionDisplayName(opponent.champion_name)
                        : "—"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {opponent
                        ? getChampionDisplayName(opponent.champion_name)
                        : "—"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs text-muted-foreground">
                {opponent ? `Lv ${opponent.champion_level}` : "—"}
              </span>
              {opponent ? (
                <span className="text-xs">
                  {opponent.kills} / {opponent.deaths} / {opponent.assists}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </div>

        {/* Column 5: Enemy Laner Stats */}
        {opponent && (
          <div className="w-25 shrink-0 flex flex-col justify-center text-xs ml-2">
            <span>
              <span className="font-medium">
                {opponent.kda?.toFixed(2) ?? "Perfect"}
              </span>{" "}
              KDA
            </span>
            <span className="mt-0.5">
              <span className="font-medium">{opponent.total_cs}</span> CS (
              {opponentCsPerMinute}/min)
            </span>
            <span className="mt-0.5">
              <span className="font-medium">{opponent.vision_score}</span>{" "}
              Vision Score
            </span>
            <span className="mt-0.5">
              <span className="font-medium">
                {enemyKillParticipation !== null
                  ? `${enemyKillParticipation.toFixed(0)}%`
                  : "—"}
              </span>{" "}
              Kill Particip.
            </span>
          </div>
        )}

        {/* Column 6: Duration & Surrender */}
        <div className="w-16 shrink-0 text-center flex flex-col justify-center">
          <span className="">{formatDuration(match.game_duration)}</span>
        </div>

        {/* Column 7: LP Change */}
        <div className="w-12 mr-2 shrink-0 text-center flex flex-col justify-center">
          {displayedLpChange !== null && displayedLpChange !== undefined ? (
            <span
              className={`text-xs font-medium ${
                displayedLpChange > 0
                  ? "text-emerald-500"
                  : displayedLpChange < 0
                    ? "text-rose-500"
                    : "text-muted-foreground"
              }`}
            >
              {displayedLpChange > 0
                ? `+${displayedLpChange}`
                : displayedLpChange < 0
                  ? displayedLpChange
                  : isRemake
                    ? "+0"
                    : "0"}{" "}
              LP
            </span>
          ) : null}
        </div>

        {/* Column 8: Team Compositions */}
        <div className="w-37 flex flex-col items-center justify-center gap-0.5 mr-1">
          {teamComps ? (
            <>
              {/* Blue Team Row with stats */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-blue-900/30 rounded px-1 py-0.5">
                  {teamComps.blue_team.map((champ) =>
                    renderTeamChampIcon(
                      champ,
                      champ.puuid === playerPuuid,
                      "blue",
                    ),
                  )}
                </div>
              </div>
              {/* Vs Separator */}
              <div className="text-center text-xs text-muted-foreground">
                Vs
              </div>
              {/* Red Team Row with stats */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-red-900/30 rounded px-1 py-0.5">
                  {teamComps.red_team.map((champ) =>
                    renderTeamChampIcon(
                      champ,
                      champ.puuid === playerPuuid,
                      "red",
                    ),
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground text-center">—</div>
          )}
        </div>
        {/* Column 9: Team Stats */}
        <div className="flex flex-col items-center justify-center gap-0.5">
          {blueTeamStats && renderTeamStatsRow(blueTeamStats, "blue")}
          <Separator className="my-2 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          {redTeamStats && renderTeamStatsRow(redTeamStats, "red")}
        </div>
      </div>
    </div>
  );
}

export function MatchHistory({ puuid, lastUpdated }: MatchHistoryProps) {
  const PAGE_SIZE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const relativeUpdatedAt = useRelativeTime(lastUpdated);

  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isUpdating, setIsUpdating] = useState(false);
  const [activeQueueFilter, setActiveQueueFilter] =
    useState<MatchHistoryQueueFilter>("ALL");
  const [championSearch, setChampionSearch] = useState("");
  const activeFilterConfig =
    MATCH_HISTORY_QUEUE_FILTERS.find(
      (filterOption) => filterOption.id === activeQueueFilter,
    ) ?? MATCH_HISTORY_QUEUE_FILTERS[0];
  const queueQueryParam =
    activeFilterConfig.id === "ALL" ? undefined : activeFilterConfig.id;
  const excludeAramFromQuery = activeFilterConfig.id === "ALL";

  const { data: statsResult } = useQuery({
    queryKey: ["match-history-stats", puuid, activeQueueFilter],
    queryFn: () =>
      validatedGet(MatchStatsResponseSchema, `/matches/player/${puuid}/stats`, {
        queue: queueQueryParam,
        exclude_aram: excludeAramFromQuery || undefined,
      }),
    enabled: !!puuid,
  });

  const {
    data: response,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["matchHistoryDetailed", puuid, activeQueueFilter, displayCount],
    queryFn: async () => {
      try {
        const result = await validatedGet(
          MatchListWithPlayerDataResponseSchema,
          `/matches/player/${puuid}/detailed`,
          {
            queue: queueQueryParam,
            exclude_aram: excludeAramFromQuery || undefined,
            start: 0,
            count: displayCount,
          },
        );
        return result;
      } catch (err) {
        console.debug("Match history fetch error:", err);
        throw err;
      }
    },
    enabled: !!puuid,
    retry: (failureCount, error) => {
      if (
        error instanceof Error &&
        (error.message.includes("Network Error") ||
          error.message.includes("ERR_NETWORK"))
      ) {
        return false;
      }
      return failureCount < 2;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        data?.success &&
        data.data?.matches &&
        data.data.matches.length === 0
      ) {
        return 5000;
      }
      return false;
    },
  });

  // Handle update button click - triggers match fetcher job
  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      // Trigger the unified player sync (match fetcher + player updater)
      const response = await api.post<{ success: boolean; message: string }>(
        `/jobs/sync-player/${puuid}`,
      );

      if (!response.data.success) {
        // Job is already running
        toast.info(response.data.message);
        setIsUpdating(false);
        return;
      }

      // Show success message
      toast.success("Update started", {
        description: "Fetching new matches from Riot API...",
      });

      // Wait a bit then refetch data
      setTimeout(async () => {
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: ["player"] }),
          queryClient.invalidateQueries({ queryKey: ["player-league"] }),
          queryClient.invalidateQueries({ queryKey: ["player-stats"] }),
        ]);
        router.refresh();
        setIsUpdating(false);
      }, 5000);
    } catch {
      toast.error("Failed to start update");
      setIsUpdating(false);
    }
  };

  const handleQueueFilterSelect = (queueId: MatchHistoryQueueFilter) => {
    if (queueId === activeQueueFilter) {
      return;
    }

    setDisplayCount(PAGE_SIZE);
    setActiveQueueFilter(queueId);
  };

  const handleChampionSearchChange = (value: string) => {
    setChampionSearch(value);
  };

  const data = response?.success ? response.data : null;
  const allMatches = data?.matches || [];
  const apiTotalMatches = data?.total || 0;
  const stats = statsResult?.success ? statsResult.data : null;
  const totalMatches = stats?.total_matches ?? apiTotalMatches;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;

  const normalizedChampionSearch = championSearch.trim().toLowerCase();
  const filteredMatches = allMatches.filter((match) => {
    if (!normalizedChampionSearch) {
      return true;
    }

    const championName = match.player_participant?.champion_name ?? "";
    return championName.toLowerCase().includes(normalizedChampionSearch);
  });

  const hasMore = allMatches.length < apiTotalMatches;

  const hasActiveSearch = normalizedChampionSearch.length > 0;

  const loadMore = useCallback(() => {
    if (!isFetching && hasMore) {
      setDisplayCount((prev) => prev + PAGE_SIZE);
    }
  }, [isFetching, hasMore]);

  useEffect(() => {
    if (!hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" },
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMore, loadMore]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListRestart className="h-5 w-5 text-primary" />
            Match History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || (response && !response.success)) {
    const errorMessage = getMatchHistoryErrorMessage(
      error,
      response && !response.success ? response.error : null,
    );

    const isNotFound =
      errorMessage.toLowerCase().includes("not found") ||
      (error instanceof Error && error.message.includes("404"));

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListRestart className="h-5 w-5 text-primary" />
            Match History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {isNotFound ? (
                <div className="space-y-2">
                  <p>No matches found for this player.</p>
                  <p className="text-sm text-muted-foreground">
                    This could mean the player has no ranked games, or match
                    data is not yet available.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>{errorMessage}</p>
                  <Button
                    onClick={() => refetch()}
                    type="submit"
                    size="sm"
                    className="mt-2"
                  >
                    Retry
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="match-history">
      <CardHeader>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="justify-self-start">
            <CardTitle className="flex items-center gap-2">
              <ListRestart className="h-5 w-5 text-primary" />
              Match History
            </CardTitle>
          </div>

          <div className="justify-self-center flex items-center text-sm">
            {MATCH_HISTORY_QUEUE_FILTERS.map((queueOption, index) => {
              const isSelected = queueOption.id === activeQueueFilter;

              return (
                <div key={queueOption.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => handleQueueFilterSelect(queueOption.id)}
                    className={`${queueOption.widthClass} text-center transition-colors ${
                      isSelected
                        ? "cursor-default font-semibold text-foreground"
                        : "cursor-pointer text-[#aaa]"
                    }`}
                  >
                    {queueOption.label}
                  </button>
                  {index < MATCH_HISTORY_QUEUE_FILTERS.length - 1 && (
                    <span className="text-muted-foreground">|</span>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            onClick={handleUpdate}
            disabled={isUpdating}
            variant="outline"
            size="sm"
            className="button-small justify-self-end"
          >
            {isUpdating ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Update
          </Button>
        </div>

        <div className="mt-1 flex items-center justify-between gap-3">
          <Input
            value={championSearch}
            onChange={(event) => handleChampionSearchChange(event.target.value)}
            placeholder="Search by champion..."
            className="match-history-light-input h-7 w-[160px] !text-xs"
          />
          {totalMatches > 0 && (
            <div className="text-sm text-right">
              {totalMatches} total matches ({wins}W / {losses}L)
            </div>
          )}
        </div>

        {lastUpdated && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <Clock className="h-3 w-3" />
            <span>Updated {relativeUpdatedAt}</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {filteredMatches.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {hasActiveSearch ? (
                <p className="font-medium">
                  No matches found for champion search: &quot;{championSearch}
                  &quot;.
                </p>
              ) : activeQueueFilter !== "ALL" ? (
                <p className="font-medium">
                  No matches found for {getQueueName(activeQueueFilter)}.
                </p>
              ) : (
                <div>
                  <p className="font-medium">
                    This player has no matches in the database.
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Tracked players matches will appear here as a background job
                    fetches them from the Riot API. If player is tracked and
                    matches are not appearing even after a few minutes,
                    something is wrong. For non-tracked players, use the{" "}
                    <b>Update</b> button.
                  </p>
                </div>
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-md border">
            {filteredMatches.map((match) => (
              <MatchRow
                key={match.match_id}
                match={match}
                playerPuuid={puuid}
              />
            ))}

            {hasMore && (
              <div
                ref={loadMoreRef}
                className="flex justify-center py-4 border-t bg-background/50"
              >
                {isFetching ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading more matches...</span>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Showing {allMatches.length} of {totalMatches} fetched
                    matches
                  </div>
                )}
              </div>
            )}
            {!hasMore && filteredMatches.length > 0 && (
              <div className="flex justify-center py-4 border-t bg-background/50">
                <div className="text-sm text-muted-foreground">
                  All {totalMatches} matches loaded
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
