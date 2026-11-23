"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { JobConfiguration } from "@/lib/core/schemas";
import {
  JobCard,
  JobExecutions,
  SystemStatus,
  jobsQueryOptions,
  jobStatusQueryOptions,
} from "@/features/jobs";
import { ProtectedRoute } from "@/features/auth";

import { PageHeader } from "@/components/page-header";
import { PageSections, Section, SectionRow } from "@/components/page-sections";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Clock } from "lucide-react";

import { JOBS_REFRESH_INTERVAL_MS } from "@/features/jobs";

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

// Placeholders in the loaded geometry: the four status tiles, and the job
// cards as one row, so the tabs and executions below do not jump.
function SystemStatusSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-busy="true">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="space-y-3 p-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-16" />
        </Card>
      ))}
    </div>
  );
}

function JobCardSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
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

  const handleExecutionClick = (executionId: number) => {
    setSelectedExecutionId(executionId);
    setActiveTab("executions");
  };

  const {
    data: jobsResult,
    isLoading: isLoadingJobs,
    error: jobsError,
    dataUpdatedAt: jobsUpdatedAt,
  } = useQuery(jobsQueryOptions());

  const {
    data: statusResult,
    isLoading: isLoadingStatus,
    dataUpdatedAt: statusUpdatedAt,
  } = useQuery(jobStatusQueryOptions());

  const jobs = jobsResult ?? [];
  const status = statusResult ?? null;

  return (
    <div className="container mx-auto px-4 py-8">
      <PageSections>
        <PageHeader
          title="Background Jobs"
          titleSub={
            <div className="mt-2 flex items-center gap-2 text-sm text-white/70">
              <Clock className="h-4 w-4" />
              <RefreshCountdown
                lastUpdate={Math.max(jobsUpdatedAt, statusUpdatedAt)}
              />
            </div>
          }
        >
          <p className="text-sm leading-relaxed">
            Monitor and manage automated background jobs for player tracking and
            data processing
          </p>
        </PageHeader>

        <Section>
          {isLoadingStatus ? (
            <SystemStatusSkeleton />
          ) : (
            <SystemStatus status={status} />
          )}
        </Section>

        <Section>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="jobs">Job Configurations</TabsTrigger>
              <TabsTrigger value="executions">Job Executions</TabsTrigger>
            </TabsList>

            <TabsContent value="jobs" className="mt-6">
              {isLoadingJobs ? (
                <SectionRow>
                  <JobCardSkeleton />
                  <JobCardSkeleton />
                </SectionRow>
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
                // Every job card has the same parts, so they balance by
                // construction and share lines two at a time.
                <SectionRow>
                  {jobs.map((job: JobConfiguration) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      onExecutionClick={handleExecutionClick}
                    />
                  ))}
                </SectionRow>
              )}
            </TabsContent>

            <TabsContent value="executions" className="mt-6">
              <JobExecutions
                jobs={jobs}
                selectedExecutionId={selectedExecutionId}
                onExecutionSelect={setSelectedExecutionId}
              />
            </TabsContent>
          </Tabs>
        </Section>
      </PageSections>
    </div>
  );
}
