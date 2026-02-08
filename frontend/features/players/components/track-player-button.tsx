"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, StarOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/core/hooks";
import { trackPlayer, untrackPlayer, getTrackingStatus } from "@/lib/core/api";
import { useAuth } from "@/features/auth";

interface TrackPlayerButtonProps {
  puuid: string;
  playerName?: string;
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
      const response = await getTrackingStatus(puuid);
      if (!response.success) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    enabled: !!userId,
    retry: 1,
    staleTime: 30000,
  });

  const isTracked = trackingStatus?.is_tracked ?? false;

  const trackMutation = useMutation({
    mutationFn: async () => {
      const response = await trackPlayer(puuid);
      if (!response.success) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking-status", userId, puuid] });
      queryClient.invalidateQueries({ queryKey: ["tracked-players", userId] });
      queryClient.invalidateQueries({ queryKey: ["player", puuid] });
      toast({
        title: "Player tracked",
        description: `${
          playerName || "Player"
        } is now being tracked. New matches will be fetched automatically.`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to track player",
        description: error.message,
        variant: "error",
      });
    },
  });

  const untrackMutation = useMutation({
    mutationFn: async () => {
      const response = await untrackPlayer(puuid);
      if (!response.success) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking-status", userId, puuid] });
      queryClient.invalidateQueries({ queryKey: ["tracked-players", userId] });
      queryClient.invalidateQueries({ queryKey: ["player", puuid] });
      toast({
        title: "Player untracked",
        description: `${playerName || "Player"} is no longer being tracked.`,
        variant: "info",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to untrack player",
        description: error.message,
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
      className={className}
      onClick={handleToggleTracking}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isTracked ? (
        <>
          <StarOff className="mr-2 h-4 w-4" />
          Untrack
        </>
      ) : (
        <>
          <Star className="mr-2 h-4 w-4" />
          Track
        </>
      )}
    </Button>
  );
}
