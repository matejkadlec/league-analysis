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

  it.each([
    ["diacritics", "Ondřej Škoda#Čech", "Ondřej Škoda", "Čech"],
    ["Cyrillic", "Пётр#РУС", "Пётр", "РУС"],
    ["Greek", "Ελένη#ΕΛ1", "Ελένη", "ΕΛ1"],
    ["Hangul", "한글이름#한국", "한글이름", "한국"],
    // Thai vowels are combining marks, not letters.
    ["Thai", "ทดสอบ#ไทย", "ทดสอบ", "ไทย"],
  ])("accepts a Riot ID written with %s", (_script, input, gameName, tagLine) => {
    // LGA-118: one stored player in ten has a name outside ASCII.
    expect(parseRiotId(input)).toEqual({ gameName, tagLine });
  });

  it("still refuses control characters, with the existing messages", () => {
    expect(() => parseRiotId("Imagine\tDragon#ASOL")).toThrow(
      "Game Name contains invalid characters. Use letters, numbers, spaces, and ._-.",
    );
    expect(() => parseRiotId("Imagine Dragon#AS\u0000L")).toThrow(
      "Tag Line contains invalid characters. Use only letters and numbers.",
    );
    expect(() => parseRiotId("Imagine Dragon#😀")).toThrow(
      "Tag Line contains invalid characters. Use only letters and numbers.",
    );
  });

  it("counts characters the way the API does, not UTF-16 units", () => {
    // 𠀀 is one character in two UTF-16 units; sixteen of them fit.
    expect(parseRiotId(`${"𠀀".repeat(16)}#ASOL`).gameName).toHaveLength(32);
    expect(() => parseRiotId(`${"Ж".repeat(17)}#ASOL`)).toThrow(
      "Game Name cannot exceed 16 characters.",
    );
  });
});
