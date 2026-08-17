"use client";

import type { Player } from "@/lib/core/schemas";

import { displayRiotId } from "./add-tracked-player-servers";

interface AddTrackedPlayerSuggestionsProps {
  suggestions: Player[];
  selectedIndex: number;
  onSelect: (player: Player) => void;
  onHoverIndex: (index: number) => void;
}

export function AddTrackedPlayerSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  onHoverIndex,
}: AddTrackedPlayerSuggestionsProps) {
  return (
    <div className="max-h-72 overflow-y-auto py-1">
      {suggestions.map((suggestion, index) => (
        <button
          key={suggestion.puuid}
          type="button"
          className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
            index === selectedIndex ? "bg-accent text-accent-foreground" : ""
          }`}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(suggestion);
          }}
          onMouseEnter={() => onHoverIndex(index)}
        >
          <span className="font-medium">{displayRiotId(suggestion)}</span>
        </button>
      ))}
    </div>
  );
}
