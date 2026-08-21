"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { validatedGet } from "@/lib/core/api";
import {
  JobConfiguration,
  JobExecutionListResponseSchema,
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
  LoaderCircle,
  Pause,
  FlaskConical,
} from "lucide-react";

import { ExecutionStatusBadge } from "./execution-status-badge";
import { JobCardHistory } from "./job-card-history";
import { JobCardTestDialog } from "./job-card-test-dialog";
import {
  formatLastRun,
  formatScheduleInterval,
  getJobDescription,
} from "./job-card-format";
import { formatDuration } from "./job-execution-format";
import { useJobCardControls } from "./use-job-card-controls";

interface JobCardProps {
  job: JobConfiguration;
  onExecutionClick?: (executionId: number) => void;
}

export function JobCard({ job, onExecutionClick }: JobCardProps) {
  const [showHistory, setShowHistory] = useState(false);

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
    refetchInterval: 15000,
  });

  const recentExecutions = useMemo(
    () => (executionsResult?.success ? executionsResult.data.executions : []),
    [executionsResult],
  );
  const lastExecution =
    recentExecutions.length > 0 ? recentExecutions[0] : null;

  const {
    showTestDialog,
    setShowTestDialog,
    isTestRunning,
    isAnyRunning,
    isAnyPaused,
    isAnyStopping,
    isAnyForceStopping,
    isControlMutationPending,
    triggerMutation,
    testTriggerMutation,
    testStopMutation,
    handleMainAction,
    handlePauseResume,
    handleTestClick,
    handleTestConfirm,
    mainButtonTitle,
  } = useJobCardControls(job, lastExecution?.id ?? null, recentExecutions);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-2">
              <CardTitle className="text-lg">{job.name}</CardTitle>
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
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-sm">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">Schedule</p>
                <p className="text-muted-foreground">
                  {formatScheduleInterval(job.schedule)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 text-sm">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">Last Execution</p>
                {lastExecution ? (
                  <div className="flex items-center gap-2">
                    <ExecutionStatusBadge
                      status={lastExecution.status}
                      className="text-xs"
                    />
                    <span className="text-muted-foreground">
                      {formatLastRun(lastExecution.started_at)}
                    </span>
                    {lastExecution.completed_at && (
                      <span className="text-muted-foreground">
                        •{" "}
                        {formatDuration(
                          lastExecution.started_at,
                          lastExecution.completed_at,
                        )}
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
            onClick={() => setShowHistory(!showHistory)}
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

        {showHistory && (
          <JobCardHistory
            recentExecutions={recentExecutions}
            isAnyForceStopping={isAnyForceStopping}
            onExecutionClick={onExecutionClick}
          />
        )}
      </CardContent>

      <JobCardTestDialog
        open={showTestDialog}
        onOpenChange={setShowTestDialog}
        onConfirm={handleTestConfirm}
      />
    </Card>
  );
}
