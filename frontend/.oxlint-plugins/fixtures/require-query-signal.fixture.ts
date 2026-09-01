// Regression fixture for `house/require-query-signal`: every directive marks a
// shape the rule MUST flag, so a stale or over-broad selector shows up here.

declare const skipToken: unique symbol;
declare const puuid: string | null;
declare function load(signal?: AbortSignal): Promise<string>;
declare function loadPage(page: number, signal?: AbortSignal): Promise<string>;

// MUST flag: the shape every query in this repo had before the sweep.
export const bare = {
  queryKey: ["a"],
  // oxlint-disable-next-line house/require-query-signal
  queryFn: async () => load(),
};

// MUST flag: an infinite query destructures `pageParam` and stops there.
export const paged = {
  queryKey: ["b"],
  // oxlint-disable-next-line house/require-query-signal
  queryFn: async ({ pageParam }: { pageParam: number }) => loadPage(pageParam),
};

// MUST flag: the `skipToken` branch is still a function, and the token in the
// other branch is what a callee-only check mistakes for an opaque value.
export const gated = {
  queryKey: ["c"],
  queryFn: puuid
    ? // oxlint-disable-next-line house/require-query-signal
      async () => load()
    : skipToken,
};

// Accepted -- the whole point.
export const withSignal = {
  queryKey: ["d"],
  queryFn: async ({ signal }: { signal: AbortSignal }) => load(signal),
};

// Accepted -- gated and still taking it.
export const gatedWithSignal = {
  queryKey: ["e"],
  queryFn: puuid
    ? async ({ signal }: { signal: AbortSignal }) => load(signal)
    : skipToken,
};

// Accepted -- a function this cannot read. Following the binding is the job of
// the call site the binding is written at.
const namedQueryFn = async () => load();
export const byName = { queryKey: ["f"], queryFn: namedQueryFn };

// Accepted -- an unrelated property that happens to hold a function.
export const unrelated = { queryKey: ["g"], select: async () => load() };
