import * as Sentry from "@sentry/nextjs";

/**
 * The API routes' error reporter. Every route here catches its own failures and returns a polite
 * JSON 500 — which means a caught error never reaches Next's onRequestError hook, and a monitoring
 * setup that only listens there would see a system in perfect health while every payment failed.
 * The routes that own money are exactly the ones whose failures must not stay inside a container
 * log nobody reads.
 *
 * Drop-in for the `console.error(label, error)` convention the routes already follow: the console
 * line stays (Vercel's function logs remain useful on their own), and the same error goes to
 * Sentry tagged with the label so the dashboard can group by route. With no DSN configured the
 * capture is a no-op and this degrades to exactly the console.error it replaced.
 */
export function reportServerError(
  label: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  if (extra) console.error(label, extra, error);
  else console.error(label, error);
  Sentry.captureException(error, {
    tags: { api: label.slice(0, 180) },
    extra,
  });
}
