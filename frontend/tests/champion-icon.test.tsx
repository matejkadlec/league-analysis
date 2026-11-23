// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A pass-through <img> so the src and the onError fallback are observable;
// the real next/image needs a loader jsdom does not have.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError?: () => void;
  }) => (
    // oxlint-disable-next-line next/no-img-element
    <img src={src} alt={alt} onError={onError} />
  ),
}));

import { ChampionIcon } from "@/components/champion-icon";

describe("ChampionIcon", () => {
  it("loads the Data Dragon icon under the champion's public name", () => {
    render(
      <ChampionIcon championName="MonkeyKing" ddragonVersion="16.22.1" sizes="52px" />,
    );

    const icon = screen.getByRole("img", { name: "Wukong" });
    expect(icon.getAttribute("src")).toMatch(/\/img\/champion\/MonkeyKing\.png$/);
  });

  it("falls back to a placeholder tile when the image fails", () => {
    // LGA-117: a broken icon showed the browser's broken-image glyph.
    const { container } = render(
      <ChampionIcon championName="Zed" ddragonVersion="16.22.1" sizes="24px" />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Zed" }));

    expect(container.querySelector("img")).toBeNull();
    const placeholder = screen.getByRole("img", { name: "Zed" });
    expect(placeholder.textContent).toBe("Z");
  });

  it("tries again when it is given another champion", () => {
    const { rerender } = render(
      <ChampionIcon championName="Zed" ddragonVersion="16.22.1" sizes="24px" />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Zed" }));

    rerender(
      <ChampionIcon championName="Ahri" ddragonVersion="16.22.1" sizes="24px" />,
    );

    expect(
      screen.getByRole("img", { name: "Ahri" }).getAttribute("src"),
    ).toMatch(/\/Ahri\.png$/);
  });
});
