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

import { ExecutionStatusBadge } from "./execution-status-badge";
import { JobExecutionApiCalls } from "./job-execution-api-calls";
import { JobExecutionLogs } from "./job-execution-logs";
import { formatDuration, formatJobTimestamp } from "./job-execution-format";

interface JobExecutionDetailsDialogProps {
  execution: JobExecution | null;
  onOpenChange: (open: boolean) => void;
}

export function JobExecutionDetailsDialog({
  execution,
  onOpenChange,
}: JobExecutionDetailsDialogProps) {
  const apiCalls = execution?.detailed_logs?.api_calls;
  const logs = execution?.detailed_logs?.logs;

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
                <ExecutionStatusBadge status={execution.status} />
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
                    {formatJobTimestamp(execution.started_at)}
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
                      ? formatJobTimestamp(execution.completed_at)
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
                // Remount per execution: the expansion state inside starts
                // collapsed for every selection, whichever path opened it.
                key={execution.id}
                startedAt={execution.started_at}
                completedAt={execution.completed_at}
                apiCalls={apiCalls}
              />
            )}

            {logs && !apiCalls && <JobExecutionLogs logs={logs} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
