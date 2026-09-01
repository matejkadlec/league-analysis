import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MATCH_HISTORY_QUEUE_FILTERS,
  getMatchQueueName,
} from "../lib/core/riot/queue-catalog";

const here = dirname(fileURLToPath(import.meta.url));
const CONSTANTS = join(here, "../../backend/app/core/riot_api/constants.py");

/**
 * Supported queues are decided on the backend and copied by hand here, so a new
 * one renders as "Queue 490". One-way: an unstored extra name is allowed.
 */
function backendSupportedQueueIds(): number[] {
  const source = readFileSync(CONSTANTS, "utf8");

  const values = new Map<string, number>();
  for (const [, name, value] of source.matchAll(
    /^\s{4}([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*$/gm,
  )) {
    if (name !== undefined && value !== undefined && !values.has(name)) {
      values.set(name, Number(value));
    }
  }

  const block = /PRODUCT_SUPPORTED_QUEUE_TYPES[^(]*\(([^)]*)\)/.exec(source);
  if (!block?.[1]) throw new Error("PRODUCT_SUPPORTED_QUEUE_TYPES not found");

  return [...block[1].matchAll(/QueueType\.([A-Z][A-Z0-9_]*)/g)].map(
    ([, member]) => {
      const value = member === undefined ? undefined : values.get(member);
      if (value === undefined) {
        throw new Error(`QueueType.${member} has no numeric value`);
      }
      return value;
    },
  );
}

describe("supported queues against the backend", () => {
  const supported = backendSupportedQueueIds();

  it("reads a plausible list out of the backend", () => {
    // Signal first: a parse that silently returned nothing would make every
    // assertion below vacuous.
    expect(supported.length).toBeGreaterThanOrEqual(5);
    expect(supported).toContain(420);
  });

  it("offers a match-history filter for every queue the backend stores", () => {
    const filterable = new Set<number | string>(
      MATCH_HISTORY_QUEUE_FILTERS.map((filter) => filter.id),
    );
    const unfilterable = supported.filter((id) => !filterable.has(id));

    expect(unfilterable).toEqual([]);
  });

  it("names every queue the backend stores", () => {
    const unnamed = supported.filter((id) =>
      getMatchQueueName(id).startsWith("Queue "),
    );

    expect(unnamed).toEqual([]);
  });
});
