"use client";

import { ChevronUp } from "lucide-react";

import { formatDateTime } from "@/lib/core/format";

import {
  type APICallEntry,
  apiCallKey,
  formatApiCallParamLabel,
} from "./job-execution-format";

interface JobExecutionApiCallsProps {
  startedAt: string;
  completedAt: string | null | undefined;
  apiCalls: APICallEntry[];
  expandedApiCalls: Set<string>;
  onToggleExpanded: (key: string) => void;
}

export function JobExecutionApiCalls({
  startedAt,
  completedAt,
  apiCalls,
  expandedApiCalls,
  onToggleExpanded,
}: JobExecutionApiCallsProps) {
  return (
    <div className="rounded-lg border bg-muted/50 p-4">
      <p className="mb-3 font-medium">API Calls</p>
      <div className="max-h-[300px] overflow-auto rounded-md border bg-background p-3">
        <div className="space-y-2 font-mono text-[11px]">
          <div className="text-blue-600 dark:text-blue-400">
            [INFO] [{formatDateTime(startedAt, { seconds: true })}]: Riot API client session
            started
          </div>

          {apiCalls.map((call) => {
            const callKey = apiCallKey(call);
            const countText = call.count === 1 ? "once" : `${call.count} times`;
            const isExpanded = expandedApiCalls.has(callKey);
            const hasMultipleParams = call.count > 1 && call.param_key;

            return (
              <div key={callKey} className="space-y-1">
                <div className="text-blue-600 dark:text-blue-400">
                  [INFO] [
                  {formatDateTime(call.first_timestamp || startedAt, { seconds: true })}
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
            <div className="text-blue-600 dark:text-blue-400">
              [INFO] [{formatDateTime(completedAt, { seconds: true })}]: Riot API client session
              closed
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
