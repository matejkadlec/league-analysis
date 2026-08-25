// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExecutionStatusBadge } from "@/features/jobs/components/execution-status-badge";
import type { JobStatus } from "@/lib/core/schemas";

// The three surfaces that show an execution status each write this colour
// ladder out in full, so they drift silently unless something reads the badge.


function badgeFor(status: JobStatus) {
  render(<ExecutionStatusBadge status={status} />);
  return screen.getByText(status.replace("_", " "));
}

describe("the execution status badge", () => {
  it.each([
    ["RATE_LIMITED", "yellow"],
    ["CANCELLED", "purple"],
    ["PAUSED", "orange"],
  ] as const)("gives %s its own colour rather than the shared grey", (
    status,
    hue,
  ) => {
    expect(badgeFor(status).className).toContain(`bg-${hue}-900/30`);
  });

  it.each(["SUCCESS", "FAILED", "PENDING", "RUNNING"] as const)(
    "leaves %s to its variant, with no colour override",
    (status) => {
      const className = badgeFor(status).className;

      expect(className).not.toContain("bg-yellow-900/30");
      expect(className).not.toContain("bg-purple-900/30");
      expect(className).not.toContain("bg-orange-900/30");
    },
  );

  it("draws the states that are neither a success nor a failure alike", () => {
    // PENDING and RUNNING both mean "no outcome yet".
    const pending = badgeFor("PENDING").className;
    cleanup();
    const running = badgeFor("RUNNING").className;

    expect(pending).toBe(running);
  });
});
