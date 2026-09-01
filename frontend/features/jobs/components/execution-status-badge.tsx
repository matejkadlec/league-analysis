import type { JobStatus } from "@/lib/core/schemas";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/core/utils";

/**
 * `Badge` offers four variants and the job ladder has seven; the three that
 * would collapse into one grey carry a colour that overrides `variant`.
 */
const STATUS_CLASSES: Partial<Record<JobStatus, string>> = {
  RATE_LIMITED:
    "bg-yellow-900/30 text-yellow-200 border-yellow-800",
  CANCELLED:
    "bg-purple-900/30 text-white border-purple-800",
  PAUSED:
    "bg-orange-900/30 text-white border-orange-800",
};

function statusVariant(status: JobStatus) {
  if (status === "SUCCESS") {
    return "default" as const;
  }
  if (status === "FAILED") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

/**
 * The status of one job execution, drawn the same way everywhere. `className`
 * carries per-surface sizing only; the colours are not a caller's decision.
 */
export function ExecutionStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  return (
    <Badge
      variant={statusVariant(status)}
      className={cn(STATUS_CLASSES[status], className)}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}
