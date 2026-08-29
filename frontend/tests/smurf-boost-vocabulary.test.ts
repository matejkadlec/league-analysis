import { describe, expect, it } from "vitest";

import {
  bandMeaning,
  familyDescription,
  familyTitle,
  noteLabel,
} from "../features/smurf-boost/smurf-boost-vocabulary";

describe("wording for a result this build has not seen", () => {
  // Each of these lookups ends in a fallback so a result computed under a later
  // model version stays readable. Dropping `?? family`, `?? note` or `?? ""`
  // kept all 364 tests green and rendered the string "undefined" on the page.

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
    // The fallbacks must not be reachable for known keys, or the whole
    // vocabulary silently becomes pass-through and every label on the page
    // turns into a snake_case identifier.
    expect(familyTitle("rapid_improvement")).toBe("Rapid Improvement Pattern");
    expect(familyDescription("rapid_improvement")).toContain("earlier games");
    // The render test reads this sentence back through `BAND_MEANINGS`, so it
    // cannot see the wording change. Written out, the band keeps saying what
    // the finding word alone does not.
    expect(bandMeaning("notable_indicators")).toBe(
      "Two different areas moved together",
    );
  });
});
