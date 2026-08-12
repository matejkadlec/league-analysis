// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toaster } = vi.hoisted(() => ({ toaster: vi.fn() }));

vi.mock("sonner", () => ({
  Toaster: (props: {
    duration: number;
    icons: Record<string, ReactNode>;
    richColors: boolean;
    theme: string;
  }) => {
    toaster(props);
    return (
      <div>
        {Object.entries(props.icons).map(([variant, icon]) => (
          <span key={variant} data-testid={`${variant}-icon`}>
            {icon}
          </span>
        ))}
      </div>
    );
  },
}));

import { ToastHost } from "../components/toast-host";

describe("ToastHost", () => {
  afterEach(() => cleanup());

  it("provides the exact semantic Lucide icons for all shared variants", () => {
    render(<ToastHost />);

    expect(toaster).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: 4000,
        richColors: true,
        position: "top-right",
        theme: "system",
      }),
    );
    expect(screen.getByTestId("success-icon").innerHTML).toContain("circle-check-big");
    expect(screen.getByTestId("warning-icon").innerHTML).toContain("triangle-alert");
    expect(screen.getByTestId("error-icon").innerHTML).toContain("circle-x");
    expect(screen.getByTestId("info-icon").innerHTML).toContain("info");
  });
});
