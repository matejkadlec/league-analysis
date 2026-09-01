// Regression fixture for `house/no-compat-shims`.

// Every directive below sits above a shape the rule MUST report and accepted
// cases carry none, so widening into string literals fails the run too.

// oxlint-disable-next-line house/no-compat-shims
// @deprecated use fetchSummoner instead
export const summonerAlias = 1;

// oxlint-disable-next-line house/no-compat-shims
// backwards-compat with the v1 payload
export const v1Payload = 2;

// oxlint-disable-next-line house/no-compat-shims
// kept for old callers of the ranked view
export const rankedView = 3;

// oxlint-disable-next-line house/no-compat-shims
// for old clients that send a string id
export const stringId = 4;

// oxlint-disable-next-line house/no-compat-shims
// supports the old shape too
export const tolerantReader = 5;

// oxlint-disable-next-line house/no-compat-shims
// legacy format from the 2023 dumps
export const dumpReader = 6;

// oxlint-disable-next-line house/no-compat-shims
// the old format had no queue id
export const queueless = 7;

// MUST flag: the five declaration positions the name check visits.
// oxlint-disable-next-line house/no-compat-shims
export const legacyOf = (id: string) => id;

// oxlint-disable-next-line house/no-compat-shims
export function deprecatedParse(raw: string) {
  return raw;
}

// oxlint-disable-next-line house/no-compat-shims
export class LegacyStore {}

// oxlint-disable-next-line house/no-compat-shims
export type LegacyMatch = { id: string };

// oxlint-disable-next-line house/no-compat-shims
export interface DeprecatedRow {
  id: string;
}

// MUST flag: the marker moved into the middle of the name.
// oxlint-disable-next-line house/no-compat-shims
export const oldLegacyPath = "";

// Accepted -- "legacies" is neither `legacy` at the start nor `Legacy` inside,
// so the name check is not a substring search.
export const legaciesMigrated = 0;

// Accepted -- the identifier is clean; only the string mentions the old world.
export const noteLabel = "legacy accounts are merged on sign-in";

// Accepted -- a marker held as data is not a marker in a comment.
export const docHint = "@deprecated appears in vendor typings";
