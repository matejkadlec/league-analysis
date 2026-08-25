"use client";

import { Badge } from "@/components/ui/badge";

import {
  detailedLogKey,
  formatJobTimestamp,
  logFieldText,
} from "./job-execution-format";
import { cn } from "@/lib/core/utils";

// The row renders these three in its own header, so listing them again as
// extras would print each twice. Not the same policy as the set in
// `job-execution-format.ts` -- see the comment there.
const HEADER_FIELDS = new Set(["level", "timestamp", "event"]);

interface JobExecutionLogsProps {
  logs: Array<Record<string, unknown>>;
}

export function JobExecutionLogs({ logs }: JobExecutionLogsProps) {
  return (
    <div className="rounded-lg border bg-muted/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-medium">Detailed Logs</p>
        <Badge variant="secondary">{logs.length} entries</Badge>
      </div>
      <div className="max-h-[300px] overflow-auto rounded-md border bg-background p-3">
        <div className="space-y-2 font-mono text-[11px]">
          {logs.map((log) => {
            const logLevel =
              typeof log.level === "string" ? log.level.toUpperCase() : "INFO";

            const extraFields = Object.entries(log).filter(
              ([key]) => !HEADER_FIELDS.has(key),
            );

            return (
              <div
                key={detailedLogKey(log)}
                className={cn(
                  "rounded border-l-4 border-y border-r bg-muted/20 p-2 space-y-1.5",
                  logLevel === "ERROR"
                    ? "border-l-destructive"
                    : logLevel === "WARNING"
                      ? "border-l-yellow-500"
                      : logLevel === "INFO"
                        ? "border-l-blue-500"
                        : logLevel === "DEBUG"
                          ? "border-l-orange-500"
                          : "border-l-muted",
                )}
              >
                <div className="flex gap-2">
                  <span
                    className={cn(
                      "shrink-0 font-bold",
                      logLevel === "ERROR"
                        ? "text-destructive"
                        : logLevel === "WARNING"
                          ? "text-yellow-600"
                          : logLevel === "INFO"
                            ? "text-blue-600"
                            : logLevel === "DEBUG"
                              ? "text-orange-600"
                              : "text-muted-foreground",
                    )}
                  >
                    [{logLevel}]
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    [{formatJobTimestamp(logFieldText(log.timestamp || ""))}]:
                  </span>
                  <span className="flex-1 break-all">
                    {logFieldText(log.event || "")}
                  </span>
                </div>

                {extraFields.length > 0 && (
                  <div className="space-y-0.5 text-[10px] text-muted-foreground/80 bg-background/50 rounded p-2 border border-muted pl-4">
                    {extraFields.map(([key, value]) => (
                      <div key={key}>
                        {key.charAt(0).toUpperCase() + key.slice(1)}:{" "}
                        {logFieldText(value)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
