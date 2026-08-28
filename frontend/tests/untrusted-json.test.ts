import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseUntrustedJson } from "@/lib/core/http/untrusted-json";

const Schema = z.object({ level: z.string() });

describe("parseUntrustedJson", () => {
  it("returns the parsed value when the text matches the schema", () => {
    expect(parseUntrustedJson(Schema, '{"level":"all"}')).toEqual({
      level: "all",
    });
  });

  it("answers malformed text with null instead of throwing", () => {
    // The reason every caller could drop its own try/catch: browser storage
    // holds whatever the last build -- or a viewer -- wrote into it.
    expect(parseUntrustedJson(Schema, "{not json")).toBeNull();
  });

  it("answers well-formed JSON of the wrong shape with null", () => {
    expect(parseUntrustedJson(Schema, '{"level":7}')).toBeNull();
    expect(parseUntrustedJson(Schema, "[]")).toBeNull();
  });

  it("answers an absent value with null", () => {
    expect(parseUntrustedJson(Schema, null)).toBeNull();
    expect(parseUntrustedJson(Schema, "")).toBeNull();
  });
});
