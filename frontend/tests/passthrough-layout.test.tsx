// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PassthroughLayout } from "@/components/passthrough-layout";

describe("PassthroughLayout", () => {
  it("mounts the route's children without wrapping them in anything", () => {
    // The layout's whole job is to be nothing: it exists only so each client
    // page can export `metadata` from a server parent. A wrapper div here --
    // the tempting "fix" -- would break every direct-child selector under it.
    const { container } = render(
      <PassthroughLayout>
        <section>
          <h1>Terms of Service</h1>
        </section>
      </PassthroughLayout>,
    );

    expect(container.childElementCount).toBe(1);
    const only = container.firstElementChild;
    expect(only?.tagName).toBe("SECTION");
    expect(only?.textContent).toBe("Terms of Service");
  });

  it("keeps every child, not just the first", () => {
    const { container } = render(
      <PassthroughLayout>
        <p>first route node</p>
        <p>second route node</p>
      </PassthroughLayout>,
    );

    expect(container.childElementCount).toBe(2);
    expect(container.children[1]?.textContent).toBe("second route node");
  });
});
