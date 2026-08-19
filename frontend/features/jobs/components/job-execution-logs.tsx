"use client";

import { Badge } from "@/components/ui/badge";

import { detailedLogKey, formatJobTimestamp } from "./job-execution-format";

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

            const standardFields = new Set(["level", "timestamp", "event"]);
            const extraFields = Object.entries(log).filter(
              ([key]) => !standardFields.has(key),
            );

            return (
              <div
                key={detailedLogKey(log)}
                className={`rounded border-l-4 border-y border-r bg-muted/20 p-2 space-y-1.5 ${
                  logLevel === "ERROR"
                    ? "border-l-destructive"
                    : logLevel === "WARNING"
                      ? "border-l-yellow-500"
                      : logLevel === "INFO"
                        ? "border-l-blue-500"
                        : logLevel === "DEBUG"
                          ? "border-l-orange-500"
                          : "border-l-muted"
                }`}
              >
                <div className="flex gap-2">
                  <span
                    className={`shrink-0 font-bold ${
                      logLevel === "ERROR"
                        ? "text-destructive"
                        : logLevel === "WARNING"
                          ? "text-yellow-600"
                          : logLevel === "INFO"
                            ? "text-blue-600"
                            : logLevel === "DEBUG"
                              ? "text-orange-600"
                              : "text-muted-foreground"
                    }`}
                  >
                    [{logLevel}]
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    [{formatJobTimestamp(String(log.timestamp || ""))}]:
                  </span>
                  <span className="flex-1 break-all">
                    {String(log.event || "")}
                  </span>
                </div>

                {extraFields.length > 0 && (
                  <div className="space-y-0.5 text-[10px] text-muted-foreground/80 bg-background/50 rounded p-2 border border-muted pl-4">
                    {extraFields.map(([key, value]) => (
                      <div key={key}>
                        {key.charAt(0).toUpperCase() + key.slice(1)}:{" "}
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
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
