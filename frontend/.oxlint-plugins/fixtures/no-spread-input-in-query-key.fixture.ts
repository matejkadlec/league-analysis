// Regression fixture for `house/no-spread-input-in-query-key`. Each directive
// suppresses a shape the rule MUST flag; accepted cases carry none. An unused
// directive fails the run, and a report on an accepted case fails it too.

declare const puuid: string;
declare const watchingCreatedAt: string;
declare const debouncedSearch: string;
declare const filters: { queue: number; search: string };
declare const PLAYER_SUGGESTIONS_QUERY_KEY: readonly unknown[];
declare const JOB_EXECUTIONS_QUERY_KEY: readonly unknown[];
declare function matchmakingStatusQueryKey(id: string): readonly unknown[];

// MUST flag: the caller's whole object spread into the key.
export const spreadInput = {
  // oxlint-disable-next-line house/no-spread-input-in-query-key
  queryKey: ["matches", puuid, ...Object.values(filters)],
};

// MUST flag: the same leak one level in, as an object element -- an array
// spread selector never visits this.
export const spreadIntoObject = {
  // oxlint-disable-next-line house/no-spread-input-in-query-key
  queryKey: ["matches", puuid, { ...filters }],
};

// MUST flag: a bare identifier is not a key, whatever it holds.
export const spreadIdentifier = {
  // oxlint-disable-next-line house/no-spread-input-in-query-key
  queryKey: ["matches", ...filters],
};

// MUST flag: inside the factory as well as at the call site -- a key that moved
// into a factory is still a key.
export function matchesQueryKey(args: { puuid: string; page: number }) {
  return [
    "matches",
    // oxlint-disable-next-line house/no-spread-input-in-query-key
    ...Object.entries(args),
  ] as const;
}

// MUST flag: the arrow spelling of the same factory.
export const lanesQueryKey = (args: { puuid: string }) =>
  // oxlint-disable-next-line house/no-spread-input-in-query-key
  ["lanes", ...Object.keys(args)] as const;

// Accepted -- the status prefix extended by the run this poll watches, which
// is `matchmaking-analysis-session.tsx` verbatim.
export const composedFromFactory = {
  queryKey: [...matchmakingStatusQueryKey(puuid), watchingCreatedAt],
};

// Accepted -- the constant spelling, from `player-selector.tsx`.
export const composedFromConstant = {
  queryKey: [...PLAYER_SUGGESTIONS_QUERY_KEY, debouncedSearch, "all-platforms"],
};

// Accepted -- the same, inside a factory, from `jobs-query.ts`.
export function jobExecutionsQueryKey(jobId: number) {
  return [...JOB_EXECUTIONS_QUERY_KEY, jobId] as const;
}

// Accepted -- the fields the cache identity needs, listed by name.
export const explicitFields = {
  queryKey: [
    "matches",
    puuid,
    { queue: filters.queue, search: filters.search },
  ] as const,
};

// Accepted -- a spread passed as an argument to the factory is that factory's
// business; it is not an element of this key.
export const spreadIntoFactoryArgument = {
  queryKey: matchmakingStatusQueryKey({ ...filters }.search),
};

// Accepted -- a destructuring rest is not an array spread.
export const restIsNotSpread = () => {
  const { search, ...rest } = filters;
  return [search, rest];
};

// Accepted -- an unrelated array that happens to spread an object.
export const unrelatedArray = ["anything", ...Object.values(filters)];
