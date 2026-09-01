// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Only the wiring is under test -- the clock arithmetic lives in
// tests/relative-time.test.tsx -- so the hook is pinned to a fixed reading.
const { useRelativeTime } = vi.hoisted(() => ({
  useRelativeTime: vi.fn<typeof import("@/lib/core/hooks/use-relative-time").useRelativeTime>(),
}));

vi.mock("@/lib/core/hooks/use-relative-time", () => ({
  useRelativeTime,
}));

import { UpdatedStamp } from "@/components/updated-stamp";

describe("the updated stamp", () => {
  it("stays silent when freshness is unknown", () => {
    // The hook still runs -- the comment on the component promises the hook
    // order does not depend on the data -- but nothing may render.
    useRelativeTime.mockReturnValue("just now");

    const absent = render(<UpdatedStamp lastUpdated={null} />);
    expect(absent.container.textContent).toBe("");
    expect(useRelativeTime).toHaveBeenCalledWith(null);

    const undefinedToo = render(<UpdatedStamp />);
    expect(undefinedToo.container.textContent).toBe("");
  });

  it("names its source, its own label, and the age it was told", () => {
    useRelativeTime.mockReturnValue("3 hours ago");

    render(<UpdatedStamp lastUpdated="2026-08-19T08:00:00Z" />);
    expect(screen.getByText("Updated 3 hours ago")).toBeTruthy();
    // The stamp asks about the timestamp it was given, not about "now".
    expect(useRelativeTime).toHaveBeenCalledWith("2026-08-19T08:00:00Z");

    const { rerender } = render(
      <UpdatedStamp
        lastUpdated="2026-08-19T08:00:00Z"
        label="Matches synced"
      />,
    );
    expect(screen.getByText("Matches synced 3 hours ago")).toBeTruthy();

    rerender(
      <UpdatedStamp lastUpdated="2026-08-19T09:00:00Z" label="Matches synced" />,
    );
    expect(useRelativeTime).toHaveBeenLastCalledWith("2026-08-19T09:00:00Z");
  });
});
