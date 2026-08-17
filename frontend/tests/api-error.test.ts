import axios, { type AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  apiErrorMessage,
  normalizeApiError,
} from "../lib/core/api-error";
import { playerTrackingFailureKind } from "../features/players/utils/tracking-feedback";

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
