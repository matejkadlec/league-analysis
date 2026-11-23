// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageSections, Section, SectionRow } from "@/components/page-sections";

/**
 * The page-layout primitive (LGA-152). Geometry needs a browser and is
 * measured by `e2e/page-layout.spec.ts`; these pin the structure that
 * geometry is built from.
 */
describe("the page sections layout", () => {
  it("gives every card in a row its own stretched slot, skipping absent ones", () => {
    // Pages render cards conditionally, and an empty slot would hold a line's
    // second column open for a card that is not there.
    const showSecond = false;
    const { container } = render(
      <PageSections>
        <SectionRow>
          <div>first</div>
          {showSecond && <div>second</div>}
          {null}
          <div>third</div>
        </SectionRow>
      </PageSections>,
    );

    const slots = container.querySelectorAll(
      "[data-layout='section-row'] > [data-layout='section-slot']",
    );
    expect([...slots].map((slot) => slot.textContent)).toEqual([
      "first",
      "third",
    ]);
  });

  it("keeps a half-width section to one column's width, and a full one to the line", () => {
    const { container } = render(
      <PageSections>
        <Section width="half">form</Section>
        <Section>list</Section>
      </PageSections>,
    );

    const [half, full] = container.querySelectorAll("[data-layout='section']");
    expect(half!.getAttribute("data-width")).toBe("half");
    expect(half!.className).toMatch(/w-\[calc\(50%-/);
    expect(full!.getAttribute("data-width")).toBe("full");
    expect(full!.className).not.toMatch(/w-\[/);
  });
});
