// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AppToast = typeof import("@/lib/core/hooks").appToast;
type AuthContext = import("@/features/auth/types").AuthContextType;

const { validatedPost, checkAuth, toastError, toastSuccess } = vi.hoisted(
  () => ({
    validatedPost: vi.fn<typeof import("@/lib/core/http/api").validatedPost>(),
    checkAuth: vi.fn<AuthContext["checkAuth"]>(),
    toastError: vi.fn<AppToast["error"]>(),
    toastSuccess: vi.fn<AppToast["success"]>(),
  }),
);

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedPost,
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ checkAuth }),
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn<AppToast["info"]>(),
    warning: vi.fn<AppToast["warning"]>(),
  }),
}));

import type { ApiError } from "@/lib/core/http/api";
import { useChangeEmail } from "@/features/settings/components/use-change-email";
import { renderHookWithQueryClient } from "./support/render-support";

/** What `validatedPost` hands back when this API refuses with a code. */
function refusal(code: string, lockedUntil?: string) {
  const error: ApiError = {
    kind: "conflict",
    code,
    status: 409,
    message: "The request could not be completed. Please try again later.",
    details: {
      detail: { code, ...(lockedUntil ? { locked_until: lockedUntil } : {}) },
    },
  };
  return { success: false as const, error };
}

function renderChangeEmail() {
  return renderHookWithQueryClient(() => useChangeEmail());
}

describe("changing the address an account is identified by", () => {
  beforeEach(() => {
    validatedPost.mockReset();
    checkAuth.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it("refuses a malformed address without asking the server", async () => {
    const { result } = renderChangeEmail();

    act(() => result.current.handleOpenEmailDialog());
    act(() => result.current.editEmail("not-an-address"));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(result.current.dialog?.error).toBe(
        "The email address is invalid, check your input.",
      ),
    );
    expect(validatedPost).not.toHaveBeenCalled();
  });

  it("normalises the address it sends, and keeps the normalised one", async () => {
    // What the server stores becomes the sign-in identity, so typed spacing
    // and case must not survive into it; resend reuses the stored value.
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "sent", expires_in_minutes: 10 },
    });
    const { result } = renderChangeEmail();

    act(() => result.current.handleOpenEmailDialog());
    act(() => result.current.editEmail("  User@Example.COM  "));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(validatedPost).toHaveBeenCalledWith(
        expect.anything(),
        "/auth/change-email/request-code",
        { new_email: "user@example.com" },
      ),
    );
    await waitFor(() => expect(result.current.dialog?.email).toBe(
      "user@example.com",
    ));
    expect(result.current.dialog?.step).toBe("code");
  });

  it("puts an already-registered address on the field, not in a toast", async () => {
    // The reason belongs on the field the person has to change; a toast would
    // vanish while they are still looking at the form.
    validatedPost.mockResolvedValue(refusal("EMAIL_ALREADY_REGISTERED"));
    const { result } = renderChangeEmail();

    act(() => result.current.handleOpenEmailDialog());
    act(() => result.current.editEmail("taken@example.com"));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(result.current.dialog?.error).toBe(
        "This email address is already registered.",
      ),
    );
    expect(result.current.dialog?.step).toBe("email");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("will not send a partial code", async () => {
    const { result } = renderChangeEmail();

    act(() => result.current.handleOpenEmailDialog());
    act(() => result.current.editEmail("new@example.com"));
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "sent", expires_in_minutes: 10 },
    });
    act(() => result.current.handleEmailDialogSubmit());
    await waitFor(() => expect(result.current.dialog?.step).toBe("code"));

    validatedPost.mockClear();
    act(() => result.current.editCodeDigits(["1", "2", "3", "", "", ""]));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(result.current.dialog?.error).toBe("Enter all 6 digits."),
    );
    expect(validatedPost).not.toHaveBeenCalled();
  });

  it("re-checks the session once the address has actually changed", async () => {
    // The identity changed server-side; without `checkAuth` every surface
    // keeps rendering the old address.
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "sent", expires_in_minutes: 10 },
    });
    const { result } = renderChangeEmail();
    act(() => result.current.handleOpenEmailDialog());
    act(() => result.current.editEmail("new@example.com"));
    act(() => result.current.handleEmailDialogSubmit());
    await waitFor(() => expect(result.current.dialog?.step).toBe("code"));

    validatedPost.mockResolvedValue({
      success: true,
      data: { id: 1, email: "new@example.com" },
    });
    act(() =>
      result.current.editCodeDigits(["1", "2", "3", "4", "5", "6"]),
    );
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() => expect(checkAuth).toHaveBeenCalled());
    expect(validatedPost).toHaveBeenLastCalledWith(
      expect.anything(),
      "/auth/change-email/verify",
      { code: "123456" },
    );
    expect(result.current.dialog).toBeNull();
  });

  it("keeps the dialog shut while the server says the account is locked", async () => {
    // The lock brakes guessing a six-digit code, so it must outlive the
    // dialog or reopening resets to a fresh set of attempts.
    const lockedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    validatedPost.mockResolvedValue(
      refusal("EMAIL_CHANGE_LOCKED", lockedUntil),
    );
    const { result } = renderChangeEmail();

    act(() => result.current.handleOpenEmailDialog());
    act(() => result.current.editEmail("new@example.com"));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() => expect(result.current.isEmailChangeLocked).toBe(true));
    expect(result.current.dialog).toBeNull();

    toastError.mockClear();
    act(() => result.current.handleOpenEmailDialog());

    expect(result.current.dialog).toBeNull();
    expect(toastError).toHaveBeenCalled();
  });
});
