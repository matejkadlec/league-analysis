// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobExecutionApiCalls } from "@/features/jobs/components/job-execution-api-calls";
import { JobExecutionLogs } from "@/features/jobs/components/job-execution-logs";
import { type APICallEntry } from "@/features/jobs/components/job-execution-format";

// The two renderers behind a job execution's expanded view. The format
// helpers they call are pinned by job-execution-format tests; what lives
// here and nowhere else is the conditional structure — which call gets an
// expander, which params are shown, and how a malformed log line degrades.

afterEach(cleanup);

const STARTED = "2026-08-19T10:00:00Z";

function call(overrides: Partial<APICallEntry> = {}): APICallEntry {
  return {
    endpoint: "/lol/match/v5/matches",
    region: "europe",
    count: 1,
    first_timestamp: "2026-08-19T10:00:05Z",
    ...overrides,
  };
}

function renderCalls(
  calls: APICallEntry[],
  {
    expanded = new Set<string>(),
    completedAt = null as string | null,
    onToggle = vi.fn(),
  } = {},
) {
  render(
    <JobExecutionApiCalls
      startedAt={STARTED}
      completedAt={completedAt}
      apiCalls={calls}
      expandedApiCalls={expanded}
      onToggleExpanded={onToggle}
    />,
  );
  return onToggle;
}

describe("the API calls transcript", () => {
  it("shows a single call with its params spelled out and no expander", () => {
    // `param_key` is present even on a single call — the range expander must
    // refuse on the count alone, or every one-call row grows a dead button.
    renderCalls([
      call({ params: { queue: "420" }, param_key: "queue", first_param: "420" }),
    ]);

    expect(screen.getByText(/Called \/lol\/match\/v5\/matches once/)).toBeTruthy();
    expect(screen.getByText("Queue: 420")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("collapses a repeated call into first, ..., last", () => {
    // 400 match fetches must not be 400 lines. The collapsed label carries
    // the range; the params of any single call would be wrong for the other
    // 399, so they must not render.
    renderCalls([
      call({
        count: 400,
        param_key: "matchId",
        first_param: "EUN1_1",
        last_param: "EUN1_400",
        params: { matchId: "EUN1_1" },
      }),
    ]);

    expect(screen.getByText(/Called .* 400 times/)).toBeTruthy();
    expect(screen.getByText(/Match IDs: EUN1_1, \.\.\., EUN1_400/)).toBeTruthy();
    expect(screen.queryByText("MatchId: EUN1_1")).toBeNull();
  });

  it("reports the toggle under the same key the expanded set is checked by", () => {
    // The parent stores expansion in a Set keyed by the endpoint (unique per
    // execution — the backend groups api_calls by it). A button that reports
    // any other string toggles an entry no render ever reads — the click
    // works, the row never opens.
    const entry = call({
      count: 400,
      param_key: "matchId",
      first_param: "EUN1_1",
      last_param: "EUN1_400",
    });
    const onToggle = renderCalls([entry]);

    fireEvent.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledWith(entry.endpoint);
  });

  it("opens the detail when the parent marks the key expanded", () => {
    const entry = call({
      count: 400,
      param_key: "matchId",
      first_param: "EUN1_1",
      last_param: "EUN1_400",
    });
    renderCalls([entry], { expanded: new Set([entry.endpoint]) });

    expect(screen.getByText("Collapse")).toBeTruthy();
    expect(screen.getByText(/\(400 total calls\)/)).toBeTruthy();
  });

  it("offers no expander for a repeated call with no parameter to range over", () => {
    renderCalls([call({ count: 3 })]);

    expect(screen.getByText(/3 times/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("closes the session line only once the run has completed", () => {
    renderCalls([]);
    expect(screen.queryByText(/session closed/)).toBeNull();

    cleanup();
    renderCalls([], { completedAt: "2026-08-19T10:05:00Z" });
    expect(screen.getByText(/session closed/)).toBeTruthy();
  });
});

describe("the detailed log lines", () => {
  it("normalises the level and keys the severity off it", () => {
    // The backend writes lowercase levels; the transcript reads uppercase.
    render(<JobExecutionLogs logs={[{ level: "error", event: "boom" }]} />);

    expect(screen.getByText("[ERROR]")).toBeTruthy();
  });

  it("treats a missing or malformed level as INFO", () => {
    render(<JobExecutionLogs logs={[{ level: 3, event: "odd" }]} />);

    expect(screen.getByText("[INFO]")).toBeTruthy();
  });

  it("counts the entries in the badge", () => {
    render(
      <JobExecutionLogs
        logs={[
          { level: "info", event: "a" },
          { level: "info", event: "b" },
        ]}
      />,
    );

    expect(screen.getByText("2 entries")).toBeTruthy();
  });

  it("shows extra fields once each, and standard fields not at all", () => {
    // Everything beyond level/timestamp/event is context worth reading;
    // repeating the standard three as "extras" would double every line.
    render(
      <JobExecutionLogs
        logs={[
          {
            level: "info",
            timestamp: "2026-08-19T10:00:00Z",
            event: "fetched",
            puuid: "p-1",
            detail: { region: "eun1" },
          },
        ]}
      />,
    );

    expect(screen.getByText(/Puuid: p-1/)).toBeTruthy();
    // Objects are serialised, not stringified into "[object Object]".
    expect(screen.getByText(/Detail: {"region":"eun1"}/)).toBeTruthy();
    expect(screen.queryByText(/Event:/)).toBeNull();
    expect(screen.queryByText(/Level:/)).toBeNull();
  });

  it("renders a log line with no event or timestamp rather than crashing", () => {
    render(<JobExecutionLogs logs={[{ level: "warning" }]} />);

    expect(screen.getByText("[WARNING]")).toBeTruthy();
  });
});
