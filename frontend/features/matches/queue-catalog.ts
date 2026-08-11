export const MATCH_QUEUE_NAMES: Readonly<Record<number, string>> = {
  400: "Normal Draft",
  420: "Ranked Solo/Duo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  480: "Swiftplay",
  2400: "ARAM: Mayhem",
};

export const MATCH_HISTORY_QUEUE_FILTERS = [
  { id: "ALL", label: "All Queues", widthClass: "w-[96px]" },
  { id: 420, label: "Ranked Solo/Duo", widthClass: "w-[140px]" },
  { id: 440, label: "Ranked Flex", widthClass: "w-[96px]" },
  { id: 480, label: "Swiftplay", widthClass: "w-[84px]" },
  { id: 400, label: "Normal Draft", widthClass: "w-[100px]" },
  { id: 450, label: "ARAM", widthClass: "w-[64px]" },
  { id: 2400, label: "ARAM: Mayhem", widthClass: "w-[116px]" },
] as const;

export type MatchHistoryQueueFilter =
  (typeof MATCH_HISTORY_QUEUE_FILTERS)[number]["id"];

export const MATCH_HISTORY_PAGE_SIZE = 20;

export function getMatchQueueName(queueId: number): string {
  return MATCH_QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

export function getMatchHistoryQueueQuery(
  filter: MatchHistoryQueueFilter,
): number | undefined {
  return filter === "ALL" ? undefined : filter;
}

export function getMatchHistoryEmptyMessage(
  filter: Exclude<MatchHistoryQueueFilter, "ALL">,
): string {
  if (filter === 2400) {
    return "No ARAM: Mayhem matches are currently available from Riot Match-V5 for this player.";
  }

  return `No matches found for ${getMatchQueueName(filter)}.`;
}

export function selectMatchHistoryQueue(
  currentFilter: MatchHistoryQueueFilter,
  nextFilter: MatchHistoryQueueFilter,
): { filter: MatchHistoryQueueFilter; displayCount: number } | null {
  if (currentFilter === nextFilter) {
    return null;
  }

  return { filter: nextFilter, displayCount: MATCH_HISTORY_PAGE_SIZE };
}
