// Regression fixture for `house/no-long-comments`.

// Every `oxlint-disable-next-line` suppresses a comment the rule MUST flag;
// accepted shapes carry no directive, so a false positive fails the run too.

/* oxlint-disable-next-line house/no-long-comments */
// MUST flag: three consecutive `//` lines are one comment, not three.
// two
// three
export const afterLongRun = 1;

// MUST flag: the same three lines as a JSDoc block.

/* oxlint-disable-next-line house/no-long-comments */
/**
 * one
 * two
 * three
 */
export const afterLongJsdoc = 2;

// MUST flag: a blank ` *` line is prose even though `/**` and `*/` are
// not, so two one-line paragraphs are still an essay.

/* oxlint-disable-next-line house/no-long-comments */
/**
 * one
 *
 * two
 */
export const afterSplitJsdoc = 3;

// Accepted: two `//` lines sit exactly at the ceiling.

// one
// two
export const atCeilingRun = 4;

// Accepted: the same two lines as JSDoc -- the delimiters carry no words,
// so they must not push a comment that fits over the ceiling.

/**
 * one
 * two
 */
export const atCeilingJsdoc = 5;

// Accepted: a blank line ends a run, so these are two blocks of two.

// one
// two

// three
// four
export const twoRunsSplitByBlank = 6;

// Accepted: code between two runs ends the first one as well.

// one
// two
export const firstRun = 7;
// three
// four
export const secondRun = 8;

// Accepted: a `// why` trailing a statement opens its own block, so it
// does not extend the two-line run immediately above it.

// one
// two
export const trailingAfterRun = 9; // why
