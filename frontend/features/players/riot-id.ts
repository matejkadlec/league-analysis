import type { Player } from "@/lib/core/schemas";

export const RIOT_ID_GAME_NAME_MAX_LENGTH = 16;
export const RIOT_ID_TAG_LINE_MAX_LENGTH = 5;

/**
 * What `GET /players/suggestions` accepts in `q`, which is more than the
 * longest Riot ID (16 + `#` + 5). Past it the query 422s and the viewer gets
 * an error toast from the shared `QueryCache` instead of "no results".
 */
export const RIOT_ID_SEARCH_MAX_LENGTH = 30;

/**
 * Riot IDs are written in any script (LGA-118): letters and numbers are
 * Unicode classes, `\p{M}` keeps scripts that need combining marks, and `#`,
 * tabs and other control characters stay out. The API declares the same two.
 */
export const RIOT_ID_GAME_NAME_PATTERN = /^[\p{L}\p{M}\p{N} ._-]+$/u;
export const RIOT_ID_TAG_LINE_PATTERN = /^[\p{L}\p{M}\p{N}]+$/u;

/** Characters as the API counts them: code points, not UTF-16 units. */
function characterCount(value: string): number {
  // oxlint-disable-next-line typescript/no-misused-spread -- Code points are the unit the API's max_length counts.
  return [...value].length;
}

export interface RiotIdParts {
  gameName: string;
  tagLine: string;
}

/** The `Name#Tag` label, the inverse of `parseRiotId`. */
export function formatRiotId(
  player: Pick<Player, "game_name" | "tag_line">,
): string {
  return `${player.game_name}${player.tag_line ? `#${player.tag_line}` : ""}`;
}

export function parseRiotId(input: string): RiotIdParts {
  const value = input.trim();

  if (!value) {
    throw new Error("Player Name is required.");
  }

  const parts = value.split("#");
  if (parts.length === 1) {
    throw new Error("Player Name must be in Name#Tag format.");
  }
  if (parts.length !== 2) {
    throw new Error("Player Name must contain exactly one # separator.");
  }

  // Both indexes exist: the length check above proves the split produced
  // exactly two parts. `?? ""` only satisfies the compiler.
  const gameName = (parts[0] ?? "").trim();
  const tagLine = (parts[1] ?? "").trim();

  if (!gameName) {
    throw new Error("Player Name cannot be empty.");
  }
  if (!tagLine) {
    throw new Error("Tag Line cannot be empty.");
  }
  if (characterCount(gameName) > RIOT_ID_GAME_NAME_MAX_LENGTH) {
    throw new Error(
      `Game Name cannot exceed ${RIOT_ID_GAME_NAME_MAX_LENGTH} characters.`,
    );
  }
  if (characterCount(tagLine) > RIOT_ID_TAG_LINE_MAX_LENGTH) {
    throw new Error(
      `Tag Line cannot exceed ${RIOT_ID_TAG_LINE_MAX_LENGTH} characters.`,
    );
  }
  if (!RIOT_ID_GAME_NAME_PATTERN.test(gameName)) {
    throw new Error(
      "Game Name contains invalid characters. Use letters, numbers, spaces, and ._-.",
    );
  }
  if (!RIOT_ID_TAG_LINE_PATTERN.test(tagLine)) {
    throw new Error(
      "Tag Line contains invalid characters. Use only letters and numbers.",
    );
  }

  return { gameName, tagLine };
}
