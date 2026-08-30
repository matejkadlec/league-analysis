// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card, CardHeader, CardTitle } from "../components/ui/card";

describe("CardTitle", () => {

  it("renders a heading so assistive technology can navigate by it", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Tracked Players</CardTitle>
        </CardHeader>
      </Card>,
    );

    // The upstream shadcn primitive renders a div, and re-adding `card` from
    // the CLI reverts the local patch. The level is the part that matters:
    // every surface's heading outline is built on `CardTitle` being an `h3`.
    expect(
      screen.getByRole("heading", { name: "Tracked Players" }).tagName,
    ).toBe("H3");
  });
});
