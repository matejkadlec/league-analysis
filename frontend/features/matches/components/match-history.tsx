"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  StopCircle,
  ListRestart,
  Swords,
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
  getSummonerSpellIconUrlById,
  getRuneStyleIconUrl,
  getObjectiveIconUrl,
} from "@/lib/core/data-dragon";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

interface MatchHistoryProps {
  puuid: string;
  queueFilter?: number;
  lastUpdated?: string | null;
}

// Format relative time
function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return "Never";

  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Queue names mapping
const QUEUE_NAMES: Record<number, string> = {
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  400: "Normal Draft",
  430: "Normal Blind",
  450: "ARAM",
};

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

  // Format damage numbers (e.g., 15234 -> "15.2k")
  const formatDamage = (damage: number): string => {
    if (damage >= 1000) {
      return `${(damage / 1000).toFixed(1)}k`;
    }
    return String(damage);
  };

  // Get player's team stats (blue or red based on team_id)
  const getBlueTeamStats = () => teamStats?.blue_team || null;
  const getRedTeamStats = () => teamStats?.red_team || null;

  const blueTeamStats = getBlueTeamStats();
  const redTeamStats = getRedTeamStats();

  // Render summoner spell icon - bigger and with border radius
  const renderSummonerSpell = (spellId: number | null | undefined) => {
    if (!spellId) return <div className="h-5 w-5 bg-muted rounded" />;
    const url = getSummonerSpellIconUrlById(spellId);
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

    // Use primary_style for primary rune icon (not keystone)
    const primaryStyleUrl = runes.primary_style
      ? getRuneStyleIconUrl(runes.primary_style)
      : null;
    const subStyleUrl = runes.sub_style
      ? getRuneStyleIconUrl(runes.sub_style)
      : null;

    return (
      <div className="flex flex-col gap-0.5 items-center">
        {/* Primary style rune - bigger, CIRCLE, no background */}
        <div className="relative h-7 w-7 rounded-full overflow-hidden shrink-0 mb-1">
          {primaryStyleUrl ? (
            <Image
              src={primaryStyleUrl}
              alt="Primary Rune"
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
        </div>
        {/* Secondary tree - square with border radius, no background */}
        <div className="relative h-4 w-4 rounded overflow-hidden shrink-0">
          {subStyleUrl ? (
            <Image
              src={subStyleUrl}
              alt="Secondary Rune"
              fill
              className="object-cover"
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
      | "turret"
      | "inhibitor"
      | "dragon"
      | "voidgrub"
      | "herald"
      | "baron",
    count: number | null | undefined,
    title: string,
    team: "blue" | "red",
  ) => {
    // Turret gets 30% bigger size
    const isTurret = objective === "turret";
    const iconSizeClass = isTurret ? "h-[26px] w-[26px]" : "h-5 w-5";

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
          <div className={`relative ${iconSizeClass}`}>
            <Image
              src={getObjectiveIconUrl(objective, team)}
              alt={title}
              fill
              className="object-cover"
              unoptimized
            />
          </div>
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
        title={champ.champion_name}
      >
        <Image
          src={getChampionIconUrl(champ.champion_name)}
          alt={champ.champion_name}
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
              Vision
            </span>
            <span className="mt-0.5">
              <span className="font-medium">
                {formatDamage(participant.total_damage_dealt_to_champions || 0)}
              </span>{" "}
              DMG
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
                    src={getChampionIconUrl(participant.champion_name)}
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
              <span className="text-sm font-medium truncate">
                {participant?.champion_name || "—"}
              </span>
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
                    src={getChampionIconUrl(opponent.champion_name)}
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
              <span className="text-sm font-medium truncate">
                {opponent?.champion_name || "—"}
              </span>
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
              Vision
            </span>
            <span className="mt-0.5">
              <span className="font-medium">
                {formatDamage(opponent.total_damage_dealt_to_champions || 0)}
              </span>{" "}
              DMG
            </span>
          </div>
        )}

        {/* Column 6: Duration & Surrender */}
        <div className="w-16 shrink-0 text-center flex flex-col justify-center">
          <span className="">{formatDuration(match.game_duration)}</span>
        </div>

        {/* Column 7: LP Change */}
        <div className="w-12 mr-2 shrink-0 text-center flex flex-col justify-center">
          {match.lp_change !== null && match.lp_change !== undefined ? (
            <span
              className={`text-xs font-medium ${
                match.lp_change > 0
                  ? "text-emerald-500"
                  : match.lp_change < 0
                    ? "text-rose-500"
                    : "text-muted-foreground"
              }`}
            >
              {match.lp_change > 0 ? "+" : ""}
              {match.lp_change} LP
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

export function MatchHistory({
  puuid,
  queueFilter = 420,
  lastUpdated,
}: MatchHistoryProps) {
  const PAGE_SIZE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const previousMatchCount = useRef(0);
  const queryClient = useQueryClient();
  const router = useRouter();

  const [displayCount, setDisplayCount] = useState(20);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisConfirm, setShowAnalysisConfirm] = useState(false);

  // Fetch match stats for total wins/losses
  const { data: statsResult } = useQuery({
    queryKey: ["match-history-stats", puuid, queueFilter],
    queryFn: () =>
      validatedGet(MatchStatsResponseSchema, `/matches/player/${puuid}/stats`, {
        queue: queueFilter,
      }),
    enabled: !!puuid,
  });

  const stats = statsResult?.success ? statsResult.data : null;

  const {
    data: response,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["matchHistoryDetailed", puuid, queueFilter, displayCount],
    queryFn: async () => {
      try {
        const result = await validatedGet(
          MatchListWithPlayerDataResponseSchema,
          `/matches/player/${puuid}/detailed`,
          {
            queue: queueFilter,
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

  const { mutate: analyzeMutate } = useMutation({
    mutationFn: async () => {
      const resp = await api.post<{ job_id: string; status: string }>(
        `/matches/analyze/${puuid}`,
      );
      return resp.data.job_id;
    },
    onSuccess: (jobId) => {
      setAnalysisJobId(jobId);
      setIsAnalyzing(true);
      toast.success("Match history analysis started");
    },
    onError: () => {
      toast.error("Failed to start analysis");
    },
  });

  const { data: jobStatus } = useQuery({
    queryKey: ["analysisStatus", analysisJobId],
    queryFn: async () => {
      if (!analysisJobId) return null;
      const response = await api.get<{
        status: string;
        error?: string;
        progress?: number;
        total?: number;
        message?: string;
        estimated_minutes_remaining?: number;
      }>(`/matches/analyze/status/${analysisJobId}`);
      const result = response.data;
      if (result.status === "completed" || result.status === "failed") {
        setIsAnalyzing(false);
        setAnalysisJobId(null);
        queryClient.invalidateQueries({ queryKey: ["matchHistoryDetailed"] });
        router.refresh();
        if (result.status === "completed") {
          toast.success("Analysis complete!");
        } else {
          toast.error(result.error || "Analysis failed");
        }
      } else if (
        result.status === "pending" ||
        result.status === "in_progress"
      ) {
        setIsAnalyzing(true);
      }
      return result;
    },
    enabled: !!analysisJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 2000;
    },
  });

  const { mutate: cancelMutate } = useMutation({
    mutationFn: async () => {
      if (!analysisJobId) return;
      await api.post(`/matches/analyze/cancel/${analysisJobId}`);
    },
    onSuccess: () => {
      toast.info("Analysis cancelled.");
      setIsAnalyzing(false);
      setAnalysisJobId(null);
    },
    onError: () => {
      toast.error("Failed to cancel analysis");
      setIsAnalyzing(false);
      setAnalysisJobId(null);
    },
  });

  const handleAnalyze = () => {
    const totalAnalyzed =
      (data as { total_analyzed?: number })?.total_analyzed || 0;
    if (totalAnalyzed >= 50) {
      setShowAnalysisConfirm(true);
    } else {
      analyzeMutate();
    }
  };

  const handleConfirmAnalyze = () => {
    setShowAnalysisConfirm(false);
    analyzeMutate();
  };

  const handleCancelAnalysis = () => {
    cancelMutate();
  };

  const data = response?.success ? response.data : null;
  const allMatches = data?.matches || [];
  const totalMatches = data?.total || 0;
  const hasMore = allMatches.length < totalMatches;

  // Use stats for total wins/losses display
  const wins = stats?.wins || 0;
  const losses = stats?.losses || 0;

  useEffect(() => {
    if (
      allMatches.length > previousMatchCount.current &&
      previousMatchCount.current > 0
    ) {
      previousMatchCount.current = allMatches.length;
    } else if (allMatches.length > 0) {
      previousMatchCount.current = allMatches.length;
    }
  }, [allMatches.length]);

  const loadMore = useCallback(() => {
    if (!isFetching && hasMore) {
      setDisplayCount((prev) => prev + PAGE_SIZE);
    }
  }, [isFetching, hasMore]);

  useEffect(() => {
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
  }, [loadMore]);

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
    let errorMessage = "Failed to load matches";

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (response && !response.success && response.error) {
      errorMessage =
        typeof response.error === "object" && "message" in response.error
          ? (response.error as { message: string }).message
          : String(response.error);
    }

    if (
      errorMessage.includes("Network Error") ||
      errorMessage.includes("ERR_NETWORK")
    ) {
      errorMessage =
        "Network connection failed. Please check your internet connection.";
    }

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
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ListRestart className="h-5 w-5 text-primary" />
            Match History
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              variant="outline"
              size="sm"
              className="button-small"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Update
            </Button>
          </div>
        </div>
        {totalMatches > 0 && (
          <div className="text-sm mt-1">
            {totalMatches} games analyzed ({wins}W / {losses}L)
          </div>
        )}
        {lastUpdated && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <Clock className="h-3 w-3" />
            <span>Updated {formatRelativeTime(lastUpdated)}</span>
          </div>
        )}

        {isAnalyzing && (
          <div className="mt-4 p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between text-sm text-slate-400">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {jobStatus?.message || "Initializing..."}
              </span>
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {jobStatus?.estimated_minutes_remaining
                  ? `~${jobStatus.estimated_minutes_remaining} min remaining`
                  : "~2 min remaining"}
              </span>
            </div>

            <Progress
              value={
                jobStatus?.total && jobStatus.total > 0
                  ? ((jobStatus.progress || 0) / jobStatus.total) * 100
                  : 0
              }
              className="h-2"
            />

            <div className="text-center text-sm text-slate-500">
              {jobStatus?.total && jobStatus.total > 0
                ? Math.round(
                    ((jobStatus.progress || 0) / jobStatus.total) * 100,
                  )
                : 0}
              % complete
            </div>

            <Button
              onClick={handleCancelAnalysis}
              variant="destructive"
              className="w-full"
              size="sm"
            >
              <StopCircle className="mr-2 h-4 w-4" />
              Cancel Analysis
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {allMatches.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">
                This player has no matches in the database.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Tracked players matches will appear here as a background job
                fetches them from the Riot API. If player is tracked and matches
                are not appearing even after a few minutes, something is wrong.
                For non-tracked players, use the <b>Update</b> button.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-md border">
            {allMatches.map((match) => (
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
                    Showing {allMatches.length} of {totalMatches} matches
                  </div>
                )}
              </div>
            )}
            {!hasMore && allMatches.length > 0 && (
              <div className="flex justify-center py-4 border-t bg-background/50">
                <div className="text-sm text-muted-foreground">
                  All {totalMatches} matches loaded
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={showAnalysisConfirm} onOpenChange={setShowAnalysisConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Analyze Match History?</DialogTitle>
            <DialogDescription>
              This player already has 50 or more analyzed matches, do you wish
              to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAnalysisConfirm(false)}
            >
              No
            </Button>
            <Button onClick={handleConfirmAnalyze}>Yes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
