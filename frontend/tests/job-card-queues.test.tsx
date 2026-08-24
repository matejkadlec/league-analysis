// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "./render-support";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toast, validatedGet, validatedPost } = vi.hoisted(() => ({
  toast: vi.fn(),
  validatedGet: vi.fn(),
  validatedPost: vi.fn(),
}));

// Spread the real module: a literal factory silently omits any export the
// components start importing later, and the failure reads as a render timeout.
vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({ toast }),
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
  interval_seconds: 3600,
  is_active: true,
  is_paused: false,
  is_running: false,
  is_stopping: false,
  is_force_stopping: false,
  is_test_running: false,
  is_test_paused: false,
  is_test_stopping: false,
  is_test_force_stopping: false,
  config_json: { enabled_queue_ids: [] },
  created_at: "2026-08-11T00:00:00Z",
  updated_at: "2026-08-11T00:00:00Z",
};

describe("Match Fetcher job card", () => {
  beforeEach(() => {
    toast.mockReset();
    validatedGet.mockReset();
    validatedPost.mockReset();
    validatedGet.mockResolvedValue({
      success: true,
      data: { executions: [], total: 0, page: 1, size: 5, pages: 0 },
    });
  });


  it("keeps job controls while removing obsolete per-queue checkboxes", async () => {
    const { queryClient } = renderWithQueryClient(<JobCard job={job} />);

    await screen.findByText("Never");

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText("Ranked Solo/Duo")).toBeNull();
    expect(screen.getByText(job.description as string)).toBeTruthy();
    expect(screen.getByRole("button", { name: /trigger now/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /history/i })).toBeTruthy();

    queryClient.clear();
  });

  it("reports a manually triggered job as success only after it finishes", async () => {
    validatedPost.mockResolvedValue({
      success: true,
      data: { success: true, message: "Job triggered", execution_id: null },
    });
    const user = userEvent.setup();

    const { queryClient } = renderWithQueryClient(<JobCard job={job} />);

    await screen.findByText("Never");
    await user.click(screen.getByRole("button", { name: /trigger now/i }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "Match Fetcher run started",
        description: "The job is running in the background.",
        variant: "info",
      });
    });

    // The cache holds what `unwrap` returned, not the `ApiResponse` envelope.
    queryClient.setQueryData(["job-executions", job.id], {
      executions: [
        {
          id: 81,
          job_config_id: job.id,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          status: "SUCCESS",
          api_requests_made: 4,
          records_created: 0,
          records_updated: 2,
          triggered_by: "user",
          has_api_key_error: false,
          execution_type: "REGULAR",
        },
      ],
      total: 1,
      page: 1,
      size: 5,
      pages: 1,
    });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "Match Fetcher run finished",
        description: "The manually triggered job completed successfully.",
        variant: "success",
      });
    });

    queryClient.clear();
  });
});
