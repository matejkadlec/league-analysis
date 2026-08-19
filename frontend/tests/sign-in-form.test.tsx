// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { login } = vi.hoisted(() => ({ login: vi.fn() }));

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("../features/auth/context/auth-context", () => ({
  useAuth: () => ({ login }),
}));

vi.mock("../components/public-page-footer", () => ({
  PublicPageFooter: () => null,
}));

// The real widget talks to Cloudflare. This stands in for the visitor solving
// it: one button that hands back a token, which is all the form consumes.
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" onClick={() => onSuccess("captcha-token")}>
      solve captcha
    </button>
  ),
}));

import { SignInForm } from "../features/auth/components/sign-in-form";
import { createAuthLoginError } from "../features/auth/utils/login-error";

describe("SignInForm", () => {
  beforeEach(() => {
    login.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("toggles password visibility without changing the entered value", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    await user.type(password, "secret-password");

    expect(password.type).toBe("password");
    expect(password.value).toBe("secret-password");

    const showPassword = screen.getByRole("button", { name: "Show password" });
    expect(showPassword.classList.contains("password-visibility-toggle")).toBe(
      true,
    );

    await user.click(showPassword);

    expect(password.type).toBe("text");
    expect(password.value).toBe("secret-password");
    expect(document.activeElement).toBe(password);
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveProperty("ariaPressed", "true");

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Hide password" }),
    );
    await user.keyboard("{Enter}");

    expect(password.type).toBe("password");
    expect(password.value).toBe("secret-password");
  });

  it("prevents duplicate submissions while allowing a visible password to be hidden", async () => {
    const user = userEvent.setup();
    login.mockReturnValue(new Promise<void>(() => {}));
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    await user.type(password, "secret-password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    const submit = screen.getByRole("button", { name: "Sign In" });

    await user.click(submit);
    await user.click(submit);

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByRole("button", {
        name: "Signing in...",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const hidePassword = screen.getByRole("button", { name: "Hide password" });
    expect(hidePassword).toHaveProperty("disabled", false);

    await user.click(hidePassword);

    expect(password.type).toBe("password");
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("never renders raw client error text", async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new Error("Failed to fetch"));
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      await screen.findByText(
        "Something went wrong while signing in. Please try again.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("hands the form back after a failure, without the last failure's message", async () => {
    // Both halves of this were unguarded, and both strand the visitor on a
    // form they cannot use. Dropping `setIsSubmitting(false)` from the
    // `finally` leaves the button reading "Signing in..." and disabled forever
    // after a rejected sign-in -- no retry, no way out, the same shape as the
    // blank-page bug this app already shipped once. Dropping `setError(null)`
    // at the start of a submission leaves the previous failure on screen while
    // the next attempt is in flight, so a visitor who just fixed their
    // password is still being told it was wrong.
    const user = userEvent.setup();
    login.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    const message = await screen.findByText(
      "Something went wrong while signing in. Please try again.",
    );
    expect(message).not.toBeNull();

    // Usable again: the button says so and accepts a second attempt.
    const retry = await screen.findByRole("button", { name: "Sign In" });
    expect(retry).toHaveProperty("disabled", false);

    login.mockReturnValue(new Promise<void>(() => {}));
    await user.click(retry);

    await waitFor(() =>
      expect(
        screen.queryByText(
          "Something went wrong while signing in. Please try again.",
        ),
      ).toBeNull(),
    );
    expect(login).toHaveBeenCalledTimes(2);
  });

  describe("when the server escalates to a captcha", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("shows the challenge and sends the token with the next attempt", async () => {
      // Nothing reached this path: the site key is unset in tests, so every
      // existing case took the "not configured" branch and `captchaRequired`
      // was never true. The whole escalation -- widget, gated submit, token on
      // the retry -- was 0% covered, and it is the only way back in for
      // someone the backend has started challenging.
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
      const user = userEvent.setup();
      login.mockRejectedValueOnce(
        createAuthLoginError({ detail: { code: "CAPTCHA_REQUIRED" } }, 403),
      );
      render(<SignInForm />);

      await user.type(screen.getByLabelText("Email"), "user@example.com");
      await user.type(screen.getByLabelText("Password"), "secret-password");
      await user.click(screen.getByRole("button", { name: "Sign In" }));

      const solve = await screen.findByRole("button", {
        name: "solve captcha",
      });
      // Unsolved, the form must not let another attempt through -- that is the
      // request the server just refused.
      expect(
        await screen.findByRole("button", { name: "Sign In" }),
      ).toHaveProperty("disabled", true);

      await user.click(solve);

      const submit = await screen.findByRole("button", { name: "Sign In" });
      expect(submit).toHaveProperty("disabled", false);

      login.mockResolvedValueOnce(undefined);
      await user.click(submit);

      // The token has to reach the server, or the retry is refused exactly
      // like the attempt that raised the challenge.
      await waitFor(() =>
        expect(login).toHaveBeenLastCalledWith(
          expect.objectContaining({ captchaToken: "captcha-token" }),
        ),
      );
    });

    it("says so plainly when there is no widget to solve", async () => {
      // The misconfiguration that fails closed: the server demands a captcha
      // and the deployment has no site key, so no widget can render. Without
      // the message the visitor gets a permanently disabled button and no
      // reason -- and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is one unset variable
      // away in any environment.
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
      const user = userEvent.setup();
      login.mockRejectedValueOnce(
        createAuthLoginError({ detail: { code: "CAPTCHA_REQUIRED" } }, 403),
      );
      render(<SignInForm />);

      await user.type(screen.getByLabelText("Email"), "user@example.com");
      await user.type(screen.getByLabelText("Password"), "secret-password");
      await user.click(screen.getByRole("button", { name: "Sign In" }));

      expect(
        await screen.findByText(
          "Sign-in is temporarily unavailable. Please try again later.",
        ),
      ).not.toBeNull();
      expect(
        await screen.findByText(
          "Security check is unavailable. Please try again later.",
        ),
      ).not.toBeNull();
      expect(screen.queryByRole("button", { name: "solve captcha" })).toBeNull();
    });
  });
});
