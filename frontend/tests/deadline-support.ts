import { vi } from "vitest";

/**
 * A request deadline a test can actually drive.
 *
 * Vitest's fake timers do not drive `AbortSignal.timeout`, so a test that
 * advances time observes nothing about it and stays green with the deadline
 * deleted. That is how four `toBeInstanceOf(AbortSignal)` assertions came to
 * pin the existence of a signal and nothing about its length: replacing every
 * `AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS)` in the auth path with a signal
 * that never fires left all 244 tests passing, while restoring the reported
 * symptom exactly -- a backend that accepts the connection and hangs leaves
 * the probe unsettled forever, `isLoading` true forever, and the gate renders
 * a white page to anyone who simply waits.
 *
 * This swaps in a timeout built on `setTimeout`, which fake timers do drive,
 * so the abort can be waited for and its length asserted.
 */
export function installDrivableAbortDeadlines(): () => void {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = ((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(
        new DOMException("The operation timed out.", "TimeoutError"),
      );
    }, ms);
    return controller.signal;
  }) as typeof AbortSignal.timeout;
  return () => {
    AbortSignal.timeout = original;
  };
}

/** A server that accepts the connection and then never answers. */
export function hangingFetch() {
  return vi.fn(
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
