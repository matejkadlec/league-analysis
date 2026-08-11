import { describe, expect, it } from "vitest";

import {
  getMatchHistoryEmptyMessage,
  getMatchHistoryQueueQuery,
  getMatchQueueName,
  MATCH_HISTORY_PAGE_SIZE,
  MATCH_HISTORY_QUEUE_FILTERS,
  selectMatchHistoryQueue,
} from "@/features/matches/queue-catalog";

describe("Match History queue catalog", () => {
  it("keeps the approved filter order and fixed-width labels", () => {
    expect(
      MATCH_HISTORY_QUEUE_FILTERS.map(({ id, label }) => ({ id, label })),
    ).toEqual([
      { id: "ALL", label: "All Queues" },
      { id: 420, label: "Ranked Solo/Duo" },
      { id: 440, label: "Ranked Flex" },
      { id: 480, label: "Swiftplay" },
      { id: 400, label: "Normal Draft" },
      { id: 450, label: "ARAM" },
      { id: 2400, label: "ARAM: Mayhem" },
    ]);
    expect(
      MATCH_HISTORY_QUEUE_FILTERS.every(({ widthClass }) =>
        widthClass.startsWith("w-["),
      ),
    ).toBe(true);
  });

  it("maps supported modes without relabeling unknown queues", () => {
    expect(getMatchQueueName(480)).toBe("Swiftplay");
    expect(getMatchQueueName(2400)).toBe("ARAM: Mayhem");
    expect(getMatchQueueName(999999)).toBe("Queue 999999");
  });

  it("explains the Match-V5 availability boundary for the Mayhem filter", () => {
    expect(getMatchHistoryEmptyMessage(2400)).toBe(
      "No ARAM: Mayhem matches are currently available from Riot Match-V5 for this player.",
    );
    expect(getMatchHistoryEmptyMessage(450)).toBe(
      "No matches found for ARAM.",
    );
  });

  it("uses no queue restriction for All Queues and resets pagination on change", () => {
    expect(getMatchHistoryQueueQuery("ALL")).toBeUndefined();
    expect(getMatchHistoryQueueQuery(480)).toBe(480);
    expect(selectMatchHistoryQueue("ALL", "ALL")).toBeNull();
    expect(selectMatchHistoryQueue("ALL", 2400)).toEqual({
      filter: 2400,
      displayCount: MATCH_HISTORY_PAGE_SIZE,
    });
  });
});
