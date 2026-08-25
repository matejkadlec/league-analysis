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
 * Render a component under a fresh, retry-free `QueryClient`. Retries are
 * never what a unit test measures, and a client per render keeps one test's
 * cached answer from satisfying the next test's request.
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
 * The same client, for a hook rather than a component. `wrap` nests inside
 * the provider, so a context provider that itself reads a query can see it.
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
