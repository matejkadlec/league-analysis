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
    notifyRiotCredentialHealthUpdated: vi.fn(),
    refreshAccessToken: vi.fn(),
  }),
);

vi.mock("@/lib/core/riot-credential-health-events", () => ({
  notifyRiotCredentialHealthUpdated,
}));

vi.mock("@/features/auth/utils/token-manager", () => ({ refreshAccessToken }));

import {
  api,
  validatedDelete,
  validatedGet,
  validatedPatch,
  validatedPost,
  validatedPut,
} from "@/lib/core/api";

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
    // This is the single guard the whole module exists for. `validateResponse`
    // could return the parsed value or the raw one and every caller would look
    // identical on the happy path, because for a valid payload they are the
    // same object. On an invalid one the difference is unvalidated server data
    // rendered as if it had been checked.
    vi.spyOn(console, "error").mockImplementation(() => {});
    reply = { status: 200, data: { id: "not a number", secret: "leak" } };

    const result = await validatedGet(Schema, "/players/context");

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("data");
  });

  it("logs which field failed without logging what was in it", async () => {
    // The rejected payload is the one most likely to hold something that
    // should not be in a log — it is server data that did not match its
    // contract. `logValidationError` takes `data` and deliberately drops it
    // (`void data`), keeping the url and the issue paths, which is what
    // actually identifies the break.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // One failure at the top level and one inside a nested object. The nested
    // one is the reason `issue.path.join(".")` exists at all: with only a
    // top-level fixture, joining the path and taking its first segment are
    // indistinguishable, and a log that says "profile" instead of
    // "profile.email" names the wrong field on a response with several.
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
    // Read the logged object rather than searching its JSON. The first draft
    // asserted `toContain("id")` and passed against a mutation that blanked
    // every issue path, because the Zod issue *code* is `invalid_type` and
    // that string contains "id". A substring assertion over a serialised
    // object matches coincidences.
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
    // The code says *how* each field failed. Asserted as non-empty rather
    // than by value: the literals are Zod's own vocabulary, and pinning them
    // would turn a library upgrade that changed nothing about this app into a
    // failing test, while a blanked code is what actually loses the reader.
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
      // Callers branch on `result.success`; `unwrap` is what turns a failure
      // into a throw, and it is deliberately a separate step. A helper that
      // rejected instead would take the same failure past every `if
      // (!result.success)` in the app and into an unhandled rejection.
      //
      // All five are covered because all five carry their own copy of the
      // `catch`: testing one leaves four `return`s that could be anything.
      reply = { status: 500, data: { detail: "boom" } };

      const result = await call(Schema, "/players/context");

      expect(result.success).toBe(false);
    },
  );

  it.each(HELPERS)(
    "sends %s over the matching HTTP method",
    async (method, call) => {
      // Five near-identical wrappers written by copy and paste, and the only
      // difference between them is the axios call in the middle. A `validatedPut`
      // that issues a GET reads correctly at every call site, type-checks, and
      // returns a plausible answer — the write simply never happens.
      await call(Schema, "/players/context");

      expect(seen).toHaveLength(1);
      expect(seen[0]?.method).toBe(method);
    },
  );

  it("forwards query parameters to the request", async () => {
    // `validatedGet` is the only one of the five that takes params, and the
    // argument is optional, so dropping it is silent. Every filtered list in
    // the app then asks for the unfiltered one and renders whatever comes
    // back as if it had been filtered.
    await validatedGet(Schema, "/players/suggestions", {
      q: "faker",
      limit: 5,
    });

    expect(seen[0]?.params).toEqual({ q: "faker", limit: 5 });
  });
});

describe("the response interceptor", () => {
  it("does not try to refresh a session while refreshing the session", async () => {
    // A 401 from `/auth/refresh` means the refresh itself was rejected.
    // Retrying it through the same interceptor is a loop that re-asks the
    // server for a token it has just refused, once per request in flight.
    reply = { status: 401, data: {} };

    await validatedPost(Schema, "/auth/refresh");

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("does not treat a rejected sign-in as an expired session", async () => {
    // A 401 from `/auth/login` is a wrong password, not a stale token. Sent
    // through the refresh path it would spend a refresh attempt and report
    // the failure as an expired session.
    reply = { status: 401, data: {} };

    await validatedPost(Schema, "/auth/login");

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("does refresh once for a 401 on any other endpoint", async () => {
    // The other half of the same guard: pinning only the exclusions would
    // pass against an interceptor that never refreshes at all.
    reply = { status: 401, data: {} };

    await validatedGet(Schema, "/players/context");

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("reports an invalid Riot key found on a failed response, not just a 200", async () => {
    // The key can fail on any endpoint that reaches Riot, and those come back
    // as errors. Watching only the success interceptor leaves the header
    // saying the credentials are healthy for exactly the requests that prove
    // they are not.
    reply = {
      status: 503,
      data: { detail: { code: "RIOT_API_KEY_INVALID" } },
    };

    await validatedGet(Schema, "/matches/player/x/stats");

    expect(notifyRiotCredentialHealthUpdated).toHaveBeenCalledTimes(1);
  });
});
