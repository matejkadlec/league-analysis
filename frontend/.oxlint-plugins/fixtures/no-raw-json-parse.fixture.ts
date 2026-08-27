// Regression fixture for `house/no-raw-json-parse`. Each directive suppresses
// a shape the rule MUST flag; accepted cases carry none. A stale selector
// leaves an unused directive; an over-broad one reports on an accept.

declare const raw: string;
declare const stored: { parse: (value: string) => unknown };

// MUST flag: the shape both storage readers had before the sweep.
export const direct = () =>
  // oxlint-disable-next-line house/no-raw-json-parse
  JSON.parse(raw) as unknown;

// MUST flag: a try/catch around it is the workaround, not the fix.
export const guarded = () => {
  try {
    // oxlint-disable-next-line house/no-raw-json-parse
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

// Accepted -- the other direction is not a parse.
export const written = () => JSON.stringify({ raw });

// Accepted -- an unrelated method that happens to be called `parse`.
export const unrelatedParse = () => stored.parse(raw);

// Accepted -- not a call at all.
export const passedAlong = () => [JSON.parse];
