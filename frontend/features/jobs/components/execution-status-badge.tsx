import type { JobStatus } from "@/lib/core/schemas";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/core/utils";

/**
 * Statuses the badge variants cannot express.
 *
 * `Badge` offers four variants and the job ladder has seven states, so the
 * three that would otherwise collapse into the same grey carry an explicit
 * colour. These win over `variant` because they set the same properties.
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
 * The status of one job execution, drawn the same way everywhere it appears.
 *
 * The three surfaces that show this -- the executions table, the details
 * dialog and the job card's history strip -- each wrote the ladder out in
 * full, and had drifted: the history strip had lost the CANCELLED and PAUSED
 * colours entirely, so a cancelled run there was indistinguishable from a
 * pending one. `className` carries per-surface sizing only; the colours are
 * not a caller's decision.
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
