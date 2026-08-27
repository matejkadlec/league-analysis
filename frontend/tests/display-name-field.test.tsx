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

import { DisplayNameField } from "@/features/settings/display-name-field";
import { USER_QUERY_KEY } from "@/features/settings/settings-helpers";

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
    // so without the trim the name renders with a gap in front of it.
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
    // Once the save lands the box follows the session again, so the padding
    // is gone from the screen and not only from the request.
    await waitFor(() => expect(field().value).toBe("Original Name"));

    queryClient.clear();
  });

  it("tells someone who cleared the box that it is empty", async () => {
    // Drop the empty-name guard and the blank field is still refused -- by
    // the length check below it, which answers "Use at least 3 characters"
    // to someone who typed nothing. Only the message tells the two apart.
    const queryClient = renderField();

    type("     ");
    save();

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith("Enter a display name"),
    );
    expect(validatedPatch).not.toHaveBeenCalled();
    // A refusal leaves the draft in the box: resetting it to the stored name
    // would make someone retype from scratch to fix a typo.
    expect(field().value).toBe("     ");

    queryClient.clear();
  });

  it("refuses a name shorter than three characters", async () => {
    const queryClient = renderField();

    type("Jo");
    save();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPatch).not.toHaveBeenCalled();
    expect(field().value).toBe("Jo");

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
    // which answers with a generic failure toast that names none of this.
    const queryClient = renderField();

    type(name);
    save();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPatch).not.toHaveBeenCalled();
    expect(field().value).toBe(name);

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
    await waitFor(() => expect(field().value).toBe("Original Name"));

    queryClient.clear();
  });

  it("re-reads the session so the new name appears everywhere else", async () => {
    // The header and the sidebar read the display name off the auth session,
    // not off this mutation. Without the re-read the field shows the new name
    // and every other surface keeps the old one until a full page reload.
    const queryClient = renderField();
    // Seeded so the invalidation has something to mark: the surfaces that
    // read the user off this key are the ones the re-read is for.
    queryClient.setQueryData(USER_QUERY_KEY, { display_name: "Original Name" });

    type("Renamed Person");
    save();

    await waitFor(() => expect(checkAuth).toHaveBeenCalled());
    expect(queryClient.getQueryState(USER_QUERY_KEY)?.isInvalidated).toBe(true);

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
