"use client";

import { AlertCircle, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobExecution } from "@/lib/core/schemas";

import { JobExecutionApiCalls } from "./job-execution-api-calls";
import { JobExecutionLogs } from "./job-execution-logs";
import { formatDateTime } from "@/lib/core/format";

import { type APICallEntry, formatDuration } from "./job-execution-format";

interface JobExecutionDetailsDialogProps {
  execution: JobExecution | null;
  expandedApiCalls: Set<string>;
  onOpenChange: (open: boolean) => void;
  onToggleApiCall: (key: string) => void;
}

export function JobExecutionDetailsDialog({
  execution,
  expandedApiCalls,
  onOpenChange,
  onToggleApiCall,
}: JobExecutionDetailsDialogProps) {
  const apiCalls = execution?.detailed_logs?.api_calls as
    APICallEntry[] | undefined;
  const logs = execution?.detailed_logs?.logs as
    Array<Record<string, unknown>> | undefined;

  return (
    <Dialog open={!!execution} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-gold-base" />
            Execution Details
          </DialogTitle>
        </DialogHeader>

        {execution && (
          <div className="space-y-4 pb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-medium">Status</span>
                <Badge
                  variant={
                    execution.status === "SUCCESS"
                      ? "default"
                      : execution.status === "FAILED"
                        ? "destructive"
                        : "secondary"
                  }
                  className={
                    execution.status === "RATE_LIMITED"
                      ? "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800"
                      : execution.status === "CANCELLED"
                        ? "bg-purple-100 text-primary-foreground border-purple-300 dark:bg-purple-900/30 dark:text-white dark:border-purple-800"
                        : execution.status === "PAUSED"
                          ? "bg-orange-100 text-white border-orange-300 dark:bg-orange-900/30 dark:text-white dark:border-orange-800"
                          : ""
                  }
                >
                  {execution.status.replace("_", " ")}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Triggered By</span>
                <Badge variant="outline" className="font-normal">
                  {execution.triggered_by === "user" ? "User" : "System"}
                </Badge>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <p className="mb-3 font-medium">Statistics</p>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="flex items-center justify-between gap-3 pr-4">
                  <span className="text-muted-foreground">Started at:</span>
                  <span className="font-medium text-right">
                    {formatDateTime(execution.started_at, { seconds: true })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 pr-4">
                  <span className="text-muted-foreground">
                    Riot API requests:
                  </span>
                  <span className="font-medium text-right">
                    {execution.api_requests_made}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 pr-4">
                  <span className="text-muted-foreground">
                    Records created:
                  </span>
                  <span className="font-medium text-right">
                    {execution.records_created}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 pr-4">
                  <span className="text-muted-foreground">Completed at:</span>
                  <span className="font-medium text-right">
                    {execution.completed_at
                      ? formatDateTime(execution.completed_at, { seconds: true })
                      : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 pr-4">
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="font-medium text-right">
                    {formatDuration(
                      execution.started_at,
                      execution.completed_at,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 pr-4">
                  <span className="text-muted-foreground">
                    Records updated:
                  </span>
                  <span className="font-medium text-right">
                    {execution.records_updated}
                  </span>
                </div>
              </div>
            </div>

            {execution.error_message && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Error Message
                </div>
                <p className="text-sm">{execution.error_message}</p>
              </div>
            )}

            {apiCalls && (
              <JobExecutionApiCalls
                startedAt={execution.started_at}
                completedAt={execution.completed_at}
                apiCalls={apiCalls}
                expandedApiCalls={expandedApiCalls}
                onToggleExpanded={onToggleApiCall}
              />
            )}

            {logs && !apiCalls && <JobExecutionLogs logs={logs} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
