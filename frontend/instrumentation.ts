/**
 * Server-side observability for the standalone production process. Next's
 * `logging` config is development-only, so this is the supported production
 * hook; it sees server failures only. Browser errors arrive through
 * `instrumentation-client.ts`.
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
