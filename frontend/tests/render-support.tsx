import type { RenderHookOptions } from "@testing-library/react";
import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react";

function testQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Render a component under a fresh, retry-free `QueryClient`.
 *
 * Twenty-eight suites built this wrapper by hand, and the retry settings had
 * split three ways between them: queries only, queries and mutations, or a
 * bare `new QueryClient()` that retried three times and so turned one failing
 * request into a test that waited on three. Retries are never what a unit test
 * is measuring; a suite that needs them can still build its own client.
 *
 * A client per render, not per module: TanStack caches by query key, so a
 * shared client would let one test's answer satisfy the next test's request
 * and hide a call that never happened.
 */
export function renderWithQueryClient(ui: ReactNode) {
  const queryClient = testQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
  return {
    ...result,
    queryClient,
    // Re-wrapped, because `rerender` replaces the whole tree it was given --
    // handed a bare element it would drop the provider and every hook under
    // it would throw.
    rerender: (next: ReactNode) =>
      result.rerender(
        <QueryClientProvider client={queryClient}>{next}</QueryClientProvider>,
      ),
  };
}

/**
 * The same client, for a hook rather than a component.
 *
 * `wrap` nests inside the provider, which is the order the suites that need
 * one depend on: a context provider that itself reads a query has to be able
 * to see the client.
 */
export function renderHookWithQueryClient<TProps, TResult>(
  hook: (props: TProps) => TResult,
  options: RenderHookOptions<TProps> & {
    wrap?: (children: ReactNode) => ReactNode;
  } = {},
) {
  const queryClient = testQueryClient();
  const { wrap, ...rest } = options;
  const view = renderHook(hook, {
    ...rest,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {wrap ? wrap(children) : children}
      </QueryClientProvider>
    ),
  });
  return { ...view, queryClient };
}
