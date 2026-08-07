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

import { SignInForm } from "../features/auth/components/sign-in-form";

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
});
