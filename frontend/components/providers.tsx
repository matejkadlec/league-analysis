"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "@/features/auth";
import { ApiKeyStatusProvider } from "@/lib/core/api-key-status-context";

export function Providers({ children }: { children: React.ReactNode }) {
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
    <QueryClientProvider client={queryClient}>
      <ApiKeyStatusProvider>
        <AuthProvider>{children}</AuthProvider>
      </ApiKeyStatusProvider>
    </QueryClientProvider>
  );
}
