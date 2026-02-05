"use client";

import { useAuth } from "@/features/auth";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const { isAuthenticated, isLoading } = useAuth();

  // Don't show loading skeletons if not authenticated (AuthGate will redirect)
  if (isLoading || !isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        {/* Header card skeleton */}
        <div className="mb-6">
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>

        {/* Two column content skeleton */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-80 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
