// Owns the English: plurals, and -- `minutesDisplay` defaulting to "auto" --
// dropping the zero-minute tail from an exact hour.
const longDurationFormatter = new Intl.DurationFormat("en", { style: "long" });

/** The run interval the backend resolved, as English: "15 minutes". */
export function formatRunInterval(totalSeconds: number): string {
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
 * `direction` is all that separates the two clocks: -1 elapsed, +1 upcoming.
 * The clamp stays on `diffMins` so neither crosses into the other's side.
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
 * never anything else. Deliberately not `formatRelativeTime`, which answers
 * "Never" and goes absolute past a week -- wrong for an execution row.
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
