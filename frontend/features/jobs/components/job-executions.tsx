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
  const [displayCount, setDisplayCount] = useState(20);
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
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 0,
  });

  const data = response?.success ? response.data : initialExecutions;
  const allExecutions = useMemo(
    () => data?.executions || [],
    [data?.executions],
  );
  const totalExecutions = data?.total || 0;
  const hasMore = allExecutions.length < totalExecutions;
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

  const loadMore = useCallback(() => {
    if (!isFetching && hasMore) {
      setDisplayCount((prev) => prev + PAGE_SIZE);
    }
  }, [isFetching, hasMore]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && hasMore && !isFetching) {
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
