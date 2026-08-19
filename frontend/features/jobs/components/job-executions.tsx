"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { validatedGet } from "@/lib/core/api";
import {
  JobExecutionListResponse,
  JobExecution,
  JobExecutionListResponseSchema,
  JobConfiguration,
} from "@/lib/core/schemas";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Loader2 } from "lucide-react";

import { JobExecutionDetailsDialog } from "./job-execution-details-dialog";
import { JobExecutionsTable } from "./job-executions-table";

interface JobExecutionsProps {
  executions: JobExecutionListResponse | null;
  jobs: JobConfiguration[];
  selectedExecutionId?: number | null;
  onExecutionSelect?: (executionId: number | null) => void;
}

export function JobExecutions({
  executions: initialExecutions,
  jobs,
  selectedExecutionId,
  onExecutionSelect,
}: JobExecutionsProps) {
  const [selectedExecutionState, setSelectedExecutionState] =
    useState<JobExecution | null>(null);
  const [expandedApiCalls, setExpandedApiCalls] = useState<Set<string>>(
    new Set(),
  );
  const PAGE_SIZE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const jobNameMap = useMemo(() => {
    const map = new Map<number, string>();
    jobs.forEach((job) => map.set(job.id, job.name));
    return map;
  }, [jobs]);

  // Fixed-size pages, not one growing request: the backend caps `size` at
  // 100, so the old growing-`size` query 422'd on the sixth load-more.
  // Tradeoff accepted with the switch: `refetchInterval` refreshes every
  // loaded page each tick (N small requests instead of one big one).
  //
  // The failure envelope is deliberately re-thrown: returned as data, a
  // single failed 15-second poll would *replace* every loaded page and
  // truncate the list to page 1 until someone scrolls it back in. Thrown,
  // React Query keeps the previous pages (and their pageParams) stale and
  // retries on the next tick.
  const { data, isLoading, isFetching, hasNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ["job-executions-infinite"],
      queryFn: async ({ pageParam }) => {
        const result = await validatedGet(
          JobExecutionListResponseSchema,
          "/jobs/executions/all",
          { page: pageParam, size: PAGE_SIZE },
        );
        if (!result.success) {
          throw new Error(result.error.message);
        }
        return result.data;
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce(
          (sum, page) => sum + page.executions.length,
          0,
        );
        return loaded < lastPage.total ? allPages.length + 1 : undefined;
      },
      enabled: !!initialExecutions,
      refetchInterval: 15000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    });

  // Until the query has ever succeeded, fall back to the executions the page
  // handed in — the poll re-runs every 15 seconds behind a table someone is
  // reading, and a failed poll must not empty it.
  const allExecutions = useMemo(
    () =>
      data?.pages.flatMap((page) => page.executions) ??
      initialExecutions?.executions ??
      [],
    [data, initialExecutions],
  );
  const totalExecutions =
    (data?.pages.at(-1)?.total ?? initialExecutions?.total) || 0;
  const hasMore = hasNextPage || allExecutions.length < totalExecutions;
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
        if (first?.isIntersecting && hasMore && !isFetching) {
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
  }, [fetchNextPage, hasMore, isFetching]);

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

      <JobExecutionDetailsDialog
        execution={internalSelectedExecution}
        expandedApiCalls={expandedApiCalls}
        onOpenChange={(open) => !open && handleCloseDialog()}
        onToggleApiCall={toggleApiCallExpanded}
      />
    </>
  );
}
