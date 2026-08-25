// Regression fixture for `house/require-query-key-factory`. Each directive
// suppresses a shape the rule MUST flag; accepted cases carry none. A selector
// that stops matching leaves an unused directive and fails the run, and one
// that over-matches reports on an accepted case and fails it the other way.

declare const queryClient: {
  invalidateQueries: (filters?: unknown) => void;
  refetchQueries: (filters?: unknown) => void;
  removeQueries: (filters?: unknown) => void;
  cancelQueries: (filters?: unknown) => void;
  setQueryData: (key: unknown, data?: unknown) => void;
  getQueryData: (key: unknown) => unknown;
};
declare const puuid: string;
declare const player: { puuid: string };
declare function playerQueryKey(id: string): readonly unknown[];
declare function isMatchHistoryQuery(
  key: readonly unknown[],
  id: string,
): boolean;
declare const USER_QUERY_KEY: readonly unknown[];

// MUST flag: the hand-typed key inside a filters object.
export const invalidateByLiteral = () => {
  queryClient.invalidateQueries({
    // oxlint-disable-next-line house/require-query-key-factory
    queryKey: ["matchmaking-analysis", puuid],
  });
};

// MUST flag: the same array behind `as const`, which is how every key in this
// repo is spelled.
export const refetchByAsConst = () => {
  queryClient.refetchQueries({
    // oxlint-disable-next-line house/require-query-key-factory
    queryKey: ["player-stats", puuid] as const,
  });
};

// MUST flag: `setQueryData` takes the key positionally, so the property
// selector never visits it.
export const writeByLiteral = () => {
  // oxlint-disable-next-line house/require-query-key-factory
  queryClient.setQueryData(["matchmaking-analysis", puuid], null);
};

// MUST flag: a read is no safer -- a drifted key answers `undefined` rather
// than matching nothing.
export const readByLiteral = () =>
  // oxlint-disable-next-line house/require-query-key-factory
  queryClient.getQueryData(["player-sync-active", puuid]);

// MUST flag: a positional walk written into the predicate, by index...
export const predicateByIndex = () => {
  queryClient.removeQueries({
    predicate: (query: { queryKey: readonly unknown[] }) =>
      // oxlint-disable-next-line house/require-query-key-factory
      query.queryKey[0] === "matchmaking-analysis",
  });
};

// ...and by `.at()`, which is a call and not a member read.
export const predicateByAt = () => {
  queryClient.cancelQueries({
    predicate: (query: { queryKey: readonly unknown[] }) =>
      // oxlint-disable-next-line house/require-query-key-factory
      query.queryKey.at(-1) !== "detailed",
  });
};

// Accepted -- the factory call, which is the whole point.
export const invalidateByFactory = () => {
  queryClient.invalidateQueries({ queryKey: playerQueryKey(puuid) });
  queryClient.setQueryData(playerQueryKey(player.puuid), player);
};

// Accepted -- a module-level constant is the file's own factory: the query and
// the invalidation read the same declaration, so neither can drift.
export const invalidateByConstant = () => {
  queryClient.invalidateQueries({ queryKey: USER_QUERY_KEY });
};

// Accepted -- the named helper exported beside the factory, which is where a
// positional walk belongs.
export const refetchByHelper = () => {
  queryClient.refetchQueries({
    predicate: (query: { queryKey: readonly unknown[] }) =>
      isMatchHistoryQuery(query.queryKey, puuid),
  });
};

// Accepted -- a predicate that asks whether the key mentions this player at
// all reads no position, so there is no layout to drift.
export const predicateByMembership = () => {
  queryClient.invalidateQueries({
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey.includes(puuid),
  });
};

// Accepted -- no key at all; a blanket refresh names no layout.
export const invalidateEverything = () => {
  queryClient.invalidateQueries();
};

// Accepted -- the same positional read outside a predicate is the factory's
// own module declaring its layout once.
export function isPlayerQuery(key: readonly unknown[], id: string): boolean {
  return key[0] === "player" && key[1] === id;
}

// Accepted -- an array in the *data* position is the value being cached, not
// a key. Only the argument the method reads as a key is checked.
export const writeArrayData = () => {
  queryClient.setQueryData(playerQueryKey(puuid), ["a", "b"]);
};
