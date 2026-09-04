// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";

import { renderWithQueryClient } from "./support/render-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Toast = ReturnType<typeof import("@/lib/core/hooks").useToast>;

const { validatedPost, toast } = vi.hoisted(() => ({
  validatedPost: vi.fn<typeof import("@/lib/core/http/api").validatedPost>(),
  toast: {
    success: vi.fn<Toast["success"]>(),
    error: vi.fn<Toast["error"]>(),
    warning: vi.fn<Toast["warning"]>(),
    info: vi.fn<Toast["info"]>(),
  },
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedPost,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => toast,
}));

import { PasswordChangeSection } from "@/features/settings/components/password-change-section";
import type { ApiResponse } from "@/lib/core/http/api";
import type { MessageResponse } from "@/lib/core/schemas";

/** Exactly what `POST /auth/change-password` resolves to. */
type ChangePasswordResponse = ApiResponse<MessageResponse>;

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

async function submit(user: UserEvent): Promise<void> {
  await user.click(changeButton());
}

/** What the API hands back when it refuses with a structured code. */
function refusal(code: string): ChangePasswordResponse {
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
    const user = userEvent.setup();
    // The repeat field exists because this value cannot be read back. Send a
    // mistyped one and the account's password becomes a string nobody knows.
    // The server cannot see the two fields differ, so the check belongs here.
    const queryClient = renderSection();

    fill({ current: CURRENT, next: STRONG, repeat: "Str0ng!Pas" });
    await submit(user);

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPost).not.toHaveBeenCalled();
    // The red mark beside the repeat field is the same verdict as the toast,
    // and it is the one still on screen once the toast has gone.
    expect(document.querySelectorAll(".lucide-circle-x")).toHaveLength(1);

    queryClient.clear();
  });

  it("will not send a password that does not meet the stated requirements", async () => {
    const user = userEvent.setup();
    // The requirements are printed under the field, so a refusal here is the
    // one the person can act on. Sending it instead spends a round trip to be
    // told the same thing in a toast that does not name the rule.
    const queryClient = renderSection();

    fill({ current: CURRENT, next: "weakpass", repeat: "weakpass" });
    await submit(user);

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPost).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".lucide-circle-x")).toHaveLength(1);

    queryClient.clear();
  });

  it("puts a wrong current password on the field, not in a toast", async () => {
    const user = userEvent.setup();
    // This is the field to correct, and it is the one case where the server
    // knows something the form cannot. A toast would vanish while the person
    // is still looking at three filled-in inputs wondering which one was wrong.
    validatedPost.mockResolvedValue(refusal("CURRENT_PASSWORD_INVALID"));
    const queryClient = renderSection();

    fill({ current: "wrong-one", next: STRONG, repeat: STRONG });
    await submit(user);

    expect(
      await screen.findByText("Current password is invalid."),
    ).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("clears every field and re-hides them once the password has changed", async () => {
    const user = userEvent.setup();
    // Two of these inputs can be switched to plain text, and this section
    // lives on a settings page that stays open. Leaving the new password
    // visible after a change leaves it on screen for whoever walks past.
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "Password changed" },
    });
    const queryClient = renderSection();

    fill({ current: CURRENT, next: STRONG, repeat: STRONG });
    const reveal = () =>
      screen.getAllByRole("button", { name: "Show password" });
    await user.click(reveal()[0]!);
    await user.click(reveal()[0]!);
    expect(
      screen.getAllByRole("button", { name: "Hide password" }),
    ).toHaveLength(2);

    await submit(user);

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
    const user = userEvent.setup();
    // The button's `disabled` is what holds this shut, not the handler's own
    // pending check -- a disabled button never delivers the click, so this
    // stays green with that check deleted.
    let release: (value: ChangePasswordResponse) => void = () => {};
    validatedPost.mockImplementation(
      () =>
        new Promise<ChangePasswordResponse>((resolve) => {
          release = resolve;
        }),
    );
    const queryClient = renderSection();

    fill({ current: CURRENT, next: STRONG, repeat: STRONG });
    // Held rather than re-queried: while the request is in flight the button
    // relabels itself, and this is the same element a person would jab at.
    const button = changeButton();
    await user.click(button);

    await waitFor(() => expect(validatedPost).toHaveBeenCalledTimes(1));
    // What actually holds the second click off, and what the person sees:
    // the button says the change is under way and refuses the press.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Changing...");
    await user.click(button);
    await user.click(button);

    expect(validatedPost).toHaveBeenCalledTimes(1);

    release({ success: true, data: { message: "Password changed" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    queryClient.clear();
  });
});
