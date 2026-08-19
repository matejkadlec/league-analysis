"use client";

import { useEffect, useState } from "react";
import { ApiRequestError, normalizeApiError, unwrap } from "@/lib/core/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { discoverPlayer, searchPlayerSuggestions } from "../player-api";
import { useToast } from "@/lib/core/hooks";
import { getPlatformDisplayName } from "@/lib/core/platform-utils";
import type { Player } from "@/lib/core/schemas";
import { cn } from "@/lib/core/utils";

import { parseRiotId, type RiotIdParts } from "../utils/riot-id";

interface DiscoverAttempt {
  riotId: RiotIdParts;
  platform: string;
}
import {
  playerNotFoundMessage,
  playerTrackingFailureKind,
} from "../utils/tracking-feedback";

const PLATFORM_OPTIONS = [
  ["eun1", "EUNE"],
  ["euw1", "EUW"],
  ["na1", "NA"],
  ["kr", "KR"],
  ["br1", "BR"],
  ["jp1", "JP"],
  ["la1", "LAN"],
  ["la2", "LAS"],
  ["oc1", "OCE"],
  ["tr1", "TR"],
  ["ru", "RU"],
  ["ph2", "PH"],
  ["sg2", "SG"],
  ["th2", "TH"],
  ["tw2", "TW"],
  ["vn2", "VN"],
] as const;

function playerLabel(player: Player): string {
  const riotId = `${player.game_name ?? "Unknown"}${
    player.tag_line ? `#${player.tag_line}` : ""
  }`;
  return `${riotId} (${getPlatformDisplayName(player.platform)})`;
}

function isValidRiotId(value: string): boolean {
  try {
    parseRiotId(value);
    return true;
  } catch {
    return false;
  }
}

interface PlayerSelectorProps {
  id: string;
  ariaLabel: string;
  onPlayerSelected: (player: Player) => void | Promise<void>;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function PlayerSelector({
  id,
  ariaLabel,
  onPlayerSelected,
  placeholder = "Search for player",
  className,
  inputClassName,
}: PlayerSelectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [pendingRiotId, setPendingRiotId] = useState<RiotIdParts | null>(null);
  const [platform, setPlatform] = useState("eun1");

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearch(searchValue.trim()),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [searchValue]);

  const suggestionsQuery = useQuery({
    queryKey: ["player-suggestions", debouncedSearch, "all-platforms"],
    queryFn: async () => {
      return unwrap(
        await searchPlayerSuggestions({
          q: debouncedSearch,
          limit: 5,
        }),
      );
    },
    enabled: debouncedSearch.length >= 2,
    staleTime: 30_000,
  });

  const suggestions = suggestionsQuery.data ?? [];
  const listboxId = `${id}-suggestions`;

  const choosePlayer = async (player: Player) => {
    setIsSelecting(true);
    try {
      await onPlayerSelected(player);
      setSearchValue("");
      setDebouncedSearch("");
      setIsSearchFocused(false);
    } catch {
      toast({
        title: "Player selection could not finish",
        description: "Please try again later.",
        variant: "error",
      });
    } finally {
      setIsSelecting(false);
    }
  };

  // The Riot ID and server travel as mutation variables rather than being read
  // from state in `onError`: cancelling or switching server while the request
  // is in flight would otherwise name a server that was never queried, or drop
  // the specific "wasn't found on <server>" wording for the generic message.
  const discoverMutation = useMutation({
    mutationFn: async ({ riotId, platform }: DiscoverAttempt) => {
      const result = await discoverPlayer({
        game_name: riotId.gameName,
        tag_line: riotId.tagLine,
        platform,
      });
      if (!result.success) {
        throw new ApiRequestError(result.error);
      }
      return result.data;
    },
    onSuccess: async (player) => {
      setPendingRiotId(null);
      void queryClient.invalidateQueries({ queryKey: ["player-suggestions"] });
      void queryClient.invalidateQueries({
        queryKey: ["player", player.puuid],
      });
      await choosePlayer(player);
    },
    onError: (error, attempt) => {
      const kind = playerTrackingFailureKind(normalizeApiError(error));
      if (kind === "api-key") {
        toast({
          title: "Player search is temporarily unavailable",
          description:
            "The Riot API key is invalid or expired. Please contact an administrator.",
          variant: "error",
        });
        return;
      }
      if (kind === "rate-limited") {
        toast({
          title: "Player search could not finish",
          description: "Riot temporarily limited requests. Try again later.",
          variant: "warning",
        });
        return;
      }
      if (kind === "not-found") {
        toast({
          title: "Player search could not finish",
          description: playerNotFoundMessage(attempt.riotId, attempt.platform),
          variant: "error",
        });
        return;
      }
      toast({
        title: "Player search could not finish",
        description: "Check the Riot ID and server, then try again.",
        variant: "error",
      });
    },
  });

  const submitUnknownPlayer = () => {
    try {
      setPendingRiotId(parseRiotId(searchValue));
      setIsSearchFocused(false);
    } catch (error) {
      toast({
        title: "Check the Riot ID",
        description:
          error instanceof Error ? error.message : "Use the Name#Tag format.",
        variant: "warning",
      });
    }
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setActiveSuggestion((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setActiveSuggestion(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = suggestions[activeSuggestion];
      if (suggestion) void choosePlayer(suggestion);
      else submitUnknownPlayer();
    } else if (event.key === "Escape") {
      setSearchValue("");
      setIsSearchFocused(false);
    }
  };

  const showResults =
    isSearchFocused && searchValue.trim().length >= 2 && !isSelecting;

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        id={id}
        value={searchValue}
        onChange={(event) => {
          setSearchValue(event.target.value);
          setActiveSuggestion(0);
        }}
        onFocus={() => setIsSearchFocused(true)}
        onBlur={() => setIsSearchFocused(false)}
        onKeyDown={onSearchKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        // The attributes below are only valid on a combobox; without the role
        // a screen reader is told nothing about the listbox this input drives.
        role="combobox"
        aria-autocomplete="list"
        aria-controls={showResults ? listboxId : undefined}
        aria-expanded={showResults}
        aria-activedescendant={
          // Gated on showResults: the option ids only exist while the listbox
          // is mounted, and a dangling reference makes a screen reader
          // announce a phantom active option after the list closes.
          showResults && suggestions[activeSuggestion]
            ? `${listboxId}-${activeSuggestion}`
            : undefined
        }
        autoComplete="off"
        disabled={isSelecting || discoverMutation.isPending}
        className={cn("pl-9", inputClassName)}
      />
      {(suggestionsQuery.isFetching || isSelecting) && (
        <Loader2
          className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground"
          aria-label="Loading players"
          role="status"
        />
      )}
      {showResults && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {suggestions.map((player, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={player.puuid}
              type="button"
              role="option"
              aria-selected={index === activeSuggestion}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveSuggestion(index)}
              onClick={() => void choosePlayer(player)}
              className={cn(
                "w-full rounded px-2 py-2 text-left text-xs transition-colors",
                index === activeSuggestion
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {playerLabel(player)}
            </button>
          ))}
          {!suggestionsQuery.isFetching &&
            (suggestions.length === 0 || isValidRiotId(searchValue)) && (
              <button
                type="button"
                className="w-full rounded px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={submitUnknownPlayer}
              >
                Search Riot for this Name#Tag
              </button>
            )}
        </div>
      )}

      <Dialog
        open={pendingRiotId !== null}
        onOpenChange={(open) => !open && setPendingRiotId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-[#cfa93a]" /> Select player server
            </DialogTitle>
            <DialogDescription>
              Choose the server for {pendingRiotId?.gameName}#
              {pendingRiotId?.tagLine}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${id}-platform`}>Server</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger id={`${id}-platform`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              className="red-gradient py-2 px-4"
              onClick={() => setPendingRiotId(null)}
            >
              <StopCircle className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              type="button"
              className="button-medium no-rotation py-2 px-4"
              disabled={discoverMutation.isPending}
              onClick={() => {
                if (pendingRiotId) {
                  discoverMutation.mutate({ riotId: pendingRiotId, platform });
                }
              }}
            >
              {discoverMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Select player
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
