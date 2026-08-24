import * as Sentry from "@sentry/nextjs";

/**
 * Error monitoring, browser side. Same posture as the server config: errors only, no session
 * replay and no PII — this app shows patient records, and a pixel-perfect recording of the
 * screen at the moment of a crash is precisely what must never leave the clinic.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
