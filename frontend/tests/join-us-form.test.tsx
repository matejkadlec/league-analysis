// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Toast = ReturnType<typeof import("@/lib/core/hooks").useToast>;

const {
  validatedPost,
  useAuth,
  toastSuccess,
  toastError,
  turnstileReset,
  onSuccessRef,
} = vi.hoisted(() => ({
  validatedPost: vi.fn<typeof import("@/lib/core/api").validatedPost>(),
  useAuth: vi.fn<typeof import("@/features/auth/context/auth-context").useAuth>(),
  toastSuccess: vi.fn<Toast["success"]>(),
  toastError: vi.fn<Toast["error"]>(),
  turnstileReset: vi.fn<() => void>(),
  onSuccessRef: { current: null as ((token: string) => void) | null },
}));

// `validatedPost`, not `api.post`: the helper closes over the module's own
// axios instance, so replacing the exported `api` object leaves the real
// request in place.
vi.mock("@/lib/core/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/core/api")>();
  return { ...actual, validatedPost };
});

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/features/auth/context/auth-context", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/auth/context/auth-context")
  >()),
  useAuth,
}));

// A stand-in widget that exposes the two things the form is responsible for:
// the token it hands back, and whether the form asked it to reset.
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: ({
    ref,
    onSuccess,
  }: {
    ref?: { current: { reset: () => void } | undefined };
    onSuccess: (token: string) => void;
  }) => {
    onSuccessRef.current = onSuccess;
    if (ref) ref.current = { reset: turnstileReset };
    return <div data-testid="turnstile" />;
  },
}));

import { JoinUsForm } from "@/features/auth/components/join-us-form";
import { JOIN_US_BODY_MAX_LENGTH } from "@/features/auth/utils/join-us-message";
import type { AuthContextType } from "@/features/auth/types";

const LONG_ENOUGH = "a".repeat(300);

/**
 * The whole context value from the two fields the form reads. A partial
 * object would only say the mock agrees with today's reading of it.
 */
function session(state: {
  isAuthenticated: boolean;
  isLoading: boolean;
}): AuthContextType {
  return {
    user: null,
    ...state,
    login: async () => {},
    logout: async () => {},
    checkAuth: async () => {},
  };
}

function submitButton() {
  return screen.getByRole("button", {
    name: /Submit|Sending/,
  }) as HTMLButtonElement;
}

/** No `jest-dom` in this suite, so read the DOM properties directly. */
function isSubmitDisabled() {
  return submitButton().disabled;
}

function valueOf(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

function fillIn({ subject = "beta_tester", body = LONG_ENOUGH } = {}) {
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: subject },
  });
  fireEvent.change(screen.getByLabelText("Body"), { target: { value: body } });
}

function solveCaptcha() {
  // The widget hands the token back outside any DOM event, so unlike
  // `fireEvent` this state update is not wrapped for us.
  act(() => onSuccessRef.current?.("captcha-token"));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
  validatedPost.mockReset();
  validatedPost.mockResolvedValue({ success: true, data: { message: "ok" } });
  toastSuccess.mockReset();
  toastError.mockReset();
  turnstileReset.mockReset();
  onSuccessRef.current = null;
  useAuth.mockReturnValue(session({ isAuthenticated: false, isLoading: false }));
});


describe("what the join-us form refuses to send", () => {
  // The endpoint is unauthenticated and sends an email, so every one of these
  // is the difference between a contact form and an open relay.

  it("stops typing at the length the API accepts, rather than 422ing", () => {
    // The counter only ever spoke about the minimum, so the 5000-character
    // ceiling was invisible until the request came back rejected.
    render(<JoinUsForm />);

    expect(
      (screen.getByLabelText("Body") as HTMLTextAreaElement).maxLength,
    ).toBe(JOIN_US_BODY_MAX_LENGTH);
  });

  it("will not submit without a subject", () => {
    render(<JoinUsForm />);
    fillIn({ subject: "" });
    solveCaptcha();

    expect(isSubmitDisabled()).toBe(true);
  });

  it("will not submit a message under the minimum length", () => {
    render(<JoinUsForm />);
    fillIn({ body: "a".repeat(299) });
    solveCaptcha();

    expect(isSubmitDisabled()).toBe(true);
  });

  it("gives a short message ending in #nl no length exemption", () => {
    // `#nl` used to switch off the minimum length, the captcha and the
    // hourly rate limit at once, and the literal shipped in the public
    // bundle. The suffix is now ordinary text.
    render(<JoinUsForm />);
    fillIn({ body: "please let me in #nl" });
    solveCaptcha();

    expect(isSubmitDisabled()).toBe(true);
  });

  it("gives a long message ending in #nl no captcha exemption", () => {
    // The other half of the old bypass, and the half a length-only test
    // would miss: a body long enough to clear the minimum still cannot be
    // sent without solving the captcha.
    render(<JoinUsForm />);
    fillIn({ body: `${"a".repeat(300)} #nl` });

    expect(isSubmitDisabled()).toBe(true);
  });

  it("accepts a message of exactly the minimum length", () => {
    // The boundary itself: 300 must pass, or the counter says "Requirement
    // met" over a button that stays dead.
    render(<JoinUsForm />);
    fillIn({ body: "a".repeat(300) });
    solveCaptcha();

    expect(isSubmitDisabled()).toBe(false);
  });

  it("measures the message after trimming it", () => {
    // Whitespace is not a message. Without the trim, 300 spaces pass.
    render(<JoinUsForm />);
    fillIn({ body: " ".repeat(400) });
    solveCaptcha();

    expect(isSubmitDisabled()).toBe(true);
  });

  it("will not submit while the captcha is unsolved", () => {
    render(<JoinUsForm />);
    fillIn();

    expect(isSubmitDisabled()).toBe(true);
  });

  it("does not accept an empty string as a solved captcha", () => {
    // `captchaToken !== null` alone is not enough: the widget's callback
    // hands back whatever it was given, and an empty token is one the server
    // will reject, so the form must keep refusing.
    render(<JoinUsForm />);
    fillIn();
    act(() => onSuccessRef.current?.(""));

    expect(isSubmitDisabled()).toBe(true);
  });

  it("submits once the captcha comes back", async () => {
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    fireEvent.click(submitButton());

    await waitFor(() => expect(validatedPost).toHaveBeenCalledTimes(1));
    expect(validatedPost.mock.calls[0]?.[1]).toBe("/auth/join-us/contact");
    expect(validatedPost.mock.calls[0]?.[2]).toEqual({
      subject: "beta_tester",
      body: LONG_ENOUGH,
      captcha_token: "captcha-token",
    });
  });

  it("does not require a captcha that this environment does not have", () => {
    // With no site key the widget never renders, so a captcha requirement
    // would be unsatisfiable and the form permanently dead.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    render(<JoinUsForm />);
    fillIn();

    expect(screen.queryByTestId("turnstile")).toBeNull();
    expect(isSubmitDisabled()).toBe(false);
  });

  it("treats a site key of only whitespace as no site key", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "   ");
    render(<JoinUsForm />);
    fillIn();

    expect(isSubmitDisabled()).toBe(false);
  });
});

describe("what happens after the send", () => {
  it("clears the form and the captcha on success", async () => {
    // A Turnstile token is single-use. Leaving the solved token in state means
    // the next submission sends one the server has already consumed, rejected
    // for a reason the sender cannot see.
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    fireEvent.click(submitButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(valueOf("Body")).toBe("");
    expect(valueOf("Subject")).toBe("");
    expect(turnstileReset).toHaveBeenCalledTimes(1);
  });

  it("keeps the message the sender wrote when the send fails", async () => {
    // It is at least 300 characters and they typed it once. Clearing it on
    // failure is the difference between "try again" and "write it again".
    validatedPost.mockRejectedValue(new Error("network"));
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    fireEvent.click(submitButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(valueOf("Body")).toBe(LONG_ENOUGH);
    expect(valueOf("Subject")).toBe("beta_tester");
  });

  it("resets the captcha after a failure so a retry is possible", async () => {
    // The token was spent on the attempt that failed. Without the reset the
    // form still holds it, the button is still enabled, and every retry is
    // rejected by the server for reusing it.
    validatedPost.mockRejectedValue(new Error("network"));
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    fireEvent.click(submitButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(turnstileReset).toHaveBeenCalledTimes(1);
    // And the button is back to refusing, because the token is gone.
    expect(isSubmitDisabled()).toBe(true);
  });

  it("shows the failure on the page as well as in a toast", async () => {
    // The toast disappears. The alert is what is still there when the sender
    // looks back at the form wondering whether it went.
    validatedPost.mockRejectedValue(new Error("network"));
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    fireEvent.click(submitButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("alert").textContent).toBeTruthy();
  });

  it("does not send twice while the first send is still going", async () => {
    // The button is disabled during the send; the guard covers a second submit
    // arriving before React has re-rendered. A holder rather than a bare `let`:
    // TypeScript narrows a closure-only assignment to `never` at the call site.
    const pending: { release: (() => void) | null } = { release: null };
    validatedPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.release = () =>
            resolve({ success: true, data: { message: "ok" } });
        }),
    );
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    const form = screen.getByLabelText("Body").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(validatedPost).toHaveBeenCalledTimes(1));
    // What the sender sees while it is going, and the reason a fourth click
    // never reaches the guard.
    expect(submitButton().textContent).toContain("Sending");
    expect(isSubmitDisabled()).toBe(true);
    pending.release?.();
  });
});

describe("the way back out of the form", () => {
  it.each([
    ["signed in", { isAuthenticated: true, isLoading: false }, "/"],
    ["signed out", { isAuthenticated: false, isLoading: false }, "/sign-in"],
  ])("sends a %s visitor to %s", (_label, auth, href) => {
    useAuth.mockReturnValue(session(auth));
    render(<JoinUsForm />);

    expect(
      screen.getByRole("link", { name: /Back to/ }).getAttribute("href"),
    ).toBe(href);
  });

  it("trusts the server's hint while the session is still loading", () => {
    // Without the hint, a signed-in visitor sees "Back to Sign In page" for as
    // long as the auth probe takes, on a page reachable from the signed-in
    // app. The hint comes from the same cookie the server already read.
    useAuth.mockReturnValue(session({ isAuthenticated: false, isLoading: true }));
    render(<JoinUsForm isAuthenticatedHint />);

    expect(
      screen.getByRole("link", { name: /Back to/ }).getAttribute("href"),
    ).toBe("/");
  });

  it("does not trust the hint once the session has actually resolved", () => {
    // The hint is a guess from a cookie that may be stale. Once `isLoading`
    // is false the real answer is in, and a stale hint must not override it.
    useAuth.mockReturnValue(
      session({ isAuthenticated: false, isLoading: false }),
    );
    render(<JoinUsForm isAuthenticatedHint />);

    expect(
      screen.getByRole("link", { name: /Back to/ }).getAttribute("href"),
    ).toBe("/sign-in");
  });
});
