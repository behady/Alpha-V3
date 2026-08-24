import * as Sentry from "@sentry/nextjs";

/**
 * Error monitoring, server side. With no DSN configured the SDK initialises disabled and costs
 * nothing — so this ships ahead of the Sentry account existing, and switches on the moment
 * NEXT_PUBLIC_SENTRY_DSN appears in Vercel. See docs/runbooks/error-monitoring.md.
 *
 * Errors only, deliberately: performance tracing is off so the free quota is spent entirely on
 * the thing the clinic needs — knowing when something broke. sendDefaultPii stays false because
 * this system holds patient records; Sentry gets stack traces, not people.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
