"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { AuthProvider } from "@/features/auth";
import { PlayerContextProvider } from "@/features/players";
import { normalizeApiError } from "@/lib/core/api-error";
import { reportApiError } from "@/lib/core/api-error-logging";
import { DDragonVersionProvider } from "@/lib/core/data-dragon-context";
import { appToast, queryErrorToast } from "@/lib/core/hooks";
import { AuthGate } from "./auth-gate";

function cacheKey(key: readonly unknown[] | undefined): string | undefined {
  if (key === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(key);
  } catch {
    return undefined;
  }
}

/**
 * Build the shared cache handlers exactly the way `Providers` mounts them.
 *
 * Kept as an exported factory (mirroring how `queryErrorToast` stays pure in
 * `lib/core/hooks.ts`) so the cache wiring is testable by driving a
 * QueryClient directly instead of rendering the whole provider tree.
 */
export function createProvidersQueryClient(): QueryClient {
  return new QueryClient({
    // 28 of the 35 `useQuery` call sites read only `data` and `isLoading`,
    // so a failed fetch used to render as a permanently empty or loading
    // surface that told the viewer nothing. Announcing it once here covers
    // every call site including the ones not written yet, which is what a
    // per-caller rule could never do.
    queryCache: new QueryCache({
      onError: (error, query) => {
        reportApiError(normalizeApiError(error), {
          source: "query",
          key: cacheKey(query.queryKey),
        });
        const toast = queryErrorToast(error, query.meta);
        if (toast) {
          appToast.toast(toast);
        }
      },
    }),
    // Mutations keep their user-facing announcement in each call site's own
    // onError callback, so the global handler reports for developers only
    // and never double-toasts a failure the viewer already saw.
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) => {
        reportApiError(normalizeApiError(error), {
          source: "mutation",
          key: cacheKey(mutation.options.mutationKey),
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function Providers({
  children,
  ddragonVersion,
}: {
  children: React.ReactNode;
  ddragonVersion: string;
}) {
  const [queryClient] = useState(() => createProvidersQueryClient());

  return (
    <DDragonVersionProvider version={ddragonVersion}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Suspense fallback={null}>
            <PlayerContextProvider>
              <AuthGate>{children}</AuthGate>
            </PlayerContextProvider>
          </Suspense>
        </AuthProvider>
      </QueryClientProvider>
    </DDragonVersionProvider>
  );
}
