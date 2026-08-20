"use client";

import type { JobExecution } from "@/lib/core/schemas";

import { ExecutionStatusBadge } from "./execution-status-badge";
import { formatLastRun } from "./job-card-format";
import { formatDuration } from "./job-execution-format";

interface JobCardHistoryProps {
  recentExecutions: JobExecution[];
  isAnyForceStopping: boolean;
  onExecutionClick?: ((executionId: number) => void) | undefined;
}

export function JobCardHistory({
  recentExecutions,
  isAnyForceStopping,
  onExecutionClick,
}: JobCardHistoryProps) {
  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-sm font-medium">Recent Executions</p>
      {recentExecutions.length > 0 ? (
        <div className="space-y-2">
          {recentExecutions.map((execution) => (
            <button
              type="button"
              key={execution.id}
              className="flex w-full items-center justify-between rounded-md border p-2 text-xs hover:bg-muted/50 transition-colors"
              onClick={() => onExecutionClick?.(execution.id)}
            >
              <div className="flex items-center gap-2">
                <ExecutionStatusBadge
                  status={execution.status}
                  className="text-[10px] min-w-17.5 justify-center"
                />
                <span className="text-muted-foreground min-w-15">
                  API: {execution.api_requests_made}
                </span>
                <span className="text-muted-foreground">
                  {formatLastRun(execution.started_at)}
                </span>
                {isAnyForceStopping && execution.status === "RUNNING" && (
                  <span className="text-amber-600">force stopping</span>
                )}
              </div>
              <span className="text-muted-foreground">
                {formatDuration(execution.started_at, execution.completed_at)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No executions yet</p>
      )}
    </div>
  );
}
