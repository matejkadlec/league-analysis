import type { AxiosAdapter, AxiosRequestConfig } from "axios";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/core/riot-credential-health-events", () => ({
  notifyRiotCredentialHealthUpdated: vi.fn(),
}));
vi.mock("@/features/auth/utils/token-manager", () => ({
  refreshAccessToken: vi.fn().mockResolvedValue({ outcome: "refused" }),
}));

import {
  cancelMatchmakingAnalysis,
  deleteMatchmakingAnalysisRecord,
  getLatestCompletedMatchmakingAnalysis,
  getLatestMatchmakingAnalysis,
  getMatchmakingAnalysisHistory,
  getMatchmakingAnalysisStatus,
  startMatchmakingAnalysis,
} from "@/features/matchmaking/matchmaking-api";
import {
  discoverPlayer,
  searchPlayerSuggestions,
  trackPlayer,
  untrackPlayer,
} from "@/features/players/player-api";
import { api } from "@/lib/core/api";

// The wire shape per function. The backend's test_frontend_api_paths.py proves
// every (path, method) pair; what nothing else checks is query parameter names,
// the request body, and URL-versus-`params`.

const originalAdapter = api.defaults.adapter;

let seen: AxiosRequestConfig[] = [];

const adapter: AxiosAdapter = async (config) => {
  seen.push(config);
  // An empty object fails every schema; these tests assert the request that
  // went out, not the response handling `api.ts`'s own suite already covers.
  return { data: {}, status: 200, statusText: "", headers: {}, config };
};

beforeEach(() => {
  seen = [];
  api.defaults.adapter = adapter;
  // The empty response body fails validation by design; keep the log quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  if (originalAdapter === undefined) {
    delete api.defaults.adapter;
  } else {
    api.defaults.adapter = originalAdapter;
  }
});

function request() {
  expect(seen).toHaveLength(1);
  return seen[0]!;
}

describe("player-api wire shapes", () => {
  it("tracks over POST and untracks over DELETE on the same route", async () => {
    // The two halves of one toggle differ only in the verb. Crossed, the
    // track button untracks — and the path test cannot see it, because both
    // (path, method) pairs are registered routes.
    await trackPlayer("p-1");
    await untrackPlayer("p-1");

    expect(seen.map((r) => [r.method, r.url])).toEqual([
      ["post", "/players/p-1/track"],
      ["delete", "/players/p-1/track"],
    ]);
  });

  it("sends only the search params the caller gave", async () => {
    // `platform` and `limit` are spread conditionally. axios drops an
    // `undefined` param anyway — the real risk is a typo'd key (`platform_` ),
    // silently ignored by the server so the search spans the wrong platform.
    await searchPlayerSuggestions({ q: "faker" });

    expect(request().params).toEqual({ q: "faker" });
  });

  it("forwards platform and limit when the caller sets them", async () => {
    await searchPlayerSuggestions({ q: "faker", platform: "eun1", limit: 3 });

    expect(request().params).toEqual({ q: "faker", platform: "eun1", limit: 3 });
  });

  it("puts discover's arguments on the query string, not in a body", async () => {
    // The endpoint reads the query string; a body would 422. The names must
    // be the backend's snake_case exactly.
    await discoverPlayer({
      game_name: "Hide on bush",
      tag_line: "KR1",
      platform: "eun1",
    });

    expect(request().method).toBe("post");
    expect(request().url).toBe("/players/discover");
    expect(request().params).toEqual({
      game_name: "Hide on bush",
      tag_line: "KR1",
      platform: "eun1",
    });
    expect(request().data).toBeUndefined();
  });
});

describe("matchmaking-api wire shapes", () => {
  it("starts an analysis with the puuid in the body", async () => {
    await startMatchmakingAnalysis("p-1");

    expect(request().method).toBe("post");
    expect(request().url).toBe("/matchmaking-analysis/start");
    expect(request().data).toBe(JSON.stringify({ puuid: "p-1" }));
  });

  it("asks for status with the created_at the row is keyed by", async () => {
    // `created_at` identifies *which* analysis. Dropped or renamed, the
    // backend answers 422 — or worse, a default — and polling watches the
    // wrong run.
    await getMatchmakingAnalysisStatus("p-1", "2026-08-19T10:00:00Z");

    expect(request().url).toBe("/matchmaking-analysis/player/p-1/status");
    expect(request().params).toEqual({ created_at: "2026-08-19T10:00:00Z" });
  });

  it("keeps latest and latest-completed as two different routes", async () => {
    // One shows the run in flight, the other the last finished result. Wired
    // to the same route, the results page renders a half-done analysis.
    await getLatestMatchmakingAnalysis("p-1");
    await getLatestCompletedMatchmakingAnalysis("p-1");

    expect(seen.map((r) => r.url)).toEqual([
      "/matchmaking-analysis/player/p-1",
      "/matchmaking-analysis/player/p-1/latest-completed",
    ]);
  });

  it("passes the history limit through, defaulting to 20", async () => {
    await getMatchmakingAnalysisHistory("p-1");
    await getMatchmakingAnalysisHistory("p-1", 5);

    expect(seen.map((r) => r.params)).toEqual([{ limit: 20 }, { limit: 5 }]);
    expect(seen[0]?.url).toBe("/matchmaking-analysis/player/p-1/history");
  });

  it("cancels and deletes with created_at as a query parameter", async () => {
    await cancelMatchmakingAnalysis("p-1", "2026-08-19T10:00:00Z");
    await deleteMatchmakingAnalysisRecord("p-1", "2026-08-19T10:00:00Z");

    expect(seen.map((r) => [r.method, r.url, r.params])).toEqual([
      [
        "delete",
        "/matchmaking-analysis/player/p-1/cancel",
        { created_at: "2026-08-19T10:00:00Z" },
      ],
      [
        "delete",
        "/matchmaking-analysis/player/p-1/analysis",
        { created_at: "2026-08-19T10:00:00Z" },
      ],
    ]);
  });
});
