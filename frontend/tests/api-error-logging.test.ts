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
  });

  afterEach(() => {
    consoleError.mockRestore();
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
