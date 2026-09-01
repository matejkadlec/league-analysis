import { describe, expect, it } from "vitest";

import {
  bandMeaning,
  familyDescription,
  familyTitle,
  noteLabel,
} from "../features/smurf-boost/smurf-boost-vocabulary";

describe("wording for a result this build has not seen", () => {
  // Each lookup ends in a fallback so a result from a later model version
  // stays readable; without one the page renders the string "undefined".

  it("shows an unknown family's own identifier rather than undefined", () => {
    expect(familyTitle("account_sharing_v2")).toBe("account_sharing_v2");
  });

  it("leaves an unknown family's description empty rather than undefined", () => {
    // Empty, not the identifier: a description sits under the title, and
    // repeating a raw key there says nothing a viewer can use.
    expect(familyDescription("account_sharing_v2")).toBe("");
  });

  it("shows an unknown note's own identifier rather than undefined", () => {
    expect(noteLabel("insufficient_recent_games_v2")).toBe(
      "insufficient_recent_games_v2",
    );
  });

  it("still uses the written wording for everything it does know", () => {
    // A fallback reachable for a known key turns the whole vocabulary into
    // pass-through snake_case identifiers.
    expect(familyTitle("rapid_improvement")).toBe("Rapid Improvement Pattern");
    expect(familyDescription("rapid_improvement")).toContain("earlier games");
    // The render test reads this back through `BAND_MEANINGS` and so cannot
    // see the wording change; written out, it can.
    expect(bandMeaning("notable_indicators")).toBe(
      "Two different areas moved together",
    );
  });
});
