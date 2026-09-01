import { Clock } from "lucide-react";

import { useRelativeTime } from "@/lib/core/hooks/use-relative-time";
import { cn } from "@/lib/core/utils";

/**
 * `useRelativeTime` runs before the absent case returns, so hook order does not
 * depend on the data.
 */
export function UpdatedStamp({
  lastUpdated,
  label = "Updated",
  className,
}: {
  lastUpdated?: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const relativeUpdatedAt = useRelativeTime(lastUpdated);

  if (!lastUpdated) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Clock className="h-3 w-3" />
      <span>
        {label} {relativeUpdatedAt}
      </span>
    </div>
  );
}
