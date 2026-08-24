import { reportClientError } from "@/lib/core/client-error-report";

/**
 * Runs in the browser before application code. Next.js does not forward
 * `console.error` to the production server; this posts a small, scrubbed
 * record so the frontend container log can see what DevTools saw.
 *
 * A missing `/_next/static/chunks/*.js` shows up here as a script `error`
 * with that filename — the 404 itself is not logged by `next start`.
 */
window.addEventListener("error", (event) => {
  const filename = event.filename || undefined;
  const kind =
    filename !== undefined && filename.includes("/_next/static/chunks/")
      ? "chunk"
      : "window";
  reportClientError({
    kind,
    message: event.message || "window error",
    source: "window",
    ...(filename !== undefined && { filename }),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "unhandled rejection";
  const name = reason instanceof Error ? reason.name : "";
  reportClientError({
    kind: name === "ChunkLoadError" ? "chunk" : "unhandled-rejection",
    message,
    source: "window",
  });
});
