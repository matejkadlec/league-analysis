// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExecutionStatusBadge } from "@/features/jobs/components/execution-status-badge";
import type { JobStatus } from "@/lib/core/schemas";

// The three surfaces that show an execution status each wrote this ladder out
// in full, and they had drifted: the job card's history strip had lost the
// CANCELLED and PAUSED colours, so a cancelled run there looked identical to a
// pending one. Nothing failed, because no test read the badge. These do.

afterEach(cleanup);

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
    expect(badgeFor(status).className).toContain(`bg-${hue}-100`);
  });

  it.each(["SUCCESS", "FAILED", "PENDING", "RUNNING"] as const)(
    "leaves %s to its variant, with no colour override",
    (status) => {
      const className = badgeFor(status).className;

      expect(className).not.toContain("bg-yellow-100");
      expect(className).not.toContain("bg-purple-100");
      expect(className).not.toContain("bg-orange-100");
    },
  );

  it("draws the states that are neither a success nor a failure alike", () => {
    // PENDING and RUNNING both mean "no outcome yet". The executions table
    // used to single PENDING out as `outline` while every other surface called
    // it `secondary`, which made the same run look different depending on
    // where you read it.
    const pending = badgeFor("PENDING").className;
    cleanup();
    const running = badgeFor("RUNNING").className;

    expect(pending).toBe(running);
  });

  it("keeps caller spacing without letting it reach the colours", () => {
    render(
      <ExecutionStatusBadge status="CANCELLED" className="text-[10px]" />,
    );
    const badge = screen.getByText("CANCELLED");

    expect(badge.className).toContain("text-[10px]");
    expect(badge.className).toContain("bg-purple-100");
  });
});
