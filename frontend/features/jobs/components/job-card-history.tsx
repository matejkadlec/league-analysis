"use client";

import { Badge } from "@/components/ui/badge";
import type { JobExecution } from "@/lib/core/schemas";

import { formatRelativeTime } from "./job-card-format";
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
                <Badge
                  variant={
                    execution.status === "SUCCESS"
                      ? "default"
                      : execution.status === "FAILED"
                        ? "destructive"
                        : "secondary"
                  }
                  className={`text-[10px] min-w-17.5 justify-center ${
                    execution.status === "RATE_LIMITED"
                      ? "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800"
                      : ""
                  }`}
                >
                  {execution.status.replace("_", " ")}
                </Badge>
                <span className="text-muted-foreground min-w-15">
                  API: {execution.api_requests_made}
                </span>
                <span className="text-muted-foreground">
                  {formatRelativeTime(execution.started_at)}
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
