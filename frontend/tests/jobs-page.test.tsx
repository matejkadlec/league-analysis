// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet, useAuth } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
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

// The three children are stubbed because what is under test here is the
// page's own wiring: which tab is showing, which of the four job-list states
// is rendered, and whether a click inside a job card reaches the other tab.
// Each stub keeps the one prop the page is responsible for passing.
vi.mock("@/features/jobs", () => ({
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

const JOB = { id: 1, name: "Match Fetcher" };

function answer(url: string) {
  if (url === "/jobs/") return { success: true, data: [JOB] };
  if (url === "/jobs/executions/all")
    return { success: true, data: { items: [], total: 0, page: 1, size: 20 } };
  return { success: true, data: { scheduler_running: true } };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <JobsPage />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

beforeEach(() => {
  validatedGet.mockReset();
  validatedGet.mockImplementation((_schema: unknown, url: string) =>
    Promise.resolve(answer(url)),
  );
  useAuth.mockReturnValue({
    user: { id: 1, is_admin: true, is_active: true },
    isAuthenticated: true,
    isLoading: false,
  });
});

afterEach(cleanup);

describe("the background jobs page", () => {
  it("shows nothing at all to an account that is not an admin", async () => {
    // The page lists every player's sync state and the Riot key's health. The
    // `requireAdmin` flag is asserted as source text elsewhere; this asserts
    // what a non-admin actually sees, which is the refusal and none of it.
    useAuth.mockReturnValue({
      user: { id: 2, is_admin: false, is_active: true },
      isAuthenticated: true,
      isLoading: false,
    });
    const { queryClient } = renderPage();

    expect(screen.getByText(/limited to administrators/)).toBeTruthy();
    expect(screen.queryByText("Background Jobs")).toBeNull();
    queryClient.clear();
  });

  it("carries a click inside a job card over to the executions tab", async () => {
    // The two tabs are siblings and the selected execution lives above both.
    // Without the tab switch, clicking an execution in a job card selects it
    // in a list nobody is looking at, and the click reads as broken.
    const { queryClient } = renderPage();

    await waitFor(() =>
      expect(screen.getByText(/job card Match Fetcher/)).toBeTruthy(),
    );
    // The inactive panel must be absent, not merely hidden. This is the only
    // assertion in the suite that touches `components/ui/tabs.tsx`, whose one
    // consumer is this page: replace `TabsContent` with something that always
    // renders and both panels stack on top of each other, which no assertion
    // about the *active* tab can see.
    expect(screen.queryByText(/executions list/)).toBeNull();

    fireEvent.click(screen.getByText(/job card Match Fetcher/));

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
          ? { success: false, error: { status: 500, kind: "server" } }
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
          ? { success: false, error: { status: 200, kind: "validation" } }
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

      await vi.advanceTimersByTimeAsync(3000);
      await waitFor(() =>
        expect(screen.getByText(/Auto-refresh in 1[12]s/)).toBeTruthy(),
      );

      queryClient.clear();
    } finally {
      vi.useRealTimers();
    }
  });
});
