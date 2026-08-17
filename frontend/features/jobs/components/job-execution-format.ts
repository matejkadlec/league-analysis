export function formatDuration(
  started: string,
  completed: string | null | undefined,
): string {
  if (!completed) return "N/A";
  const startTime = new Date(started).getTime();
  const endTime = new Date(completed).getTime();
  const seconds = (endTime - startTime) / 1000;

  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);

  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  hours = hours ? hours : 12;

  const minutesStr = minutes < 10 ? "0" + minutes : minutes;
  const secondsStr = seconds < 10 ? "0" + seconds : seconds;

  return `${day}.${month}.${year} ${hours}:${minutesStr}:${secondsStr} ${ampm}`;
}

export function formatLogDateTime(timestamp: string): string {
  return formatDateTime(timestamp);
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

export function formatApiCallParamLabel(paramKey?: string): string {
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

export interface APICallEntry {
  endpoint: string;
  region: string;
  count: number;
  first_timestamp?: string;
  last_timestamp?: string;
  params?: Record<string, string>;
  param_key?: string;
  first_param?: string;
  last_param?: string;
}

export function apiCallKey(call: APICallEntry): string {
  return [
    call.endpoint,
    call.region,
    call.param_key ?? "",
    call.first_timestamp ?? "",
    call.first_param ?? "",
    call.last_timestamp ?? "",
    call.last_param ?? "",
  ].join("|");
}

export function detailedLogKey(log: Record<string, unknown>): string {
  const level = typeof log.level === "string" ? log.level : "INFO";
  const timestamp = String(log.timestamp ?? "");
  const event = String(log.event ?? "");
  const extras: string[] = [];
  for (const [key, value] of Object.entries(log)) {
    if (key === "level" || key === "timestamp" || key === "event") {
      continue;
    }
    extras.push(
      `${key}:${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    );
  }
  const extrasJoined = extras.join("|");
  return `${timestamp}|${level}|${event}|${extrasJoined}`;
}
