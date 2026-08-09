"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "@/features/auth";
import { ApiKeyStatusProvider } from "@/lib/core/api-key-status-context";
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
        <ApiKeyStatusProvider>
          <AuthProvider>
            <AuthGate>{children}</AuthGate>
          </AuthProvider>
        </ApiKeyStatusProvider>
      </QueryClientProvider>
    </DDragonVersionProvider>
  );
}
