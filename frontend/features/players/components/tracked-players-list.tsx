"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Eye,
  EyeOff,
  Loader2,
  UserMinus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { api, validatedGet } from "@/lib/core/api";
import {
  PlayerLeagueSchema,
  PlayerSchema,
  type Player,
} from "@/lib/core/schemas";
import { useAuth } from "@/features/auth";
import { getRankColors } from "@/features/players/utils/rank-colors";
import { cn } from "@/lib/core/utils";
import { getPlatformDisplayName } from "@/lib/core/platform-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const TrackedPlayersSchema = z.array(PlayerSchema);
const PLAYER_ROW_HEIGHT_PX = 88;
const PLAYER_ROW_GAP_PX = 12;
const EMPTY_LIST_HEIGHT_PX = 88;
const MAX_VISIBLE_PLAYER_ROWS = 5;

interface TrackedPlayersListProps {
  className?: string;
  selectedPlayerPuuid?: string | null;
  onViewPlayerChange?: (player: Player | null) => void;
}

interface TrackedPlayerRowProps {
  player: Player;
  isViewedPlayer: boolean;
  isUntrackingCurrentPlayer: boolean;
  onViewPlayer: (player: Player) => void;
  onUntrackPlayer: (player: Player) => void;
}

function getListHeightPx(rowCount: number): number {
  if (rowCount <= 0) {
    return EMPTY_LIST_HEIGHT_PX;
  }

  return (
    rowCount * PLAYER_ROW_HEIGHT_PX +
    Math.max(0, rowCount - 1) * PLAYER_ROW_GAP_PX
  );
}

function TrackedPlayerRow({
  player,
  isViewedPlayer,
  isUntrackingCurrentPlayer,
  onViewPlayer,
  onUntrackPlayer,
}: TrackedPlayerRowProps) {
  const { data: league } = useQuery({
    queryKey: ["player-league", player.puuid],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerLeagueSchema.nullable(),
        `/players/${player.puuid}/league`,
      );

      if (!result.success) {
        return null;
      }

      return result.data;
    },
    retry: false,
    staleTime: 60000,
  });

  const leagueColors = league ? getRankColors(league.tier) : null;

  return (
    <div
      data-testid={`tracked-player-row-${player.puuid}`}
      className="player-management-border flex min-h-[88px] items-center justify-between rounded-lg bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{player.game_name}</h3>
          {player.tag_line && (
            <span className="text-sm text-muted-foreground">
              #{player.tag_line}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {league && (
            <>
              <span className={cn("font-semibold", leagueColors?.text)}>
                {league.display_rank} {league.league_points} LP
              </span>
              <span>•</span>
            </>
          )}

          <span>{getPlatformDisplayName(player.platform)}</span>

          {typeof player.summoner_level === "number" && (
            <>
              <span>•</span>
              <span>Level {player.summoner_level}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          className="button-medium no-rotation"
          onClick={() => onViewPlayer(player)}
        >
          {isViewedPlayer ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          {isViewedPlayer ? "Hide" : "View"}
        </Button>

        <Button
          type="button"
          className="button-medium no-rotation"
          onClick={() => onUntrackPlayer(player)}
          disabled={isUntrackingCurrentPlayer}
        >
          {isUntrackingCurrentPlayer ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserMinus className="h-4 w-4" />
          )}
          Untrack
        </Button>
      </div>
    </div>
  );
}

export function TrackedPlayersList({
  className,
  selectedPlayerPuuid = null,
  onViewPlayerChange,
}: TrackedPlayersListProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["tracked-players", userId],
    queryFn: async () => {
      const result = await validatedGet(
        TrackedPlayersSchema,
        "/players/tracked/list",
      );

      if (!result.success) {
        throw new Error(result.error.message);
      }

      return result.data;
    },
    enabled: !!userId,
    refetchInterval: 10000,
  });

  const untrackMutation = useMutation({
    mutationFn: async (puuid: string) => {
      const response = await api.delete(`/players/${puuid}/track`);
      return response.data;
    },
    onSuccess: (_, puuid) => {
      queryClient.invalidateQueries({ queryKey: ["tracked-players", userId] });
      queryClient.invalidateQueries({ queryKey: ["player-context", userId] });
      queryClient.invalidateQueries({
        queryKey: ["tracking-status", userId, puuid],
      });
      queryClient.invalidateQueries({ queryKey: ["player", puuid] });

      const player = data?.find(
        (trackedPlayer) => trackedPlayer.puuid === puuid,
      );
      toast.success(
        `Successfully removed ${
          player?.game_name || "player"
        } from tracked players`,
      );

      if (selectedPlayerPuuid === puuid) {
        onViewPlayerChange?.(null);
      }
    },
    onError: (mutationError: Error) => {
      toast.error(`Failed to untrack player: ${mutationError.message}`);
    },
  });

  const handleUntrack = (player: Player) => {
    if (
      window.confirm(
        `Are you sure you want to stop tracking ${player.game_name}?`,
      )
    ) {
      untrackMutation.mutate(player.puuid);
    }
  };

  const handleViewPlayer = (player: Player) => {
    const isAlreadyVisible = selectedPlayerPuuid === player.puuid;

    if (isAlreadyVisible) {
      onViewPlayerChange?.(null);
      return;
    }

    onViewPlayerChange?.(player);
  };

  if (isLoading) {
    return (
      <Card
        id="tracked-players"
        className={cn("flex h-full flex-col border-0", className)}
      >
        <CardContent className="flex flex-1 items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card
        id="tracked-players"
        className={cn("flex h-full flex-col border-0", className)}
      >
        <CardContent className="flex flex-1 flex-col justify-center p-6">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
            <p className="text-sm text-destructive">
              Failed to load tracked players. Please try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card
        id="tracked-players"
        className={cn("flex h-full flex-col border-0", className)}
      >
        <CardContent className="flex flex-1 items-center p-6">
          <div className="w-full rounded-lg border border-dashed p-8 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              No tracked players yet. Add a player using the left card to start
              tracking.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      id="tracked-players"
      className={cn("flex h-full flex-col border-0", className)}
    >
      <div
        data-testid="tracked-players-scroll-region"
        className={cn(
          data.length > MAX_VISIBLE_PLAYER_ROWS
            ? "overflow-y-auto pr-1"
            : "overflow-hidden",
        )}
        style={{
          maxHeight: `${getListHeightPx(
            Math.min(data.length, MAX_VISIBLE_PLAYER_ROWS),
          )}px`,
        }}
      >
        <div className="space-y-3">
          {data.map((player) => (
            <TrackedPlayerRow
              key={player.puuid}
              player={player}
              isViewedPlayer={selectedPlayerPuuid === player.puuid}
              isUntrackingCurrentPlayer={
                untrackMutation.isPending &&
                untrackMutation.variables === player.puuid
              }
              onViewPlayer={handleViewPlayer}
              onUntrackPlayer={handleUntrack}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
