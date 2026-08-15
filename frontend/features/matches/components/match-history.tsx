"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Clock,
  ListRestart,
  Search,
  Swords,
} from "lucide-react";
import { useToast } from "@/lib/core/hooks";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useRelativeTime } from "@/lib/core/use-relative-time";
import {
  DEFAULT_MATCH_HISTORY_QUEUE_SELECTION,
  getMatchHistoryEmptyMessage,
  getMatchHistoryQueueQuery,
  getMatchQueueName,
  MATCH_HISTORY_QUEUE_FILTERS,
  MatchHistoryQueueFilter,
  selectMatchHistoryQueue,
} from "../queue-catalog";
import {
  DEFAULT_MATCH_HISTORY_PAGE_SIZE,
  getMatchHistoryPaginationItems,
  getMatchHistoryRecordRange,
  MATCH_HISTORY_PAGE_SIZES,
  type MatchHistoryPageSize,
} from "../match-history-pagination";
import {
  persistMatchHistoryPageSize,
  persistMatchHistoryQueueFilters,
  readMatchHistoryPreferences,
} from "../match-history-preferences";
import { TeamObjectiveStats } from "./objective-icons";

interface MatchHistoryProps {
  puuid: string;
  lastUpdated?: string | null;
}

const MATCH_HISTORY_SEARCH_DEBOUNCE_MS = 300;

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

  const renderTeamStatsRow = (
    stats: TeamStats | null,
    team: "blue" | "red",
  ) => {
    if (!stats) return null;
    return <TeamObjectiveStats stats={stats} team={team} />;
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
            {getMatchQueueName(match.queue_id)}
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
  const toast = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const relativeUpdatedAt = useRelativeTime(lastUpdated);

  const [isUpdating, setIsUpdating] = useState(false);
  const [activeQueueFilters, setActiveQueueFilters] = useState<
    MatchHistoryQueueFilter[]
  >([...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION]);
  const [matchSearch, setMatchSearch] = useState("");
  const [debouncedMatchSearch, setDebouncedMatchSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<MatchHistoryPageSize>(
    DEFAULT_MATCH_HISTORY_PAGE_SIZE,
  );
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [pageSizeOpen, setPageSizeOpen] = useState(false);
  const queueQueryParam = getMatchHistoryQueueQuery(activeQueueFilters);
  const normalizedMatchSearch = matchSearch.trim();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedMatchSearch(normalizedMatchSearch);
    }, MATCH_HISTORY_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [normalizedMatchSearch]);

  /* eslint-disable react-hooks/set-state-in-effect -- Optional browser preferences initialize after hydration to preserve a stable server snapshot. */
  useEffect(() => {
    const preferences = readMatchHistoryPreferences();
    setActiveQueueFilters(preferences.queueFilters);
    setPageSize(preferences.pageSize);
    setPreferencesReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const { data: statsResult } = useQuery({
    queryKey: ["match-history-stats", puuid, queueQueryParam],
    queryFn: () =>
      validatedGet(MatchStatsResponseSchema, `/matches/player/${puuid}/stats`, {
        queues: queueQueryParam,
      }),
    enabled: !!puuid && preferencesReady,
  });

  const {
    data: response,
    isLoading,
    error,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useQuery({
    queryKey: [
      "matchHistoryDetailed",
      puuid,
      queueQueryParam,
      debouncedMatchSearch,
      currentPage,
      pageSize,
    ],
    queryFn: () =>
      validatedGet(
        MatchListWithPlayerDataResponseSchema,
        `/matches/player/${puuid}/detailed`,
        {
          queues: queueQueryParam,
          search: debouncedMatchSearch || undefined,
          start: (currentPage - 1) * pageSize,
          count: pageSize,
        },
      ),
    enabled: !!puuid && preferencesReady,
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
        toast.warning("Player update is already running", {
          description: "Wait for the current player-data refresh to finish.",
        });
        setIsUpdating(false);
        return;
      }

      toast.info("Player profile update started", {
        description: "Match and rank data are refreshing in the background.",
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
      toast.error("Player profile update could not start", {
        description: "Please try again later.",
      });
      setIsUpdating(false);
    }
  };

  const handleQueueFilterSelect = (
    queueId: MatchHistoryQueueFilter,
    additive: boolean,
  ) => {
    const selection = selectMatchHistoryQueue(
      activeQueueFilters,
      queueId,
      additive,
    );
    if (!selection) {
      return;
    }

    setActiveQueueFilters(selection);
    persistMatchHistoryQueueFilters(selection);
    setCurrentPage(1);
  };

  const handleMatchSearchChange = (value: string) => {
    setMatchSearch(value.slice(0, 64));
    setCurrentPage(1);
  };

  const handlePageSizeChange = (nextPageSize: MatchHistoryPageSize) => {
    setPageSize(nextPageSize);
    persistMatchHistoryPageSize(nextPageSize);
    setCurrentPage(1);
    setPageSizeOpen(false);
  };

  const data = response?.success ? response.data : null;
  const matches = data?.matches || [];
  const apiTotalMatches = data?.total || 0;
  const stats = statsResult?.success ? statsResult.data : null;
  const totalMatches = stats?.total_matches ?? apiTotalMatches;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const winRate = stats?.win_rate ?? 0;
  const totalPages = Math.ceil(apiTotalMatches / pageSize);
  const paginationItems = getMatchHistoryPaginationItems(
    currentPage,
    totalPages,
  );
  const recordRange = getMatchHistoryRecordRange(
    currentPage,
    pageSize,
    apiTotalMatches,
  );
  const hasActiveSearch = debouncedMatchSearch.length > 0;

  useEffect(() => {
    if (isPlaceholderData) {
      return;
    }
    const lastAvailablePage = Math.max(1, totalPages);
    if (currentPage > lastAvailablePage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- The server total is authoritative when refreshed data removes the requested page.
      setCurrentPage(lastAvailablePage);
    }
  }, [currentPage, isPlaceholderData, totalPages]);

  if (!preferencesReady || isLoading) {
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

  if ((!isFetching && error) || (response && !response.success)) {
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
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 xl:grid-cols-[1fr_auto_1fr]">
          <div className="justify-self-start">
            <CardTitle className="flex items-center gap-2">
              <ListRestart className="h-5 w-5 text-primary" />
              Match History
            </CardTitle>
          </div>

          <div
            className="order-3 col-span-2 min-w-0 w-full overflow-x-auto xl:order-none xl:col-span-1 xl:justify-self-center"
            data-testid="match-history-queue-filters"
            aria-describedby="match-history-queue-instructions"
          >
            <p id="match-history-queue-instructions" className="sr-only">
              Select one queue, or hold Shift while selecting to combine
              queues.
            </p>
            <div className="flex w-max min-w-full items-center justify-center text-sm">
              {MATCH_HISTORY_QUEUE_FILTERS.map((queueOption, index) => {
                const isSelected = activeQueueFilters.includes(queueOption.id);

                return (
                  <div key={queueOption.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={(event) =>
                        handleQueueFilterSelect(
                          queueOption.id,
                          event.shiftKey,
                        )
                      }
                      aria-pressed={isSelected}
                      aria-describedby="match-history-queue-instructions"
                      className={`${queueOption.widthClass} text-center transition-colors ${
                        isSelected
                          ? "font-semibold text-foreground"
                          : "text-[#aaa]"
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

        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-[230px] max-w-full shrink-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1.5 h-4 w-4 text-muted-foreground"
            />
            <Input
              value={matchSearch}
              onChange={(event) =>
                handleMatchSearchChange(event.target.value)
              }
              placeholder="Search for champion or player"
              aria-label="Search for champion or player"
              className="h-7 w-full border-white/15 bg-white/5 pl-8 !text-xs text-white placeholder:text-white/45"
            />
          </div>
          {totalMatches > 0 && (
            <div className="shrink-0 text-sm text-right">
              {totalMatches} total matches ({wins}W / {losses}L) •{" "}
              {(winRate * 100).toFixed(1)}% WR
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
        {matches.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {hasActiveSearch ? (
                <p className="font-medium">
                  No matches found for &quot;{debouncedMatchSearch}&quot;.
                </p>
              ) : (
                <p className="font-medium">
                  {getMatchHistoryEmptyMessage(activeQueueFilters)}
                </p>
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-md border">
            {matches.map((match) => (
              <MatchRow
                key={match.match_id}
                match={match}
                playerPuuid={puuid}
              />
            ))}
          </div>
        )}

        <div className="mt-3 grid items-center gap-3 border-t pt-3 text-sm text-muted-foreground md:grid-cols-[1fr_auto_1fr]">
          <div className="justify-self-start" aria-live="polite">
            Showing {recordRange.start} to {recordRange.end} of {apiTotalMatches}{" "}
            matches
          </div>

          <nav
            className="flex items-center justify-center gap-1"
            aria-label="Match history pages"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-[22px] min-w-[22px] p-0 text-card-foreground disabled:text-muted-foreground disabled:opacity-100"
              aria-label="Previous page"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={totalPages <= 1 || currentPage <= 1}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            {paginationItems.map((item) =>
              typeof item === "number" ? (
                <Button
                  key={item}
                  type="button"
                  variant={item === currentPage ? "default" : "outline"}
                  size="sm"
                  className="h-8 min-w-8 px-2"
                  aria-current={item === currentPage ? "page" : undefined}
                  onClick={() => setCurrentPage(item)}
                  disabled={isFetching && item === currentPage}
                >
                  {item}
                </Button>
              ) : (
                <span key={item} className="px-1" aria-hidden="true">
                  …
                </span>
              ),
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-[22px] min-w-[22px] p-0 text-card-foreground disabled:text-muted-foreground disabled:opacity-100"
              aria-label="Next page"
              onClick={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
              disabled={totalPages <= 1 || currentPage >= totalPages}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>

          <div className="flex items-center gap-2 md:justify-self-end">
            <label htmlFor="match-history-page-size">Page size</label>
            <Popover open={pageSizeOpen} onOpenChange={setPageSizeOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="match-history-page-size"
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-[76px] justify-between px-3 font-normal"
                  role="combobox"
                  aria-expanded={pageSizeOpen}
                  aria-haspopup="listbox"
                  aria-controls="match-history-page-size-options"
                  aria-label="Match history page size"
                >
                  {pageSize}
                  <ChevronDown
                    aria-hidden="true"
                    className="opacity-50"
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                id="match-history-page-size-options"
                role="listbox"
                aria-label="Match history page size"
                align="end"
                className="w-[76px] p-1"
              >
                {MATCH_HISTORY_PAGE_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    role="option"
                    aria-selected={size === pageSize}
                    onClick={() => handlePageSizeChange(size)}
                    className="relative flex w-full items-center rounded-sm py-1.5 pl-2 pr-8 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                  >
                    {size}
                    {size === pageSize && (
                      <Check
                        aria-hidden="true"
                        className="absolute right-2 h-4 w-4"
                      />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
