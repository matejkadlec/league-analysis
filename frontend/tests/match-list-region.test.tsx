// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, screen } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AppToast = typeof import("@/lib/core/hooks").appToast;
type AppRouter = ReturnType<typeof import("next/navigation").useRouter>;

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn<typeof import("@/lib/core/http/api").validatedGet>(),
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: vi.fn<AppToast["error"]>(),
    info: vi.fn<AppToast["info"]>(),
    warning: vi.fn<AppToast["warning"]>(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn<AppRouter["refresh"]>() }),
}));

vi.mock("@/lib/core/riot/data-dragon-context", () => ({
  useDDragonVersion: () => "16.1.1",
}));

vi.mock("@/lib/core/hooks/use-relative-time", () => ({
  useRelativeTime: () => "just now",
}));

// The rows themselves are not the subject; the container around them is.
// Stubbing them keeps this test off a 40-field match fixture while leaving
// the real `match-history.tsx` -- where the conditional lives -- under test.
vi.mock("@/features/matches/components/match-row", () => ({
  MatchRow: () => <div data-testid="match-row" />,
}));

import { MatchHistory } from "@/features/matches/components/match-history";
import { installMemoryLocalStorage } from "./support/test-browser-storage";

type MatchHistoryProps = ComponentProps<typeof MatchHistory>;

const CONSENT_COOKIE = "league_analysis_cookie_consent";

installMemoryLocalStorage();

// The detailed-matches query is gated on stored preferences being ready,
// which is gated on optional-storage consent.
function setOptionalConsent(): void {
  const value = encodeURIComponent(
    `v1|all|${new Date("2026-08-15T00:00:00Z").toISOString()}`,
  );
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/`;
}

// The list scrolls sideways only from `lg` up, so only there does it need to be
// a named keyboard-reachable region. These render the real `MatchHistory`; a
// local copy of the JSX would survive the revert they exist to catch.

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

async function renderHistory(): Promise<void> {
  renderWithQueryClient(
    <MatchHistory
      puuid="player-puuid"
      onSelectPlayer={vi.fn<MatchHistoryProps["onSelectPlayer"]>()}
    />,
  );
  await screen.findByTestId("match-list", undefined, { timeout: 4000 });
}

describe("the match list scroll region", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOptionalConsent();
    validatedGet.mockReset();
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => ({
      success: true,
      data: path.endsWith("/stats")
        ? {
            puuid: "player-puuid",
            total_matches: 1,
            wins: 1,
            losses: 0,
            win_rate: 1,
            avg_kills: 7,
            avg_deaths: 5,
            avg_assists: 9,
            avg_kda: 3.2,
            avg_cs: 180,
            avg_vision_score: 22,
          }
        : {
            matches: [{ match_id: "EUN1_1" }],
            total: 1,
            total_analyzed: 1,
            page: 0,
            size: 25,
            pages: 1,
          },
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
  });

  it("is a keyboard-reachable named region at the width it scrolls at", async () => {
    stubMatchMedia(true);
    await renderHistory();

    const region = screen.getByRole("region", { name: "Match list" });
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("is no region and no focus stop at the widths it cannot scroll", async () => {
    stubMatchMedia(false);
    await renderHistory();

    expect(screen.queryByRole("region")).toBeNull();
    expect(
      screen.getByTestId("match-list").getAttribute("tabindex"),
    ).toBeNull();
  });
});
