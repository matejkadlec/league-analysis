"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Search, Star, StopCircle, Users } from "lucide-react";
import { z } from "zod";

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
import { TrackedPlayersList } from "@/features/players/components/tracked-players-list";
import { usePlayerContext } from "@/features/players/context/player-context";
import {
  parseRiotId,
  type RiotIdParts,
} from "@/features/players/utils/riot-id";
import { api, validatedGet } from "@/lib/core/api";
import { useToast } from "@/lib/core/hooks";
import { getPlatformDisplayName } from "@/lib/core/platform-utils";
import { PlayerSchema, type Player } from "@/lib/core/schemas";
import { cn } from "@/lib/core/utils";

const PlayerSuggestionsSchema = z.array(PlayerSchema);
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
] as const;

interface SidebarPlayerSwitcherProps {
  onNavigate?: () => void;
}

function playerLabel(player: Player): string {
  return `${player.game_name ?? "Unknown"}${player.tag_line ? `#${player.tag_line}` : ""}`;
}

export function SidebarPlayerSwitcher({
  onNavigate,
}: SidebarPlayerSwitcherProps) {
  const { toast } = useToast();
  const { currentPlayer, trackedPlayers, selectPlayer, isLoading } =
    usePlayerContext();
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [pendingRiotId, setPendingRiotId] = useState<RiotIdParts | null>(null);
  const [platform, setPlatform] = useState("eun1");
  const [manageOpen, setManageOpen] = useState(false);

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
      const result = await validatedGet(
        PlayerSuggestionsSchema,
        "/players/suggestions",
        { q: debouncedSearch, limit: 5 },
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: debouncedSearch.length >= 2,
    staleTime: 30_000,
  });

  const suggestions = suggestionsQuery.data ?? [];

  const choosePlayer = async (player: Player) => {
    await selectPlayer(player);
    setSearchValue("");
    setDebouncedSearch("");
    onNavigate?.();
  };

  const discoverMutation = useMutation({
    mutationFn: async () => {
      if (!pendingRiotId)
        throw new Error("Enter a Riot ID in Name#Tag format.");
      const response = await api.post("/players/discover", null, {
        params: {
          game_name: pendingRiotId.gameName,
          tag_line: pendingRiotId.tagLine,
          platform,
        },
      });
      const parsed = PlayerSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The player response was invalid.");
      return parsed.data;
    },
    onSuccess: async (player) => {
      setPendingRiotId(null);
      await choosePlayer(player);
    },
    onError: (error: Error) => {
      toast({
        title: "Player search failed",
        description: error.message,
        variant: "error",
      });
    },
  });

  const submitUnknownPlayer = () => {
    try {
      setPendingRiotId(parseRiotId(searchValue));
    } catch (error) {
      toast({
        title: "Check the Riot ID",
        description:
          error instanceof Error ? error.message : "Use the Name#Tag format.",
        variant: "error",
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
    }
  };

  const recentPlayers = useMemo(
    () =>
      trackedPlayers
        .filter((player) => player.puuid !== currentPlayer?.puuid)
        .slice(0, 3),
    [currentPlayer?.puuid, trackedPlayers],
  );

  return (
    <div className="border-b border-white/10 px-3 pb-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/50" />
        <Input
          value={searchValue}
          onChange={(event) => {
            setSearchValue(event.target.value);
            setActiveSuggestion(0);
          }}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search for player"
          aria-label="Search for player"
          aria-autocomplete="list"
          aria-expanded={isSearchFocused && suggestions.length > 0}
          className="h-9 border-white/15 bg-white/5 pl-9 text-sm text-white placeholder:text-white/45"
        />
        {suggestionsQuery.isFetching && (
          <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-white/60" />
        )}
        {isSearchFocused && searchValue.trim().length >= 2 && (
          <div
            role="listbox"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-white/15 bg-[#0a1428] p-1 shadow-xl"
          >
            {suggestions.map((player, index) => (
              <button
                key={player.puuid}
                type="button"
                role="option"
                aria-selected={index === activeSuggestion}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void choosePlayer(player)}
                className={cn(
                  "w-full rounded px-2 py-2 text-left text-xs text-white transition-colors",
                  index === activeSuggestion
                    ? "bg-white/15 text-[#cfa93a]"
                    : "hover:bg-white/10",
                )}
              >
                {playerLabel(player)} ({getPlatformDisplayName(player.platform)}
                )
              </button>
            ))}
            {!suggestionsQuery.isFetching && suggestions.length === 0 && (
              <button
                type="button"
                className="w-full rounded px-2 py-2 text-left text-xs text-white/75 hover:bg-white/10"
                onMouseDown={(event) => event.preventDefault()}
                onClick={submitUnknownPlayer}
              >
                Search Riot for this Name#Tag
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1" aria-label="Current and recent players">
        {isLoading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-white/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading players
          </div>
        ) : currentPlayer ? (
          <button
            type="button"
            onClick={() => void choosePlayer(currentPlayer)}
            className="flex w-full items-center gap-2 rounded border border-[#cfa93a]/45 bg-[#cfa93a]/10 px-2 py-2 text-left text-xs font-medium text-[#e4c96f]"
            aria-current="true"
          >
            <Star className="h-3.5 w-3.5 fill-current" />
            <span className="truncate">{playerLabel(currentPlayer)}</span>
          </button>
        ) : (
          <p className="px-2 py-2 text-xs text-white/55">Select a player</p>
        )}

        {recentPlayers.map((player) => (
          <button
            key={player.puuid}
            type="button"
            onClick={() => void choosePlayer(player)}
            className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-white/80 transition-all hover:bg-white/10 hover:text-[#cfa93a] motion-reduce:transition-none"
          >
            {playerLabel(player)}
          </button>
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setManageOpen(true)}
        className="mt-2 h-8 w-full justify-start px-2 text-xs text-white/65 hover:bg-white/10 hover:text-white"
      >
        <Users className="mr-2 h-3.5 w-3.5" /> Manage Tracked Players
      </Button>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="dialog-white-border max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-[#cfa93a]" /> Manage Tracked
              Players
            </DialogTitle>
            <DialogDescription>
              Select a current player or remove players from your tracked list.
            </DialogDescription>
          </DialogHeader>
          <TrackedPlayersList
            selectedPlayerPuuid={currentPlayer?.puuid ?? null}
            onViewPlayerChange={(player) => {
              if (player) void choosePlayer(player);
              setManageOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingRiotId !== null}
        onOpenChange={(open) => !open && setPendingRiotId(null)}
      >
        <DialogContent className="dialog-white-border">
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
            <Label htmlFor="sidebar-player-platform">Server</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger id="sidebar-player-platform">
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
              onClick={() => discoverMutation.mutate()}
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
