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
import { normalizeApiError } from "@/lib/core/http/api-error";
import { reportApiError } from "@/lib/core/http/api-error-logging";
import { DDragonVersionProvider } from "@/lib/core/riot/data-dragon-context";
import { appToast, queryErrorToast } from "@/lib/core/hooks";
import { AppSkeleton } from "./app-skeleton";
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
 * An exported factory so the wiring is testable by driving a QueryClient
 * directly instead of rendering the whole provider tree.
 */
export function createProvidersQueryClient(): QueryClient {
  return new QueryClient({
    // Most `useQuery` call sites read only `data` and `isLoading`, so a failed
    // fetch renders as a permanently empty surface. Announcing it once here
    // covers every call site including the ones not written yet.
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
          {/* Not `fallback={null}`: `PlayerContextProvider` reads
              `useSearchParams`, which bails to client rendering during a static
              prerender, so this fallback is what the prerender emits. */}
          <Suspense fallback={<AppSkeleton />}>
            <PlayerContextProvider>
              <AuthGate>{children}</AuthGate>
            </PlayerContextProvider>
          </Suspense>
        </AuthProvider>
      </QueryClientProvider>
    </DDragonVersionProvider>
  );
}
