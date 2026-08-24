# Error monitoring — switching it on

The code side is done and deployed: the app knows how to report every error — browser crashes,
server failures, and the caught errors inside the API routes that used to die silently in a
container log. It reports to **Sentry**, an error dashboard with a free tier that is more than
enough for a clinic's traffic.

What ships in the code is inert until a key exists. **Nothing is collected and nothing changes
until you do the steps below** — and until then the app behaves exactly as before.

## One-time setup (about 5 minutes)

1. Go to **sentry.io** and create a free account.
2. Create a new project. When asked for the platform, choose **Next.js**. Name it `alpha-dental`.
3. Sentry shows you a **DSN** — a long address starting `https://...ingest...sentry.io/...`.
   That string is the project's mailbox address for error reports. Copy it.
4. Open **Vercel → your project → Settings → Environment Variables** and add:
   - Name: `NEXT_PUBLIC_SENTRY_DSN`
   - Value: the DSN you copied
   - Environments: tick **all** (Production, Preview, Development)
5. Redeploy (Deployments → latest → ⋯ → Redeploy), because the value is baked in at build time.

From that deploy on, every error lands in the Sentry dashboard, grouped and counted, and Sentry
emails you when a **new kind** of error appears — that is the "dashboard instead of a phone call".

## What was chosen for you, and why

- **Errors only, no performance tracing** — the free quota is spent entirely on knowing when
  something broke.
- **No session replay, no personal data** (`sendDefaultPii: false`) — this system holds patient
  records; Sentry receives stack traces, never screens or people.
- **Caught errors report too.** Every API route catches its failures and returns a polite 500, so
  a monitoring setup that only watched for crashes would show perfect health while payments
  failed. `src/lib/server/reportError.ts` is the one reporter; routes call it where they used to
  call `console.error`, and the console line still happens, so Vercel's own logs stay useful.
- **A last-resort error page** (`src/app/global-error.tsx`) — a crash in the root layout used to
  be a blank white page that reported nothing; now it reports and offers "Try again".

## Optional, later: readable browser stack traces

Browser code is minified, so browser errors arrive as gibberish line numbers until Sentry is given
the source maps. When that starts to matter: Sentry → Settings → Auth Tokens → create a token with
`project:releases` scope, add it in Vercel as `SENTRY_AUTH_TOKEN` (plus `SENTRY_ORG` and
`SENTRY_PROJECT` with your org and project slugs), and redeploy. The build uploads the maps
automatically from then on. Server errors are readable without this.
