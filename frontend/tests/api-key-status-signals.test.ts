import type { AxiosAdapter } from "axios";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { notifyRiotCredentialHealthUpdated } = vi.hoisted(() => ({
  notifyRiotCredentialHealthUpdated: vi.fn(),
}));

vi.mock("@/lib/core/riot-credential-health-events", () => ({
  notifyRiotCredentialHealthUpdated,
}));

import { api } from "../lib/core/api";

const originalAdapter = api.defaults.adapter;
let responseData: unknown;

const responseAdapter: AxiosAdapter = async (config) => ({
  data: responseData,
  status: 200,
  statusText: "OK",
  headers: {},
  config,
});

describe("Riot credential-health refresh signals", () => {
  beforeEach(() => {
    notifyRiotCredentialHealthUpdated.mockReset();
    api.defaults.adapter = responseAdapter;
    responseData = null;
  });

  afterAll(() => {
    // `adapter` is an optional property: restoring "absent" means deleting it,
    // not assigning `undefined`.
    if (originalAdapter === undefined) {
      delete api.defaults.adapter;
    } else {
      api.defaults.adapter = originalAdapter;
    }
  });

  it("does not treat accepting or polling an active analysis as key validation", async () => {
    responseData = { status: "pending", error_code: null };
    await api.post("/matchmaking-analysis/start", { puuid: "test-puuid" });

    responseData = { status: "in_progress", error_code: null };
    await api.get("/matchmaking-analysis/player/test-puuid/status");

    expect(notifyRiotCredentialHealthUpdated).not.toHaveBeenCalled();
  });

  it("marks a persisted invalid-key failure returned with HTTP 200", async () => {
    responseData = {
      status: "failed",
      error_code: "RIOT_API_KEY_INVALID",
    };

    await api.get("/matchmaking-analysis/player/test-puuid/status");

    expect(notifyRiotCredentialHealthUpdated).toHaveBeenCalledTimes(1);
  });

  it("does not infer validity from completed or cached local work", async () => {
    responseData = { status: "completed", error_code: null };
    await api.get("/matchmaking-analysis/player/test-puuid/status");

    await api.get("/matchmaking-analysis/player/test-puuid/latest-completed");
    await api.get("/players/suggestions?q=cached-player");

    expect(notifyRiotCredentialHealthUpdated).not.toHaveBeenCalled();
  });
});
