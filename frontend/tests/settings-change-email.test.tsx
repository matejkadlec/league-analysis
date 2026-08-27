// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AppToast = typeof import("@/lib/core/hooks").appToast;
type AuthContext = import("@/features/auth/types").AuthContextType;

const { validatedPost, checkAuth, toastError, toastSuccess } = vi.hoisted(
  () => ({
    validatedPost: vi.fn<typeof import("@/lib/core/api").validatedPost>(),
    checkAuth: vi.fn<AuthContext["checkAuth"]>(),
    toastError: vi.fn<AppToast["error"]>(),
    toastSuccess: vi.fn<AppToast["success"]>(),
  }),
);

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
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

import type { ApiError } from "@/lib/core/api";
import { useChangeEmail } from "@/features/settings/use-change-email";
import { renderHookWithQueryClient } from "./render-support";

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

    act(() => result.current.setNewEmail("not-an-address"));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(result.current.newEmailError).toBe(
        "The email address is invalid, check your input.",
      ),
    );
    expect(validatedPost).not.toHaveBeenCalled();
  });

  it("normalises the address it sends, and keeps the normalised one", async () => {
    // What the server stores becomes the identity this account signs in with,
    // so the spacing and case a person happens to type must not survive into
    // it. The resend path reuses that stored value.
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "sent", expires_in_minutes: 10 },
    });
    const { result } = renderChangeEmail();

    act(() => result.current.setNewEmail("  User@Example.COM  "));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(validatedPost).toHaveBeenCalledWith(
        expect.anything(),
        "/auth/change-email/request-code",
        { new_email: "user@example.com" },
      ),
    );
    await waitFor(() => expect(result.current.newEmail).toBe(
      "user@example.com",
    ));
    expect(result.current.emailDialogStep).toBe("code");
  });

  it("puts an already-registered address on the field, not in a toast", async () => {
    // The dialog stays on the email step with the reason attached to the
    // input, because that is the field the person has to change. A toast here
    // would vanish while they are still looking at the form.
    validatedPost.mockResolvedValue(refusal("EMAIL_ALREADY_REGISTERED"));
    const { result } = renderChangeEmail();

    act(() => result.current.setNewEmail("taken@example.com"));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(result.current.newEmailError).toBe(
        "This email address is already registered.",
      ),
    );
    expect(result.current.emailDialogStep).toBe("email");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("will not send a partial code", async () => {
    const { result } = renderChangeEmail();

    act(() => result.current.setNewEmail("new@example.com"));
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "sent", expires_in_minutes: 10 },
    });
    act(() => result.current.handleEmailDialogSubmit());
    await waitFor(() => expect(result.current.emailDialogStep).toBe("code"));

    validatedPost.mockClear();
    act(() => result.current.setEmailCodeDigits(["1", "2", "3", "", "", ""]));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() =>
      expect(result.current.emailCodeError).toBe("Enter all 6 digits."),
    );
    expect(validatedPost).not.toHaveBeenCalled();
  });

  it("re-checks the session once the address has actually changed", async () => {
    // The account's identity just changed server-side. Without `checkAuth`
    // every surface keeps rendering the old address until something else
    // happens to refresh it.
    validatedPost.mockResolvedValue({
      success: true,
      data: { message: "sent", expires_in_minutes: 10 },
    });
    const { result } = renderChangeEmail();
    act(() => result.current.setNewEmail("new@example.com"));
    act(() => result.current.handleEmailDialogSubmit());
    await waitFor(() => expect(result.current.emailDialogStep).toBe("code"));

    validatedPost.mockResolvedValue({
      success: true,
      data: { id: 1, email: "new@example.com" },
    });
    act(() =>
      result.current.setEmailCodeDigits(["1", "2", "3", "4", "5", "6"]),
    );
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() => expect(checkAuth).toHaveBeenCalled());
    expect(validatedPost).toHaveBeenLastCalledWith(
      expect.anything(),
      "/auth/change-email/verify",
      { code: "123456" },
    );
    expect(result.current.emailDialogOpen).toBe(false);
  });

  it("keeps the dialog shut while the server says the account is locked", async () => {
    // The lock is the brake on guessing a six-digit code. It has to outlive
    // the dialog that triggered it, or reopening resets straight back to a
    // fresh set of attempts.
    const lockedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    validatedPost.mockResolvedValue(
      refusal("EMAIL_CHANGE_LOCKED", lockedUntil),
    );
    const { result } = renderChangeEmail();

    act(() => result.current.setNewEmail("new@example.com"));
    act(() => result.current.handleEmailDialogSubmit());

    await waitFor(() => expect(result.current.isEmailChangeLocked).toBe(true));
    expect(result.current.emailDialogOpen).toBe(false);

    toastError.mockClear();
    act(() => result.current.handleOpenEmailDialog());

    expect(result.current.emailDialogOpen).toBe(false);
    expect(toastError).toHaveBeenCalled();
  });
});
