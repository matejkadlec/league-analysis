"use client";

import { useEffect } from "react";

/**
 * The boundary of last resort: `error.tsx` sits inside the layout and cannot
 * catch a throw from the providers, the auth gate or the sidebar. This one
 * replaces the document, so it brings its own `html`/`body` and inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Inlined: this file replaces the whole document and must not import the
    // application graph that just threw. `/client-error-report` is the same
    // beacon `reportClientError` uses.
    void fetch("/client-error-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "react",
        message: error.message.slice(0, 240),
        source: "boundary",
      }),
      // Nothing awaits this and the app has already failed: a same-origin log
      // write that has not landed in three seconds never will, and holding the
      // socket open on a crashed page buys nothing.
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
