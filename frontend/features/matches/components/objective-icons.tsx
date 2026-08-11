import { Eye } from "lucide-react";

import type { TeamStats } from "@/lib/core/schemas";

interface ObjectiveGlyphProps {
  className: string;
}

function TurretGlyph({ className }: ObjectiveGlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M5 3h3v3h2V3h4v3h2V3h3v7l-2 2v7h2v2H5v-2h2v-7l-2-2V3Zm5 9v7h4v-7l2-2H8l2 2Z" />
    </svg>
  );
}

function InhibitorGlyph({ className }: ObjectiveGlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="m12 2 5 5-2 7H9L7 7l5-5Zm0 3.1L9.7 7.4l1.1 4.1h2.4l1.1-4.1L12 5.1Z" />
      <path d="M7 15h10l2 3v3H5v-3l2-3Zm1.1 3-.7 1h9.2l-.7-1H8.1Z" />
    </svg>
  );
}

function DragonGlyph({ className }: ObjectiveGlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M3 5c4.4.1 7.2 1.4 9 4 1.8-2.6 4.6-3.9 9-4-1.1 2.7-2.6 4.6-4.6 5.7l2.1 1.1-2.4 2.1.8 3.8-3.2-1.4L12 22l-1.7-5.7-3.2 1.4.8-3.8-2.4-2.1 2.1-1.1C5.6 9.6 4.1 7.7 3 5Zm7.1 5.5 1.9 2 1.9-2L12 8.8l-1.9 1.7Zm.5 3.5.5 2.1h1.8l.5-2.1H10.6Z" />
    </svg>
  );
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

function BaronGlyph({ className }: ObjectiveGlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M4 3c3.2.5 5.7 1.7 8 3.8C14.3 4.7 16.8 3.5 20 3l-2.2 4.5 2.2 2.2-3.1 1.1.6 4.8-3.1 4.9L12 22l-2.4-1.5-3.1-4.9.6-4.8L4 9.7l2.2-2.2L4 3Zm4.8 7.2-.4 4.7 2.2 3.5h2.8l2.2-3.5-.4-4.7L12 8.1l-3.2 2.1Zm.8 2.1 1.7.6-.7 1.4-1-.4v-1.6Zm4.8 0v1.6l-1 .4-.7-1.4 1.7-.6Z" />
    </svg>
  );
}

export const OBJECTIVE_DEFINITIONS = [
  { id: "turret", label: "Turrets", statKey: "turrets" },
  { id: "inhibitor", label: "Inhibitors", statKey: "inhibitors" },
  { id: "dragon", label: "Dragons", statKey: "dragons" },
  { id: "voidgrub", label: "Voidgrubs", statKey: "voidgrubs" },
  { id: "herald", label: "Rift Heralds", statKey: "rift_heralds" },
  { id: "baron", label: "Barons", statKey: "barons" },
] as const;

type ObjectiveId = (typeof OBJECTIVE_DEFINITIONS)[number]["id"];

function ObjectiveGlyph({
  objective,
  className,
}: ObjectiveGlyphProps & { objective: ObjectiveId }) {
  if (objective === "turret") return <TurretGlyph className={className} />;
  if (objective === "inhibitor")
    return <InhibitorGlyph className={className} />;
  if (objective === "dragon") return <DragonGlyph className={className} />;
  if (objective === "voidgrub")
    return <VoidgrubGlyph className={className} />;
  if (objective === "herald") return <Eye className={className} />;
  return <BaronGlyph className={className} />;
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
  const sizeClass = objective === "turret" ? "h-[26px] w-[26px]" : "h-5 w-5";

  return (
    <div
      role="img"
      aria-label={`${label}: ${displayCount}`}
      title={label}
      data-objective={objective}
      className="flex h-full w-full items-center justify-center"
    >
      <span aria-hidden="true" className={colorClass}>
        <ObjectiveGlyph objective={objective} className={sizeClass} />
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
