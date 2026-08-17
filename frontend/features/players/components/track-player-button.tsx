"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@/lib/core/api";
import { Star, StarOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/core/hooks";
import { trackPlayer, untrackPlayer, getTrackingStatus } from "../player-api";
import { useAuth } from "@/features/auth";
import { cn } from "@/lib/core/utils";

interface TrackPlayerButtonProps {
  puuid: string;
  playerName?: string | undefined;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

export function TrackPlayerButton({
  puuid,
  playerName,
  variant = "outline",
  size = "default",
  className,
}: TrackPlayerButtonProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data: trackingStatus, isLoading: isLoadingStatus } = useQuery({
    queryKey: ["tracking-status", userId, puuid],
    queryFn: async () => {
      return unwrap(await getTrackingStatus(puuid));
    },
    enabled: !!userId,
    retry: 1,
    staleTime: 30000,
  });

  const isTracked = trackingStatus?.is_tracked ?? false;

  const trackMutation = useMutation({
    mutationFn: async () => {
      return unwrap(await trackPlayer(puuid));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["tracking-status", userId, puuid],
      });
      void queryClient.invalidateQueries({
        queryKey: ["tracked-players", userId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["player-context", userId],
      });
      void queryClient.invalidateQueries({ queryKey: ["player", puuid] });
      toast({
        title: "Player added for tracking",
        description: `${
          playerName || "Player"
        } is now being tracked. New matches will be fetched automatically.`,
        variant: "success",
      });
    },
    onError: () => {
      toast({
        title: "Player could not be added for tracking",
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const untrackMutation = useMutation({
    mutationFn: async () => {
      return unwrap(await untrackPlayer(puuid));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["tracking-status", userId, puuid],
      });
      void queryClient.invalidateQueries({
        queryKey: ["tracked-players", userId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["player-context", userId],
      });
      void queryClient.invalidateQueries({ queryKey: ["player", puuid] });
      toast({
        title: "Player removed from tracking",
        description: `${playerName || "Player"} is no longer being tracked.`,
        variant: "success",
      });
    },
    onError: () => {
      toast({
        title: "Player could not be removed from tracking",
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const handleToggleTracking = () => {
    if (isTracked) {
      untrackMutation.mutate();
    } else {
      trackMutation.mutate();
    }
  };

  const isLoading =
    isLoadingStatus || trackMutation.isPending || untrackMutation.isPending;

  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "tracking-status-toggle group h-6 w-[72px] shrink-0 px-0 text-[10px]",
        className,
      )}
      onClick={handleToggleTracking}
      disabled={isLoading}
      aria-label={
        isLoading
          ? "Updating player tracking status"
          : isTracked
            ? "Untrack player"
            : "Track player"
      }
      data-tracking-state={isTracked ? "tracked" : "untracked"}
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <>
          <span className="flex items-center gap-1 group-hover:hidden group-focus-visible:hidden">
            {isTracked ? (
              <Star className="h-3.5 w-3.5 fill-current" />
            ) : (
              <StarOff className="h-3.5 w-3.5" />
            )}
            {isTracked ? "Tracked" : "Untracked"}
          </span>
          <span className="hidden items-center gap-1 group-hover:flex group-focus-visible:flex">
            {isTracked ? (
              <StarOff className="h-3.5 w-3.5" />
            ) : (
              <Star className="h-3.5 w-3.5 fill-current" />
            )}
            {isTracked ? "Untrack" : "Track"}
          </span>
        </>
      )}
    </Button>
  );
}
