import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RIOT_ID_GAME_NAME_MAX_LENGTH,
  RIOT_ID_SEARCH_MAX_LENGTH,
  RIOT_ID_GAME_NAME_PATTERN,
  RIOT_ID_TAG_LINE_MAX_LENGTH,
  RIOT_ID_TAG_LINE_PATTERN,
} from "@/features/players/riot-id";

/**
 * The Riot ID rules exist on both sides, so something has to hold them equal.
 * The route declares them as `Query(...)`, which puts them in the OpenAPI
 * document; without `OPENAPI_JSON` this skips rather than pretending to pass.
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

  it("declares the same game-name pattern as the API", () => {
    // Read with the `u` flag: the API's Rust regex engine knows `\p{...}`
    // classes, and JavaScript only does in Unicode mode.
    expect(parameterSchema("game_name")?.pattern).toBe(
      RIOT_ID_GAME_NAME_PATTERN.source,
    );
    expect(RIOT_ID_GAME_NAME_PATTERN.flags).toBe("u");
  });

  it("declares the same tag-line pattern as the API", () => {
    expect(parameterSchema("tag_line")?.pattern).toBe(
      RIOT_ID_TAG_LINE_PATTERN.source,
    );
    expect(RIOT_ID_TAG_LINE_PATTERN.flags).toBe("u");
  });

  it.each([
    ["game_name", RIOT_ID_GAME_NAME_PATTERN],
    ["tag_line", RIOT_ID_TAG_LINE_PATTERN],
  ] as const)("accepts exactly the %s characters the API accepts", (name, ours) => {
    const apiPattern = new RegExp(parameterSchema(name)?.pattern ?? "$^", "u");
    // Printable ASCII, the control range and a sample of other scripts.
    const characters = [
      ...Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)),
      // oxlint-disable-next-line typescript/no-misused-spread -- One sample per code point, as each regex test reads it.
      ..."čřŠéñßЖпΩλ한글ไทยाあ中٣\u00a0\u200b😀",
    ];
    for (const character of characters) {
      expect(
        ours.test(character),
        `${name} character ${JSON.stringify(character)}`,
      ).toBe(apiPattern.test(character));
    }
  });
});
