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

    // The upstream shadcn primitive renders a div here. Re-adding `card` from
    // the shadcn CLI reverts the local patch, and this assertion is what
    // catches that: a div leaves the accessible heading tree empty.
    expect(
      screen.getByRole("heading", { name: "Tracked Players" }),
    ).toBeDefined();
  });
});
