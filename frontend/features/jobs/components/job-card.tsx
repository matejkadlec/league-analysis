"use client";

import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { validatedPost, validatedGet } from "@/lib/core/api";
import {
  JobConfiguration,
  JobControlActionResponseSchema,
  JobTriggerResponseSchema,
  JobExecutionListResponseSchema,
} from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Play,
  History,
  Clock,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Loader2,
  LoaderCircle,
  Pause,
  FlaskConical,
  StopCircle,
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
      "Fetches every supported League queue and updates match history and rank progression",
    PLAYER_UPDATER:
      "Fetches player info and updates player name, tag, icon and level",
  };
  return (
    descriptions[jobType] ||
    `Executes ${jobType.replace(/_/g, " ").toLowerCase()} tasks`
  );
}

export function JobCard({ job, onExecutionClick }: JobCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [optimisticTestRunning, setOptimisticTestRunning] = useState<
    boolean | null
  >(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isRunning = job.is_running;

  // Clear optimistic state once server data catches up
  const serverTestRunning = job.is_test_running;
  const isTestRunning =
    optimisticTestRunning !== null ? optimisticTestRunning : serverTestRunning;

  // Auto-clear optimistic override when server state matches
  if (
    optimisticTestRunning !== null &&
    serverTestRunning === optimisticTestRunning
  ) {
    // Schedule the clear for after render (can't setState during render synchronously
    // in all cases, but this pattern is safe for derived-state reconciliation)
    queueMicrotask(() => setOptimisticTestRunning(null));
  }

  // Unified state: test runs simulate regular runs 1:1 in the UI
  const isAnyRunning = isRunning || isTestRunning;
  const isAnyPaused = isAnyRunning && job.is_paused;
  const isAnyStopping =
    (isRunning && job.is_stopping) || (isTestRunning && job.is_test_stopping);
  const isAnyForceStopping =
    (isRunning && job.is_force_stopping) ||
    (isTestRunning && job.is_test_force_stopping);

  const refreshJobsData = () => {
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["job-status"] });
    queryClient.invalidateQueries({ queryKey: ["job-executions"] });
    queryClient.invalidateQueries({ queryKey: ["job-executions-all"] });
    queryClient.invalidateQueries({ queryKey: ["job-executions-infinite"] });
    queryClient.refetchQueries({ queryKey: ["jobs"], type: "active" });
  };

  // Fetch latest 5 REGULAR executions for this job (for history display)
  // Test runs are excluded from Last Execution and History dropdown
  const { data: executionsResult } = useQuery({
    queryKey: ["job-executions", job.id],
    queryFn: () =>
      validatedGet(
        JobExecutionListResponseSchema,
        `/jobs/${job.id}/executions`,
        {
          page: 1,
          size: 5,
          execution_type: "REGULAR",
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
          title: `${job.name} run started`,
          description: "The job is running in the background.",
          variant: "info",
        });
        // Wait for job execution to be created in DB (background task)
        // then invalidate queries to refresh data
        setTimeout(() => {
          refreshJobsData();
        }, 1500);

        // Refresh again after job likely completes to update status
        setTimeout(() => {
          refreshJobsData();
        }, 5000);
      } else {
        toast({
          title: `${job.name} run could not start`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} run could not start`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () =>
      validatedPost(JobControlActionResponseSchema, `/jobs/${job.id}/pause`),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: `${job.name} paused`,
          description: "Scheduled runs will wait until the job is resumed.",
          variant: "success",
        });
        refreshJobsData();
      } else {
        toast({
          title: `${job.name} could not be paused`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} could not be paused`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () =>
      validatedPost(JobControlActionResponseSchema, `/jobs/${job.id}/resume`),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: `${job.name} resumed`,
          description: "Scheduled runs are active again.",
          variant: "success",
        });
        refreshJobsData();
      } else {
        toast({
          title: `${job.name} could not be resumed`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} could not be resumed`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (force: boolean) =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/stop${force ? "?force=true" : ""}`,
      ),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: `${job.name} stop requested`,
          description: "The current run is stopping in the background.",
          variant: "info",
        });
        refreshJobsData();
      } else {
        toast({
          title: `${job.name} could not be stopped`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} could not be stopped`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const testTriggerMutation = useMutation({
    mutationFn: (suspendRegular: boolean) =>
      validatedPost(
        JobTriggerResponseSchema,
        `/jobs/${job.id}/test${suspendRegular ? "?suspend_regular=true" : ""}`,
      ),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: `${job.name} test started`,
          description: "The test run is running in the background.",
          variant: "info",
        });
        setOptimisticTestRunning(true);
        // Delay initial refresh — backend creates execution asynchronously
        setTimeout(() => refreshJobsData(), 1500);
      } else {
        toast({
          title: `${job.name} test could not start`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} test could not start`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const testStopMutation = useMutation({
    mutationFn: () =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/test/stop`,
      ),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: `${job.name} test stopped`,
          description: "The test run is no longer active.",
          variant: "success",
        });
        setOptimisticTestRunning(false);
        refreshJobsData();
      } else {
        toast({
          title: `${job.name} test could not be stopped`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} test could not be stopped`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const testPauseMutation = useMutation({
    mutationFn: () =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/test/pause`,
      ),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: `${job.name} test paused`,
          description: "The test run will wait until it is resumed.",
          variant: "success",
        });
        refreshJobsData();
      } else {
        toast({
          title: `${job.name} test could not be paused`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} test could not be paused`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const testResumeMutation = useMutation({
    mutationFn: () =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/test/resume`,
      ),
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: `${job.name} test resumed`,
          description: "The test run is active again.",
          variant: "success",
        });
        refreshJobsData();
      } else {
        toast({
          title: `${job.name} test could not be resumed`,
          description: "Please try again later.",
          variant: "error",
        });
      }
    },
    onError: () => {
      toast({
        title: `${job.name} test could not be resumed`,
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  const handleTestClick = () => {
    if (isTestRunning) {
      testStopMutation.mutate();
      return;
    }
    setShowTestDialog(true);
  };

  const handleTestConfirm = (suspendRegular: boolean) => {
    setShowTestDialog(false);
    testTriggerMutation.mutate(suspendRegular);
  };

  const handleTrigger = () => {
    triggerMutation.mutate();
  };

  const handlePauseResume = () => {
    if (isAnyPaused) {
      if (isTestRunning) {
        testResumeMutation.mutate();
      } else {
        resumeMutation.mutate();
      }
      return;
    }

    if (isTestRunning) {
      testPauseMutation.mutate();
    } else {
      pauseMutation.mutate();
    }
  };

  const handleMainAction = () => {
    if (isAnyPaused) {
      if (isTestRunning) {
        testResumeMutation.mutate();
      } else {
        resumeMutation.mutate();
      }
      return;
    }

    if (isTestRunning) {
      // For test runs: first click = graceful stop, second = force stop
      testStopMutation.mutate();
      return;
    }

    if (isRunning) {
      stopMutation.mutate(isAnyStopping);
      return;
    }

    handleTrigger();
  };

  const toggleHistory = () => {
    setShowHistory(!showHistory);
  };

  const isControlMutationPending =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending ||
    testPauseMutation.isPending ||
    testResumeMutation.isPending ||
    testStopMutation.isPending;

  const mainButtonTitle = isAnyPaused
    ? "Resume"
    : isAnyStopping
      ? "Force stop the job now"
      : isAnyRunning
        ? "End the job early"
        : "Trigger job now";

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
          <div className="flex items-center gap-1.5">
            {isAnyRunning && !isAnyStopping ? (
              <button
                type="button"
                onClick={handlePauseResume}
                disabled={isControlMutationPending}
                title={isAnyPaused ? "Resume" : "Pause the job"}
                className="icon-circle"
              >
                {isAnyPaused ? (
                  <Play className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
              </button>
            ) : null}
            {job.is_active ? (
              <button
                type="button"
                onClick={handleTestClick}
                disabled={
                  testTriggerMutation.isPending || testStopMutation.isPending
                }
                title={isTestRunning ? "Stop the test run" : "Start a test run"}
                className="icon-circle relative"
              >
                <FlaskConical
                  className={`h-3.5 w-3.5${isTestRunning ? " opacity-40" : ""}`}
                />
                {isTestRunning && (
                  <LoaderCircle className="absolute inset-0 m-auto h-6 w-6 animate-spin text-primary-foreground" />
                )}
              </button>
            ) : null}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
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
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            type="submit"
            onClick={handleMainAction}
            disabled={
              (!job.is_active && !isAnyRunning) ||
              triggerMutation.isPending ||
              isControlMutationPending
            }
            title={mainButtonTitle}
            className="flex-1"
          >
            {triggerMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Triggering...
              </>
            ) : isAnyPaused ? (
              <>
                <Pause className="mr-2 h-4 w-4" />
                Paused
              </>
            ) : isAnyStopping ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Stopping job...
              </>
            ) : isAnyRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
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
            title="See recent 5 executions"
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

      {/* Test Run Confirmation Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="sm:max-w-md dialog-white-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-gold-base" />
              Start Test Run
            </DialogTitle>
            <DialogDescription>
              The test run will call all Riot API endpoints this job uses once
              per minute without saving any data. It runs for up to 1 hour or
              until stopped.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Suspend regular scheduled runs during the test?
          </p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              className="red-gradient py-2 px-4"
              onClick={() => setShowTestDialog(false)}
            >
              <StopCircle className="h-4 w-4" />
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button
                className="gold-gradient py-2 px-4"
                onClick={() => handleTestConfirm(false)}
              >
                No
              </Button>
              <Button
                className="gold-gradient py-2 px-4"
                onClick={() => handleTestConfirm(true)}
              >
                Yes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
