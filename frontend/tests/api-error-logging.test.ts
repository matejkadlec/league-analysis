// @vitest-environment jsdom

import axios, { type AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { normalizeApiError, type ApiError } from "../lib/core/api-error";
import { reportApiError } from "../lib/core/api-error-logging";

function axiosError(
  status: number | undefined,
  data: unknown,
  code?: string,
): AxiosError {
  return new axios.AxiosError(
    code === "ECONNABORTED" ? "timeout of 30000ms exceeded" : "Request failed",
    code,
    undefined,
    undefined,
    status === undefined
      ? undefined
      : {
          data,
          status,
          statusText: "Error",
          headers: {},
          config: { headers: new axios.AxiosHeaders() },
        },
  );
}

function normalizedError(trigger: unknown): ApiError {
  return normalizeApiError(trigger);
}

describe("reportApiError", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it.each([
    ["unexpected", normalizedError(new Error("anything a call site threw"))],
    ["service", normalizedError(axiosError(500, { detail: "boom" }))],
    [
      "network",
      normalizedError(axiosError(undefined, undefined)),
    ],
    [
      "timeout",
      normalizedError(axiosError(undefined, undefined, "ECONNABORTED")),
    ],
  ])("records a developer-actionable %s failure", (_kind, apiError) => {
    reportApiError(apiError, { source: "query", key: '["x"]' });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "API error",
      expect.objectContaining({ kind: apiError.kind, source: "query" }),
    );
    // The scrubbed product message, not the raw axios one: the record is the
    // developer's only account of a failure the viewer already saw worded.
    const payload = consoleError.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.message).toBe(apiError.message);
  });

  it.each([
    ["validation", normalizedError(axiosError(422, { detail: "Pick a queue" }))],
    ["authentication", normalizedError(axiosError(401, {}))],
    ["authorization", normalizedError(axiosError(403, {}))],
    ["not-found", normalizedError(axiosError(404, { detail: "Player" }))],
    ["conflict", normalizedError(axiosError(409, {}))],
    ["rate-limit", normalizedError(axiosError(429, {}))],
    [
      "invalid-response",
      normalizedError(z.object({ id: z.number() }).safeParse({ id: "x" }).error),
    ],
  ])("stays silent for an expected %s flow", (_kind, apiError) => {
    reportApiError(apiError, { source: "mutation", key: '["x"]' });

    expect(consoleError).not.toHaveBeenCalled();
    // Silence read against a record that does arrive: "nothing was logged"
    // also holds for a reporter that logs nothing at all.
    reportApiError(normalizedError(new Error("boom")), { source: "mutation" });
    const records = consoleError.mock.calls as [string, { kind: string }][];
    expect(records.map(([, payload]) => payload.kind)).toEqual(["unexpected"]);
  });

  it("records a structured, secret-safe payload", () => {
    const apiError = normalizeApiError(
      axiosError(503, {
        error_code: "SERVICE_ERROR",
        message: "Internal server error at /api/v1/players",
      }),
    );

    reportApiError(apiError, {
      source: "mutation",
      key: '["start-matchmaking-analysis","puuid-1"]',
      url: "/matchmaking-analysis/start",
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const payload = consoleError.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual({
      kind: "service",
      status: 503,
      url: "/matchmaking-analysis/start",
      code: "SERVICE_ERROR",
      message:
        "The League Analysis service could not complete the request. Please try again later.",
      source: "mutation",
      key: '["start-matchmaking-analysis","puuid-1"]',
    });
  });

  it("never records the raw response body or error details", () => {
    const apiError = normalizeApiError(
      axiosError(500, {
        detail: {
          code: "SERVICE_ERROR",
          message: "psycopg.OperationalError: connection to postgres lost",
          rgapi: "RGAPI-secret-token",
        },
      }),
    );

    reportApiError(apiError, { source: "query" });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const payload = consoleError.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("details" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(
      /psycopg|postgres|rgapi|OperationalError/i,
    );
  });

  it("beacons a copy to the container without the query key", () => {
    const fetchMock = vi.mocked(fetch);
    reportApiError(normalizedError(new Error("transport died")), {
      source: "query",
      key: '["lane-stats","PNm-92VrUvdu-cj0KFhqs0_8dNV2g9DsQ2pObEKsJZum-3uISPmVr2xn2eI1ztzq10TJb9M-ZpdbdQ",420]',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = String(init.body);
    expect(body).not.toMatch(/PNm-|lane-stats/);
    expect(JSON.parse(body)).toEqual({
      kind: "api",
      message: "The request could not be completed. Please try again later.",
      source: "query",
      code: "UNKNOWN_ERROR",
    });
  });

  it("omits optional fields instead of recording undefined values", () => {
    reportApiError(normalizedError(new Error("transport died")), {
      source: "query",
    });

    const payload = consoleError.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "code",
      "kind",
      "message",
      "source",
      "status",
    ]);
  });
});
