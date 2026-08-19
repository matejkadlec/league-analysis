import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { validatedPost } from "@/lib/core/api";
import { useToast } from "@/lib/core/hooks";
import {
  JobConfiguration,
  JobControlActionResponseSchema,
  JobExecution,
  JobTriggerResponseSchema,
} from "@/lib/core/schemas";

export function useJobCardControls(
  job: JobConfiguration,
  lastExecutionId: number | null,
  recentExecutions: JobExecution[],
) {
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [optimisticTestRunning, setOptimisticTestRunning] = useState<
    boolean | null
  >(null);
  const awaitingManualRunRef = useRef(false);
  const manualRunBaselineIdRef = useRef<number | null>(null);
  const manualRunRequestedAtRef = useRef<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isRunning = job.is_running;
  const serverTestRunning = job.is_test_running;
  const isTestRunning =
    optimisticTestRunning !== null ? optimisticTestRunning : serverTestRunning;

  if (
    optimisticTestRunning !== null &&
    serverTestRunning === optimisticTestRunning
  ) {
    queueMicrotask(() => setOptimisticTestRunning(null));
  }

  const isAnyRunning = isRunning || isTestRunning;
  const isAnyPaused = isAnyRunning && job.is_paused;
  const isAnyStopping =
    (isRunning && job.is_stopping) || (isTestRunning && job.is_test_stopping);
  const isAnyForceStopping =
    (isRunning && job.is_force_stopping) ||
    (isTestRunning && job.is_test_force_stopping);

  const refreshJobsData = () => {
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["job-status"] });
    void queryClient.invalidateQueries({ queryKey: ["job-executions"] });
    void queryClient.invalidateQueries({ queryKey: ["job-executions-all"] });
    void queryClient.invalidateQueries({
      queryKey: ["job-executions-infinite"],
    });
    void queryClient.refetchQueries({ queryKey: ["jobs"], type: "active" });
  };

  useEffect(() => {
    if (!awaitingManualRunRef.current) {
      return;
    }

    const baselineId = manualRunBaselineIdRef.current;
    const requestedAt = manualRunRequestedAtRef.current;
    const manualExecution = recentExecutions.find((execution) => {
      if (execution.triggered_by !== "user") {
        return false;
      }
      if (baselineId !== null) {
        return execution.id > baselineId;
      }
      return (
        requestedAt !== null &&
        Date.parse(execution.started_at) >= requestedAt - 2_000
      );
    });

    if (
      !manualExecution ||
      manualExecution.status === "PENDING" ||
      manualExecution.status === "RUNNING" ||
      manualExecution.status === "PAUSED"
    ) {
      return;
    }

    awaitingManualRunRef.current = false;

    if (manualExecution.status === "SUCCESS") {
      toast({
        title: `${job.name} run finished`,
        description: "The manually triggered job completed successfully.",
        variant: "success",
      });
      return;
    }

    if (manualExecution.status === "RATE_LIMITED") {
      toast({
        title: `${job.name} run was rate limited`,
        description: "Riot temporarily limited requests. Try again later.",
        variant: "warning",
      });
      return;
    }

    if (manualExecution.status === "CANCELLED") {
      toast({
        title: `${job.name} run stopped`,
        description: "The manually triggered job is no longer active.",
        variant: "success",
      });
      return;
    }

    toast({
      title: `${job.name} run failed`,
      description: "Open the execution history for details, then try again.",
      variant: "error",
    });
  }, [job.name, recentExecutions, toast]);

  const triggerMutation = useMutation({
    mutationFn: () =>
      validatedPost(JobTriggerResponseSchema, `/jobs/${job.id}/trigger`),
    onSuccess: (result) => {
      if (result.success && result.data.success) {
        awaitingManualRunRef.current = true;
        manualRunBaselineIdRef.current = lastExecutionId;
        manualRunRequestedAtRef.current = Date.now();
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
      } else if (result.success) {
        toast({
          title: `${job.name} is already running`,
          description:
            "Wait for the current run to finish before trying again.",
          variant: "warning",
        });
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

  // The six control endpoints answer the same shape and want the same
  // toast-on-success / try-again-later-on-anything-else handling; only the
  // URL and the wording differ, so those are the only inputs.
  function useControlMutation<TArg = void>(
    buildUrl: (arg: TArg) => string,
    success: { title: string; description: string; variant: "success" | "info" },
    failureTitle: string,
    onSuccessExtra?: () => void,
  ) {
    const fail = () =>
      toast({
        title: failureTitle,
        description: "Please try again later.",
        variant: "error",
      });
    return useMutation({
      mutationFn: (arg: TArg) =>
        validatedPost(JobControlActionResponseSchema, buildUrl(arg)),
      onSuccess: (result) => {
        if (result.success && result.data.success) {
          toast(success);
          onSuccessExtra?.();
          refreshJobsData();
        } else {
          fail();
        }
      },
      onError: fail,
    });
  }

  const pauseMutation = useControlMutation(
    () => `/jobs/${job.id}/pause`,
    {
      title: `${job.name} paused`,
      description: "Scheduled runs will wait until the job is resumed.",
      variant: "success",
    },
    `${job.name} could not be paused`,
  );

  const resumeMutation = useControlMutation(
    () => `/jobs/${job.id}/resume`,
    {
      title: `${job.name} resumed`,
      description: "Scheduled runs are active again.",
      variant: "success",
    },
    `${job.name} could not be resumed`,
  );

  const stopMutation = useControlMutation(
    (force: boolean) => `/jobs/${job.id}/stop${force ? "?force=true" : ""}`,
    {
      title: `${job.name} stop requested`,
      description: "The current run is stopping in the background.",
      variant: "info",
    },
    `${job.name} could not be stopped`,
  );

  const testTriggerMutation = useMutation({
    mutationFn: (suspendRegular: boolean) =>
      validatedPost(
        JobTriggerResponseSchema,
        `/jobs/${job.id}/test${suspendRegular ? "?suspend_regular=true" : ""}`,
      ),
    onSuccess: (result) => {
      if (result.success && result.data.success) {
        toast({
          title: `${job.name} test started`,
          description: "The test run is running in the background.",
          variant: "info",
        });
        setOptimisticTestRunning(true);
        setTimeout(() => refreshJobsData(), 1500);
      } else if (result.success) {
        toast({
          title: `${job.name} test is already running`,
          description:
            "Wait for the current test to finish before trying again.",
          variant: "warning",
        });
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

  const testStopMutation = useControlMutation(
    () => `/jobs/${job.id}/test/stop`,
    {
      title: `${job.name} test stopped`,
      description: "The test run is no longer active.",
      variant: "success",
    },
    `${job.name} test could not be stopped`,
    () => setOptimisticTestRunning(false),
  );

  const testPauseMutation = useControlMutation(
    () => `/jobs/${job.id}/test/pause`,
    {
      title: `${job.name} test paused`,
      description: "The test run will wait until it is resumed.",
      variant: "success",
    },
    `${job.name} test could not be paused`,
  );

  const testResumeMutation = useControlMutation(
    () => `/jobs/${job.id}/test/resume`,
    {
      title: `${job.name} test resumed`,
      description: "The test run is active again.",
      variant: "success",
    },
    `${job.name} test could not be resumed`,
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
