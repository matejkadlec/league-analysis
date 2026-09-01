import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lives here, not in `app/loading.tsx`, because `providers.tsx` needs it too,
 * and it renders signed-out while the gate waits on the session probe.
 */
export function AppSkeleton() {
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
