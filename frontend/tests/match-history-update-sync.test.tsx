// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Api = typeof import("@/lib/core/api");
type AppToast = typeof import("@/lib/core/hooks").appToast;
type AppRouter = ReturnType<typeof import("next/navigation").useRouter>;

const { validatedGet, validatedPost } = vi.hoisted(() => ({
  validatedGet: vi.fn<Api["validatedGet"]>(),
  validatedPost: vi.fn<Api["validatedPost"]>(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: vi.fn<AppToast["error"]>(),
    info: vi.fn<AppToast["info"]>(),
    warning: vi.fn<AppToast["warning"]>(),
    success: vi.fn<AppToast["success"]>(),
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

import type { ComponentProps } from "react";

import { MatchHistory } from "@/features/matches/components/match-history";
import { installMemoryLocalStorage } from "./support/test-browser-storage";

type SelectPlayer = ComponentProps<typeof MatchHistory>["onSelectPlayer"];

installMemoryLocalStorage();

const EMPTY_HISTORY = {
  matches: [],
  total: 0,
  total_analyzed: 0,
  page: 1,
  page_size: 25,
};

function renderHistory(): void {
  renderWithQueryClient(
    <MatchHistory
      puuid="player-puuid"
      onSelectPlayer={vi.fn<SelectPlayer>()}
    />,
  );
}

const RUN_TIMESTAMPS = {
  created_at: "2026-08-16T10:00:00Z",
  updated_at: "2026-08-16T10:00:00Z",
};

function syncPaths(): string[] {
  return validatedGet.mock.calls
    .map((call) => String(call[1]))
    .filter(
      (path) => path.includes("/sync/") && !path.endsWith("/sync/active"),
    );
}

describe("Match History update", () => {
  beforeEach(() => {
    window.localStorage.clear();
    validatedGet.mockReset();
    validatedPost.mockReset();
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/sync/active")) {
        return { success: true, data: null };
      }
      if (path.includes("/sync/")) {
        return {
          success: true,
          data: { id: 7, puuid: "p", status: "running", ...RUN_TIMESTAMPS },
        };
      }
      return { success: true, data: EMPTY_HISTORY };
    });
    validatedPost.mockResolvedValue({
      success: true,
      data: {
        id: 7,
        puuid: "player-puuid",
        status: "pending",
        ...RUN_TIMESTAMPS,
      },
    });
  });


  it("starts the trackable run rather than the untracked jobs route", async () => {
    const user = userEvent.setup();
    renderHistory();

    const button = await screen.findByRole("button", { name: /update/i });
    await user.click(button);

    // The jobs route returns only `{success, message}`, which is why the old
    // code had to guess at a delay. This one returns a run to watch.
    await waitFor(() => expect(validatedPost).toHaveBeenCalled());
    expect(validatedPost).toHaveBeenCalledWith(
      expect.anything(),
      "/players/player-puuid/sync",
    );
    // And the run it answered with is adopted: a response with nothing to
    // watch leaves the button live again the moment the request settles.
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
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

  it("adopts an in-flight run after a reload instead of losing it", async () => {
    // Before the shared usePlayerSyncRun hook, this surface kept the run id
    // in local state only, so a reload mid-sync re-enabled the button with
    // the run still going.
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/sync/active")) {
        return {
          success: true,
          data: { id: 9, puuid: "p", status: "running", ...RUN_TIMESTAMPS },
        };
      }
      if (path.includes("/sync/")) {
        return {
          success: true,
          data: { id: 9, puuid: "p", status: "running", ...RUN_TIMESTAMPS },
        };
      }
      return { success: true, data: EMPTY_HISTORY };
    });
    renderHistory();

    const button = await screen.findByRole("button", { name: /update/i });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
    await waitFor(() =>
      expect(syncPaths()).toContain("/players/player-puuid/sync/9"),
    );
    expect(validatedPost).not.toHaveBeenCalled();
  });
});
