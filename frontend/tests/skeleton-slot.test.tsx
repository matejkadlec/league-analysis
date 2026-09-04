// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "../components/ui/skeleton";

describe("Skeleton", () => {
  it("names itself, so the e2e harness can wait for gated cards to resolve", () => {
    const { container } = render(<Skeleton className="h-6 w-48" />);

    // Upstream carries no `data-slot`, so re-adding `skeleton` from the
    // shadcn CLI reverts this. `gotoPopulatedRoute` waits for zero of these,
    // and an unnamed one makes a page of placeholders look ready.
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});
