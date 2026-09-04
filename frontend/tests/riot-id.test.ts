import { describe, expect, it } from "vitest";

import { parseRiotId } from "../features/players/riot-id";

describe("parseRiotId", () => {
  it("parses and trims a valid Riot ID", () => {
    expect(parseRiotId("  Imagine Dragon # ASOL  ")).toEqual({
      gameName: "Imagine Dragon",
      tagLine: "ASOL",
    });
  });

  it("requires exactly one separator", () => {
    expect(() => parseRiotId("Imagine Dragon")).toThrow(
      "Player Name must be in Name#Tag format.",
    );
    expect(() => parseRiotId("Imagine#Dragon#ASOL")).toThrow(
      "Player Name must contain exactly one # separator.",
    );
  });

  it("requires values on both sides of the separator", () => {
    expect(() => parseRiotId("#ASOL")).toThrow("Player Name cannot be empty.");
    expect(() => parseRiotId("Imagine Dragon#")).toThrow(
      "Tag Line cannot be empty.",
    );
  });

  it("rejects invalid characters and oversized parts", () => {
    expect(() => parseRiotId("Imagine Dragon#AS-OL")).toThrow(
      "Tag Line contains invalid characters. Use only letters and numbers.",
    );
    expect(() => parseRiotId(`${"A".repeat(17)}#ASOL`)).toThrow(
      "Game Name cannot exceed 16 characters.",
    );
    expect(() => parseRiotId("Imagine Dragon#ASOLA1")).toThrow(
      "Tag Line cannot exceed 5 characters.",
    );
  });
});
