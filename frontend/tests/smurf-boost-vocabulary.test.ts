import { describe, expect, it } from "vitest";

import {
  familyDescription,
  familyTitle,
  noteLabel,
} from "../features/smurf-boost/smurf-boost-vocabulary";

describe("wording for a result this build has not seen", () => {
  // Each of these lookups ends in a fallback, and the file says why: "a result
  // computed under a later model version must still be readable instead of
  // failing the whole page". The backend can add a family or a note at any
  // time, and this frontend is deployed separately, so that is a matter of
  // when rather than if.
  //
  // Nothing was holding any of it. Dropping `?? family`, `?? note` or `?? ""`
  // kept all 364 tests green, and the page then renders the string "undefined"
  // where a screen about smurfing and boosting accusations puts its label.

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
    expect(familyTitle("rapid_improvement")).toBe(
      "Rapid improvement pattern",
    );
    expect(familyDescription("rapid_improvement")).toContain(
      "earlier games",
    );
  });
});
