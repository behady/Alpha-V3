import * as Sentry from "@sentry/nextjs";

// Edge runtime twin of sentry.server.config.ts — same posture: errors only, no PII, disabled
// until a DSN exists.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
