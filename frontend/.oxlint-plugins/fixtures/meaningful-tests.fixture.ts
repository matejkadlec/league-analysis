// Regression fixture for `house/meaningful-tests`. Every directive below
// suppresses a shape the rule MUST flag; accepted cases carry none. Under
// `--report-unused-disable-directives-severity=error` an unused directive is
// a detection that stopped matching, a report here is one that over-matched.

type Matchers = {
  toBe: (value: unknown) => void;
  toHaveBeenCalled: () => void;
  toHaveBeenCalledOnce: () => void;
  toHaveBeenCalledWith: (...args: readonly unknown[]) => void;
  toHaveBeenCalledTimes: (times: number) => void;
  toThrow: (message?: string) => void;
  toThrowError: (message?: string) => void;
  not: Matchers;
  // Vitest's async matchers return a promise, which is what makes `await
  // expect(p).rejects.toThrow()` a real await rather than a type-aware finding.
  rejects: AsyncMatchers;
};

type AsyncMatchers = {
  toThrow: (message?: string) => Promise<void>;
  toThrowError: (message?: string) => Promise<void>;
  not: AsyncMatchers;
};

declare const expect: (value: unknown) => Matchers;
declare const describe: (name: string, body: () => void) => void;
declare const it: ((name: string, body: () => unknown) => void) & {
  each: (
    table: readonly unknown[],
  ) => (name: string, body: (...args: readonly never[]) => unknown) => void;
};
declare const test: typeof it & { beforeEach: (body: () => unknown) => void };
declare const waitFor: (body: () => unknown) => Promise<void>;

declare const postMock: unknown;
declare const toastError: unknown;
declare const startSync: (player?: string) => void;
declare const renderedText: () => string;
declare const parseRiotId: (raw: string) => string;
declare const clearOptionalBrowserStorage: () => void;
declare const failingQuery: () => Promise<unknown>;

describe("mock-call-only assertions", () => {
  // MUST flag: the whole test is wiring. It passes with the toast, the
  // rendered row and the returned value all wrong. The `.not` chain is a call
  // assertion too, so it does not rescue the test.
  // oxlint-disable-next-line house/meaningful-tests
  it("posts the sync request", () => {
    startSync();
    expect(postMock).toHaveBeenCalledWith("/players/sync");
    expect(toastError).not.toHaveBeenCalled();
  });

  // MUST flag: the same shape through `it.each`, where the test body is an
  // argument to the call the table returns.
  // oxlint-disable-next-line house/meaningful-tests
  it.each([["Faker#KR1"], ["QA#TEST"]])("forwards %s", (player: never) => {
    startSync(player);
    expect(postMock).toHaveBeenCalled();
  });

  // MUST flag: Playwright's `test` is the same function to this rule.
  // oxlint-disable-next-line house/meaningful-tests
  test("blocks the upstream request", () => {
    startSync();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  // Accepted: the call assertion corroborates an outcome assertion.
  it("shows the running player in the toast", () => {
    startSync();
    expect(renderedText()).toBe("An update for Faker#KR1 is still running.");
    expect(postMock).toHaveBeenCalledOnce();
  });

  // Accepted: the outcome assertion sits inside a `waitFor` callback, which is
  // where half of this suite's assertions live.
  it("renders the row once the query settles", async () => {
    startSync();
    await waitFor(() => expect(renderedText()).toBe("Faker#KR1"));
    expect(postMock).toHaveBeenCalled();
  });

  // Accepted: a hook is not a test, and neither is `describe`. Reporting here
  // would flag every `beforeEach` that checks its own setup.
  test.beforeEach(() => {
    expect(postMock).toHaveBeenCalled();
  });

  // Accepted, deliberately: a test with no assertions is left to the runner's
  // own report. This rule reads matchers, not intent.
  it("mounts without crashing", () => {
    startSync();
  });
});

describe("throws that name nothing", () => {
  it("rejects a Riot ID without a tag", () => {
    // MUST flag: every error satisfies this, the TypeError from a renamed
    // export included.
    // oxlint-disable-next-line house/meaningful-tests
    expect(() => parseRiotId("Imagine Dragon")).toThrow();
  });

  it("surfaces a failed query", async () => {
    // MUST flag: the same hole reached through `rejects`.
    // oxlint-disable-next-line house/meaningful-tests
    await expect(failingQuery()).rejects.toThrowError();
  });

  // Accepted: the message is the contract.
  it("names the empty player name", () => {
    expect(() => parseRiotId("#ASOL")).toThrow("Player Name cannot be empty.");
  });

  // Accepted: `not.toThrow()` has nothing to name - an argument would narrow
  // it into a weaker assertion.
  it("survives blocked browser storage", () => {
    expect(() => clearOptionalBrowserStorage()).not.toThrow();
  });
});
