/**
 * How often every jobs view re-reads the server. The page's countdown
 * promises the viewer this number and every card has to keep it: three copies
 * of `15000` is how that promise silently breaks.
 */
export const JOBS_REFRESH_INTERVAL_MS = 15_000;
