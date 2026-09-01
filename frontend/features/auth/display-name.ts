/**
 * The API declares the same three constraints, and
 * `tests/display-name-alignment.test.ts` is all that holds the copies equal.
 */
export const DISPLAY_NAME_MIN_LENGTH = 3;
export const DISPLAY_NAME_MAX_LENGTH = 128;

/** Letters, marks, underscores and spaces, starting and ending on a letter. */
export const DISPLAY_NAME_PATTERN = /^[\p{L}](?:[\p{L}\p{M}_ ]*[\p{L}])?$/u;
