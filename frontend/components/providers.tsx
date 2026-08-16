"use client";

import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { AuthProvider } from "@/features/auth";
import { PlayerContextProvider } from "@/features/players";
import { DDragonVersionProvider } from "@/lib/core/data-dragon-context";
import { appToast, queryErrorToast } from "@/lib/core/hooks";
import { AuthGate } from "./auth-gate";

export function Providers({
  children,
  ddragonVersion,
}: {
  children: React.ReactNode;
  ddragonVersion: string;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // 28 of the 35 `useQuery` call sites read only `data` and `isLoading`,
        // so a failed fetch used to render as a permanently empty or loading
        // surface that told the viewer nothing. Announcing it once here covers
        // every call site including the ones not written yet, which is what a
        // per-caller rule could never do.
        queryCache: new QueryCache({
          onError: (error, query) => {
            const toast = queryErrorToast(error, query.meta);
            if (toast) {
              appToast.toast(toast);
            }
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

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
