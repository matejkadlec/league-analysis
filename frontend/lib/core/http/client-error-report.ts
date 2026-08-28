import { z } from "zod";

/**
 * Same-origin POST so a client failure shows up in the frontend container log.
 * Outside the `/api/*` prefix on purpose, since that is rewritten to the
 * backend. Must stay identical to the literal in `proxy.ts`.
 */
export const CLIENT_ERROR_REPORT_PATH = "/client-error-report";

export const ClientErrorReportSchema = z.object({
  kind: z.enum(["react", "chunk", "api", "window", "unhandled-rejection"]),
  message: z.string().trim().min(1).max(240),
  code: z.string().trim().max(64).optional(),
  source: z.enum(["query", "mutation", "window", "boundary"]).optional(),
  filename: z.string().trim().max(300).optional(),
});

export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

export function writeClientErrorLog(report: ClientErrorReport): void {
  console.error(
    JSON.stringify({
      event: "client_error",
      ...report,
    }),
  );
}

/**
 * Best-effort beacon. Failures are swallowed: a reporter that reports its
 * own outage loops, and a full page crash must not wait on logging.
 */
export function reportClientError(payload: ClientErrorReport): void {
  if (typeof window === "undefined") {
    return;
  }
  const parsed = ClientErrorReportSchema.safeParse({
    ...payload,
    message: payload.message.slice(0, 240),
    ...(payload.filename
      ? { filename: pathnameOnly(payload.filename) }
      : {}),
  });
  if (!parsed.success) {
    return;
  }
  void fetch(CLIENT_ERROR_REPORT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
    // Nobody awaits this. Three seconds is long enough for a same-origin POST
    // and short enough that a backend which accepts and never answers does not
    // hold the socket for the life of the tab.
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
}

function pathnameOnly(value: string): string {
  try {
    return new URL(value, window.location.origin).pathname.slice(0, 300);
  } catch {
    return value.slice(0, 300);
  }
}
