import { vi } from "vitest";

/**
 * A request deadline a test can actually drive: fake timers move `setTimeout`
 * but not `AbortSignal.timeout`, so a deadline built on the latter can be
 * deleted outright with every test still green.
 */
export function installDrivableAbortDeadlines(): () => void {
  const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(
        new DOMException("The operation timed out.", "TimeoutError"),
      );
    }, ms);
    return controller.signal;
  });
  return () => {
    spy.mockRestore();
  };
}

/** A server that accepts the connection and then never answers. */
export function hangingFetch() {
  return vi.fn<typeof fetch>(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
  );
}
