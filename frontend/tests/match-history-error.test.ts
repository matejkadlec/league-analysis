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

  it("does not render an untyped backend error", () => {
    expect(
      getMatchHistoryErrorMessage(null, {
        message: "The match-history service returned an internal error.",
      }),
    ).toBe("Match history could not be loaded. Please try again later.");
  });

  it("uses a deterministic fallback for an unknown error shape", () => {
    expect(getMatchHistoryErrorMessage(null, { detail: "unavailable" })).toBe(
      "Match history could not be loaded. Please try again later.",
    );
  });

  it("preserves a normalized safe not-found message", () => {
    expect(
      getMatchHistoryErrorMessage(null, {
        kind: "not-found",
        code: "NOT_FOUND",
        status: 404,
        message: "No matches were found for this player.",
      }),
    ).toBe("No matches were found for this player.");
  });
});
