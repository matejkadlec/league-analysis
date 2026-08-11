// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
}));

vi.mock("@/lib/core/api", () => ({
  validatedGet,
  validatedPost: vi.fn(),
}));

import { JobCard } from "@/features/jobs/components/job-card";
import type { JobConfiguration } from "@/lib/core/schemas";

const job: JobConfiguration = {
  id: 7,
  job_type: "MATCH_FETCHER",
  name: "Match Fetcher",
  description:
    "Fetches new matches and updates player's match history and rank progression",
  schedule: "3600",
  is_active: true,
  is_paused: false,
  is_running: false,
  is_stopping: false,
  is_force_stopping: false,
  is_test_running: false,
  is_test_stopping: false,
  is_test_force_stopping: false,
  config_json: { enabled_queue_ids: [] },
  created_at: "2026-08-11T00:00:00Z",
  updated_at: "2026-08-11T00:00:00Z",
};

describe("Match Fetcher job card", () => {
  beforeEach(() => {
    validatedGet.mockReset();
    validatedGet.mockResolvedValue({
      success: true,
      data: { executions: [], total: 0, page: 1, size: 5, pages: 0 },
    });
  });

  afterEach(() => cleanup());

  it("keeps job controls while removing obsolete per-queue checkboxes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <JobCard job={job} />
      </QueryClientProvider>,
    );

    await screen.findByText("Never");

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText("Ranked Solo/Duo")).toBeNull();
    expect(screen.getByText(job.description as string)).toBeTruthy();
    expect(screen.getByRole("button", { name: /trigger now/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /history/i })).toBeTruthy();

    queryClient.clear();
  });
});
