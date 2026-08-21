// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedPost, toast } = vi.hoisted(() => ({
  validatedPost: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedPost,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => toast,
}));

import { PasswordChangeSection } from "@/features/settings/password-change-section";

const CURRENT = "Current-1";
const STRONG = "Str0ng!Pass";

function renderSection() {
  const { queryClient } = renderWithQueryClient(
    <PasswordChangeSection />,
  );
  return queryClient;
}

function fill(fields: {
  current?: string;
  next?: string;
  repeat?: string;
}): void {
  const set = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  if (fields.current !== undefined) set("Current Password", fields.current);
  if (fields.next !== undefined) set("New Password", fields.next);
  if (fields.repeat !== undefined) set("Repeat Password", fields.repeat);
}

function changeButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /^Change$/,
  }) as HTMLButtonElement;
}

function submit(): void {
  fireEvent.click(changeButton());
}

/** What the API hands back when it refuses with a structured code. */
function refusal(code: string) {
  return {
    success: false as const,
    error: {
      kind: "conflict",
      status: 400,
      code,
      message: "The request could not be completed.",
      details: { detail: { code } },
    },
  };
}

describe("changing an account password", () => {
  beforeEach(() => {
    validatedPost.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    cleanup();
  });

  it("will not send a new password that was typed differently twice", async () => {
    // The repeat field exists because this value cannot be read back. Send a
    // mistyped one and the account's password becomes a string nobody knows,
    // recoverable only by email. Nothing about the two fields differing is
    // visible to the server, so this check has to happen here.
    const queryClient = renderSection();

    fill({ current: CURRENT, next: STRONG, repeat: "Str0ng!Pas" });
    submit();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPost).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("will not send a password that does not meet the stated requirements", async () => {
    // The requirements are printed under the field, so a refusal here is the
    // one the person can act on. Sending it instead spends a round trip to be
    // told the same thing in a toast that does not name the rule.
    const queryClient = renderSection();

    fill({ current: CURRENT, next: "weakpass", repeat: "weakpass" });
    submit();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPost).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("puts a wrong current password on the field, not in a toast", async () => {
    // This is the field to correct, and it is the one case where the server
    // knows something the form cannot. A toast would vanish while the person
    // is still looking at three filled-in inputs wondering which one was wrong.
    validatedPost.mockResolvedValue(refusal("CURRENT_PASSWORD_INVALID"));
    const queryClient = renderSection();

    fill({ current: "wrong-one", next: STRONG, repeat: STRONG });
    submit();

    expect(
      await screen.findByText("Current password is invalid."),
    ).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("clears every field and re-hides them once the password has changed", async () => {
    // Two of these inputs can be switched to plain text, and this section
    // lives on a settings page that stays open. Leaving the new password
    // visible after a successful change leaves it on screen for whoever walks
    // past next.
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "Password changed" },
    });
    const queryClient = renderSection();

    fill({ current: CURRENT, next: STRONG, repeat: STRONG });
    const reveal = () =>
      screen.getAllByRole("button", { name: "Show password" });
    fireEvent.click(reveal()[0]!);
    fireEvent.click(reveal()[0]!);
    expect(
      screen.getAllByRole("button", { name: "Hide password" }),
    ).toHaveLength(2);

    submit();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    expect(
      (screen.getByLabelText("Current Password") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("New Password") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Repeat Password") as HTMLInputElement).value,
    ).toBe("");
    expect(
      screen.queryAllByRole("button", { name: "Hide password" }),
    ).toHaveLength(0);

    queryClient.clear();
  });

  it("stops a second submit while the first is still in flight", async () => {
    // Each attempt is checked against the current password server-side, so a
    // double-fire spends a second attempt on an endpoint that has every reason
    // to rate-limit them.
    //
    // What holds this shut is the button's `disabled` while the mutation is
    // pending, not the matching check inside the handler: removing that check
    // leaves this green, because a disabled button never delivers the click.
    // The check is a second lock on a door with no other way in.
    let release: (value: unknown) => void = () => {};
    validatedPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const queryClient = renderSection();

    fill({ current: CURRENT, next: STRONG, repeat: STRONG });
    // Held rather than re-queried: while the request is in flight the button
    // relabels itself, and this is the same element a person would jab at.
    const button = changeButton();
    fireEvent.click(button);

    await waitFor(() => expect(validatedPost).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    fireEvent.click(button);

    expect(validatedPost).toHaveBeenCalledTimes(1);

    release({ success: true, data: { message: "Password changed" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    queryClient.clear();
  });
});
