import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCH_HISTORY_QUEUE_SELECTION,
  getMatchHistoryEmptyMessage,
  getMatchHistoryQueueQuery,
  getMatchQueueName,
  MATCH_HISTORY_QUEUE_FILTERS,
  selectMatchHistoryQueue,
} from "@/lib/core/riot/queue-catalog";

describe("Match History queue catalog", () => {
  it("defaults to Ranked Solo/Duo", () => {
    expect(DEFAULT_MATCH_HISTORY_QUEUE_SELECTION).toEqual([420]);
  });

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
    expect(
      Object.fromEntries(
        MATCH_HISTORY_QUEUE_FILTERS.map(({ label, widthClass }) => [
          label,
          widthClass,
        ]),
      ),
    ).toMatchObject({
      "Ranked Flex": "w-[108px]",
      "Normal Draft": "w-[116px]",
      "ARAM: Mayhem": "w-[132px]",
    });
  });

  it("maps supported modes without relabeling unknown queues", () => {
    expect(getMatchQueueName(480)).toBe("Swiftplay");
    expect(getMatchQueueName(2400)).toBe("ARAM: Mayhem");
    expect(getMatchQueueName(999999)).toBe("Queue 999999");
  });

  it("explains the Match-V5 availability boundary for the Mayhem filter", () => {
    expect(getMatchHistoryEmptyMessage([2400])).toBe(
      "No ARAM: Mayhem matches are currently available from Riot Match-V5 for this player.",
    );
    expect(getMatchHistoryEmptyMessage([450])).toBe(
      "No matches found for ARAM.",
    );
    expect(getMatchHistoryEmptyMessage([420, 440])).toBe(
      "No matches found for the selected queues.",
    );
  });

  it("uses no restriction for All Queues and serializes queue unions", () => {
    expect(getMatchHistoryQueueQuery(["ALL"])).toBeUndefined();
    expect(getMatchHistoryQueueQuery([420, 440, 450])).toBe("420,440,450");
  });

  it("uses normal selection as an exclusive queue choice", () => {
    expect(selectMatchHistoryQueue(["ALL"], "ALL", false)).toBeNull();
    expect(selectMatchHistoryQueue(["ALL"], 2400, false)).toEqual([2400]);
    expect(selectMatchHistoryQueue([420, 440], 450, false)).toEqual([450]);
  });

  it("uses Shift selection for stable queue unions without allowing zero", () => {
    expect(selectMatchHistoryQueue([420], 440, true)).toEqual([420, 440]);
    expect(selectMatchHistoryQueue([420, 440], 420, true)).toEqual([440]);
    expect(selectMatchHistoryQueue([420], 420, true)).toBeNull();
    expect(selectMatchHistoryQueue([420, 440], "ALL", true)).toEqual([
      "ALL",
    ]);
    expect(selectMatchHistoryQueue([440, 450], 420, true)).toEqual([
      420, 440, 450,
    ]);
  });
});
