import { describe, expect, it } from "vitest";

import { getMatchHistoryErrorMessage } from "../features/matches/utils/match-history-error";

describe("match-history error messaging", () => {
  it.each(["Network Error", "request failed: ERR_NETWORK"])(
    "describes service reachability without blaming internet access: %s",
    (message) => {
      const result = getMatchHistoryErrorMessage(null, { message });

      expect(result).toContain("Unable to reach the League Analysis service");
      expect(result).toContain("backend is running");
      expect(result.toLowerCase()).not.toContain("internet");
    },
  );

  it("preserves a specific backend error", () => {
    expect(
      getMatchHistoryErrorMessage(null, {
        message: "The match-history service returned an internal error.",
      }),
    ).toBe("The match-history service returned an internal error.");
  });

  it("uses a deterministic fallback for an unknown error shape", () => {
    expect(getMatchHistoryErrorMessage(null, { detail: "unavailable" })).toBe(
      "Failed to load matches",
    );
  });
});
