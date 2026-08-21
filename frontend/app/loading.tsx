import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a route loads, signed in or not.
 *
 * It used to render nothing unless authenticated, on the reasoning that the
 * gate would redirect anyway — but the redirect needs the session probe to
 * finish first, so the wait it was meant to cover was exactly the wait it
 * left blank. A skeleton reveals nothing.
 */
export default function Loading() {
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
