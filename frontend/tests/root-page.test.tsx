// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The gate is not what this page is about; the landing content is.
vi.mock("@/features/auth", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import Home from "@/app/page";

describe("the landing page", () => {
  it("introduces the tool under its own name and branding", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "League Analysis" }),
    ).toBeTruthy();
    // The magnifier is the logo half of the title row; a missing or mislabeled
    // one is a broken landing, not a missing feature.
    expect(screen.getByAltText("Magnifier")).toBeTruthy();
    expect(
      screen.getByText(/Welcome to League Analysis - your all in one tool/),
    ).toBeTruthy();
  });

  it("states the roadmap as a planned-features list", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Planned Features" }),
    ).toBeTruthy();
    // Two headline bullets from different sections: the detection tool the
    // site exists to grow towards, and the per-user configuration promise.
    expect(screen.getByText("Smurfing/boosting detection tool.")).toBeTruthy();
    expect(
      screen.getByText(
        "Custom user configuration to cards where it's applicable.",
      ),
    ).toBeTruthy();
  });
});
