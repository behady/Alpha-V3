"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * The crash screen for anything below the root layout — every page, and the dashboard shell
 * around them.
 *
 * Until this file existed the app had exactly one boundary, `global-error.tsx`, which replaces
 * `<html>` itself: a single component throwing anywhere took the whole application down to a
 * blank page that named nothing. That is what staff were photographing and sending in. This one
 * keeps the app mounted, so "Try again" re-renders the page that failed instead of reloading the
 * world, and it prints the error's id.
 *
 * The id matters more than it looks: it is the same digest Sentry files the event under, so a
 * photograph of a phone screen is enough to find the exact crash, which a grey box with no
 * identifier never was.
 */
export default function AppError({
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
    <div className="min-h-[100dvh] flex items-center justify-center bg-surface-page px-6">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-black text-ink tracking-tight">This screen stopped working</h2>
        <p className="mt-2 text-sm text-slate-500">
          Nothing you did caused it and nothing was lost. Try again, or go back to the dashboard.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="px-5 py-3 rounded-2xl bg-ink text-white font-black text-sm"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-5 py-3 rounded-2xl bg-surface border-2 border-line text-slate-700 font-black text-sm"
          >
            Dashboard
          </a>
        </div>

        {(error.digest || error.message) && (
          <p className="mt-8 text-[11px] text-slate-400 font-mono break-all">
            {error.digest ? `#${error.digest}` : error.message}
          </p>
        )}
      </div>
    </div>
  );
}
