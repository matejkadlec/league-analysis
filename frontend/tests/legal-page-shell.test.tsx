// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContextType } from "@/features/auth/types";

const { useAuth } = vi.hoisted(() => ({
  useAuth: vi.fn<typeof import("@/features/auth").useAuth>(),
}));

vi.mock("@/features/auth", () => ({ useAuth }));

// The footer's logo only exists as a build asset; the links around it are
// what this shell has to answer for.
vi.mock("next/image", () => ({
  default: () => null,
}));

import { LegalPageShell } from "@/components/legal-page-shell";

/** The whole context, because that is what `useAuth` answers with. */
function authState({
  isAuthenticated,
  isLoading,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
}): AuthContextType {
  return {
    user: null,
    isAuthenticated,
    isLoading,
    login: async () => {},
    logout: async () => {},
    checkAuth: async () => {},
  };
}

function renderShell(hint = false) {
  return render(
    <LegalPageShell title="Privacy Policy" isAuthenticatedHint={hint}>
      <p>We do not sell your data.</p>
    </LegalPageShell>,
  );
}

beforeEach(() => {
  useAuth.mockReset();
  useAuth.mockReturnValue(authState({ isAuthenticated: false, isLoading: false }));
});

describe("LegalPageShell", () => {
  it("wraps the legal copy in the signed-out frame: back link, heading, footer", () => {
    renderShell();

    // The only way out for someone who landed here signed out is the way they
    // came in; the label says where it goes and the href says the same.
    const back = screen.getByRole("link", { name: "Back to Sign In page" });
    expect(back.getAttribute("href")).toBe("/sign-in");

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Privacy Policy");
    expect(screen.getByText("We do not sell your data.")).not.toBeNull();

    // The public footer's legal links: the shell that renders them for
    // signed-out visitors must not drop the cross-links between the pages.
    expect(screen.getByRole("link", { name: "Cookie Policy" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cookie settings" })).not.toBeNull();
  });

  it("drops the back link and footer once the visitor is signed in", () => {
    useAuth.mockReturnValue(authState({ isAuthenticated: true, isLoading: false }));
    renderShell();

    // Signed in, the app shell owns the navigation; a fixed back link and a
    // second footer would both sit on top of it.
    expect(
      screen.queryByRole("link", { name: "Back to Sign In page" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Cookie Policy" })).toBeNull();

    // The legal copy itself is identical in both frames.
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).not.toBeNull();
    expect(screen.getByText("We do not sell your data.")).not.toBeNull();
  });

  it("keeps the signed-in frame while the session probe is still loading", () => {
    // Every legal route is reachable both ways, so while the probe is in flight
    // the page must not flash the public frame at someone signed in.
    useAuth.mockReturnValue(authState({ isAuthenticated: false, isLoading: true }));

    const { rerender } = render(
      <LegalPageShell title="License" isAuthenticatedHint>
        <p>MIT for the code.</p>
      </LegalPageShell>,
    );
    expect(
      screen.queryByRole("link", { name: "Back to Sign In page" }),
    ).toBeNull();
    expect(screen.getByText("MIT for the code.")).not.toBeNull();

    // Without the hint the same loading state is treated as signed out: the
    // hint is the route's say, not the shell's guess.
    rerender(
      <LegalPageShell title="License" isAuthenticatedHint={false}>
        <p>MIT for the code.</p>
      </LegalPageShell>,
    );
    expect(
      screen.getByRole("link", { name: "Back to Sign In page" }),
    ).not.toBeNull();
  });

  it("carries the page title in the header card in both frames", () => {
    const { container } = renderShell();
    const headerCard = container.querySelector("#header-card");
    expect(headerCard).not.toBeNull();
    expect(
      headerCard?.querySelector("h1")?.textContent,
    ).toBe("Privacy Policy");
    // The children live inside the same card, under the title, not after it.
    expect(headerCard?.contains(screen.getByText("We do not sell your data.")))
      .toBe(true);
  });
});
