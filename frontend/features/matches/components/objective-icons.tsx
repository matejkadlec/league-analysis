import type { TeamStats } from "@/lib/core/schemas";
import { RIOT_OBJECTIVE_ICON_SOURCES } from "./objective-icon-assets";

interface ObjectiveGlyphProps {
  className: string;
}

function VoidgrubGlyph({ className }: ObjectiveGlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
    >
      <path d="M8 1 6.333 2.42s-.87.798-1.151.798H3.928c-.928 0-2.261.978-2.557 2.68-.074.429-.098 1.282.56 2.168L1 8.812s1.333.71 1.667 2.131C3 12.363 5.088 13.704 6.9 14.088l1.08.881V15L8 14.985l.019.015v-.031l1.08-.881c1.813-.384 3.901-1.724 4.234-3.145.334-1.42 1.667-2.13 1.667-2.13l-.931-.747c.658-.886.637-1.726.56-2.169-.296-1.701-1.629-2.68-2.557-2.68h-1.254c-.28 0-1.151-.797-1.151-.797zm.149 3.245a.2.2 0 0 0-.298 0L5.434 6.93a.2.2 0 0 0 .021.29c.275.228.818.687 1.007.914.21.255-1.316 1.405-1.862 1.804a.202.202 0 0 0-.026.304l1.84 1.88a.2.2 0 0 0 .285 0l1.158-1.183a.2.2 0 0 1 .286 0L9.3 12.122a.2.2 0 0 0 .286 0l1.84-1.88a.202.202 0 0 0-.026-.304c-.546-.399-2.073-1.549-1.862-1.804.189-.227.732-.686 1.007-.913a.2.2 0 0 0 .021-.29z" />
    </svg>
  );
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

function ObjectiveGlyph({
  objective,
  className,
  team,
}: ObjectiveGlyphProps & { objective: ObjectiveId; team: "blue" | "red" }) {
  if (objective === "voidgrub")
    return <VoidgrubGlyph className={className} />;

  const source =
    objective === "turret"
      ? RIOT_OBJECTIVE_ICON_SOURCES.tower
      : RIOT_OBJECTIVE_ICON_SOURCES[objective];

  return (
    <span
      aria-hidden="true"
      data-icon-source="riot-match-history"
      className={`${className} block bg-contain bg-center bg-no-repeat`}
      style={{
        backgroundImage: `url(${source})`,
        filter:
          team === "blue"
            ? "saturate(1.7) brightness(1.25)"
            : "hue-rotate(150deg) saturate(2.2) brightness(1.15)",
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
  const colorClass = team === "blue" ? "text-cyan-400" : "text-rose-500";
  const sizeClass =
    objective === "voidgrub" ? "h-5 w-5" : "h-[26px] w-[26px]";

  return (
    <div
      role="img"
      aria-label={`${label}: ${displayCount}`}
      title={label}
      data-objective={objective}
      className="flex h-full w-full items-center justify-center"
    >
      <span aria-hidden="true" className={colorClass}>
        <ObjectiveGlyph
          objective={objective}
          className={sizeClass}
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
