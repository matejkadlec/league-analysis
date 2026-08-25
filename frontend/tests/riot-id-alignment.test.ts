import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RIOT_ID_GAME_NAME_MAX_LENGTH,
  RIOT_ID_SEARCH_MAX_LENGTH,
  RIOT_ID_GAME_NAME_PATTERN,
  RIOT_ID_TAG_LINE_MAX_LENGTH,
  RIOT_ID_TAG_LINE_PATTERN,
} from "@/features/players/utils/riot-id";

/**
 * The Riot ID rules exist on both sides, so something has to hold them equal.
 * The route declares them as `Query(min_length=, max_length=, pattern=)`, which
 * puts them in the OpenAPI document, and this reads them back out. Needs
 * `OPENAPI_JSON`; without it the check skips rather than pretending to pass.
 */
const openapiPath = process.env.OPENAPI_JSON;
const spec = openapiPath
  ? (JSON.parse(readFileSync(openapiPath, "utf8")) as {
      paths: Record<
        string,
        Record<
          string,
          {
            parameters?: {
              name: string;
              schema: { maxLength?: number; pattern?: string };
            }[];
          }
        >
      >;
    })
  : null;

function parameterSchema(name: string) {
  return operationParameter("/api/v1/players/discover", name);
}

function operationParameter(path: string, name: string) {
  const operations = spec?.paths[path];
  const operation = operations ? Object.values(operations)[0] : undefined;
  return operation?.parameters?.find((p) => p.name === name)?.schema;
}

describe.skipIf(!spec)("Riot ID rules against the API contract", () => {
  it("caps the search box at what the suggestions query accepts", () => {
    // Not a Riot ID bound but the same failure: without the cap the box takes
    // more than `q` allows, and the viewer meets a 422 error toast from the
    // shared QueryCache rather than an empty result list.
    expect(
      operationParameter("/api/v1/players/suggestions", "q")?.maxLength,
    ).toBe(RIOT_ID_SEARCH_MAX_LENGTH);
  });

  it("bounds the game name to the same length the API does", () => {
    expect(parameterSchema("game_name")?.maxLength).toBe(
      RIOT_ID_GAME_NAME_MAX_LENGTH,
    );
  });

  it("bounds the tag line to the same length the API does", () => {
    expect(parameterSchema("tag_line")?.maxLength).toBe(
      RIOT_ID_TAG_LINE_MAX_LENGTH,
    );
  });

  it("accepts exactly the game-name characters the API accepts", () => {
    const apiPattern = new RegExp(parameterSchema("game_name")?.pattern ?? "$^");
    for (let code = 32; code < 127; code += 1) {
      const character = String.fromCharCode(code);
      expect(
        RIOT_ID_GAME_NAME_PATTERN.test(character),
        `game name character ${JSON.stringify(character)}`,
      ).toBe(apiPattern.test(character));
    }
  });

  it("accepts exactly the tag-line characters the API accepts", () => {
    const apiPattern = new RegExp(parameterSchema("tag_line")?.pattern ?? "$^");
    for (let code = 32; code < 127; code += 1) {
      const character = String.fromCharCode(code);
      expect(
        RIOT_ID_TAG_LINE_PATTERN.test(character),
        `tag line character ${JSON.stringify(character)}`,
      ).toBe(apiPattern.test(character));
    }
  });
});
