// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet, post } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/core/api", () => ({
  api: { post },
  validatedGet,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
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
import { installMemoryLocalStorage } from "./test-browser-storage";

installMemoryLocalStorage();

const EMPTY_HISTORY = {
  matches: [],
  total: 0,
  total_analyzed: 0,
  page: 1,
  page_size: 25,
};

function renderHistory(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MatchHistory puuid="player-puuid" />
    </QueryClientProvider>,
  );
}

const RUN_TIMESTAMPS = {
  created_at: "2026-08-16T10:00:00Z",
  updated_at: "2026-08-16T10:00:00Z",
};

function syncPaths(): string[] {
  return validatedGet.mock.calls
    .map((call) => String(call[1]))
    .filter((path) => path.includes("/sync/"));
}

describe("Match History update", () => {
  beforeEach(() => {
    window.localStorage.clear();
    validatedGet.mockReset();
    post.mockReset();
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.includes("/sync/")) {
        return {
          success: true,
          data: { id: 7, puuid: "p", status: "running", ...RUN_TIMESTAMPS },
        };
      }
      return { success: true, data: EMPTY_HISTORY };
    });
    post.mockResolvedValue({
      data: {
        id: 7,
        puuid: "player-puuid",
        status: "pending",
        ...RUN_TIMESTAMPS,
      },
    });
  });

  afterEach(() => cleanup());

  it("starts the trackable run rather than the untracked jobs route", async () => {
    const user = userEvent.setup();
    renderHistory();

    await user.click(await screen.findByRole("button", { name: /update/i }));

    // The jobs route returns only `{success, message}`, which is why the old
    // code had to guess at a delay. This one returns a run to watch.
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/players/player-puuid/sync");
  });

  it("polls the run it started instead of waiting a fixed delay", async () => {
    const user = userEvent.setup();
    renderHistory();

    await user.click(await screen.findByRole("button", { name: /update/i }));

    // The previous implementation refetched behind `setTimeout(..., 5000)` and
    // never read the run at all, so this request is the whole point of the
    // change: with no timers advanced, the run must already be under way.
    await waitFor(() => expect(syncPaths().length).toBeGreaterThan(0));
    expect(syncPaths()[0]).toBe("/players/player-puuid/sync/7");
  });

  it("keeps the button disabled while the run is still going", async () => {
    const user = userEvent.setup();
    renderHistory();

    const button = await screen.findByRole("button", { name: /update/i });
    await user.click(button);

    await waitFor(() => expect(syncPaths().length).toBeGreaterThan(0));
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
