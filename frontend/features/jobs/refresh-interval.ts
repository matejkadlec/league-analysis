/**
 * How often every jobs view re-reads the server.
 *
 * The page's countdown promises the viewer this number, and the job cards and
 * the executions table have to keep it: three copies of `15000` is how that
 * promise silently breaks, with the countdown reaching zero while a card sits
 * on data seconds older or newer.
 */
export const JOBS_REFRESH_INTERVAL_MS = 15_000;
