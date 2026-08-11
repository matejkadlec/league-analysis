"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { AuthProvider } from "@/features/auth";
import { PlayerContextProvider } from "@/features/players";
import { DDragonVersionProvider } from "@/lib/core/data-dragon-context";
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
