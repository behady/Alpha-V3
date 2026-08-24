import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Uncaught errors in server components and route handlers land here. The routes' own catch
// blocks report through src/lib/server/reportError.ts instead — a caught error never reaches
// this hook, which is exactly why that helper exists.
export const onRequestError = Sentry.captureRequestError;
