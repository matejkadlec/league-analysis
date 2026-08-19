"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { JobExecution } from "@/lib/core/schemas";

import {
  formatDuration,
  formatJobTimestamp,
  formatRecordsSummary,
} from "./job-execution-format";

interface JobExecutionsTableProps {
  executions: JobExecution[];
  getJobName: (jobConfigId: number) => string;
  onSelectExecution: (execution: JobExecution) => void;
}

export function JobExecutionsTable({
  executions,
  getJobName,
  onSelectExecution,
}: JobExecutionsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Triggered By</TableHead>
            <TableHead>Started At</TableHead>
            <TableHead>Completed At</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Statistics</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {executions.map((execution) => (
            <TableRow
              key={execution.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onSelectExecution(execution)}
            >
              <TableCell className="font-medium">
                {getJobName(execution.job_config_id)}
              </TableCell>
              <TableCell>
                {execution.execution_type === "TEST" ? (
                  <Badge
                    variant="outline"
                    className="bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800"
                  >
                    Test
                  </Badge>
                ) : (
                  <span className="text-sm">Regular</span>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    execution.status === "SUCCESS"
                      ? "default"
                      : execution.status === "FAILED"
                        ? "destructive"
                        : execution.status === "RUNNING"
                          ? "secondary"
                          : "outline"
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
              </TableCell>
              <TableCell className="text-sm">
                <Badge variant="outline" className="font-normal">
                  {execution.triggered_by === "user" ? "User" : "System"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatJobTimestamp(execution.started_at)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {execution.completed_at
                  ? formatJobTimestamp(execution.completed_at)
                  : "—"}
              </TableCell>
              <TableCell className="text-sm">
                {formatDuration(execution.started_at, execution.completed_at)}
              </TableCell>
              <TableCell className="text-sm">
                <div className="flex flex-col gap-0.5">
                  <span>Riot API requests: {execution.api_requests_made}</span>
                  <span className="text-xs text-muted-foreground">
                    {execution.execution_type === "TEST"
                      ? "Test run — no records created or updated"
                      : formatRecordsSummary(
                          execution.records_created,
                          execution.records_updated,
                        )}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
