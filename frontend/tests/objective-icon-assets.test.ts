import { describe, expect, it } from "vitest";

import { RIOT_OBJECTIVE_ICON_SOURCES } from "@/features/matches/components/objective-icon-assets";
import {
  OBJECTIVE_DEFINITIONS,
  type ObjectiveId,
} from "@/features/matches/components/objective-definitions";

// `objective-icons.tsx` special-cases the turret and indexes everything else
// by its own id, so this is the map's lookup contract.
function iconSourceFor(objective: ObjectiveId): string {
  return objective === "turret"
    ? RIOT_OBJECTIVE_ICON_SOURCES.tower
    : RIOT_OBJECTIVE_ICON_SOURCES[objective];
}

describe("the embedded Riot objective art", () => {
  it("has a source for every objective the match row renders", () => {
    // A missing or renamed key does not fail anything at runtime: the glyph
    // just builds a `url(undefined)` background and renders as empty space
    // beside its count. Only the key set says it is gone.
    expect(Object.keys(RIOT_OBJECTIVE_ICON_SOURCES).sort()).toEqual([
      "baron",
      "dragon",
      "herald",
      "inhibitor",
      "tower",
      "voidgrub",
    ]);

    for (const objective of OBJECTIVE_DEFINITIONS) {
      expect(iconSourceFor(objective.id), objective.id).toMatch(
        /^data:image\/png;base64,/,
      );
    }
  });

  it("ships every icon as a complete, decodable PNG", () => {
    // These blobs were pasted in by hand, and a truncated or corrupt one is
    // invisible until the match row shows a broken glyph on every page load.
    const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

    for (const [key, source] of Object.entries(RIOT_OBJECTIVE_ICON_SOURCES)) {
      const base64 = source.replace(/^data:image\/png;base64,/, "");
      const bytes = Uint8Array.from(atob(base64), (character) =>
        character.charCodeAt(0),
      );

      // `atob` throws on a malformed alphabet; an intact header says the
      // payload really is a PNG and not some other file pasted by mistake.
      expect(Array.from(bytes.slice(0, 4)), key).toEqual(PNG_SIGNATURE);
    }
  });
});
