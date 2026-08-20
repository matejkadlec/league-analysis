// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";

describe("DialogContent", () => {

  it("carries the branded white border without the call site asking", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Select player server</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // The upstream shadcn primitive has no such border. Re-adding `dialog`
    // from the shadcn CLI reverts the local patch and every dialog in the app
    // loses its edge against the dark background at once.
    expect(screen.getByRole("dialog").className).toContain(
      "dialog-white-border",
    );
  });

  it("keeps the class names callers pass to it", () => {
    render(
      <Dialog open>
        <DialogContent className="max-w-5xl">
          <DialogTitle>Execution details</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByRole("dialog");
    expect(content.className).toContain("dialog-white-border");
    expect(content.className).toContain("max-w-5xl");
  });
});
