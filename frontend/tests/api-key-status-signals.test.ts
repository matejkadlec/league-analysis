import type { AxiosAdapter } from "axios";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { notifyApiKeyInvalid, notifyApiKeyValid } = vi.hoisted(() => ({
  notifyApiKeyInvalid: vi.fn(),
  notifyApiKeyValid: vi.fn(),
}));

vi.mock("@/lib/core/api-key-status-context", () => ({
  notifyApiKeyInvalid,
  notifyApiKeyValid,
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

describe("Riot API key lifecycle signals", () => {
  beforeEach(() => {
    notifyApiKeyInvalid.mockReset();
    notifyApiKeyValid.mockReset();
    api.defaults.adapter = responseAdapter;
    responseData = null;
  });

  afterAll(() => {
    api.defaults.adapter = originalAdapter;
  });

  it("does not treat accepting or polling an active analysis as key validation", async () => {
    responseData = { status: "pending", error_code: null };
    await api.post("/matchmaking-analysis/start", { puuid: "test-puuid" });

    responseData = { status: "in_progress", error_code: null };
    await api.get("/matchmaking-analysis/player/test-puuid/status");

    expect(notifyApiKeyInvalid).not.toHaveBeenCalled();
    expect(notifyApiKeyValid).not.toHaveBeenCalled();
  });

  it("marks a persisted invalid-key failure returned with HTTP 200", async () => {
    responseData = {
      status: "failed",
      error_code: "RIOT_API_KEY_INVALID",
    };

    await api.get("/matchmaking-analysis/player/test-puuid/status");

    expect(notifyApiKeyInvalid).toHaveBeenCalledTimes(1);
    expect(notifyApiKeyValid).not.toHaveBeenCalled();
  });

  it("marks only exact current-run completion as successful validation", async () => {
    responseData = { status: "completed", error_code: null };
    await api.get("/matchmaking-analysis/player/test-puuid/status");

    expect(notifyApiKeyValid).toHaveBeenCalledTimes(1);
    expect(notifyApiKeyInvalid).not.toHaveBeenCalled();

    notifyApiKeyValid.mockReset();
    await api.get("/matchmaking-analysis/player/test-puuid/latest-completed");
    expect(notifyApiKeyValid).not.toHaveBeenCalled();
  });
});
