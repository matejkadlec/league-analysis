export const OBJECTIVE_DEFINITIONS = [
  { id: "turret", label: "Turrets", statKey: "turrets" },
  { id: "inhibitor", label: "Inhibitors", statKey: "inhibitors" },
  { id: "dragon", label: "Dragons", statKey: "dragons" },
  { id: "voidgrub", label: "Voidgrubs", statKey: "voidgrubs" },
  { id: "herald", label: "Rift Herald", statKey: "rift_heralds" },
  { id: "baron", label: "Barons", statKey: "barons" },
] as const;

export type ObjectiveId = (typeof OBJECTIVE_DEFINITIONS)[number]["id"];
