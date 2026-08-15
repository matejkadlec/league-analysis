// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
}));

vi.mock("@/lib/core/api", () => ({
  api: { post: vi.fn() },
  validatedGet,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/core/data-dragon-context", () => ({
  useDDragonVersion: () => "16.1.1",
}));

vi.mock("@/lib/core/use-relative-time", () => ({
  useRelativeTime: () => "just now",
}));

import { MatchHistory } from "@/features/matches/components/match-history";
import {
  MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY,
  MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
} from "@/features/matches/match-history-preferences";
import { installMemoryLocalStorage } from "./test-browser-storage";

const CONSENT_COOKIE = "league_analysis_cookie_consent";

installMemoryLocalStorage();

function setOptionalConsent(): void {
  const value = encodeURIComponent(
    `v1|all|${new Date("2026-08-15T00:00:00Z").toISOString()}`,
  );
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/`;
}

function hasDetailedRequest(expectedParams: Record<string, unknown>): boolean {
  return validatedGet.mock.calls.some(
    ([, path, params]) =>
      path === "/matches/player/player-puuid/detailed" &&
      Object.entries(expectedParams).every(
        ([key, value]) => params?.[key] === value,
      ),
  );
}

function renderHistory(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MatchHistory puuid="player-puuid" />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("Match History controls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOptionalConsent();
    validatedGet.mockReset();
    validatedGet.mockImplementation(
      async (_schema: unknown, path: string) => ({
        success: true,
        data: path.endsWith("/stats")
          ? {
              puuid: "player-puuid",
              total_matches: 126,
              wins: 70,
              losses: 56,
              win_rate: 70 / 126,
              avg_kills: 7,
              avg_deaths: 5,
              avg_assists: 9,
              avg_kda: 3.2,
              avg_cs: 180,
              avg_vision_score: 22,
            }
          : {
              matches: [],
              total: 126,
              total_analyzed: 100,
              page: 0,
              size: 25,
              pages: 6,
            },
      }),
    );
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
  });

  it("composes queue unions, participant search, and numbered pages", async () => {
    const queryClient = renderHistory();
    const user = userEvent.setup();

    await screen.findByText("Showing 1 to 25 of 126 matches");
    const searchInput = screen.getByPlaceholderText(
      "Search for champion or player",
    );
    expect(searchInput.parentElement?.className).toContain("w-[230px]");
    expect(searchInput.className).toContain("h-7");
    expect(searchInput.className).toContain("border-white/15");
    expect(searchInput.className).toContain("bg-white/5");
    expect(searchInput.className).toContain("!text-xs");
    expect(searchInput.className).toContain("pl-8");
    expect(
      screen.getByText("126 total matches (70W / 56L) • 55.6% WR"),
    ).toBeTruthy();
    expect(hasDetailedRequest({ queues: "420", start: 0, count: 25 })).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: "Ranked Flex" }));
    await waitFor(() =>
      expect(hasDetailedRequest({ queues: "440", start: 0 })).toBe(true),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Ranked Solo/Duo" }),
      { shiftKey: true },
    );
    await waitFor(() =>
      expect(hasDetailedRequest({ queues: "420,440", start: 0 })).toBe(true),
    );
    expect(
      screen
        .getByRole("button", { name: "Ranked Solo/Duo" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Ranked Flex" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    await user.type(
      searchInput,
      "Ahri",
    );
    await waitFor(() =>
      expect(
        hasDetailedRequest({ queues: "420,440", search: "Ahri", start: 0 }),
      ).toBe(true),
    );

    const pagination = screen.getByRole("navigation", {
      name: "Match history pages",
    });
    const previousPage = within(pagination).getByRole("button", {
      name: "Previous page",
    }) as HTMLButtonElement;
    const nextPage = within(pagination).getByRole("button", {
      name: "Next page",
    }) as HTMLButtonElement;
    expect(previousPage.disabled).toBe(true);
    expect(nextPage.disabled).toBe(false);

    await user.click(nextPage);
    await waitFor(() =>
      expect(
        hasDetailedRequest({
          queues: "420,440",
          search: "Ahri",
          start: 25,
          count: 25,
        }),
      ).toBe(true),
    );
    await screen.findByText("Showing 26 to 50 of 126 matches");
    expect(previousPage.disabled).toBe(false);

    await user.click(
      screen.getByRole("combobox", { name: "Match history page size" }),
    );
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    await user.click(screen.getByRole("option", { name: "1000" }));
    await waitFor(() =>
      expect(
        hasDetailedRequest({
          queues: "420,440",
          search: "Ahri",
          start: 0,
          count: 1000,
        }),
      ).toBe(true),
    );
    await screen.findByText("Showing 1 to 126 of 126 matches");
    expect(previousPage.disabled).toBe(true);
    expect(nextPage.disabled).toBe(true);
    expect(
      window.localStorage.getItem(MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY),
    ).toBe("1000");
    expect(
      window.localStorage.getItem(MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY),
    ).toBe("[420,440]");

    queryClient.clear();
  });

  it("restores the saved page size and queue filter after remount", async () => {
    window.localStorage.setItem(MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY, "100");
    window.localStorage.setItem(
      MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
      "[440]",
    );
    const queryClient = renderHistory();

    await waitFor(() =>
      expect(hasDetailedRequest({ queues: "440", start: 0, count: 100 })).toBe(
        true,
      ),
    );
    expect(
      (
        await screen.findByRole("button", { name: "Ranked Flex" })
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("combobox", { name: "Match history page size" })
        .textContent,
    ).toContain("100");

    queryClient.clear();
  });
});
