// The bucket ladder below stays hand-written: Intl.RelativeTimeFormat takes a
// unit already chosen and does no unit selection. `numeric: "always"` is
// deliberate — "auto" would turn day = 1 into "yesterday" and change copy in
// every consumer of useRelativeTime.
const relativeFormatter = new Intl.RelativeTimeFormat("en-US", {
  numeric: "always",
});

export function formatRelativeTime(
  value: string | null | undefined,
  now = Date.now(),
): string {
  if (!value) return "Never";

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Never";

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return relativeFormatter.format(-elapsedMinutes, "minute");

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return relativeFormatter.format(-elapsedHours, "hour");

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return relativeFormatter.format(-elapsedDays, "day");

  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function oldestCompleteFreshness(
  values: ReadonlyArray<string | null | undefined>,
): string | null {
  if (values.length === 0 || values.some((value) => !value)) return null;

  return values.reduce<string | null>((oldest, value) => {
    if (!value) return oldest;
    if (!oldest) return value;
    return new Date(value).getTime() < new Date(oldest).getTime()
      ? value
      : oldest;
  }, null);
}
