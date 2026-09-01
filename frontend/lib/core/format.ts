/** Shared display formatters over the platform's own Intl machinery. */

// Module-level: Intl formatters are expensive and these run in render paths.
// `minimumFractionDigits` defaults to 0, so "52%" and "52.3%" need no branch.
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** Format a 0-1 fraction as a percentage: 0.523 -> "52.3%", 0.5 -> "50%". */
export function formatFractionAsPercent(fraction: number): string {
  return percentFormatter.format(fraction);
}

// The contract everywhere is a 0-1 fraction; the one percent-shaped API
// field (league.win_rate) is normalized in its schema.

/** Text and bar colors for a 0-1 win-rate fraction: green ≥51%, yellow >49%, rose below. */
export function winRateColors(fraction: number): { text: string; bar: string } {
  const percent = fraction * 100;
  if (percent >= 51) return { text: "text-green-500", bar: "bg-green-500" };
  if (percent > 49) return { text: "text-yellow-500", bar: "bg-yellow-500" };
  return { text: "text-rose-500", bar: "bg-rose-500" };
}

/** Text color for a KDA verdict: green ≥3, yellow ≥2, rose below. */
export function kdaColor(kda: number): string {
  if (kda >= 3) return "text-green-500";
  if (kda >= 2) return "text-yellow-500";
  return "text-rose-500";
}

/** Format a KDA ratio for display: always two decimals, "3.37". */
export function formatKDA(kda: number): string {
  return kda.toFixed(2);
}

/** The one duration grammar: "12.3s" under a minute, "4m 5s" under an hour,
 * "1h 0m 4s" above. Negative input (clock skew) clamps to "0.0s". */
export function formatSeconds(seconds: number): string {
  const clamped = Math.max(0, seconds);
  // Round to the displayed precision first so 59.97 rolls over to "1m 0s"
  // instead of rendering "60.0s".
  const rounded = Math.round(clamped * 10) / 10;
  if (rounded < 60) return `${rounded.toFixed(1)}s`;
  const whole = Math.floor(rounded);
  const remainingSeconds = whole % 60;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainingSeconds}s`;
}

// Hand-rolled rather than Intl: recent ICU puts a narrow no-break space
// before AM/PM, which breaks exact-text assertions and copy-paste.

/** Local-time "4.3.2026 2:07 PM"; pass { seconds: true } for "…2:07:09 PM". */
export function formatDateTime(
  timestamp: string | number,
  { seconds = false }: { seconds?: boolean } = {},
): string {
  const date = new Date(timestamp);
  // An unparseable timestamp otherwise renders "NaN.NaN.NaN 12:NaN AM";
  // "—" matches the placeholder sibling surfaces already use.
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = date.getHours() % 12 || 12;
  const meridiem = date.getHours() >= 12 ? "PM" : "AM";
  const clock = seconds
    ? `${hours}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    : `${hours}:${pad(date.getMinutes())}`;
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} ${clock} ${meridiem}`;
}
