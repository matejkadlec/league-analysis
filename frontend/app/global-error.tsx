"use client";

import { useEffect } from "react";

/**
 * `error.tsx` sits inside the layout and cannot catch a throw from the providers;
 * this one replaces the document, so it brings its own `html`/`body` and styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Inlined: this file must not import the application graph that just threw.
    // The literal path must match `CLIENT_ERROR_REPORT_PATH`, the beacon `reportClientError` uses.
    void fetch("/client-error-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "react",
        message: error.message.slice(0, 240),
        source: "boundary",
      }),
      // Nothing awaits this; holding a socket open on a crashed page buys nothing.
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0f",
          color: "#f5f5f5",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "28rem", padding: "1.5rem" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            Something went wrong
          </h2>
          <p style={{ marginTop: "0.5rem", color: "#a1a1aa" }}>
            The page could not be displayed. Try again, or reload if the
            problem continues.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #3f3f46",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
