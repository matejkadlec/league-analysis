import { Clock } from "lucide-react";

import { useRelativeTime } from "@/lib/core/use-relative-time";
import { cn } from "@/lib/core/utils";

/**
 * When the figures above were last refreshed, or nothing if that is unknown.
 *
 * `useRelativeTime` runs before the absent case returns so the hook order does
 * not depend on the data. Callers pass their own spacing through `className`;
 * the champion card sits in a `justify-between` row and supplies its own
 * placeholder when this renders nothing.
 */
export function UpdatedStamp({
  lastUpdated,
  className,
}: {
  lastUpdated?: string | null | undefined;
  className?: string;
}) {
  const relativeUpdatedAt = useRelativeTime(lastUpdated);

  if (!lastUpdated) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Clock className="h-3 w-3" />
      <span>Updated {relativeUpdatedAt}</span>
    </div>
  );
}
