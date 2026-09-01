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

    // The upstream shadcn primitive has no such border: re-adding `dialog` from
    // the CLI reverts the patch and every dialog loses its edge at once.
    expect(screen.getByRole("dialog").className).toContain(
      "dialog-white-border",
    );
  });
});
