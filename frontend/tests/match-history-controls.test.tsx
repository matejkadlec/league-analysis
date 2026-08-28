// @vitest-environment jsdom

import type { ComponentProps } from "react";
import axios from "axios";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AppToast = typeof import("@/lib/core/hooks").appToast;
type AppRouter = ReturnType<typeof import("next/navigation").useRouter>;

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn<typeof import("@/lib/core/api").validatedGet>(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
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

vi.mock("@/lib/core/data-dragon-context", () => ({
  useDDragonVersion: () => "16.1.1",
}));

vi.mock("@/lib/core/use-relative-time", () => ({
  useRelativeTime: () => "just now",
}));

import { MatchHistory } from "@/features/matches/components/match-history";
import {
} from "@/features/matches/match-history-preferences";
import {
  MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY,
  MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
} from "@/features/cookie-consent";
import { installMemoryLocalStorage } from "./support/test-browser-storage";

type MatchHistoryProps = ComponentProps<typeof MatchHistory>;

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
    ([, path, options]) =>
      path === "/matches/player/player-puuid/detailed" &&
      Object.entries(expectedParams).every(
        ([key, value]) => options?.params?.[key] === value,
      ),
  );
}

function renderHistory() {
  return renderWithQueryClient(
    <MatchHistory
      puuid="player-puuid"
      onSelectPlayer={vi.fn<MatchHistoryProps["onSelectPlayer"]>()}
    />,
  ).queryClient;
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

  it("reports a failed load inline, and retries when asked", async () => {
    // This query sets `silenceErrorToast`, so the card below is the only thing
    // telling the viewer anything went wrong. The network-shaped rejection also
    // pins the component's own `retry` predicate.
    const networkFailure = new axios.AxiosError("Network Error");
    validatedGet.mockReset();
    validatedGet.mockRejectedValue(networkFailure);

    const queryClient = renderHistory();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(
      screen.queryByText("Showing 1 to 25 of 126 matches"),
    ).toBeNull();

    validatedGet.mockClear();
    fireEvent.click(retry);

    await waitFor(() => expect(validatedGet).toHaveBeenCalled());

    queryClient.clear();
  });

  it("caps what the search box will hold", async () => {
    // 64 characters. Without the cap every keystroke past it still re-renders
    // and, after the debounce, becomes a query parameter -- an unbounded
    // string from the viewer straight into a request URL.
    const queryClient = renderHistory();

    await screen.findByText("Showing 1 to 25 of 126 matches");
    const searchInput = screen.getByPlaceholderText(
      "Search for champion or player",
    ) as HTMLInputElement;

    fireEvent.change(searchInput, { target: { value: "x".repeat(200) } });

    expect(searchInput.value).toHaveLength(64);

    queryClient.clear();
  });

  it("debounces server-backed search requests while typing", async () => {
    const queryClient = renderHistory();

    await screen.findByText("Showing 1 to 25 of 126 matches");
    validatedGet.mockClear();

    const searchInput = screen.getByPlaceholderText(
      "Search for champion or player",
    );
    fireEvent.change(searchInput, { target: { value: "A" } });
    fireEvent.change(searchInput, { target: { value: "Ah" } });
    fireEvent.change(searchInput, { target: { value: "Ahri" } });

    expect(
      validatedGet.mock.calls.filter(
        ([, path, options]) =>
          path === "/matches/player/player-puuid/detailed" &&
          options?.params?.search,
      ),
    ).toHaveLength(0);

    await waitFor(() =>
      expect(
        hasDetailedRequest({
          queues: "420",
          search: "Ahri",
          start: 0,
          count: 25,
        }),
      ).toBe(true),
    );
    expect(
      validatedGet.mock.calls
        .filter(
          ([, path, options]) =>
            path === "/matches/player/player-puuid/detailed" &&
            options?.params?.search,
        )
        .map(([, , options]) => options?.params?.search),
    ).toEqual(["Ahri"]);

    queryClient.clear();
  });
});
