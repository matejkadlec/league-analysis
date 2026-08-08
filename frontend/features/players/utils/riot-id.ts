export const RIOT_ID_GAME_NAME_MAX_LENGTH = 16;
export const RIOT_ID_TAG_LINE_MAX_LENGTH = 5;

const RIOT_ID_GAME_NAME_PATTERN = /^[a-zA-Z0-9\s._-]+$/;
const RIOT_ID_TAG_LINE_PATTERN = /^[a-zA-Z0-9]+$/;

export interface RiotIdParts {
  gameName: string;
  tagLine: string;
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

  const gameName = parts[0].trim();
  const tagLine = parts[1].trim();

  if (!gameName) {
    throw new Error("Player Name cannot be empty.");
  }
  if (!tagLine) {
    throw new Error("Tag Line cannot be empty.");
  }
  if (gameName.length > RIOT_ID_GAME_NAME_MAX_LENGTH) {
    throw new Error(
      `Game Name cannot exceed ${RIOT_ID_GAME_NAME_MAX_LENGTH} characters.`,
    );
  }
  if (tagLine.length > RIOT_ID_TAG_LINE_MAX_LENGTH) {
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
