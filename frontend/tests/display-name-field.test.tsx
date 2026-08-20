// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedPatch, checkAuth, toast } = vi.hoisted(() => ({
  validatedPatch: vi.fn(),
  checkAuth: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedPatch,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => toast,
}));

vi.mock("@/features/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth")>()),
  useAuth: () => ({
    user: { display_name: "Original Name" },
    checkAuth,
  }),
}));

import { DisplayNameField } from "@/app/settings/display-name-field";

function renderField() {
  const { queryClient } = renderWithQueryClient(
    <DisplayNameField />,
  );
  return queryClient;
}

function field(): HTMLInputElement {
  return screen.getByLabelText("Display Name") as HTMLInputElement;
}

function type(value: string): void {
  fireEvent.change(field(), { target: { value } });
}

function save(): void {
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
}

describe("the display name on the settings page", () => {
  beforeEach(() => {
    validatedPatch.mockReset();
    checkAuth.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
    validatedPatch.mockResolvedValue({
      success: true,
      data: { display_name: "New Name" },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("sends the trimmed name, not what the box contains", async () => {
    // This is the name other people see. A pasted value carries whatever
    // whitespace came with it, and the server stores the string it is given,
    // so without the trim the account is renamed to something that renders
    // with a gap in front of it and reads as a different name in a list.
    const queryClient = renderField();

    type("  Padded Name  ");
    save();

    await waitFor(() =>
      expect(validatedPatch).toHaveBeenCalledWith(
        expect.anything(),
        "/auth/me",
        { display_name: "Padded Name" },
      ),
    );

    queryClient.clear();
  });

  it("tells someone who cleared the box that it is empty", async () => {
    // The message is what is asserted, not just that something was refused.
    // Drop this guard and the blank field is still refused -- by the length
    // check below it, which answers "Use at least 3 characters" to someone
    // who typed nothing at all. Naming the message is the only way to hold
    // the two apart.
    const queryClient = renderField();

    type("     ");
    save();

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith("Enter a display name"),
    );
    expect(validatedPatch).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("refuses a name shorter than three characters", async () => {
    const queryClient = renderField();

    type("Jo");
    save();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPatch).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it.each([
    ["_leading", "an underscore at the front"],
    ["trailing_", "an underscore at the end"],
    ["has1digit", "a digit"],
    ["has-hyphen", "a hyphen"],
  ])("refuses %s (%s)", async (name) => {
    // The rule is printed in the refusal, so each of these is a case someone
    // will actually type. Widen the pattern and the name goes to the server,
    // which has its own rule and answers with a generic failure toast that
    // names none of this.
    const queryClient = renderField();

    type(name);
    save();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPatch).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("accepts letters from outside the Latin alphabet", async () => {
    // The pattern is written with `\p{L}`, not `[a-zA-Z]`, and the deployment
    // this runs on is a single European region. A name in accented or
    // non-Latin letters must save, or the rule quietly means "English only".
    const queryClient = renderField();

    type("Žluťoučký Kůň");
    save();

    await waitFor(() =>
      expect(validatedPatch).toHaveBeenCalledWith(
        expect.anything(),
        "/auth/me",
        { display_name: "Žluťoučký Kůň" },
      ),
    );
    expect(toast.warning).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("re-reads the session so the new name appears everywhere else", async () => {
    // The header and the sidebar read the display name off the auth session,
    // not off this mutation. Without the re-read the field shows the new name
    // and every other surface keeps the old one until a full page reload.
    const queryClient = renderField();

    type("Renamed Person");
    save();

    await waitFor(() => expect(checkAuth).toHaveBeenCalled());

    queryClient.clear();
  });

  it("says so when the rename did not happen", async () => {
    validatedPatch.mockResolvedValue({
      success: false,
      error: { status: 500, kind: "server" },
    });
    const queryClient = renderField();

    type("Renamed Person");
    save();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    // The box keeps what was typed, so the attempt can be repeated rather
    // than retyped.
    expect(field().value).toBe("Renamed Person");

    queryClient.clear();
  });
});
