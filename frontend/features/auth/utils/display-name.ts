/**
 * The display-name rule, in the one place the settings form reads it from.
 *
 * The same three constraints are declared on the API's `display_name` field,
 * and `tests/display-name-alignment.test.ts` reads them back out of the
 * OpenAPI document to hold the two copies equal. Change one and that test
 * says so; it is the only thing standing between them.
 */
export const DISPLAY_NAME_MIN_LENGTH = 3;
export const DISPLAY_NAME_MAX_LENGTH = 128;

/** Letters, marks, underscores and spaces, starting and ending on a letter. */
export const DISPLAY_NAME_PATTERN = /^[\p{L}](?:[\p{L}\p{M}_ ]*[\p{L}])?$/u;
