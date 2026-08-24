"use client";

import { useEffect } from "react";

/**
 * The boundary of last resort, above the layout itself.
 *
 * `error.tsx` sits inside the layout and so only covers the page segment.
 * Everything the layout renders — the providers, the auth gate, the sidebar,
 * the cookie-consent manager — is above it, and a throw from any of those
 * unmounts the entire tree with no boundary to catch it. The visitor gets a
 * white page with nothing on it and no way to reset: the same symptom, and
 * the same dead end, as the blank page this whole change exists to remove.
 *
 * It replaces the document, so it has to bring its own `html` and `body`, and
 * it cannot rely on anything the layout would normally provide — no fonts, no
 * theme tokens, no stylesheet. The styles here are inline for that reason.
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
      keepalive: true,
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
