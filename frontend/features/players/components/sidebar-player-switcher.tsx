"use client";

import { Loader2, Star, Users } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlayerSelector } from "@/features/players/components/player-selector";
import { TrackedPlayersList } from "@/features/players/components/tracked-players-list";
import { usePlayerContext } from "@/features/players/context/player-context";
import type { Player } from "@/lib/core/schemas";

interface SidebarPlayerSwitcherProps {
  manageOpen: boolean;
  onManageOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
}

function playerLabel(player: Player): string {
  return `${player.game_name ?? "Unknown"}${player.tag_line ? `#${player.tag_line}` : ""}`;
}

export function SidebarPlayerSwitcher({
  manageOpen,
  onManageOpenChange,
  onNavigate,
}: SidebarPlayerSwitcherProps) {
  const { currentPlayer, selectPlayer, isLoading } = usePlayerContext();

  const choosePlayer = async (player: Player) => {
    await selectPlayer(player);
    onNavigate?.();
  };

  const handleCurrentPlayerClick = () => {
    onManageOpenChange(true);
    onNavigate?.();
  };

  return (
    <div className="border-b border-white/10 px-3 pt-4 pb-3">
      <PlayerSelector
        id="sidebar-player-search"
        ariaLabel="Search for player"
        onPlayerSelected={choosePlayer}
        inputClassName="h-9 border-white/15 bg-white/5 text-sm text-white placeholder:text-white/45"
      />

      <div className="mt-3" aria-label="Current player">
        {isLoading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-white/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading players
          </div>
        ) : currentPlayer ? (
          <button
            type="button"
            onClick={handleCurrentPlayerClick}
            data-testid="current-player-button"
            className="flex w-full items-center gap-2 rounded border border-[#cfa93a]/45 bg-[#cfa93a]/10 px-2 py-2 text-left text-xs font-medium text-[#e4c96f] transition-colors hover:border-[#cfa93a] hover:bg-[#cfa93a]/15 focus-visible:border-[#cfa93a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cfa93a] motion-reduce:transition-none"
            aria-haspopup="dialog"
            aria-expanded={manageOpen}
          >
            <Star className="h-3.5 w-3.5 fill-current" />
            <span className="truncate">{playerLabel(currentPlayer)}</span>
          </button>
        ) : (
          <p className="px-2 py-2 text-xs text-white/55">Select a player</p>
        )}
      </div>

      <Dialog open={manageOpen} onOpenChange={onManageOpenChange}>
        <DialogContent className="player-management-border max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-[#cfa93a]" /> Tracked Players
            </DialogTitle>
            <DialogDescription>
              View, add or remove tracked players.
            </DialogDescription>
          </DialogHeader>
          <TrackedPlayersList
            selectedPlayerPuuid={currentPlayer?.puuid ?? null}
            onViewPlayerChange={(player) => {
              if (player) void choosePlayer(player);
              onManageOpenChange(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
