import type { TeamStats } from "@/lib/core/schemas";
import { RIOT_OBJECTIVE_ICON_SOURCES } from "./objective-icon-assets";

interface ObjectiveGlyphProps {
  className: string;
}

export const OBJECTIVE_DEFINITIONS = [
  { id: "turret", label: "Turrets", statKey: "turrets" },
  { id: "inhibitor", label: "Inhibitors", statKey: "inhibitors" },
  { id: "dragon", label: "Dragons", statKey: "dragons" },
  { id: "voidgrub", label: "Voidgrubs", statKey: "voidgrubs" },
  { id: "herald", label: "Rift Herald", statKey: "rift_heralds" },
  { id: "baron", label: "Barons", statKey: "barons" },
] as const;

type ObjectiveId = (typeof OBJECTIVE_DEFINITIONS)[number]["id"];

const OBJECTIVE_SIZE_CLASSES: Record<ObjectiveId, string> = {
  turret: "h-[31px] w-[31px]",
  inhibitor: "h-[22px] w-[22px]",
  dragon: "h-[22px] w-[22px]",
  voidgrub: "h-5 w-5",
  herald: "h-[22px] w-[22px]",
  baron: "h-[21px] w-[21px]",
};

function objectiveFilter(objective: ObjectiveId, team: "blue" | "red") {
  if (objective === "voidgrub") {
    return team === "blue"
      ? "sepia(1) saturate(6) hue-rotate(135deg) brightness(1.05)"
      : "sepia(1) saturate(6) hue-rotate(285deg) brightness(1.05)";
  }

  return team === "blue"
    ? "saturate(1.7) brightness(1.25)"
    : "hue-rotate(150deg) saturate(2.2) brightness(1.15)";
}

function objectiveSource(objective: ObjectiveId) {
  if (objective === "turret") return RIOT_OBJECTIVE_ICON_SOURCES.tower;
  if (objective === "voidgrub")
    return RIOT_OBJECTIVE_ICON_SOURCES.voidgrubSprite;
  return RIOT_OBJECTIVE_ICON_SOURCES[objective];
}

function ObjectiveGlyph({
  objective,
  className,
  team,
}: ObjectiveGlyphProps & { objective: ObjectiveId; team: "blue" | "red" }) {
  return (
    <span
      aria-hidden="true"
      data-icon-source="riot-match-history"
      className={`${className} block bg-contain bg-center bg-no-repeat`}
      style={{
        backgroundImage: `url(${objectiveSource(objective)})`,
        backgroundPosition:
          objective === "voidgrub" ? "center bottom" : undefined,
        backgroundSize: objective === "voidgrub" ? "100% 700%" : undefined,
        filter: objectiveFilter(objective, team),
      }}
    />
  );
}

function ObjectiveStat({
  objective,
  label,
  count,
  team,
}: {
  objective: ObjectiveId;
  label: string;
  count: number | null | undefined;
  team: "blue" | "red";
}) {
  const displayCount = count === null || count === undefined ? "?" : String(count);

  return (
    <div
      role="img"
      aria-label={`${label}: ${displayCount}`}
      title={label}
      data-objective={objective}
      className="flex h-full w-full items-center justify-center"
    >
      <span aria-hidden="true">
        <ObjectiveGlyph
          objective={objective}
          className={OBJECTIVE_SIZE_CLASSES[objective]}
          team={team}
        />
      </span>
      <span aria-hidden="true" className="w-5 text-center text-xs">
        {displayCount}
      </span>
    </div>
  );
}

export function TeamObjectiveStats({
  stats,
  team,
}: {
  stats: TeamStats;
  team: "blue" | "red";
}) {
  return (
    <div className="grid h-full w-full grid-cols-6 gap-1.5 text-xs">
      {OBJECTIVE_DEFINITIONS.map((objective) => (
        <ObjectiveStat
          key={objective.id}
          objective={objective.id}
          label={objective.label}
          count={stats[objective.statKey]}
          team={team}
        />
      ))}
    </div>
  );
}
