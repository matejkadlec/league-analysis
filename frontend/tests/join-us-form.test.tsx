// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  post,
  useAuth,
  toastSuccess,
  toastError,
  turnstileReset,
  onSuccessRef,
} = vi.hoisted(() => ({
  post: vi.fn(),
  useAuth: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  turnstileReset: vi.fn(),
  onSuccessRef: { current: null as ((token: string) => void) | null },
}));

vi.mock("@/lib/core/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/core/api")>();
  return { ...actual, api: { ...actual.api, post } };
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

const LONG_ENOUGH = "a".repeat(300);

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
  post.mockReset();
  post.mockResolvedValue({ data: { message: "ok" } });
  toastSuccess.mockReset();
  toastError.mockReset();
  turnstileReset.mockReset();
  onSuccessRef.current = null;
  useAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
});

afterEach(cleanup);

describe("what the join-us form refuses to send", () => {
  // The endpoint is unauthenticated and sends an email, so every one of these
  // is the difference between a contact form and an open relay.

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

  it("gives a message ending in #nl no special treatment", () => {
    // `#nl` used to switch off the minimum length, the captcha and the
    // hourly rate limit, and the literal shipped in the public bundle.
    // The suffix is now ordinary text; if it ever buys an exemption again,
    // this is where it shows up.
    render(<JoinUsForm />);
    fillIn({ body: "please let me in #nl" });
    solveCaptcha();

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
    // hands back whatever it was given, and an empty token is a token the
    // server will reject. The form must keep refusing rather than spend a
    // submission on it.
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

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toEqual({
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
    // the next submission sends one the server has already consumed, and the
    // second application of the session is rejected for a reason the sender
    // cannot see.
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
    post.mockRejectedValue(new Error("network"));
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
    post.mockRejectedValue(new Error("network"));
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
    post.mockRejectedValue(new Error("network"));
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    fireEvent.click(submitButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("alert").textContent).toBeTruthy();
  });

  it("does not send twice while the first send is still going", async () => {
    // The button is disabled during the send, but the guard is what covers a
    // second submit event arriving before React has re-rendered -- a double
    // click, or Enter held down in the textarea.
    // A holder rather than a bare `let`: TypeScript narrows a variable only
    // assigned inside a closure to `never` at the call site below.
    const pending: { release: (() => void) | null } = { release: null };
    post.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.release = () => resolve({ data: {} });
        }),
    );
    render(<JoinUsForm />);
    fillIn();
    solveCaptcha();

    const form = screen.getByLabelText("Body").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    pending.release?.();
  });
});

describe("the way back out of the form", () => {
  it.each([
    ["signed in", { isAuthenticated: true, isLoading: false }, "/"],
    ["signed out", { isAuthenticated: false, isLoading: false }, "/sign-in"],
  ])("sends a %s visitor to %s", (_label, auth, href) => {
    useAuth.mockReturnValue(auth);
    render(<JoinUsForm />);

    expect(
      screen.getByRole("link", { name: /Back to/ }).getAttribute("href"),
    ).toBe(href);
  });

  it("trusts the server's hint while the session is still loading", () => {
    // Without the hint, a signed-in visitor sees "Back to Sign In page" for as
    // long as the auth probe takes, on a page reachable from the signed-in
    // app. The hint comes from the same cookie the server already read.
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });
    render(<JoinUsForm isAuthenticatedHint />);

    expect(
      screen.getByRole("link", { name: /Back to/ }).getAttribute("href"),
    ).toBe("/");
  });

  it("does not trust the hint once the session has actually resolved", () => {
    // The hint is a guess from a cookie that may be stale. Once `isLoading`
    // is false the real answer is in, and a stale hint must not override it.
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    render(<JoinUsForm isAuthenticatedHint />);

    expect(
      screen.getByRole("link", { name: /Back to/ }).getAttribute("href"),
    ).toBe("/sign-in");
  });
});
