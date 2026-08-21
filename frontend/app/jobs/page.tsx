"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap, validatedGet } from "@/lib/core/api";
import {
  JobConfigurationSchema,
  JobConfiguration,
  JobStatusResponseSchema,
} from "@/lib/core/schemas";
import { JobCard, JobExecutions, SystemStatus } from "@/features/jobs";
import { ProtectedRoute } from "@/features/auth";

import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertCircle, Clock } from "lucide-react";
import { z } from "zod";

import { JOBS_REFRESH_INTERVAL_MS } from "@/features/jobs/refresh-interval";

function RefreshCountdown({ lastUpdate }: { lastUpdate: number }) {
  // Its own component, and its own second: the countdown is a pure function
  // of the wall clock read by one <span>, and ticking it in the page re-ran
  // every job card ten times a second for a number that changes once.
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(
    JOBS_REFRESH_INTERVAL_MS / 1000,
  );

  useEffect(() => {
    if (lastUpdate === 0) return;

    const tick = () =>
      setSecondsUntilRefresh(
        Math.max(
          0,
          Math.ceil(
            (JOBS_REFRESH_INTERVAL_MS - (Date.now() - lastUpdate)) / 1000,
          ),
        ),
      );
    tick();
    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [lastUpdate]);

  return <span>Auto-refresh in {secondsUntilRefresh}s</span>;
}

export default function JobsPage() {
  return (
    <ProtectedRoute requireAdmin>
      <JobsPageContent />
    </ProtectedRoute>
  );
}

function JobsPageContent() {
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
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
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
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });

  const jobs = jobsResult ?? [];
  const status = statusResult ?? null;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <Card id="header-card" className="mb-6 p-6 text-white">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Background Jobs</h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-white/70">
              <Clock className="h-4 w-4" />
              <RefreshCountdown
                lastUpdate={Math.max(jobsUpdatedAt, statusUpdatedAt)}
              />
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
          <JobExecutions
            jobs={jobs}
            selectedExecutionId={selectedExecutionId}
            onExecutionSelect={setSelectedExecutionId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
