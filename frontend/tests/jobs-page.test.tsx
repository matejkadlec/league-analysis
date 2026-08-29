// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithQueryClient } from "./support/render-support";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet, useAuth } = vi.hoisted(() => ({
  validatedGet: vi.fn<typeof import("@/lib/core/http/api").validatedGet>(),
  useAuth:
    vi.fn<typeof import("@/features/auth/context/auth-context").useAuth>(),
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
}));

// The context module, not the `@/features/auth` barrel: `ProtectedRoute`
// imports `useAuth` by relative path, so mocking the barrel leaves it reading
// the real context and throwing "must be used within an AuthProvider".
vi.mock("@/features/auth/context/auth-context", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/auth/context/auth-context")
  >()),
  useAuth,
}));

// The three children are stubbed because what is under test here is the page's
// own wiring: which tab is showing, which job-list state is rendered, and
// whether a click inside a job card reaches the other tab.
vi.mock("@/features/jobs", async (importOriginal) => ({
  ...(await importOriginal()),
  JobCard: ({
    job,
    onExecutionClick,
  }: {
    job: { id: number; name: string };
    onExecutionClick: (id: number) => void;
  }) => (
    <button type="button" onClick={() => onExecutionClick(42)}>
      job card {job.name}
    </button>
  ),
  JobExecutions: ({
    selectedExecutionId,
  }: {
    selectedExecutionId: number | null;
  }) => <div>executions list, selected: {String(selectedExecutionId)}</div>,
  SystemStatus: ({ status }: { status: unknown }) => (
    <div>system status: {status === null ? "none" : "present"}</div>
  ),
}));

import JobsPage from "@/app/jobs/page";
import type { ApiResponse } from "@/lib/core/http/api";
import type { AuthContextType } from "@/features/auth/types";

const JOB = { id: 1, name: "Match Fetcher" };

function answer(url: string): ApiResponse<unknown> {
  if (url === "/jobs/") return { success: true, data: [JOB] };
  if (url === "/jobs/executions/all")
    return { success: true, data: { items: [], total: 0, page: 1, size: 20 } };
  return { success: true, data: { scheduler_running: true } };
}

/** The whole context, because that is what `useAuth` answers with. */
function signedInAs({
  id,
  is_admin,
}: {
  id: number;
  is_admin: boolean;
}): AuthContextType {
  return {
    user: {
      id,
      is_admin,
      email: `account-${id}@example.test`,
      display_name: `Account ${id}`,
      is_active: true,
      email_verified: true,
      email_verified_at: null,
      last_login: null,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    checkAuth: async () => {},
  };
}

function renderPage() {
  return renderWithQueryClient(<JobsPage />);
}

beforeEach(() => {
  validatedGet.mockReset();
  validatedGet.mockImplementation((_schema: unknown, url: string) =>
    Promise.resolve(answer(url)),
  );
  useAuth.mockReturnValue(signedInAs({ id: 1, is_admin: true }));
});


describe("the background jobs page", () => {
  it("shows nothing at all to an account that is not an admin", async () => {
    // The page lists every player's sync state and the Riot key's health. The
    // `requireAdmin` flag is asserted as source text elsewhere; this asserts
    // what a non-admin actually sees, which is the refusal and none of it.
    useAuth.mockReturnValue(signedInAs({ id: 2, is_admin: false }));
    const { queryClient } = renderPage();

    expect(screen.getByText(/limited to administrators/)).toBeTruthy();
    expect(screen.queryByText("Background Jobs")).toBeNull();
    queryClient.clear();
  });

  it("carries a click inside a job card over to the executions tab", async () => {
    const user = userEvent.setup();
    // The two tabs are siblings and the selected execution lives above both.
    // Without the tab switch, clicking an execution in a job card selects it
    // in a list nobody is looking at, and the click reads as broken.
    const { queryClient } = renderPage();

    await waitFor(() =>
      expect(screen.getByText(/job card Match Fetcher/)).toBeTruthy(),
    );
    // The inactive panel must be absent, not merely hidden: a `TabsContent`
    // that always rendered would stack both panels, which no assertion about
    // the active tab can see.
    expect(screen.queryByText(/executions list/)).toBeNull();

    await user.click(screen.getByText(/job card Match Fetcher/));

    await waitFor(() =>
      expect(screen.getByText(/executions list, selected: 42/)).toBeTruthy(),
    );
    queryClient.clear();
  });

  it("tells a failed load apart from an empty one", async () => {
    // Both leave `jobs` as `[]`, and they need opposite actions: one is
    // someone to fix, the other is someone to add a job. Collapse them and
    // an outage reads as a tidy, empty system.
    validatedGet.mockImplementation((_schema: unknown, url: string) =>
      Promise.resolve(
        url === "/jobs/"
          ? {
              success: false,
              error: {
                status: 500,
                kind: "service",
                message: "The service is unavailable.",
              },
            }
          : answer(url),
      ),
    );
    const { queryClient } = renderPage();

    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load job configurations/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/No job configurations found/)).toBeNull();
    queryClient.clear();
  });

  it("says so when the list is genuinely empty", async () => {
    validatedGet.mockImplementation((_schema: unknown, url: string) =>
      Promise.resolve(
        url === "/jobs/" ? { success: true, data: [] } : answer(url),
      ),
    );
    const { queryClient } = renderPage();

    await waitFor(() =>
      expect(screen.getByText(/No job configurations found/)).toBeTruthy(),
    );
    expect(screen.queryByText(/Failed to load/)).toBeNull();
    queryClient.clear();
  });

  it("hands the status card nothing rather than a rejected payload", async () => {
    // A response that fails schema validation is not a status. Passing
    // `statusResult.data` through regardless would put unvalidated fields on
    // the dashboard four cards wide.
    validatedGet.mockImplementation((_schema: unknown, url: string) =>
      Promise.resolve(
        url === "/jobs/status/overview"
          ? {
              success: false,
              error: {
                status: 200,
                kind: "validation",
                message: "The response did not match the schema.",
              },
            }
          : answer(url),
      ),
    );
    const { queryClient } = renderPage();

    await waitFor(() =>
      expect(screen.getByText(/system status: none/)).toBeTruthy(),
    );
    queryClient.clear();
  });

  it("counts down towards the next refresh rather than sitting still", async () => {
    // The countdown is the only thing on the page that says the numbers are
    // live. Stuck at 15 it is decoration; stuck at 0 it reads as a stall.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { queryClient } = renderPage();

      await waitFor(() =>
        expect(screen.getByText(/job card Match Fetcher/)).toBeTruthy(),
      );

      // The window is wide because `shouldAdvanceTime` lets real elapsed time add to
      // the mocked clock and the gate runs on a Pi that also runs deploys. Still
      // narrow enough to fail on a countdown that does not move or has bottomed out.
      await vi.advanceTimersByTimeAsync(3000);
      await waitFor(() =>
        expect(
          screen.getByText(/Auto-refresh in (?:[5-9]|1[0-2])s/),
        ).toBeTruthy(),
      );

      queryClient.clear();
    } finally {
      vi.useRealTimers();
    }
  });
});
