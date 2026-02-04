"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { validatedGet } from "@/lib/core/api";
import {
  JobExecutionListResponse,
  JobExecution,
  JobExecutionListResponseSchema,
  JobConfiguration,
} from "@/lib/core/schemas";
import { notifyApiKeyInvalid } from "@/lib/core/api-key-status-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface JobExecutionsProps {
  executions: JobExecutionListResponse | null;
  jobs: JobConfiguration[];
  /** If provided, opens the execution details dialog for this execution ID */
  selectedExecutionId?: number | null;
  /** Callback when execution selection changes */
  onExecutionSelect?: (executionId: number | null) => void;
}

interface APICallEntry {
  endpoint: string;
  region: string;
  count: number;
  first_timestamp?: string;
  last_timestamp?: string;
  params?: Record<string, string>;
  param_key?: string;
  first_param?: string;
  last_param?: string;
}

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(
  started: string,
  completed: string | null | undefined,
): string {
  if (!completed) return "N/A";
  const startTime = new Date(started).getTime();
  const endTime = new Date(completed).getTime();
  const seconds = (endTime - startTime) / 1000;

  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format timestamp to local date/time: D.M.YYYY H:MM:SS AM/PM
 */
function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);

  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'

  const minutesStr = minutes < 10 ? "0" + minutes : minutes;
  const secondsStr = seconds < 10 ? "0" + seconds : seconds;

  return `${day}.${month}.${year} ${hours}:${minutesStr}:${secondsStr} ${ampm}`;
}

/**
 * Format timestamp for log display: D.M.YYYY H:MM:SS AM/PM
 */
function formatLogDateTime(timestamp: string): string {
  return formatDateTime(timestamp);
}

/**
 * Format records summary message
 */
function formatRecordsSummary(created: number, updated: number): string {
  if (created === 0 && updated === 0) {
    return "No records created or updated";
  }
  if (created > 0 && updated > 0) {
    return `${created} records created and ${updated} records updated`;
  }
  if (created > 0) {
    return `${created} records created`;
  }
  return `${updated} records updated`;
}

export function JobExecutions({
  executions: initialExecutions,
  jobs,
  selectedExecutionId,
  onExecutionSelect,
}: JobExecutionsProps) {
  const [internalSelectedExecution, setInternalSelectedExecution] =
    useState<JobExecution | null>(null);
  const [displayCount, setDisplayCount] = useState(20);
  const [expandedApiCalls, setExpandedApiCalls] = useState<Set<string>>(
    new Set(),
  );
  const PAGE_SIZE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Create job name mapping
  const jobNameMap = useMemo(() => {
    const map = new Map<number, string>();
    jobs.forEach((job) => map.set(job.id, job.name));
    return map;
  }, [jobs]);

  // Fetch executions with pagination - always fetch all at once for display
  const {
    data: response,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["job-executions-infinite", displayCount],
    queryFn: async () => {
      const result = await validatedGet(
        JobExecutionListResponseSchema,
        "/jobs/executions/all",
        {
          page: 1,
          size: displayCount,
        },
      );
      return result;
    },
    enabled: !!initialExecutions,
    refetchInterval: 15000, // Auto-refresh every 15 seconds
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 0, // Always consider data stale so invalidation triggers refetch
  });

  const data = response?.success ? response.data : initialExecutions;
  const allExecutions = useMemo(
    () => data?.executions || [],
    [data?.executions],
  );
  const totalExecutions = data?.total || 0;
  const hasMore = allExecutions.length < totalExecutions;

  // Handle external selection (from job card)
  useEffect(() => {
    if (selectedExecutionId !== undefined && selectedExecutionId !== null) {
      const execution = allExecutions.find((e) => e.id === selectedExecutionId);
      if (execution) {
        setInternalSelectedExecution(execution);
      }
    }
  }, [selectedExecutionId, allExecutions]);

  // Check for API key errors in job executions and trigger header notification
  useEffect(() => {
    const hasApiKeyError = allExecutions.some(
      (execution) => execution.has_api_key_error,
    );
    if (hasApiKeyError) {
      notifyApiKeyInvalid();
    }
  }, [allExecutions]);

  // Load more function
  const loadMore = useCallback(() => {
    if (!isFetching && hasMore) {
      setDisplayCount((prev) => prev + PAGE_SIZE);
    }
  }, [isFetching, hasMore]);

  // Infinite scroll using Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && hasMore && !isFetching) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "200px" },
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [loadMore, hasMore, isFetching]);

  // Get job name by ID
  const getJobName = (jobConfigId: number): string => {
    return jobNameMap.get(jobConfigId) || `Job #${jobConfigId}`;
  };

  const handleSelectExecution = (execution: JobExecution) => {
    setInternalSelectedExecution(execution);
    onExecutionSelect?.(execution.id);
  };

  const handleCloseDialog = () => {
    setInternalSelectedExecution(null);
    onExecutionSelect?.(null);
  };

  const toggleApiCallExpanded = (endpoint: string) => {
    setExpandedApiCalls((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(endpoint)) {
        newSet.delete(endpoint);
      } else {
        newSet.add(endpoint);
      }
      return newSet;
    });
  };

  if (isLoading && allExecutions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Loading executions...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (allExecutions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No job executions found
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="pt-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Triggered By</TableHead>
                  <TableHead>Started At</TableHead>
                  <TableHead>Completed At</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Statistics</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allExecutions.map((execution) => (
                  <TableRow
                    key={execution.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSelectExecution(execution)}
                  >
                    <TableCell className="font-medium">
                      {getJobName(execution.job_config_id)}
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
                      {formatDateTime(execution.started_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {execution.completed_at
                        ? formatDateTime(execution.completed_at)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDuration(
                        execution.started_at,
                        execution.completed_at,
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col gap-0.5">
                        <span>
                          Riot API requests: {execution.api_requests_made}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatRecordsSummary(
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

          {/* Infinite scroll trigger - always visible when there's more data */}
          <div ref={loadMoreRef} className="mt-4 flex justify-center py-4">
            {isFetching ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading more executions...</span>
              </div>
            ) : hasMore ? (
              <div className="text-sm text-muted-foreground">
                Showing {allExecutions.length} of {totalExecutions} executions
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                All {totalExecutions} executions loaded
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Execution Details Dialog */}
      <Dialog
        open={!!internalSelectedExecution}
        onOpenChange={(open) => !open && handleCloseDialog()}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Execution Details</DialogTitle>
          </DialogHeader>

          {internalSelectedExecution && (
            <div className="space-y-4 pb-4">
              {/* Status and Triggered By row */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Status</span>
                  <Badge
                    variant={
                      internalSelectedExecution.status === "SUCCESS"
                        ? "default"
                        : internalSelectedExecution.status === "FAILED"
                          ? "destructive"
                          : "secondary"
                    }
                    className={
                      internalSelectedExecution.status === "RATE_LIMITED"
                        ? "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800"
                        : ""
                    }
                  >
                    {internalSelectedExecution.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Triggered By</span>
                  <Badge variant="outline" className="font-normal">
                    {internalSelectedExecution.triggered_by === "user"
                      ? "User"
                      : "System"}
                  </Badge>
                </div>
              </div>

              {/* Statistics - 3 columns, 2 rows */}
              <div className="rounded-lg border p-4">
                <p className="mb-3 font-medium">Statistics</p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  {/* Row 1 */}
                  <div>
                    <span className="text-muted-foreground">Started at:</span>{" "}
                    <span className="font-medium">
                      {formatDateTime(internalSelectedExecution.started_at)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Riot API requests:
                    </span>{" "}
                    <span className="font-medium">
                      {internalSelectedExecution.api_requests_made}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Records created:
                    </span>{" "}
                    <span className="font-medium">
                      {internalSelectedExecution.records_created}
                    </span>
                  </div>
                  {/* Row 2 */}
                  <div>
                    <span className="text-muted-foreground">Completed at:</span>{" "}
                    <span className="font-medium">
                      {internalSelectedExecution.completed_at
                        ? formatDateTime(internalSelectedExecution.completed_at)
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>{" "}
                    <span className="font-medium">
                      {formatDuration(
                        internalSelectedExecution.started_at,
                        internalSelectedExecution.completed_at,
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Records updated:
                    </span>{" "}
                    <span className="font-medium">
                      {internalSelectedExecution.records_updated}
                    </span>
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {internalSelectedExecution.error_message && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                  <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    Error Message
                  </div>
                  <p className="text-sm">
                    {internalSelectedExecution.error_message}
                  </p>
                </div>
              )}

              {/* API Calls Section */}
              {internalSelectedExecution.detailed_logs?.api_calls && (
                <div className="rounded-lg border bg-muted/50 p-4">
                  <p className="mb-3 font-medium">API Calls</p>
                  <div className="max-h-[300px] overflow-auto rounded-md border bg-background p-3">
                    <div className="space-y-2 font-mono text-[11px]">
                      {/* Session Started */}
                      <div className="text-blue-600 dark:text-blue-400">
                        [INFO] [
                        {formatLogDateTime(
                          internalSelectedExecution.started_at,
                        )}
                        ]: Riot API client session started
                      </div>

                      {/* API Calls */}
                      {(
                        internalSelectedExecution.detailed_logs
                          .api_calls as APICallEntry[]
                      ).map((call: APICallEntry, idx: number) => {
                        const countText =
                          call.count === 1 ? "once" : `${call.count} times`;
                        const isExpanded = expandedApiCalls.has(
                          `${idx}-${call.endpoint}`,
                        );
                        const hasMultipleParams =
                          call.count > 1 && call.param_key;

                        return (
                          <div key={idx} className="space-y-1">
                            <div className="text-blue-600 dark:text-blue-400">
                              [INFO] [
                              {formatLogDateTime(
                                call.first_timestamp ||
                                  internalSelectedExecution.started_at,
                              )}
                              ]: Called {call.endpoint} {countText}
                            </div>
                            <div className="pl-4 text-muted-foreground">
                              <div>Region: {call.region}</div>
                              {call.params &&
                                call.count === 1 &&
                                Object.entries(call.params).map(
                                  ([key, value]) => (
                                    <div key={key}>
                                      {key.charAt(0).toUpperCase() +
                                        key.slice(1)}
                                      : {value}
                                    </div>
                                  ),
                                )}
                              {hasMultipleParams && (
                                <div>
                                  <button
                                    onClick={() =>
                                      toggleApiCallExpanded(
                                        `${idx}-${call.endpoint}`,
                                      )
                                    }
                                    className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"
                                  >
                                    {call.param_key &&
                                      call.param_key.charAt(0).toUpperCase() +
                                        call.param_key.slice(1)}
                                    s:{" "}
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp className="h-3 w-3" />
                                        Collapse
                                      </>
                                    ) : (
                                      <>
                                        {call.first_param}, ...,{" "}
                                        {call.last_param}
                                        <ChevronDown className="h-3 w-3" />
                                      </>
                                    )}
                                  </button>
                                  {isExpanded && (
                                    <div className="mt-1 pl-2 border-l-2 border-muted">
                                      First: {call.first_param}
                                      <br />
                                      Last: {call.last_param}
                                      <br />
                                      <span className="text-xs text-muted-foreground">
                                        ({call.count} total calls)
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Session Closed */}
                      {internalSelectedExecution.completed_at && (
                        <div className="text-blue-600 dark:text-blue-400">
                          [INFO] [
                          {formatLogDateTime(
                            internalSelectedExecution.completed_at,
                          )}
                          ]: Riot API client session closed
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Detailed Logs (only show if no API calls section, or has additional logs) */}
              {internalSelectedExecution.detailed_logs?.logs &&
                !internalSelectedExecution.detailed_logs?.api_calls && (
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="font-medium">Detailed Logs</p>
                      <Badge variant="secondary">
                        {
                          (
                            internalSelectedExecution.detailed_logs
                              .logs as Array<Record<string, unknown>>
                          ).length
                        }{" "}
                        entries
                      </Badge>
                    </div>
                    <div className="max-h-[300px] overflow-auto rounded-md border bg-background p-3">
                      <div className="space-y-2 font-mono text-[11px]">
                        {(
                          internalSelectedExecution.detailed_logs.logs as Array<
                            Record<string, unknown>
                          >
                        ).map((log: Record<string, unknown>, idx: number) => {
                          const logLevel =
                            typeof log.level === "string"
                              ? log.level.toUpperCase()
                              : "INFO";

                          // Extract extra fields (everything except the standard fields)
                          const standardFields = new Set([
                            "level",
                            "timestamp",
                            "event",
                          ]);
                          const extraFields = Object.entries(log).filter(
                            ([key]) => !standardFields.has(key),
                          );

                          return (
                            <div
                              key={idx}
                              className={`rounded border-l-4 border-y border-r bg-muted/20 p-2 space-y-1.5 ${
                                logLevel === "ERROR"
                                  ? "border-l-destructive"
                                  : logLevel === "WARNING"
                                    ? "border-l-yellow-500"
                                    : logLevel === "INFO"
                                      ? "border-l-blue-500"
                                      : logLevel === "DEBUG"
                                        ? "border-l-orange-500"
                                        : "border-l-muted"
                              }`}
                            >
                              {/* Main log line */}
                              <div className="flex gap-2">
                                <span
                                  className={`shrink-0 font-bold ${
                                    logLevel === "ERROR"
                                      ? "text-destructive"
                                      : logLevel === "WARNING"
                                        ? "text-yellow-600"
                                        : logLevel === "INFO"
                                          ? "text-blue-600"
                                          : logLevel === "DEBUG"
                                            ? "text-orange-600"
                                            : "text-muted-foreground"
                                  }`}
                                >
                                  [{logLevel}]
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  [
                                  {formatLogDateTime(
                                    String(log.timestamp || ""),
                                  )}
                                  ]:
                                </span>
                                <span className="flex-1 break-all">
                                  {String(log.event || "")}
                                </span>
                              </div>

                              {/* Extra fields */}
                              {extraFields.length > 0 && (
                                <div className="space-y-0.5 text-[10px] text-muted-foreground/80 bg-background/50 rounded p-2 border border-muted pl-4">
                                  {extraFields.map(([key, value]) => (
                                    <div key={key}>
                                      {key.charAt(0).toUpperCase() +
                                        key.slice(1)}
                                      :{" "}
                                      {typeof value === "object"
                                        ? JSON.stringify(value)
                                        : String(value)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
