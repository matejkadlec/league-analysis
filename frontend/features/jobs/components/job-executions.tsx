"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { JobExecution, JobConfiguration } from "@/lib/core/schemas";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";

import { JobExecutionDetailsDialog } from "./job-execution-details-dialog";
import { jobExecutionsInfiniteQueryOptions } from "../jobs-query";
import { JobExecutionsTable } from "./job-executions-table";

interface JobExecutionsProps {
  jobs: JobConfiguration[];
  selectedExecutionId?: number | null;
  onExecutionSelect?: (executionId: number | null) => void;
}

export function JobExecutions({
  jobs,
  selectedExecutionId,
  onExecutionSelect,
}: JobExecutionsProps) {
  const [selectedExecutionState, setSelectedExecutionState] =
    useState<JobExecution | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const jobNameMap = useMemo(
    () => new Map(jobs.map((job) => [job.id, job.name] as const)),
    [jobs],
  );

  const { data, isError, isLoading, isFetching, hasNextPage, fetchNextPage } =
    useInfiniteQuery(jobExecutionsInfiniteQueryOptions());

  // A failed poll must not empty a table someone is reading: the queryFn
  // re-throws rather than returning a failure envelope, so React Query keeps
  // the previous pages stale and this reads them.
  const allExecutions = useMemo(
    () => data?.pages.flatMap((page) => page.executions) ?? [],
    [data],
  );
  const totalExecutions = data?.pages.at(-1)?.total ?? 0;
  const internalSelectedExecution = useMemo(() => {
    if (selectedExecutionId !== undefined && selectedExecutionId !== null) {
      return (
        allExecutions.find(
          (execution) => execution.id === selectedExecutionId,
        ) ?? null
      );
    }
    return selectedExecutionState;
  }, [selectedExecutionId, allExecutions, selectedExecutionState]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && hasNextPage && !isFetching) {
          void fetchNextPage();
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
  }, [fetchNextPage, hasNextPage, isFetching]);

  const getJobName = (jobConfigId: number): string => {
    return jobNameMap.get(jobConfigId) || `Job #${jobConfigId}`;
  };

  const handleSelectExecution = (execution: JobExecution) => {
    setSelectedExecutionState(execution);
    onExecutionSelect?.(execution.id);
  };

  const handleCloseDialog = () => {
    setSelectedExecutionState(null);
    onExecutionSelect?.(null);
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

  // Without this arm a failed first load renders the empty state below, so a
  // scheduler whose API is down reads as one that has never run. Later failures
  // keep their pages, so `allExecutions` is non-empty and the table stays up.
  if (isError && allExecutions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Execution history could not be loaded. It is retried
              automatically.
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
          <JobExecutionsTable
            executions={allExecutions}
            getJobName={getJobName}
            onSelectExecution={handleSelectExecution}
          />

          <div ref={loadMoreRef} className="mt-4 flex justify-center py-4">
            {isFetching ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading more executions...</span>
              </div>
            ) : hasNextPage ? (
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

      <JobExecutionDetailsDialog
        execution={internalSelectedExecution}
        onOpenChange={(open) => !open && handleCloseDialog()}
      />
    </>
  );
}
