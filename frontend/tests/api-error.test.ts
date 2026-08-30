import axios, { type AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  apiErrorMessage,
  normalizeApiError,
} from "../lib/core/http/api-error";
import { playerTrackingFailureKind } from "../features/players/tracking-feedback";

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

describe("API error presentation", () => {
  it.each([
    [400, { detail: "Internal server error updating settings" }],
    [500, { detail: "SQLAlchemy stack trace at /api/v1/settings" }],
    [503, { message: "RiotAPIError: provider response included RGAPI-secret" }],
  ])("does not expose raw technical response text for HTTP %s", (status, data) => {
    const result = normalizeApiError(axiosError(status, data));

    expect(result.message).not.toMatch(
      /internal server|sqlalchemy|stack trace|\/api\/|riotapierror|rgapi-secret/i,
    );
  });

  it.each([
    ["a string detail", { detail: "Traceback (most recent call last)" }],
    ["a structured detail", { detail: { code: "sqlalchemy.exc.OperationalError" } }],
    ["a top-level field", { error_code: "at Object.<anonymous> (/app/main.py)" }],
  ])("refuses to carry %s through as an error code", (_label, data) => {
    // Widening `SAFE_CODE_PATTERN` to `/.*/` kept all 353 tests green. `code` is
    // the field callers branch on and `reportApiError` logs, so prose arriving in
    // it is the same leak the message pattern exists to stop.
    const { code } = normalizeApiError(axiosError(400, data));

    // The invariant is the shape, not one bad string: whatever reaches `code`
    // is a token this API defines, never text from a server it does not
    // control.
    expect(code).toMatch(/^[A-Z][A-Z0-9_]{1,63}$/);
  });

  it("preserves a typed validation message and structured lock metadata", () => {
    const result = normalizeApiError(
      axiosError(429, {
        detail: {
          code: "EMAIL_CHANGE_LOCKED",
          message: "Too many failed attempts. Try again in 5 minutes.",
          locked_until: "2026-08-12T22:00:00Z",
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "rate-limit",
      code: "EMAIL_CHANGE_LOCKED",
      message: "Too many failed attempts. Try again in 5 minutes.",
      details: {
        detail: { locked_until: "2026-08-12T22:00:00Z" },
      },
    });
  });

  it("recognizes an exact legacy string detail as an error code", () => {
    expect(
      normalizeApiError(
        axiosError(503, { detail: "RIOT_API_KEY_INVALID" }),
      ),
    ).toMatchObject({
      kind: "service",
      code: "RIOT_API_KEY_INVALID",
      message:
        "Riot data is temporarily unavailable. Please contact an administrator.",
    });
  });

  it("classifies the structured credential detail without exposing it", () => {
    const normalized = normalizeApiError(
      axiosError(503, {
        detail: {
          code: "RIOT_API_KEY_INVALID",
          message:
            "Riot data is temporarily unavailable. Please contact an administrator.",
        },
      }),
    );

    expect(normalized).toMatchObject({
      kind: "service",
      code: "RIOT_API_KEY_INVALID",
      message:
        "Riot data is temporarily unavailable. Please contact an administrator.",
    });
    expect(playerTrackingFailureKind(normalized)).toBe("api-key");
  });

  it("survives the array `detail` FastAPI returns for a 422", () => {
    // The only response body where `detail` is neither a string nor the
    // structured object: a list of per-field validation errors. A stricter
    // reader could throw out of `normalizeApiError`, which every path calls.
    expect(
      normalizeApiError(
        axiosError(422, {
          detail: [
            { loc: ["body", "x"], msg: "field required", type: "missing" },
          ],
        }),
      ),
    ).toMatchObject({ kind: "validation" });
  });

  it("classifies authentication, authorization, not-found and conflict paths", () => {
    expect(normalizeApiError(axiosError(401, {})).kind).toBe("authentication");
    expect(normalizeApiError(axiosError(403, {})).kind).toBe("authorization");
    expect(normalizeApiError(axiosError(404, { detail: "Player not found" }))).toMatchObject({
      kind: "not-found",
      message: "Player not found",
    });
    expect(normalizeApiError(axiosError(409, {})).kind).toBe("conflict");
  });

  it("names the player-lookup outcomes the selector words differently", () => {
    const kindOf = (status: number | undefined, body: unknown) =>
      playerTrackingFailureKind(normalizeApiError(axiosError(status, body)));

    expect(kindOf(404, { detail: "Player not found" })).toBe("not-found");
    expect(kindOf(429, {})).toBe("rate-limited");
    expect(kindOf(500, {})).toBe("unexpected");
    // A network failure carries no status at all and must not read as a
    // missing player, which would tell the viewer the Riot ID was wrong.
    expect(kindOf(undefined, undefined)).toBe("unexpected");
  });

  it("uses safe messages for network, timeout and invalid-response failures", () => {
    const network = normalizeApiError(axiosError(undefined, undefined));
    const timeout = normalizeApiError(
      axiosError(undefined, undefined, "ECONNABORTED"),
    );
    const invalidResponse = normalizeApiError(
      z.object({ id: z.number() }).safeParse({ id: "wrong" }).error,
    );

    expect(network).toMatchObject({ kind: "network", code: "NETWORK_ERROR" });
    expect(network.message).not.toContain("Failed to fetch");
    expect(timeout).toMatchObject({ kind: "timeout", code: "REQUEST_TIMEOUT" });
    expect(invalidResponse).toMatchObject({
      kind: "invalid-response",
      code: "INVALID_RESPONSE",
    });
  });

  it("keeps a backend message of exactly the length limit, and drops one over", () => {
    // 240 is the limit, so only these two lengths separate `>` from `>=`.
    // Over it the viewer gets the generic sentence instead of a wall of text.
    const atLimit = "a".repeat(240);
    const overLimit = "a".repeat(241);

    expect(normalizeApiError(axiosError(400, { detail: atLimit })).message).toBe(
      atLimit,
    );
    expect(
      normalizeApiError(axiosError(400, { detail: overLimit })).message,
    ).not.toContain("aaa");
  });

  it("reads a connect timeout as a timeout, not as an unknown failure", () => {
    // Axios reports a read timeout as ECONNABORTED and a connect timeout as
    // ETIMEDOUT. This error's message says nothing about time, so the branch
    // is the only thing that can classify it.
    const connectTimeout = normalizeApiError(
      axiosError(undefined, undefined, "ETIMEDOUT"),
    );

    expect(connectTimeout).toMatchObject({
      kind: "timeout",
      code: "REQUEST_TIMEOUT",
    });
  });

  it("uses a feature-specific fallback for unexpected and service failures", () => {
    const service = normalizeApiError(
      axiosError(500, { detail: "Internal server error" }),
    );

    expect(
      apiErrorMessage(
        service,
        "Player tracking could not be updated. Please try again later.",
      ),
    ).toBe("Player tracking could not be updated. Please try again later.");
  });
});
