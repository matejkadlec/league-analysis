/** Ranked Solo/Duo. Every stats surface in the app reports on this queue. */
export const RANKED_SOLO_QUEUE_ID = 420;

/**
 * Names for the queues a stored match can carry. The six synced queues come
 * first; the rest are catalogued queues Riot returns or lists but the product
 * does not sync (LGA-120), named so a match from one never reads "Queue N".
 */
const MATCH_QUEUE_NAMES: Readonly<Record<number, string>> = {
  400: "Normal Draft",
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  450: "ARAM",
  480: "Swiftplay",
  2400: "ARAM: Mayhem",
  430: "Normal Blind",
  490: "Quickplay",
  700: "Clash",
  710: "Ranked 5s",
  720: "ARAM Clash",
  900: "ARURF",
  1700: "Arena",
  1710: "Arena",
  1740: "Bravery Arena",
  1750: "Arena 3x6",
  1900: "URF",
  2300: "Brawl",
  2450: "ARAM: Mayhem Classic-ish",
};

export const MATCH_HISTORY_QUEUE_FILTERS = [
  { id: "ALL", label: "All Queues", widthClass: "w-[96px]" },
  { id: 420, label: "Ranked Solo/Duo", widthClass: "w-[140px]" },
  { id: 440, label: "Ranked Flex", widthClass: "w-[108px]" },
  { id: 480, label: "Swiftplay", widthClass: "w-[84px]" },
  { id: 400, label: "Normal Draft", widthClass: "w-[116px]" },
  { id: 450, label: "ARAM", widthClass: "w-[64px]" },
  { id: 2400, label: "ARAM: Mayhem", widthClass: "w-[132px]" },
] as const;

export type MatchHistoryQueueFilter =
  (typeof MATCH_HISTORY_QUEUE_FILTERS)[number]["id"];

export type MatchHistoryQueueSelection = MatchHistoryQueueFilter[];

export const DEFAULT_MATCH_HISTORY_QUEUE_SELECTION: MatchHistoryQueueSelection = [
  420,
];

export function getMatchQueueName(queueId: number): string {
  return MATCH_QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

export function getMatchHistoryQueueQuery(
  filters: ReadonlyArray<MatchHistoryQueueFilter>,
): string | undefined {
  if (filters.includes("ALL")) {
    return undefined;
  }

  return filters.join(",");
}

export function getMatchHistoryEmptyMessage(
  filters: ReadonlyArray<MatchHistoryQueueFilter>,
): string {
  if (filters.length > 1) {
    return "No matches found for the selected queues.";
  }

  const filter = filters[0];
  if (filter === 2400) {
    return "No ARAM: Mayhem matches are currently available from Riot Match-V5 for this player.";
  }

  if (filter === "ALL" || filter === undefined) {
    return "This player has no matches in the database.";
  }

  return `No matches found for ${getMatchQueueName(filter)}.`;
}

/** Next selection, or null when the selection would not change (caller skips the update). */
export function selectMatchHistoryQueue(
  currentFilters: ReadonlyArray<MatchHistoryQueueFilter>,
  nextFilter: MatchHistoryQueueFilter,
  additive: boolean,
): MatchHistoryQueueSelection | null {
  if (nextFilter === "ALL") {
    return currentFilters.length === 1 && currentFilters[0] === "ALL"
      ? null
      : ["ALL"];
  }

  if (!additive || currentFilters.includes("ALL")) {
    return currentFilters.length === 1 && currentFilters[0] === nextFilter
      ? null
      : [nextFilter];
  }

  if (currentFilters.includes(nextFilter)) {
    if (currentFilters.length === 1) {
      return null;
    }
    return currentFilters.filter((filter) => filter !== nextFilter);
  }

  const selected = new Set([...currentFilters, nextFilter]);
  const ordered = MATCH_HISTORY_QUEUE_FILTERS.map(({ id }) => id).filter(
    (filter): filter is MatchHistoryQueueFilter => selected.has(filter),
  );
  if (ordered.length === currentFilters.length) {
    return null;
  }

  return ordered;
}
