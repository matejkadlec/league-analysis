"use client";

import { useState } from "react";
import { ChevronUp } from "lucide-react";

import type { JobExecutionApiCall } from "@/lib/core/schemas";

import {
  formatApiCallParamLabel,
  formatJobTimestamp,
} from "./job-execution-format";

interface JobExecutionApiCallsProps {
  startedAt: string;
  completedAt: string | null | undefined;
  apiCalls: JobExecutionApiCall[];
}

export function JobExecutionApiCalls({
  startedAt,
  completedAt,
  apiCalls,
}: JobExecutionApiCallsProps) {
  // The expansion keys are endpoints, unique only within one execution, so
  // the state lives here and the dialog remounts this component per
  // execution (`key={execution.id}`) — every dialog starts collapsed.
  const [expandedApiCalls, setExpandedApiCalls] = useState<Set<string>>(
    new Set(),
  );
  const onToggleExpanded = (endpoint: string) => {
    setExpandedApiCalls((prev) => {
      const next = new Set(prev);
      if (next.has(endpoint)) {
        next.delete(endpoint);
      } else {
        next.add(endpoint);
      }
      return next;
    });
  };
  return (
    <div className="rounded-lg border bg-muted/50 p-4">
      <p className="mb-3 font-medium">API Calls</p>
      <div className="max-h-[300px] overflow-auto rounded-md border bg-background p-3">
        <div className="space-y-2 font-mono text-[11px]">
          <div className="text-blue-400">
            [INFO] [{formatJobTimestamp(startedAt)}]: Riot API client session
            started
          </div>

          {apiCalls.map((call) => {
            // The backend groups api_calls by endpoint before storing them
            // (_format_api_calls_for_storage), so the endpoint alone is
            // unique within one execution.
            const callKey = call.endpoint;
            const countText = call.count === 1 ? "once" : `${call.count} times`;
            const isExpanded = expandedApiCalls.has(callKey);
            const hasMultipleParams = call.count > 1 && call.param_key;

            return (
              <div key={callKey} className="space-y-1">
                <div className="text-blue-400">
                  [INFO] [
                  {formatJobTimestamp(call.first_timestamp || startedAt)}
                  ]: Called {call.endpoint} {countText}
                </div>
                <div className="pl-4 text-muted-foreground">
                  <div>Region: {call.region}</div>
                  {call.params &&
                    call.count === 1 &&
                    Object.entries(call.params).map(([key, value]) => (
                      <div key={key}>
                        {key.charAt(0).toUpperCase() + key.slice(1)}: {value}
                      </div>
                    ))}
                  {hasMultipleParams && (
                    <div>
                      <button
                        type="button"
                        onClick={() => onToggleExpanded(callKey)}
                        className="m-0 block w-full border-0 bg-transparent p-0 text-left font-mono text-[11px] text-primary hover:underline cursor-pointer"
                      >
                        {isExpanded ? (
                          <span className="inline-flex items-center gap-1">
                            <ChevronUp className="h-3 w-3" />
                            Collapse
                          </span>
                        ) : (
                          <span className="break-all">
                            {formatApiCallParamLabel(call.param_key)}:{" "}
                            {call.first_param}, ..., {call.last_param}
                          </span>
                        )}
                      </button>
                      {isExpanded && (
                        <div className="mt-1 pl-2 border-l-2 border-muted">
                          First: {call.first_param}
                          <br />
                          Last: {call.last_param}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            ({call.count} total calls)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {completedAt && (
            <div className="text-blue-400">
              [INFO] [{formatJobTimestamp(completedAt)}]: Riot API client session
              closed
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
