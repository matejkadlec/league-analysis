import { PageSections, Section, SectionRow } from "@/components/page-sections";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The page-shaped placeholder shown whenever there is nothing to draw yet.
 * Rendered signed-out too: the gate's redirect waits on the session probe.
 * Lives here, not in `app/loading.tsx`, because `providers.tsx` needs it too.
 */
export function AppSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        {/* The shape every card page shares: the header, a row of two cards,
            then a full-width card. */}
        <PageSections>
          <Skeleton className="h-32 w-full rounded-lg" />
          <SectionRow>
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </SectionRow>
          <Section>
            <Skeleton className="h-80 w-full rounded-lg" />
          </Section>
        </PageSections>
      </div>
    </div>
  );
}
