"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap, validatedGet } from "@/lib/core/api";
import {
  JobConfigurationSchema,
  JobConfiguration,
  JobExecutionListResponseSchema,
  JobStatusResponseSchema,
} from "@/lib/core/schemas";
import { JobCard, JobExecutions, SystemStatus } from "@/features/jobs";
import { ProtectedRoute } from "@/features/auth";

import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertCircle, Clock } from "lucide-react";
import { z } from "zod";

const REFRESH_INTERVAL = 15000; // 15 seconds

export default function JobsPage() {
  return (
    <ProtectedRoute requireAdmin>
      <JobsPageContent />
    </ProtectedRoute>
  );
}

function JobsPageContent() {
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(15);
  const [activeTab, setActiveTab] = useState("jobs");
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(
    null,
  );

  // Handler for when an execution is clicked in a job card
  const handleExecutionClick = (executionId: number) => {
    setSelectedExecutionId(executionId);
    setActiveTab("executions");
  };

  // Fetch all job configurations
  const {
    data: jobsResult,
    isLoading: isLoadingJobs,
    error: jobsError,
    dataUpdatedAt: jobsUpdatedAt,
  } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () =>
      unwrap(
        await validatedGet(z.array(JobConfigurationSchema), "/jobs/", {
          active_only: false,
        }),
      ),
    refetchInterval: REFRESH_INTERVAL,
  });

  // Fetch all recent executions
  const { data: executionsResult, isLoading: isLoadingExecutions } = useQuery({
    queryKey: ["job-executions-all"],
    queryFn: async () =>
      unwrap(
        await validatedGet(
          JobExecutionListResponseSchema,
          "/jobs/executions/all",
          { page: 1, size: 20 },
        ),
      ),
    // No `refetchInterval`: `JobExecutions` polls this exact URL and query
    // string on the same 15s interval under its own infinite-query key. This
    // one fetches once per mount, to gate that query and to seed its first
    // paint.
  });

  // Fetch system status
  const {
    data: statusResult,
    isLoading: isLoadingStatus,
    dataUpdatedAt: statusUpdatedAt,
  } = useQuery({
    queryKey: ["job-status"],
    queryFn: async () =>
      unwrap(await validatedGet(JobStatusResponseSchema, "/jobs/status/overview")),
    refetchInterval: REFRESH_INTERVAL,
  });

  // Countdown timer for next refresh
  useEffect(() => {
    const lastUpdate = Math.max(jobsUpdatedAt, statusUpdatedAt);
    if (lastUpdate === 0) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastUpdate;
      const remaining = Math.max(
        0,
        Math.ceil((REFRESH_INTERVAL - elapsed) / 1000),
      );
      setSecondsUntilRefresh(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [jobsUpdatedAt, statusUpdatedAt]);

  const jobs = jobsResult ?? [];
  const executions = executionsResult ?? null;
  const status = statusResult ?? null;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <Card
        id="header-card"
        className="mb-6 bg-[#152b56] p-6 text-white dark:bg-[#0a1428]"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Background Jobs</h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-white/70">
              <Clock className="h-4 w-4" />
              <span>Auto-refresh in {secondsUntilRefresh}s</span>
            </div>
          </div>
        </div>
        <p className="text-sm leading-relaxed">
          Monitor and manage automated background jobs for player tracking and
          data processing
        </p>
      </Card>

      {/* System Status Dashboard */}
      <div className="mb-6">
        {isLoadingStatus ? (
          <Card className="p-8">
            <div className="flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          </Card>
        ) : (
          <SystemStatus status={status} />
        )}
      </div>

      {/* Tabs for Jobs and Executions */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="jobs">Job Configurations</TabsTrigger>
          <TabsTrigger value="executions">Job Executions</TabsTrigger>
        </TabsList>

        {/* Job Configurations Tab */}
        <TabsContent value="jobs" className="mt-6">
          {isLoadingJobs ? (
            <Card className="p-8">
              <div className="flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            </Card>
          ) : jobsError ? (
            <Card className="p-8">
              <div className="flex flex-col items-center justify-center gap-2">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-muted-foreground">
                  Failed to load job configurations
                </p>
              </div>
            </Card>
          ) : jobs.length === 0 ? (
            <Card className="p-8">
              <p className="text-center text-muted-foreground">
                No job configurations found
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {jobs.map((job: JobConfiguration) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onExecutionClick={handleExecutionClick}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Recent Executions Tab */}
        <TabsContent value="executions" className="mt-6">
          {isLoadingExecutions ? (
            <Card className="p-8">
              <div className="flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            </Card>
          ) : (
            <JobExecutions
              executions={executions}
              jobs={jobs}
              selectedExecutionId={selectedExecutionId}
              onExecutionSelect={setSelectedExecutionId}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
