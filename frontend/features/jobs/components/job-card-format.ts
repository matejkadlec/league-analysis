import cronstrue from "cronstrue";

export function formatCronSchedule(schedule: string): string {
  try {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length >= 5 && parts.length <= 7) {
      return cronstrue.toString(schedule, { use24HourTimeFormat: true });
    }
    return schedule;
  } catch {
    return schedule;
  }
}

/**
 * Format schedule from seconds to human-readable format
 * Rules:
 * - If <60 seconds: show only seconds
 * - If >=3600 (1 hour): show hours, and minutes if not exact hours (no seconds)
 * - Otherwise: show minutes only (round seconds to nearest minute)
 */
export function formatScheduleInterval(schedule: string): string {
  const totalSeconds = parseInt(schedule, 10);
  if (isNaN(totalSeconds)) {
    return formatCronSchedule(schedule);
  }

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}`;
  }

  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const remainingMinutes = Math.round((totalSeconds % 3600) / 60);

    if (remainingMinutes === 0) {
      return `${hours} hour${hours !== 1 ? "s" : ""}`;
    }
    return `${hours} hour${hours !== 1 ? "s" : ""} ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
  }

  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "N/A";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// `style: "narrow"` is byte-identical to the old hand-built templates:
// "5m ago", "23h ago", "3d ago".
const narrowRelativeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
  style: "narrow",
});

// Both clocks clamp toward "Just now" across the present: the past clock so a
// browser running behind the DB never reads a fresh run as the future, the
// upcoming clock so an overdue schedule never reads as history.

export function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return narrowRelativeFormatter.format(-diffMins, "minute");
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return narrowRelativeFormatter.format(-diffHours, "hour");
  const diffDays = Math.floor(diffHours / 24);
  return narrowRelativeFormatter.format(-diffDays, "day");
}

/** The future-facing sibling for next_run_time: "in 10m", "in 2h". */
export function formatNextRun(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMins = Math.floor((date.getTime() - now.getTime()) / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return narrowRelativeFormatter.format(diffMins, "minute");
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return narrowRelativeFormatter.format(diffHours, "hour");
  const diffDays = Math.floor(diffHours / 24);
  return narrowRelativeFormatter.format(diffDays, "day");
}

export function getJobDescription(jobType: string): string {
  const descriptions: Record<string, string> = {
    MATCH_FETCHER:
      "Fetches every supported League queue and updates match history and rank progression",
    PLAYER_UPDATER:
      "Fetches player info and updates player name, tag, icon and level",
  };
  return (
    descriptions[jobType] ||
    `Executes ${jobType.replace(/_/g, " ").toLowerCase()} tasks`
  );
}
