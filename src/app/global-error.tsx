"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * The last-resort error screen: a crash in the root layout unmounts the entire app, including
 * every error boundary inside it, so without this file such a crash is a white page that reports
 * nothing. Deliberately plain HTML — it renders in place of <html> itself, so nothing from the
 * app (fonts, context, theme) can be assumed to exist.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 2rem", textAlign: "center" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Something went wrong</h2>
        <p style={{ color: "#666", marginBottom: "1.5rem" }}>
          The error has been reported. Reloading usually fixes it.
        </p>
        <button
          onClick={() => reset()}
          style={{ padding: "0.6rem 1.4rem", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
