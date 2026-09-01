import { useEffect, useRef } from "react";

import { type ToastVariant, useToast } from "@/lib/core/hooks";
import { JobExecution, type JobStatus } from "@/lib/core/schemas";

/** What a finished manual run announces, by the status it finished in. */
const MANUAL_RUN_OUTCOMES: Partial<
  Record<JobStatus, { suffix: string; description: string; variant: ToastVariant }>
> = {
  SUCCESS: {
    suffix: "run finished",
    description: "The manually triggered job completed successfully.",
    variant: "success",
  },
  RATE_LIMITED: {
    suffix: "run was rate limited",
    description: "Riot temporarily limited requests. Try again later.",
    variant: "warning",
  },
  CANCELLED: {
    suffix: "run stopped",
    description: "The manually triggered job is no longer active.",
    variant: "success",
  },
};

function manualRunToast(jobName: string, status: JobStatus) {
  const outcome = MANUAL_RUN_OUTCOMES[status] ?? {
    suffix: "run failed",
    description: "Open the execution history for details, then try again.",
    variant: "error" as const,
  };
  return {
    title: `${jobName} ${outcome.suffix}`,
    description: outcome.description,
    variant: outcome.variant,
  };
}

/**
 * The trigger response says only that the run started, so the outcome has to
 * be recognised in the execution history that arrives later.
 */
export function useManualRunOutcome(
  jobName: string,
  recentExecutions: JobExecution[],
) {
  const { toast } = useToast();
  const awaitingRef = useRef(false);
  const baselineIdRef = useRef<number | null>(null);
  const requestedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!awaitingRef.current) {
      return;
    }

    const baselineId = baselineIdRef.current;
    const requestedAt = requestedAtRef.current;
    const manualExecution = recentExecutions.find((execution) => {
      if (execution.triggered_by !== "user") {
        return false;
      }
      if (baselineId !== null) {
        return execution.id > baselineId;
      }
      return (
        requestedAt !== null &&
        Date.parse(execution.started_at) >= requestedAt - 2_000
      );
    });

    if (
      !manualExecution ||
      manualExecution.status === "PENDING" ||
      manualExecution.status === "RUNNING" ||
      manualExecution.status === "PAUSED"
    ) {
      return;
    }

    awaitingRef.current = false;
    toast(manualRunToast(jobName, manualExecution.status));
  }, [jobName, recentExecutions, toast]);

  /** Start watching for the run this trigger just requested. */
  return (lastExecutionId: number | null) => {
    awaitingRef.current = true;
    baselineIdRef.current = lastExecutionId;
    requestedAtRef.current = Date.now();
  };
}
