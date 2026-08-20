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

// `style: "narrow"` is byte-identical to the old hand-built templates:
// "5m ago", "23h ago", "3d ago".
const narrowRelativeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
  style: "narrow",
});

// Both clocks clamp toward "Just now" across the present: the past clock so a
// browser running behind the DB never reads a fresh run as the future, the
// upcoming clock so an overdue schedule never reads as history.

/**
 * A minute count laddered up into hours and days, signed for `Intl`.
 *
 * `direction` is the only thing that separated the two clocks below: -1 reads
 * the count as elapsed, +1 as upcoming. The clamp stays on `diffMins` -- the
 * count in each clock's own direction -- rather than on the signed value, so
 * each keeps its own side of "Just now" and neither crosses into the other's.
 */
function formatMinuteLadder(diffMins: number, direction: -1 | 1): string {
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) {
    return narrowRelativeFormatter.format(direction * diffMins, "minute");
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return narrowRelativeFormatter.format(direction * diffHours, "hour");
  }
  const diffDays = Math.floor(diffHours / 24);
  return narrowRelativeFormatter.format(direction * diffDays, "day");
}

export function formatRelativeTime(timestamp: string): string {
  const elapsedMins = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 60000,
  );
  return formatMinuteLadder(elapsedMins, -1);
}

/** The future-facing sibling for next_run_time: "in 10m", "in 2h". */
export function formatNextRun(timestamp: string): string {
  const upcomingMins = Math.floor(
    (new Date(timestamp).getTime() - Date.now()) / 60000,
  );
  return formatMinuteLadder(upcomingMins, 1);
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
