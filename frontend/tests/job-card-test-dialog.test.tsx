// @vitest-environment jsdom

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { JobCardTestDialog } from "@/features/jobs/components/job-card-test-dialog";

/**
 * The dialog the way `JobCard` mounts it: open state owned above, and the
 * confirm handler closing it before firing the mutation -- the component
 * itself only reports; the parent decides.
 */
function DialogHarness({
  onConfirm,
}: {
  onConfirm: (suspendRegular: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const handleConfirm = (suspendRegular: boolean) => {
    setOpen(false);
    onConfirm(suspendRegular);
  };
  return (
    <JobCardTestDialog
      open={open}
      onOpenChange={setOpen}
      onConfirm={handleConfirm}
    />
  );
}

describe("JobCardTestDialog", () => {
  it("states what a test run does before asking the one question", () => {
    render(
      <DialogHarness onConfirm={vi.fn<(suspendRegular: boolean) => void>()} />,
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Start Test Run" }),
    ).not.toBeNull();
    // The safety promises an admin is consenting to: every endpoint, once a
    // minute, nothing written, bounded by an hour.
    expect(
      within(dialog).getByText(/without saving any data/),
    ).not.toBeNull();
    expect(within(dialog).getByText(/up to 1 hour or until stopped/))
      .not.toBeNull();
    expect(
      within(dialog).getByText("Suspend regular scheduled runs during the test?"),
    ).not.toBeNull();
    for (const label of ["Cancel", "No", "Yes"]) {
      expect(
        within(dialog).getByRole("button", { name: label }),
      ).not.toBeNull();
    }
  });

  it("renders nothing while closed", () => {
    render(
      <JobCardTestDialog
        open={false}
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onConfirm={vi.fn<(suspendRegular: boolean) => void>()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Start Test Run")).toBeNull();
  });

  it.each([
    ["No", false],
    ["Yes", true],
  ])(
    "answers the question with %s and is done asking",
    async (label, suspendRegular) => {
      // The boolean is the whole payload: it decides whether the scheduler
      // keeps firing the regular run while the test overlaps it. Closing is
      // the parent's move, mirrored the way `handleTestConfirm` makes it.
      const onConfirm = vi.fn<(suspendRegular: boolean) => void>();
      const user = userEvent.setup();
      render(<DialogHarness onConfirm={onConfirm} />);

      await user.click(screen.getByRole("button", { name: label }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(suspendRegular);
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it.each([
    ["Cancel", "explicit cancel button"],
    ["Close", "corner close control"],
  ])("closes through the %s (%s) without answering the question", async (label) => {
    const onConfirm = vi.fn<(suspendRegular: boolean) => void>();
    const user = userEvent.setup();
    render(<DialogHarness onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: label }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
