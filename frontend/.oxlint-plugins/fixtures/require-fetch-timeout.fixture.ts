// Regression fixture for `house/require-fetch-timeout`. Each directive
// suppresses a shape the rule MUST flag; accepted cases carry none. A selector
// that stops matching leaves an unused directive and fails the run, and one
// that over-matches reports on an accepted case and fails it the other way.

declare const url: string;
declare const body: string;
declare const init: RequestInit;
declare const rest: RequestInit;
declare const controller: AbortController;
declare const request: Request;

// MUST flag: no init at all.
export const bare = () =>
  // oxlint-disable-next-line house/require-fetch-timeout
  fetch(url);

// MUST flag: an init that says everything except when to give up. This is the
// beacon shape in `client-error-report.ts`.
export const beacon = () => {
  void
    // oxlint-disable-next-line house/require-fetch-timeout
    fetch("/client-error-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => undefined);
};

// MUST flag: reached through a global object, which an identifier-only check
// walks straight past.
export const viaGlobal = () =>
  // oxlint-disable-next-line house/require-fetch-timeout
  globalThis.fetch(url, { method: "POST" });

export const viaWindow = () =>
  // oxlint-disable-next-line house/require-fetch-timeout
  window.fetch(url, {});

// MUST flag: a `Request` built here without one is no better than a bare init.
export const requestWithoutSignal = () =>
  // oxlint-disable-next-line house/require-fetch-timeout
  fetch(new Request(url, { method: "POST" }));

// Accepted -- a deadline, which is what every auth call in this repo passes.
export const withTimeout = () =>
  fetch(url, { signal: AbortSignal.timeout(5_000) });

// Accepted -- a controller the caller aborts itself, as the login call does.
export const withController = () =>
  fetch(url, { method: "POST", body, signal: controller.signal });

// Accepted -- an init held in a variable may already carry the signal, and
// reading it would take following the binding.
export const opaqueInit = () => fetch(url, init);

// Accepted -- a spread may carry it too.
export const spreadInit = () =>
  fetch(url, { method: "POST", ...rest });

// Accepted -- the signal travelling on a `Request` assembled at the call site.
export const requestWithSignal = () =>
  fetch(new Request(url, { signal: AbortSignal.timeout(5_000) }));

// Accepted -- an unrelated method that happens to be called `fetch`.
export const unrelatedFetch = () => {
  const loader = { fetch: (target: string) => target };
  return loader.fetch(url);
};

// Accepted -- not a call at all.
export const passedAlong = () => [fetch, request];
