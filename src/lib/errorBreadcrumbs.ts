// src/lib/errorBreadcrumbs.ts
/**
 * The last few JavaScript errors, kept so a bug report can carry them.
 *
 * When someone tells support "it broke", the single most useful artefact is the error that fired
 * — and by the time they open the chat to complain, the console is closed and the moment is gone.
 * This keeps a small ring buffer of uncaught errors and promise rejections from the moment the
 * dashboard loads, and the support ticket attaches whatever is in it.
 *
 * Deliberately tiny and passive: no console patching (Sentry already instruments this app, and
 * two libraries fighting over console.error is how logging breaks), no network, no storage —
 * just two window listeners and an array. Messages are truncated because a single pathological
 * error (a stringified payload, a base64 blob) would otherwise become the whole ticket.
 */

interface Breadcrumb {
  at: string;
  message: string;
}

const MAX_CRUMBS = 20;
const MAX_MESSAGE_CHARS = 500;

const crumbs: Breadcrumb[] = [];
let installed = false;

function push(message: string) {
  crumbs.push({
    at: new Date().toISOString(),
    message: String(message || "(no message)").slice(0, MAX_MESSAGE_CHARS),
  });
  if (crumbs.length > MAX_CRUMBS) crumbs.shift();
}

/** Idempotent — the widget calls it on every mount and only the first call wires anything. */
export function installErrorBreadcrumbs(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno ?? "?"})` : "";
    push(`${e.message || "Script error"}${where}`);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason: unknown = e.reason;
    const msg =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection";
    push(msg);
  });
}

/** A copy, oldest first — the ticket route stores it verbatim. */
export function getErrorBreadcrumbs(): Breadcrumb[] {
  return crumbs.map((c) => ({ ...c }));
}
