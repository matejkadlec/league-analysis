import { formatDateTime, formatSeconds } from "@/lib/core/format";

/** The jobs surfaces all show seconds; this names that policy once. */
export function formatJobTimestamp(timestamp: string): string {
  return formatDateTime(timestamp, { seconds: true });
}

export function formatDuration(
  started: string,
  completed: string | null | undefined,
): string {
  if (!completed) return "N/A";
  const startTime = new Date(started).getTime();
  const endTime = new Date(completed).getTime();
  // Shares the grammar with the job cards' formatDuration; a zero-second
  // run still reads "0.0s" here, not that copy's "N/A".
  return formatSeconds((endTime - startTime) / 1000);
}

export function formatRecordsSummary(created: number, updated: number): string {
  if (created === 0 && updated === 0) {
    return "No records created or updated";
  }
  if (created > 0 && updated > 0) {
    return `${created} records created and ${updated} records updated`;
  }
  if (created > 0) {
    return `${created} records created`;
  }
  return `${updated} records updated`;
}

export function formatApiCallParamLabel(paramKey?: string | null): string {
  if (!paramKey) {
    return "Parameters";
  }

  if (paramKey === "puuid") {
    return "PUUIDs";
  }

  if (paramKey === "matchId") {
    return "Match IDs";
  }

  const spacedKey = paramKey.replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${spacedKey.charAt(0).toUpperCase()}${spacedKey.slice(1)}s`;
}

// Deliberately not shared with the identical-looking set in
// `job-execution-logs.tsx`. That one hides fields the row already renders in
// its header; this one skips fields the key below already emits positionally.
// They agree today for different reasons, and one shared set means hiding a
// noisy field from the display would also drop it from the key -- two rows
// differing only in that field would collide and the second would never
// render.
const KEYED_POSITIONALLY = new Set(["level", "timestamp", "event"]);

export function detailedLogKey(log: Record<string, unknown>): string {
  const level = typeof log.level === "string" ? log.level : "INFO";
  const timestamp = String(log.timestamp ?? "");
  const event = String(log.event ?? "");
  const extrasJoined = Object.entries(log)
    .filter(([key]) => !KEYED_POSITIONALLY.has(key))
    .map(
      ([key, value]) =>
        `${key}:${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .join("|");
  return `${timestamp}|${level}|${event}|${extrasJoined}`;
}
