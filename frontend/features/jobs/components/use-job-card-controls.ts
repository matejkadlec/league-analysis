import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { type ApiResponse, unwrap, validatedPost } from "@/lib/core/api";
import { useToast } from "@/lib/core/hooks";
import {
  JobConfiguration,
  type JobControlActionResponse,
  JobControlActionResponseSchema,
  JobExecution,
  JobTriggerResponseSchema,
} from "@/lib/core/schemas";

import { invalidateJobsData } from "../jobs-query";
import { useManualRunOutcome } from "./use-manual-run-outcome";

type ToastFn = ReturnType<typeof useToast>["toast"];

// The six control endpoints answer the same shape and want the same toast
// handling. The mutationFn stays at each call site because the backend's
// test_frontend_api_paths.py reads the validatedPost URL literal there.
function useControlMutation<TArg = void>(
  request: (arg: TArg) => Promise<ApiResponse<JobControlActionResponse>>,
  success: {
    title: string;
    description: string;
    variant: "success" | "info";
  },
  failureTitle: string,
  toast: ToastFn,
  onRefresh: () => void,
  onSuccessExtra?: () => void,
) {
  const fail = () =>
    toast({
      title: failureTitle,
      description: "Please try again later.",
      variant: "error",
    });
  return useMutation({
    mutationFn: async (arg: TArg) => unwrap(await request(arg)),
    onSuccess: (response) => {
      if (!response.success) {
        fail();
        return;
      }
      toast(success);
      onSuccessExtra?.();
      onRefresh();
    },
    // A rejected request is the same outcome for the viewer as a declined
    // one; only the announcement path differs.
    onError: () => fail(),
  });
}

export function useJobCardControls(
  job: JobConfiguration,
  lastExecutionId: number | null,
  recentExecutions: JobExecution[],
) {
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [optimisticTestRunning, setOptimisticTestRunning] = useState<
    boolean | null
  >(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const watchManualRun = useManualRunOutcome(job.name, recentExecutions);

  const isRunning = job.is_running;
  const serverTestRunning = job.is_test_running;
  const isTestRunning =
    optimisticTestRunning !== null ? optimisticTestRunning : serverTestRunning;

  // Drop the optimistic flag once the server agrees, during render: the guard
  // is false on the immediate re-render, so it converges without a commit.
  if (
    optimisticTestRunning !== null &&
    serverTestRunning === optimisticTestRunning
  ) {
    setOptimisticTestRunning(null);
  }

  const isAnyRunning = isRunning || isTestRunning;
  // Pause is per run: the scheduled run and a test run each carry their own
  // flag, mirroring how the stopping flags below are paired.
  const isAnyPaused =
    (isRunning && job.is_paused) || (isTestRunning && job.is_test_paused);
  const isAnyStopping =
    (isRunning && job.is_stopping) || (isTestRunning && job.is_test_stopping);
  const isAnyForceStopping =
    (isRunning && job.is_force_stopping) ||
    (isTestRunning && job.is_test_force_stopping);

  // Fire-and-forget on purpose: the toast already reported the outcome, and
  // the refetch is background work.
  const refreshJobsData = () => {
    void invalidateJobsData(queryClient);
  };

  // Every mutationFn unwraps, so a failed request rejects and `onError` (plus
  // the global `MutationCache.onError` reporting) runs; an HTTP 200 that
  // declines -- `data.success === false` -- stays in `onSuccess`.
  const triggerMutation = useMutation({
    mutationFn: async () =>
      unwrap(
        await validatedPost(JobTriggerResponseSchema, `/jobs/${job.id}/trigger`),
      ),
    onSuccess: (response) => {
      if (response.success) {
        watchManualRun(lastExecutionId);
        toast({
          title: `${job.name} run started`,
          description: "The job is running in the background.",
          variant: "info",
        });
        setTimeout(() => {
          refreshJobsData();
        }, 1500);

        setTimeout(() => {
          refreshJobsData();
        }, 5000);
      } else {
        toast({
          title: `${job.name} is already running`,
          description:
            "Wait for the current run to finish before trying again.",
          variant: "warning",
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

  const pauseMutation = useControlMutation(
    () =>
      validatedPost(JobControlActionResponseSchema, `/jobs/${job.id}/pause`),
    {
      title: `${job.name} paused`,
      description: "Scheduled runs will wait until the job is resumed.",
      variant: "success",
    },
    `${job.name} could not be paused`,
    toast,
    refreshJobsData,
  );

  const resumeMutation = useControlMutation(
    () =>
      validatedPost(JobControlActionResponseSchema, `/jobs/${job.id}/resume`),
    {
      title: `${job.name} resumed`,
      description: "Scheduled runs are active again.",
      variant: "success",
    },
    `${job.name} could not be resumed`,
    toast,
    refreshJobsData,
  );

  const stopMutation = useControlMutation(
    (force: boolean) =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/stop`,
        undefined,
        force ? { force: true } : undefined,
      ),
    {
      title: `${job.name} stop requested`,
      description: "The current run is stopping in the background.",
      variant: "info",
    },
    `${job.name} could not be stopped`,
    toast,
    refreshJobsData,
  );

  const testTriggerMutation = useMutation({
    mutationFn: async (suspendRegular: boolean) =>
      unwrap(
        await validatedPost(
          JobTriggerResponseSchema,
          `/jobs/${job.id}/test`,
          undefined,
          suspendRegular ? { suspend_regular: true } : undefined,
        ),
      ),
    onSuccess: (response) => {
      if (response.success) {
        toast({
          title: `${job.name} test started`,
          description: "The test run is running in the background.",
          variant: "info",
        });
        setOptimisticTestRunning(true);
        setTimeout(() => refreshJobsData(), 1500);
      } else {
        toast({
          title: `${job.name} test is already running`,
          description:
            "Wait for the current test to finish before trying again.",
          variant: "warning",
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

  const testStopMutation = useControlMutation(
    () =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/test/stop`,
      ),
    {
      title: `${job.name} test stopped`,
      description: "The test run is no longer active.",
      variant: "success",
    },
    `${job.name} test could not be stopped`,
    toast,
    refreshJobsData,
    () => setOptimisticTestRunning(false),
  );

  const testPauseMutation = useControlMutation(
    () =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/test/pause`,
      ),
    {
      title: `${job.name} test paused`,
      description: "The test run will wait until it is resumed.",
      variant: "success",
    },
    `${job.name} test could not be paused`,
    toast,
    refreshJobsData,
  );

  const testResumeMutation = useControlMutation(
    () =>
      validatedPost(
        JobControlActionResponseSchema,
        `/jobs/${job.id}/test/resume`,
      ),
    {
      title: `${job.name} test resumed`,
      description: "The test run is active again.",
      variant: "success",
    },
    `${job.name} test could not be resumed`,
    toast,
    refreshJobsData,
  );

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
      // Resume the run whose own flag is set — routing by isTestRunning
      // alone would resume the (unpaused) test run and leave a paused
      // scheduled run unreachable for as long as any test run exists.
      if (isTestRunning && job.is_test_paused) {
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
      handlePauseResume();
      return;
    }

    if (isTestRunning) {
      testStopMutation.mutate();
      return;
    }

    if (isRunning) {
      stopMutation.mutate(isAnyStopping);
      return;
    }

    handleTrigger();
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

  return {
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
  };
}
