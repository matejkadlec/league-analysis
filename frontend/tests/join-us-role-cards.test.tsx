// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JoinUsRoleCards } from "@/features/auth/components/join-us-role-cards";

// Static copy, but the commitments are what a candidate signs up against, so
// dropping one should be a noticed decision.

describe("JoinUsRoleCards", () => {
  it("presents all three ways to join as card headings", () => {
    render(<JoinUsRoleCards />);

    for (const title of ["Full-Stack Developer", "Beta Tester", "Other"]) {
      expect(screen.getByRole("heading", { name: title })).not.toBeNull();
    }
  });

  it("names each expectation block on the developer card", () => {
    render(<JoinUsRoleCards />);

    for (const heading of [
      "You must have experience with",
      "Nice to have experience with",
      "The real deal-breaker",
      "Why join us",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).not.toBeNull();
    }
  });

  it("spells out the commitment a candidate is agreeing to", () => {
    render(<JoinUsRoleCards />);

    expect(screen.getByText("You can contribute 5+ hours per week on average."))
      .not.toBeNull();
    expect(screen.getByText(/3\+ months/)).not.toBeNull();
    expect(
      screen.getByText(/only long-term \(3\+ months\) contributors are welcomed/),
    ).not.toBeNull();
    // Beta testing is deliberately held to a lighter term than developing.
    expect(
      screen.getByText(/long-term availability is welcome but not strictly required/),
    ).not.toBeNull();
  });

  it("lists every requirement as a bullet, and nothing else as one", () => {
    render(<JoinUsRoleCards />);

    // 2 must-have + 4 nice-to-have + 6 deal-breaker + 5 benefits on the
    // developer card, 5 + 3 on the beta card, 4 other-ideas bullets.
    expect(screen.getAllByRole("listitem")).toHaveLength(29);
  });

  it("points people who fit neither role at the contact form's Other option", () => {
    render(<JoinUsRoleCards />);

    // The instruction splits "Other" into its own highlighted span, so the
    // sentence is matched on the paragraph that carries it.
    expect(
      screen.getByText(/in the contact form below and describe how you would like/),
    ).not.toBeNull();
    expect(screen.getByText("Other", { selector: "span" })).not.toBeNull();
    expect(
      screen.getByText("UI/UX feedback, exploratory testing, and bug triage."),
    ).not.toBeNull();
  });
});
