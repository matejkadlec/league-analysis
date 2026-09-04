"use client";

import type { ReactElement } from "react";
import Image from "next/image";

import type { TeamChampion } from "@/lib/core/schemas";
import {
  getChampionIconUrl,
  getChampionDisplayName,
  getSummonerSpellIconUrlById,
  getKeystoneIconUrlById,
  getKeystoneName,
  getRuneStyleIconUrl,
  getRuneStyleName,
  getSummonerSpellName,
} from "@/lib/core/riot/data-dragon";
import { formatRiotId } from "@/features/players";
import { cn } from "@/lib/core/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { switchTarget, type MatchSideParticipant } from "../match-row-format";

/**
 * Names a wordless icon on hover and on keyboard focus. Focus is the caller's
 * job: `asChild` hands the trigger to its child and a `div` is not focusable,
 * so icon-group callers pass `tabIndex={0}`, one stop per group.
 */
function IconTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function renderSummonerSpells(
  spellIds: (number | null | undefined)[],
  ddragonVersion: string,
) {
  const spells = spellIds.map((spellId) => {
    if (!spellId) return null;
    const url = getSummonerSpellIconUrlById(spellId, ddragonVersion);
    // Both or neither: art and name come out of the same entry, so an id this
    // build does not know falls back to the placeholder rather than to an icon
    // labelled "Summoner spell", which named nothing and read as a real answer.
    const name = getSummonerSpellName(spellId);
    return url && name ? { url, name } : null;
  });
  const icons = spells.map((spell, index) =>
    spell ? (
      <div
        key={index}
        className="relative rounded-sm h-5 w-5 overflow-hidden shrink-0 border border-black/30"
      >
        <Image
          src={spell.url}
          alt={spell.name}
          fill
          sizes="20px"
          className="object-cover"
          unoptimized
        />
      </div>
    ) : (
      <div key={index} className="h-5 w-5 bg-muted rounded" />
    ),
  );
  const names = spells.filter((spell) => spell !== null);
  // One focus stop and one tooltip for the pair, not one per icon: a page of
  // rows is tabbed through, and per-icon stops made the tab order mostly
  // decoration (LGA-91 review). Each icon keeps its own `alt`.
  if (names.length === 0) {
    return <div className="flex gap-0.5">{icons}</div>;
  }
  return (
    <IconTooltip label={names.map((spell) => spell.name).join(" — ")}>
      <div tabIndex={0} className="flex gap-0.5">
        {icons}
      </div>
    </IconTooltip>
  );
}

export function renderRunes(
  runes:
    | {
        primary_style?: number | null | undefined;
        sub_style?: number | null | undefined;
        keystone?: number | null | undefined;
      }
    | null
    | undefined,
) {
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
  const keystoneName = runes.keystone ? getKeystoneName(runes.keystone) : null;
  const primaryStyleName = runes.primary_style
    ? getRuneStyleName(runes.primary_style)
    : null;
  const subStyleName = runes.sub_style
    ? getRuneStyleName(runes.sub_style)
    : null;
  // The top icon is the keystone whenever we have art for it, so its label
  // has to be the keystone too. Both come out of the same keystone table, so
  // the label falls back to the tree exactly when the icon does.
  const primaryLabel = keystoneName || primaryStyleName || "Primary rune style";
  // The bottom icon really is the secondary tree, and keeps saying so.
  const subLabel = subStyleName || "Secondary rune style";

  // One focus stop and one tooltip for the pair — same reasoning as the
  // summoner spells: keyboard reachability per row group, not per icon.
  return (
    <IconTooltip label={`${primaryLabel} — ${subLabel}`}>
      <div tabIndex={0} className="flex flex-col gap-0.5 items-center">
        <div className="relative h-7 w-7 rounded-full overflow-hidden shrink-0 mb-1">
          {primaryStyleIconUrl ? (
            <Image
              src={primaryStyleIconUrl}
              alt={primaryLabel}
              fill
              sizes="28px"
              className="object-contain"
              unoptimized
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
        </div>
        <div className="relative h-4 w-4 rounded overflow-hidden shrink-0">
          {subStyleIconUrl ? (
            <Image
              src={subStyleIconUrl}
              alt={subLabel}
              fill
              sizes="16px"
              className="object-contain"
              unoptimized
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
        </div>
      </div>
    </IconTooltip>
  );
}

/**
 * The 52px champion icon at the centre of the matchup. Switchable only for
 * the lane opponent: the other side is the player whose page this is, whom
 * the API does not identify here and who has nowhere to switch to anyway.
 */
export function ChampionPortrait({
  participant,
  ddragonVersion,
  emptyChampionFallback,
  onSelectPlayer,
}: {
  participant: MatchSideParticipant | null | undefined;
  ddragonVersion: string;
  emptyChampionFallback: boolean;
  onSelectPlayer: (puuid: string) => void;
}) {
  const shell = "relative h-[52px] w-[52px] rounded overflow-hidden shrink-0";

  if (!participant) {
    return emptyChampionFallback ? (
      <div className={shell}>
        <div className="h-full w-full bg-muted" />
      </div>
    ) : (
      <div className={shell} />
    );
  }

  const championName = getChampionDisplayName(participant.champion_name);
  const icon = (
    <Image
      src={getChampionIconUrl(participant.champion_name, ddragonVersion)}
      alt={championName}
      fill
      sizes="52px"
      className="object-cover"
      unoptimized
    />
  );
  const target = switchTarget(participant);

  if (!target) {
    return <div className={shell}>{icon}</div>;
  }

  return (
    <IconTooltip label={target.riotId}>
      <button
        type="button"
        aria-label={`${championName} — view ${target.riotId}`}
        onClick={() => onSelectPlayer(target.puuid)}
        className={cn(
          shell,
          "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cfa93a]",
        )}
      >
        {icon}
      </button>
    </IconTooltip>
  );
}

export function renderTeamChampIcon(
  champ: TeamChampion,
  isCurrentPlayer: boolean,
  teamColor: "blue" | "red",
  ddragonVersion: string,
  onSelectPlayer: (puuid: string) => void,
) {
  const borderColor = isCurrentPlayer
    ? "ring-2 ring-yellow-400"
    : teamColor === "blue"
      ? "ring-1 ring-blue-500"
      : "ring-1 ring-red-500";
  const championName = getChampionDisplayName(champ.champion_name);
  const riotId = formatRiotId(champ);
  const shell = `relative h-6 w-6 rounded overflow-hidden shrink-0 ${borderColor}`;
  const icon = (
    <Image
      src={getChampionIconUrl(champ.champion_name, ddragonVersion)}
      alt={championName}
      fill
      sizes="24px"
      className="object-cover"
      unoptimized
    />
  );

  // The tooltip names the player, not the champion: the champion is what the
  // icon already is. The current player's own icon stays a plain div with no
  // focus stop -- it cannot switch anywhere.
  return isCurrentPlayer ? (
    <IconTooltip key={champ.puuid} label={riotId}>
      <div className={shell}>{icon}</div>
    </IconTooltip>
  ) : (
    <IconTooltip key={champ.puuid} label={riotId}>
      <button
        type="button"
        // Both halves on purpose: the ticket wants the target player in the
        // accessible name, and dropping the champion would lose what the icon
        // used to say.
        aria-label={`${championName} — view ${riotId}`}
        onClick={() => onSelectPlayer(champ.puuid)}
        className={cn(
          shell,
          "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cfa93a]",
        )}
      >
        {icon}
      </button>
    </IconTooltip>
  );
}
