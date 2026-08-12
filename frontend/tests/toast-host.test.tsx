// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  toaster: vi.fn(),
  toast: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => {
  const toast = Object.assign(sonner.toast, {
    success: sonner.success,
    warning: sonner.warning,
    error: sonner.error,
    info: sonner.info,
    dismiss: sonner.dismiss,
  });

  return {
    toast,
    Toaster: (props: {
      duration: number;
      icons: Record<string, ReactNode>;
      richColors: boolean;
      theme: string;
    }) => {
      sonner.toaster(props);
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
  };
});

import { ToastHost } from "../components/toast-host";

describe("ToastHost", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("provides the exact semantic Lucide icons for all shared variants", () => {
    render(<ToastHost />);

    expect(sonner.toaster).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: 4000,
        richColors: true,
        position: "top-right",
        theme: "system",
      }),
    );
    expect(screen.getByTestId("success-icon").innerHTML).toContain(
      "circle-check-big",
    );
    expect(screen.getByTestId("success-icon").innerHTML).toContain(
      "text-[#166534]",
    );
    expect(screen.getByTestId("warning-icon").innerHTML).toContain(
      "triangle-alert",
    );
    expect(screen.getByTestId("warning-icon").innerHTML).toContain(
      "text-[#854d0e]",
    );
    expect(screen.getByTestId("error-icon").innerHTML).toContain("circle-x");
    expect(screen.getByTestId("error-icon").innerHTML).toContain(
      "text-[#991b1b]",
    );
    expect(screen.getByTestId("info-icon").innerHTML).toContain("info");
    expect(screen.getByTestId("info-icon").innerHTML).toContain(
      "text-[#1e3a8a]",
    );
  });

  it("accepts development preview events through the shared toast adapter", () => {
    render(<ToastHost />);

    window.dispatchEvent(
      new CustomEvent("league-analysis:toast", {
        detail: {
          variant: "success",
          title: "Sample success",
          description: "The operation finished.",
          duration: 4000,
        },
      }),
    );

    expect(sonner.success).toHaveBeenCalledWith("Sample success", {
      description: "The operation finished.",
      duration: 4000,
    });
  });
});
