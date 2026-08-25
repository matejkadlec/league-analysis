"use client";

import type { ReactElement } from "react";
import Image from "next/image";
import { Swords } from "lucide-react";

import {
  MatchWithPlayerData,
  ParticipantRunes,
  TeamChampion,
  TeamStats,
} from "@/lib/core/schemas";
import {
  getChampionIconUrl,
  getChampionDisplayName,
  getSummonerSpellIconUrlById,
  getKeystoneIconUrlById,
  getKeystoneName,
  getRuneStyleIconUrl,
  getRuneStyleName,
  getSummonerSpellName,
} from "@/lib/core/data-dragon";
import { formatDateTime } from "@/lib/core/format";
import { useDDragonVersion } from "@/lib/core/data-dragon-context";
import { formatRiotId } from "@/features/players";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { getMatchQueueName } from "../queue-catalog";
import { TeamObjectiveStats } from "./objective-icons";

interface MatchRowProps {
  match: MatchWithPlayerData;
  playerPuuid: string;
  /** Make this participant the application's current player. */
  onSelectPlayer: (puuid: string) => void;
}

interface MatchSideParticipant {
  champion_name: string;
  champion_level: number;
  kills: number;
  deaths: number;
  assists: number;
  summoner1_id?: number | null | undefined;
  summoner2_id?: number | null | undefined;
  runes?: ParticipantRunes | null | undefined;
  // Optional because the two shapes this stands in for differ: the API
  // identifies the lane opponent, but not the current player's own
  // participant — that row's identity is the page you are already on. An
  // unidentified side is therefore also an unswitchable one, which is exactly
  // the rule the icons need.
  puuid?: string | undefined;
  game_name?: string | undefined;
  tag_line?: string | undefined;
}

/**
 * The Riot ID and PUUID of a participant it is possible to switch to, or
 * `null` for one it is not.
 */
function switchTarget(
  participant: MatchSideParticipant | null | undefined,
): { puuid: string; riotId: string } | null {
  if (!participant?.puuid || !participant.game_name) return null;
  return {
    puuid: participant.puuid,
    riotId: formatRiotId({
      game_name: participant.game_name,
      tag_line: participant.tag_line ?? "",
    }),
  };
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// `numeric: "auto"` is what produces "today"/"yesterday" natively; only the
// capitalisation is ours.
const dayFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getDaysAgo(timestamp: number): string {
  // Calendar days apart, not elapsed 24-hour blocks. The absolute date
  // printed directly above this label is a local calendar day
  // (`formatDateTime`), and the two are meant to be two readings of one
  // instant: counting 24-hour blocks made a game played at 23:00 read
  // "Today" until the following midday, and stretched "Yesterday" into the
  // day before. Rounding rather than flooring the difference keeps the
  // 23- and 25-hour days either side of a DST change on whole numbers.
  const diffDays = Math.round(
    (startOfLocalDay(Date.now()) - startOfLocalDay(timestamp)) / 86_400_000,
  );
  const formatted = dayFormatter.format(-diffDays, "day");
  return diffDays < 2
    ? formatted.charAt(0).toUpperCase() + formatted.slice(1)
    : formatted;
}

/**
 * How the game went, decided once for both signals the row shows: the
 * background tint and the outcome word next to the duration (WCAG 1.4.1 —
 * colour is never the only carrier of meaning).
 *
 * The remake check comes before the win check on purpose: a remake is
 * annulled, so neither side won it. A missing participant is a data gap, not
 * a loss — neutral tint and no verdict word, rather than a row that reads as
 * a game the player lost.
 */
function getMatchOutcome(match: MatchWithPlayerData): {
  label: string;
  bgClass: string;
} {
  const participant = match.player_participant;

  if (!participant) return { label: "—", bgClass: "bg-muted/30" };
  if (participant.remake || match.early_surrender)
    return { label: "Remake", bgClass: "bg-gray-500/50" };
  if (participant.win)
    return { label: "Victory", bgClass: "bg-emerald-700/30" };
  return { label: "Defeat", bgClass: "bg-rose-600/30" };
}

/**
 * Names a wordless icon on hover and on keyboard focus.
 *
 * Focus is the caller's job, not this component's: `asChild` hands the trigger
 * to whatever child it is given, and a plain `div` is not focusable, so the
 * icon-group callers pass `tabIndex={0}` — one stop per rune or spell group,
 * not per icon — and the two button callers need nothing. Each icon's name is
 * also its image's `alt`, so a screen reader that never opens the tooltip
 * still gets the name. The two participant triggers are buttons and do not
 * work that way: their label is the Riot ID, their `alt` is the champion, and
 * their accessible name is the `aria-label` that names both.
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

function renderSummonerSpells(
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

function renderRunes(
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
  // has to be the keystone too — naming it "Precision" over a Conqueror icon
  // is the bug this replaced. Both come out of the same keystone table, so
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
 * The 52px champion icon at the centre of the matchup.
 *
 * Switchable only for the lane opponent: the other side is the player whose
 * page this is, whom the API does not identify here and who has nowhere to
 * switch to anyway.
 */
function ChampionPortrait({
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
        className={`${shell} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cfa93a]`}
      >
        {icon}
      </button>
    </IconTooltip>
  );
}

function renderTeamStatsRow(stats: TeamStats | null, team: "blue" | "red") {
  if (!stats) return null;
  return <TeamObjectiveStats stats={stats} team={team} />;
}

function renderTeamChampIcon(
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
  // icon already is, while whose game this was appeared nowhere in the row.
  //
  // The current player's own icon stays a plain div with no focus stop. It
  // cannot switch anywhere — they are already here — and its tooltip only
  // names the viewer themselves, which is not worth a tab stop on every row
  // (the hover tooltip and the champion `alt` remain).
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
        className={`${shell} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cfa93a]`}
      >
        {icon}
      </button>
    </IconTooltip>
  );
}

/** Which of one side's four statistics beat the other side's. */
interface SideStatHighlight {
  kda: boolean;
  cs: boolean;
  vision: boolean;
  killParticipation: boolean;
}

/**
 * Whether this side wins one lane comparison. Compared on the canonical
 * numbers, never on the rendered strings, so two values that round to the
 * same text still separate. A value missing on either side — no lane
 * opponent, or a kill participation with no team kills to divide by — and an
 * exact tie both leave the pair unhighlighted.
 */
function winsStat(
  mine: number | null | undefined,
  theirs: number | null | undefined,
): boolean {
  return mine != null && theirs != null && mine > theirs;
}

function MatchSideStats({
  kda,
  totalCs,
  csPerMinute,
  visionScore,
  killParticipation,
  highlight,
}: {
  kda: number;
  totalCs: number;
  csPerMinute: string;
  visionScore: number;
  killParticipation: number | null;
  highlight: SideStatHighlight;
}) {
  // Yellow marks the better side of the matchup; the other side keeps the
  // normal foreground rather than being dimmed. Nothing is encoded in the
  // colour that the numbers themselves do not say (WCAG 1.4.1) — it is a
  // scan aid across two mirrored blocks, not a state.
  const lead = (wins: boolean) => (wins ? " text-yellow-500" : "");
  return (
    <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center text-xs lg:ml-2 lg:w-25 lg:shrink-0">
      <span className={lead(highlight.kda).trim()}>
        <span className="font-medium">{kda.toFixed(2)}</span> KDA
      </span>
      <span className={`mt-0.5${lead(highlight.cs)}`}>
        <span className="font-medium">{totalCs}</span> CS ({csPerMinute}/min)
      </span>
      <span className={`mt-0.5${lead(highlight.vision)}`}>
        <span className="font-medium">{visionScore}</span> Vision Score
      </span>
      <span className={`mt-0.5${lead(highlight.killParticipation)}`}>
        <span className="font-medium">
          {killParticipation !== null
            ? `${killParticipation.toFixed(0)}%`
            : "—"}
        </span>{" "}
        Kill Particip.
      </span>
    </div>
  );
}

function MatchSideColumn({
  participant,
  ddragonVersion,
  emptyChampionFallback,
  emptyKdaFallback,
  onSelectPlayer,
}: {
  participant: MatchSideParticipant | null | undefined;
  ddragonVersion: string;
  emptyChampionFallback: boolean;
  emptyKdaFallback: boolean;
  onSelectPlayer: (puuid: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 lg:w-48 lg:flex-none">
      {/* Below `lg` the two sides split one phone width, and the rune icons
          are the detail worth trading for a readable champion name. */}
      <div className="hidden lg:block">{renderRunes(participant?.runes)}</div>

      <div className="flex flex-col items-center gap-0.5">
        <ChampionPortrait
          participant={participant}
          ddragonVersion={ddragonVersion}
          emptyChampionFallback={emptyChampionFallback}
          onSelectPlayer={onSelectPlayer}
        />
        {renderSummonerSpells(
          [participant?.summoner1_id, participant?.summoner2_id],
          ddragonVersion,
        )}
      </div>

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
        <span className="text-xs text-foreground/75">
          {participant ? `Lv ${participant.champion_level}` : "—"}
        </span>
        {participant ? (
          <span className="text-xs">
            {participant.kills} / {participant.deaths} / {participant.assists}
          </span>
        ) : emptyKdaFallback ? (
          // text-foreground/75 like the other row text: this fallback sits on
          // the same win/loss tint that failed 4.5:1, it just never rendered
          // under the axe fixtures, which always serve full participants.
          <span className="text-xs text-foreground/75">—</span>
        ) : null}
      </div>
    </div>
  );
}

function MatchTeamCompositions({
  teamComps,
  playerPuuid,
  ddragonVersion,
  onSelectPlayer,
}: {
  teamComps: MatchWithPlayerData["team_compositions"];
  playerPuuid: string;
  ddragonVersion: string;
  onSelectPlayer: (puuid: string) => void;
}) {
  return (
    <div className="flex w-37 flex-col items-center justify-center gap-0.5 lg:mr-1">
      {teamComps ? (
        <>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-blue-900/30 rounded px-1 py-0.5">
              {teamComps.blue_team.map((champ) =>
                renderTeamChampIcon(
                  champ,
                  champ.puuid === playerPuuid,
                  "blue",
                  ddragonVersion,
                  onSelectPlayer,
                ),
              )}
            </div>
          </div>
          {/* text-foreground/75 like the rest of the row: muted-foreground
              composites to 3.1-4.4:1 on the win/loss tints, under the 4.5:1
              the earlier contrast fix cites. axe filed these under
              results.incomplete (alpha-stacked backgrounds), which the spec
              does not assert, so the green gate proved nothing here. */}
          <div className="text-center text-xs text-foreground/75">Vs</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-red-900/30 rounded px-1 py-0.5">
              {teamComps.red_team.map((champ) =>
                renderTeamChampIcon(
                  champ,
                  champ.puuid === playerPuuid,
                  "red",
                  ddragonVersion,
                  onSelectPlayer,
                ),
              )}
            </div>
          </div>
        </>
      ) : (
        // Same contrast reasoning as the KDA fallback above.
        <div className="text-xs text-foreground/75 text-center">—</div>
      )}
    </div>
  );
}

export function MatchRow({
  match,
  playerPuuid,
  onSelectPlayer,
}: MatchRowProps) {
  const ddragonVersion = useDDragonVersion();
  const participant = match.player_participant;
  const opponent = match.lane_opponent;
  const outcome = getMatchOutcome(match);
  const teamComps = match.team_compositions;
  const teamStats = match.team_stats;

  const csPerMinute = participant
    ? (participant.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  const opponentCsPerMinute = opponent
    ? (opponent.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

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
  const killParticipation =
    participant && playerTeamStats && playerTeamStats.kills > 0
      ? ((participant.kills + participant.assists) / playerTeamStats.kills) *
        100
      : null;
  const enemyKillParticipation =
    opponent && enemyTeamStats && enemyTeamStats.kills > 0
      ? ((opponent.kills + opponent.assists) / enemyTeamStats.kills) * 100
      : null;

  // Decided here because only the row sees both sides. CS compares the raw
  // `total_cs` integers rather than the `/min` strings: both participants
  // played the same `game_duration`, so the CS ordering is the CS/min
  // ordering, and the parenthetical is highlighted with the total it came
  // from.
  const playerStatHighlight: SideStatHighlight = {
    kda: winsStat(participant?.kda, opponent?.kda),
    cs: winsStat(participant?.total_cs, opponent?.total_cs),
    vision: winsStat(participant?.vision_score, opponent?.vision_score),
    killParticipation: winsStat(killParticipation, enemyKillParticipation),
  };
  const opponentStatHighlight: SideStatHighlight = {
    kda: winsStat(opponent?.kda, participant?.kda),
    cs: winsStat(opponent?.total_cs, participant?.total_cs),
    vision: winsStat(opponent?.vision_score, participant?.vision_score),
    killParticipation: winsStat(enemyKillParticipation, killParticipation),
  };

  return (
    <div
      className={`px-3 py-1.5 rounded border-2 mb-1.5 border-t-1 border-b-1 border-amber-400/20 last:border-b-0 last:mb-0 ${outcome.bgClass}`}
    >
      {/*
        Below `lg` the blocks wrap instead of holding their desktop widths, and
        the matchup jumps to the front so the two stat blocks end up adjacent —
        left one the player's, right one the opponent's, same as on desktop.
      */}
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center lg:w-35 lg:shrink-0">
          <span className="text-sm font-medium text-center">
            {getMatchQueueName(match.queue_id)}
          </span>
          <span className="text-xs text-foreground/75 text-center mt-1">
            Patch {match.game_version.split(".").slice(0, 2).join(".")}
          </span>
        </div>

        <div className="flex w-[calc(50%-0.25rem)] flex-col justify-center lg:w-33 lg:shrink-0">
          <span className="text-sm text-center">
            {formatDateTime(match.game_start_timestamp)}
          </span>
          <span className="text-xs text-center text-foreground/75 mt-1">
            {getDaysAgo(match.game_start_timestamp)}
          </span>
        </div>

        {/* Full width below `lg`: every other stacked cell is a half, so a
            half here would pair the duration with the player's stat block and
            push the opponent's onto the next row, breaking the side-by-side
            reading the wrap order above exists for. */}
        <div className="w-full shrink-0 text-center flex flex-col justify-center lg:w-16">
          {/* The row's tint is the only other outcome signal; colourblind
              players need the word (WCAG 1.4.1: no colour-only meaning). */}
          <span className="text-[10px] font-semibold uppercase text-foreground/75">
            {outcome.label}
          </span>
          <span>{formatDuration(match.game_duration)}</span>
        </div>

        {participant && (
          <MatchSideStats
            kda={participant.kda}
            totalCs={participant.total_cs}
            csPerMinute={csPerMinute}
            visionScore={participant.vision_score}
            killParticipation={killParticipation}
            highlight={playerStatHighlight}
          />
        )}

        {/* 484px, not 420: the LP cell took `w-12` + `mr-2` + one of the
            row's `gap-2` gaps with it (3 + 0.5 + 0.5rem = 4rem), and both
            champion columns grew by half of that each (`lg:w-40` →
            `lg:w-48`). The wrapper has to grow by the whole 4rem or the two
            columns take the space out of the swords divider instead, and the
            row's total desktop width is unchanged. */}
        <div className="order-first flex w-full items-center gap-0 lg:order-none lg:w-[484px]">
          <MatchSideColumn
            participant={participant}
            ddragonVersion={ddragonVersion}
            emptyChampionFallback={false}
            emptyKdaFallback={false}
            onSelectPlayer={onSelectPlayer}
          />

          <div className="w-10 flex items-center justify-center shrink-0">
            <Swords className="h-5 w-5 text-muted-foreground" />
          </div>

          <MatchSideColumn
            participant={opponent}
            ddragonVersion={ddragonVersion}
            emptyChampionFallback
            emptyKdaFallback
            onSelectPlayer={onSelectPlayer}
          />
        </div>

        {opponent && (
          <MatchSideStats
            kda={opponent.kda}
            totalCs={opponent.total_cs}
            csPerMinute={opponentCsPerMinute}
            visionScore={opponent.vision_score}
            killParticipation={enemyKillParticipation}
            highlight={opponentStatHighlight}
          />
        )}

        {/* No per-match LP column here any more: reliable historical
            per-match LP is not obtainable under the current Riot
            developer-key constraints, so the row was showing a number it
            could not stand behind. `match.lp_change` is still stored and
            still served — this is a UI hide pending a trustworthy source, not
            a feature deletion. The width it held went to the two champion
            columns in the matchup block above. */}

        <MatchTeamCompositions
          teamComps={teamComps}
          playerPuuid={playerPuuid}
          ddragonVersion={ddragonVersion}
          onSelectPlayer={onSelectPlayer}
        />

        <div className="flex flex-col items-center justify-center gap-0.5">
          {blueTeamStats && renderTeamStatsRow(blueTeamStats, "blue")}
          <Separator className="my-2 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          {redTeamStats && renderTeamStatsRow(redTeamStats, "red")}
        </div>
      </div>
    </div>
  );
}
