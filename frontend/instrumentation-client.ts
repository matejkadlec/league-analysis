import { reportClientError } from "@/lib/core/client-error-report";

/**
 * Runs in the browser before application code. Next.js does not forward
 * `console.error` to the production server, so this posts a scrubbed record
 * the frontend container log can see -- including a missing chunk's 404.
 */
function isChunkFilename(filename: string | undefined): boolean {
  return filename !== undefined && filename.includes("/_next/static/chunks/");
}

function isChunkMessage(message: string): boolean {
  return (
    message.includes("Loading chunk") ||
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("ChunkLoadError")
  );
}

window.addEventListener("error", (event) => {
  const filename = event.filename || undefined;
  const message = event.message || "window error";
  if (!isChunkFilename(filename) && !isChunkMessage(message)) {
    return;
  }
  reportClientError({
    kind: "chunk",
    message,
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
  if (name !== "ChunkLoadError" && !isChunkMessage(message)) {
    return;
  }
  reportClientError({
    kind: "chunk",
    message,
    source: "window",
  });
});
