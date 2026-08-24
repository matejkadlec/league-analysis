/**
 * Server-side observability for the standalone production process.
 *
 * Next.js `logging` in next.config is development-only — incoming requests
 * and `browserToTerminal` never reach `docker logs` in production. This file
 * is the supported production hook. `onRequestError` sees *server* failures
 * (RSC render, route handlers). Browser React errors and missing chunks are
 * posted by `instrumentation-client.ts` to `/client-error-report`.
 */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routeType: string; routePath: string },
): void {
  const message =
    error instanceof Error ? error.message.slice(0, 240) : "unknown";
  const path = request.path.split("?")[0] ?? request.path;
  console.error(
    JSON.stringify({
      event: "next_request_error",
      method: request.method,
      path,
      routeType: context.routeType,
      routePath: context.routePath,
      message,
    }),
  );
}
