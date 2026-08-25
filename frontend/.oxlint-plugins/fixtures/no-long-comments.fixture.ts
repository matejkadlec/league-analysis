// Regression fixture for `house/no-long-comments`.

// Every `oxlint-disable-next-line` below suppresses a comment the rule MUST
// flag; the accepted shapes carry no directive, so a false positive fails the
// run too. The directives are block comments on purpose: a `//` directive
// would join the run it guards and drag the report onto its own line.

// MUST flag: five consecutive `//` lines are one comment, not five.

/* oxlint-disable-next-line house/no-long-comments */
// one
// two
// three
// four
// five
export const afterLongRun = 1;

// MUST flag: the same five lines as a JSDoc block.

/* oxlint-disable-next-line house/no-long-comments */
/**
 * one
 * two
 * three
 * four
 * five
 */
export const afterLongJsdoc = 2;

// MUST flag: a blank ` *` line is prose even though `/**` and `*/` are not,
// so two short paragraphs are still an essay.

/* oxlint-disable-next-line house/no-long-comments */
/**
 * one
 * two
 *
 * three
 * four
 */
export const afterSplitJsdoc = 3;

// Accepted: four `//` lines sit exactly at the ceiling.

// one
// two
// three
// four
export const atCeilingRun = 4;

// Accepted: the same four lines as JSDoc -- the delimiters carry no words, so
// they must not push a comment that fits over the ceiling.

/**
 * one
 * two
 * three
 * four
 */
export const atCeilingJsdoc = 5;

// Accepted: a blank line ends a run, so these are two blocks of three.

// one
// two
// three

// four
// five
// six
export const twoRunsSplitByBlank = 6;

// Accepted: code between two runs ends the first one as well.

// one
// two
// three
export const firstRun = 7;
// four
// five
// six
export const secondRun = 8;

// Accepted: a `// why` trailing a statement opens its own block, so it does
// not extend the four-line run immediately above it.

// one
// two
// three
// four
export const trailingAfterRun = 9; // why
