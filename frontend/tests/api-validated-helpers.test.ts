import type { AxiosAdapter, AxiosRequestConfig } from "axios";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

const { notifyRiotCredentialHealthUpdated, refreshAccessToken } = vi.hoisted(
  () => ({
    notifyRiotCredentialHealthUpdated:
      vi.fn<
        typeof import("@/lib/core/riot-credential-health-events").notifyRiotCredentialHealthUpdated
      >(),
    refreshAccessToken:
      vi.fn<
        typeof import("@/lib/session/token-manager").refreshAccessToken
      >(),
  }),
);

vi.mock("@/lib/core/riot-credential-health-events", () => ({
  notifyRiotCredentialHealthUpdated,
}));

vi.mock("@/lib/session/token-manager", () => ({ refreshAccessToken }));

import {
  api,
  unwrap,
  validatedDelete,
  validatedGet,
  validatedPatch,
  validatedPost,
  validatedPut,
} from "@/lib/core/api";
import { ApiRequestError } from "@/lib/core/api-error";

const Schema = z.object({ id: z.number() });

const originalAdapter = api.defaults.adapter;

/** Every request the adapter saw, so the wrappers' own wiring is observable. */
let seen: AxiosRequestConfig[] = [];
let reply: { status: number; data: unknown } = { status: 200, data: { id: 1 } };

const adapter: AxiosAdapter = async (config) => {
  seen.push(config);
  const response = {
    data: reply.data,
    status: reply.status,
    statusText: "",
    headers: {},
    config,
  };
  if (reply.status >= 400) {
    const error = new Error("request failed") as Error & {
      isAxiosError: boolean;
      response: typeof response;
      config: typeof config;
    };
    error.isAxiosError = true;
    error.response = response;
    error.config = config;
    throw error;
  }
  return response;
};

beforeEach(() => {
  seen = [];
  reply = { status: 200, data: { id: 1 } };
  notifyRiotCredentialHealthUpdated.mockReset();
  refreshAccessToken.mockReset();
  refreshAccessToken.mockResolvedValue({ outcome: "refused" });
  api.defaults.adapter = adapter;
});

// `vi.spyOn` on an already-spied method returns the existing spy rather than a
// fresh one, so without this a call-count assertion sees the previous test's
// calls as well as its own. That is how the console-error test first failed.
afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  // `adapter` is optional: restoring "absent" means deleting it.
  if (originalAdapter === undefined) {
    delete api.defaults.adapter;
  } else {
    api.defaults.adapter = originalAdapter;
  }
});

describe("the validated request helpers", () => {
  it("refuses a payload the schema rejects instead of passing it through", async () => {
    // The single guard the module exists for. Returning the parsed value or
    // the raw one is indistinguishable on a valid payload -- same object -- so
    // only an invalid one separates a check from unvalidated server data.
    vi.spyOn(console, "error").mockImplementation(() => {});
    reply = { status: 200, data: { id: "not a number", secret: "leak" } };

    const result = await validatedGet(Schema, "/players/context");

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("data");
  });

  it("logs which field failed without logging what was in it", async () => {
    // A rejected payload is server data that broke its contract, so it is the
    // one most likely to hold something that should not be logged. The url and
    // the issue paths identify the break without it.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // The nested failure is why `issue.path.join(".")` exists: with only a
    // top-level fixture, joining the path and taking its first segment are
    // indistinguishable, and "profile" names the wrong field.
    const Nested = z.object({
      id: z.number(),
      profile: z.object({ email: z.string() }),
    });
    reply = {
      status: 200,
      data: { id: "nope", profile: { email: 42 }, contact: "a@b.test" },
    };

    await validatedGet(Nested, "/players/context");

    expect(error).toHaveBeenCalledTimes(1);
    // Read the logged object rather than searching its JSON: `toContain("id")`
    // passed against blanked issue paths, because Zod's `invalid_type` code
    // contains "id". A substring over a serialised object matches coincidences.
    const [message, payload] = error.mock.calls[0] as [
      string,
      { url: string; issues: { code: string; path: string }[] },
    ];
    expect(message).toBe("API response validation failed");
    expect(payload.url).toBe("/players/context");
    expect(payload.issues.map((issue) => issue.path)).toEqual([
      "id",
      "profile.email",
    ]);
    // The code says *how* each field failed. Asserted as non-empty rather than
    // by value: the literals are Zod's own vocabulary, and pinning them would
    // fail on a library upgrade that changed nothing about this app.
    for (const issue of payload.issues) {
      expect(issue.code.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(payload)).not.toContain("a@b.test");
  });

  const HELPERS = [
    ["get", validatedGet],
    ["post", validatedPost],
    ["put", validatedPut],
    ["delete", validatedDelete],
    ["patch", validatedPatch],
  ] as const;

  it.each(HELPERS)(
    "answers a failed %s rather than throwing out of the helper",
    async (_method, call) => {
      // Callers branch on `result.success`; turning a failure into a throw is
      // `unwrap`'s separate step. A helper that rejected instead would take the
      // failure past every `if (!result.success)` into an unhandled rejection.
      reply = { status: 500, data: { detail: "boom" } };

      const result = await call(Schema, "/players/context");

      expect(result.success).toBe(false);
    },
  );

  it("keeps the original exception as a non-serialized cause", async () => {
    // The sanitized `error` is the only user-facing and serialized shape; the
    // raw exception survives for debugging and never reaches JSON output.
    reply = { status: 500, data: { detail: "boom" } };

    const result = await validatedGet(Schema, "/players/context");
    expect(result.success).toBe(false);

    let thrown: unknown;
    try {
      unwrap(result);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect((thrown as ApiRequestError).cause).toBeInstanceOf(Error);
    // Non-enumerable: serialization cannot walk circular Axios internals
    // through it.
    expect(JSON.stringify(result)).not.toContain("cause");
  });

  it.each(HELPERS)(
    "sends %s over the matching HTTP method",
    async (method, call) => {
      // Five near-identical wrappers, and the only difference between them is
      // the axios call in the middle. A `validatedPut` that issues a GET reads
      // correctly at every call site and type-checks — the write never happens.
      await call(Schema, "/players/context");

      expect(seen).toHaveLength(1);
      expect(seen[0]?.method).toBe(method);
    },
  );

  it("forwards query parameters to the request", async () => {
    // Params ride in the trailing options bag, and the bag is optional, so
    // dropping it is silent. Every filtered list would then ask for the
    // unfiltered one and render it as if it had been filtered.
    await validatedGet(Schema, "/players/suggestions", {
      params: { q: "faker", limit: 5 },
    });

    expect(seen[0]?.params).toEqual({ q: "faker", limit: 5 });
  });

  // The verbs that take a body, so their options bag is the fourth argument.
  const BODY_HELPERS = [
    ["post", validatedPost],
    ["put", validatedPut],
    ["patch", validatedPatch],
  ] as const;

  it.each(BODY_HELPERS)(
    "forwards an abort signal on %s",
    async (_method, call) => {
      // Only `validatedGet` used to reach axios with a config, so a signal
      // passed to a mutation went nowhere. Dropping it is silent -- the request
      // still succeeds -- and an abandoned surface holds its connection open.
      const controller = new AbortController();

      await call(
        Schema,
        "/players/context",
        { note: "x" },
        { signal: controller.signal },
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.signal).toBe(controller.signal);
    },
  );

  it("forwards an abort signal on delete", async () => {
    // `validatedDelete` has no body, so its bag is the third argument: the one
    // slot that used to be params-only.
    const controller = new AbortController();

    await validatedDelete(Schema, "/players/context", {
      signal: controller.signal,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBe(controller.signal);
  });
});

describe("the response interceptor", () => {
  it("does not try to refresh a session while refreshing the session", async () => {
    // A 401 from `/auth/refresh` means the refresh itself was rejected.
    // Retrying it through the same interceptor is a loop that re-asks the
    // server for a token it has just refused, once per request in flight.
    reply = { status: 401, data: {} };

    const result = await validatedPost(Schema, "/auth/refresh");

    expect(seen.map((request) => request.url)).toEqual(["/auth/refresh"]);
    expect(result.success).toBe(false);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("does not treat a rejected sign-in as an expired session", async () => {
    // A 401 from `/auth/login` is a wrong password, not a stale token. Sent
    // through the refresh path it would spend a refresh attempt and report
    // the failure as an expired session.
    reply = { status: 401, data: {} };

    const result = await validatedPost(Schema, "/auth/login");

    expect(seen.map((request) => request.url)).toEqual(["/auth/login"]);
    expect(result.success).toBe(false);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("does refresh once for a 401 on any other endpoint", async () => {
    // The other half of the same guard: pinning only the exclusions would
    // pass against an interceptor that never refreshes at all. A renewed
    // session is observable as the original request going out a second time.
    refreshAccessToken.mockResolvedValue({ outcome: "refreshed" });
    reply = { status: 401, data: {} };

    await validatedGet(Schema, "/players/context");

    expect(seen.map((request) => request.url)).toEqual([
      "/players/context",
      "/players/context",
    ]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("reports an invalid Riot key found on a failed response, not just a 200", async () => {
    // The key can fail on any endpoint that reaches Riot, and those come back
    // as errors. Watching only the success interceptor calls the credentials
    // healthy for exactly the requests that prove they are not.
    reply = {
      status: 503,
      data: { detail: { code: "RIOT_API_KEY_INVALID" } },
    };

    const result = await validatedGet(Schema, "/matches/player/x/stats");

    expect(result).toMatchObject({
      success: false,
      error: { code: "RIOT_API_KEY_INVALID", status: 503, kind: "service" },
    });
    expect(notifyRiotCredentialHealthUpdated).toHaveBeenCalledTimes(1);
  });
});
