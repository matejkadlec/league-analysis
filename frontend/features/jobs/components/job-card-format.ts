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

// Owns the English: plurals, and -- `minutesDisplay` defaulting to "auto" --
// dropping the zero-minute tail from an exact hour.
const longDurationFormatter = new Intl.DurationFormat("en", { style: "long" });

// The three interval spellings the scheduler accepts -- "900", "interval:900"
// and "900s" -- and its `max(n, 1)` clamp, mirrored from
// backend/app/features/jobs/scheduler.py:_parse_interval_from_schedule.
// `parseInt` cannot stand in for this: it reads the cron "0 0 * * *" as 0
// seconds, and "interval:900" and "900s" as NaN and 900 respectively.
function intervalSeconds(schedule: string): number | null {
  const normalized = schedule.trim().toLowerCase();
  const digits = normalized.startsWith("interval:")
    ? normalized.slice("interval:".length).trim()
    : normalized.endsWith("s")
      ? normalized.slice(0, -1)
      : normalized;
  return /^[0-9]+$/.test(digits) ? Math.max(Number(digits), 1) : null;
}

/** A job's schedule: either an interval in seconds, or a cron expression. */
export function formatScheduleInterval(schedule: string): string {
  const totalSeconds = intervalSeconds(schedule);
  if (totalSeconds === null) {
    return formatCronSchedule(schedule);
  }

  if (totalSeconds < 60) {
    return longDurationFormatter.format({ seconds: totalSeconds });
  }

  if (totalSeconds >= 3600) {
    return longDurationFormatter.format({
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.round((totalSeconds % 3600) / 60),
    });
  }

  return longDurationFormatter.format({
    minutes: Math.round(totalSeconds / 60),
  });
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

/**
 * The narrow, always-relative clock the job surfaces run on: "2h ago", and
 * never anything else however old the run is.
 *
 * Deliberately not `lib/core/relative-time`'s `formatRelativeTime`, which the
 * shared name used to imply it was a copy of. That one answers "Never" for a
 * missing value and switches to an absolute date past a week — right for a
 * freshness stamp that may have no value at all, wrong for an execution row,
 * which always has a start time and reads as a log.
 */
export function formatLastRun(timestamp: string): string {
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
