"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { validatedPost, validatedGet, validatedPut } from "@/lib/core/api";
import {
  JobConfiguration,
  JobTriggerResponseSchema,
  JobExecutionListResponseSchema,
  JobConfigurationSchema,
} from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  History,
  Clock,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { useToast } from "@/lib/core/hooks";
import cronstrue from "cronstrue";

interface JobCardProps {
  job: JobConfiguration;
  onExecutionClick?: (executionId: number) => void;
}

/**
 * Convert cron expression to human-readable format
 */
function formatCronSchedule(schedule: string): string {
  try {
    // Check if it's a cron expression (starts with 5-7 parts)
    const parts = schedule.trim().split(/\s+/);
    if (parts.length >= 5 && parts.length <= 7) {
      return cronstrue.toString(schedule, { use24HourTimeFormat: true });
    }
    // Otherwise return as-is (might be interval format)
    return schedule;
  } catch {
    return schedule;
  }
}

/**
 * Format schedule from seconds to human-readable format
 * Rules:
 * - If <60 seconds: show only seconds
 * - If >=3600 (1 hour): show hours, and minutes if not exact hours (no seconds)
 * - Otherwise: show minutes only (round seconds to nearest minute)
 */
function formatScheduleInterval(schedule: string): string {
  // Try to parse as number (seconds)
  const totalSeconds = parseInt(schedule, 10);
  if (isNaN(totalSeconds)) {
    // Not a number, try cron format
    return formatCronSchedule(schedule);
  }

  // Less than 1 minute - show seconds only
  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}`;
  }

  // 1 hour or more
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const remainingMinutes = Math.round((totalSeconds % 3600) / 60);

    if (remainingMinutes === 0) {
      return `${hours} hour${hours !== 1 ? "s" : ""}`;
    }
    return `${hours} hour${hours !== 1 ? "s" : ""} ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
  }

  // Between 1 minute and 1 hour - show minutes only (rounded)
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "N/A";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Get a brief description for job types
 */
function getJobDescription(jobType: string): string {
  const descriptions: Record<string, string> = {
    MATCH_FETCHER:
      "Fetches new matches and updates player's match history and rank progression",
    PLAYER_UPDATER:
      "Fetches player info and updates player name, tag, icon and level",
  };
  return (
    descriptions[jobType] ||
    `Executes ${jobType.replace(/_/g, " ").toLowerCase()} tasks`
  );
}

const MATCH_FETCHER_QUEUE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 420, label: "Ranked Solo/Duo" },
  { id: 440, label: "Ranked Flex" },
  { id: 400, label: "Normal Draft" },
  { id: 450, label: "ARAM" },
];

const MATCH_FETCHER_DEFAULT_QUEUE_IDS = [420, 440, 400, 450];
const TOGGLE_COOLDOWN_MS = 2000;

function getEnabledQueueIds(config: JobConfiguration["config_json"]): number[] {
  const rawQueueIds = config?.enabled_queue_ids;
  if (!Array.isArray(rawQueueIds)) {
    return [...MATCH_FETCHER_DEFAULT_QUEUE_IDS];
  }

  if (rawQueueIds.length === 0) {
    return [];
  }

  const rawSet = new Set(
    rawQueueIds
      .map((value) => Number(value))
      .filter((value) =>
        MATCH_FETCHER_DEFAULT_QUEUE_IDS.includes(value),
      ),
  );

  if (rawSet.size === 0) {
    return [...MATCH_FETCHER_DEFAULT_QUEUE_IDS];
  }

  return MATCH_FETCHER_DEFAULT_QUEUE_IDS.filter((queueId) =>
    rawSet.has(queueId),
  );
}

export function JobCard({ job, onExecutionClick }: JobCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queueToggleCooldownRef = useRef(0);
  const isMatchFetcher = job.job_type === "MATCH_FETCHER";
  const enabledQueueIds = isMatchFetcher ? getEnabledQueueIds(job.config_json) : [];

  // Fetch latest 5 executions for this job (for history display)
  const { data: executionsResult } = useQuery({
    queryKey: ["job-executions", job.id],
    queryFn: () =>
      validatedGet(
        JobExecutionListResponseSchema,
        `/jobs/${job.id}/executions`,
        {
          page: 1,
          size: 5,
        },
      ),
    enabled: !!job.id,
    refetchInterval: 15000, // Auto-refresh every 15 seconds to update relative time
  });

  const recentExecutions = executionsResult?.success
    ? executionsResult.data.executions
    : [];
  const lastExecution =
    recentExecutions.length > 0 ? recentExecutions[0] : null;

  // Calculate duration
  const duration =
    lastExecution?.started_at && lastExecution?.completed_at
      ? (new Date(lastExecution.completed_at).getTime() -
          new Date(lastExecution.started_at).getTime()) /
        1000
      : null;

  // Trigger job mutation
  const triggerMutation = useMutation({
    mutationFn: () =>
      validatedPost(JobTriggerResponseSchema, `/jobs/${job.id}/trigger`),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: "Job Triggered",
          description: result.data.message,
        });
        // Wait for job execution to be created in DB (background task)
        // then invalidate queries to refresh data
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          queryClient.invalidateQueries({ queryKey: ["job-executions"] });
          queryClient.invalidateQueries({ queryKey: ["job-executions-all"] });
          queryClient.invalidateQueries({
            queryKey: ["job-executions-infinite"],
          });
          queryClient.invalidateQueries({ queryKey: ["job-status"] });
        }, 1500);

        // Refresh again after job likely completes to update status
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["job-executions"] });
          queryClient.invalidateQueries({ queryKey: ["job-executions-all"] });
          queryClient.invalidateQueries({
            queryKey: ["job-executions-infinite"],
          });
          queryClient.invalidateQueries({ queryKey: ["job-status"] });
        }, 5000);
      } else {
        toast({
          title: "Failed to Trigger Job",
          description: result.error.message,
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to trigger job",
        variant: "error",
      });
    },
  });

  const updateMatchFetcherQueuesMutation = useMutation({
    mutationFn: (queueIds: number[]) =>
      validatedPut(JobConfigurationSchema, `/jobs/${job.id}`, {
        config_json: { enabled_queue_ids: queueIds },
      }),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: "Configuration Updated",
          description: "Match queues were updated successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["job-status"] });
      } else {
        toast({
          title: "Failed to Update Configuration",
          description: result.error.message,
          variant: "error",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to update match queues",
        variant: "error",
      });
    },
  });

  const handleTrigger = () => {
    triggerMutation.mutate();
  };

  const toggleHistory = () => {
    setShowHistory(!showHistory);
  };

  const handleQueueToggle = (
    queueId: number,
    checked: boolean,
    timestamp: number,
  ) => {
    const now = timestamp;
    if (now < queueToggleCooldownRef.current) {
      toast({
        title: "Please wait",
        description: "You need to wait a few seconds to repeat this action",
        variant: "error",
      });
      return;
    }

    queueToggleCooldownRef.current = now + TOGGLE_COOLDOWN_MS;

    const nextQueueIds = checked
      ? [...new Set([...enabledQueueIds, queueId])]
      : enabledQueueIds.filter((id) => id !== queueId);

    updateMatchFetcherQueuesMutation.mutate(nextQueueIds);
  };

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-lg">{job.name}</span>
              <Badge variant={job.is_active ? "default" : "secondary"}>
                {job.is_active ? "Active" : "Disabled"}
              </Badge>
            </div>
            <div className="text-sm font-normal text-muted-foreground">
              {job.description || getJobDescription(job.job_type)}
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={isMatchFetcher ? "grid gap-4 md:grid-cols-2" : ""}>
          <div className="space-y-4">
            {/* Schedule */}
            <div className="flex items-start gap-2 text-sm">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">Schedule</p>
                <p className="text-muted-foreground">
                  {formatScheduleInterval(job.schedule)}
                </p>
              </div>
            </div>

            {/* Last Execution */}
            <div className="flex items-start gap-2 text-sm">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">Last Execution</p>
                {lastExecution ? (
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        lastExecution.status === "SUCCESS"
                          ? "default"
                          : lastExecution.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {lastExecution.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatRelativeTime(lastExecution.started_at)}
                    </span>
                    {duration && (
                      <span className="text-muted-foreground">
                        • {formatDuration(duration)}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">Never</p>
                )}
              </div>
            </div>
          </div>

          {isMatchFetcher && (
            <div className="rounded-md border">
              <div className="grid h-full grid-rows-4">
                {MATCH_FETCHER_QUEUE_OPTIONS.map((queueOption) => (
                  <label
                    key={queueOption.id}
                    className="flex min-h-[44px] items-center justify-between px-3 text-sm border-b last:border-b-0"
                  >
                    <span className="font-medium">{queueOption.label}</span>
                    <input
                      type="checkbox"
                      checked={enabledQueueIds.includes(queueOption.id)}
                      onChange={(event) =>
                        handleQueueToggle(
                          queueOption.id,
                          event.target.checked,
                          event.timeStamp,
                        )
                      }
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      disabled={updateMatchFetcherQueuesMutation.isPending}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            type="submit"
            onClick={handleTrigger}
            disabled={!job.is_active || triggerMutation.isPending}
            className="flex-1"
          >
            {triggerMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Triggering...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Trigger Now
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={toggleHistory}
            className="flex-1 cursor-pointer"
          >
            <History className="mr-2 h-4 w-4" />
            History
            {showHistory ? (
              <ChevronUp className="ml-1 h-4 w-4" />
            ) : (
              <ChevronDown className="ml-1 h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Execution History (Expandable) */}
        {showHistory && (
          <div className="mt-4 border-t pt-4">
            <p className="mb-2 text-sm font-medium">Recent Executions</p>
            {recentExecutions.length > 0 ? (
              <div className="space-y-2">
                {recentExecutions.map((execution) => (
                  <div
                    key={execution.id}
                    className="flex items-center justify-between rounded-md border p-2 text-xs cursor-pointer hover:bg-muted/50 transition-colors"
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
                        className={`text-[10px] min-w-[70px] justify-center ${
                          execution.status === "RATE_LIMITED"
                            ? "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800"
                            : ""
                        }`}
                      >
                        {execution.status.replace("_", " ")}
                      </Badge>
                      <span className="text-muted-foreground min-w-[60px]">
                        API: {execution.api_requests_made}
                      </span>
                      <span className="text-muted-foreground">
                        {formatRelativeTime(execution.started_at)}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {execution.started_at && execution.completed_at
                        ? formatDuration(
                            (new Date(execution.completed_at).getTime() -
                              new Date(execution.started_at).getTime()) /
                              1000,
                          )
                        : "N/A"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No executions yet</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
