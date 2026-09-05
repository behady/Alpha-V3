// src/lib/aiNavigation.ts
/**
 * Where the assistant is allowed to send someone, and how a requested path is checked.
 *
 * The `navigate_to` tool takes a path the model composed from a description. A path that does not
 * exist renders as an empty 404 — which, to the person who asked, is indistinguishable from the
 * assistant having done nothing at all, except that it announced "Opening the billing page…"
 * first. That is the specific complaint this file exists to answer: the assistant saying it did
 * something and nothing happening.
 *
 * Kept here rather than in the route so the same list feeds the tool description, the error the
 * model gets back, and the tests — three places that would otherwise drift apart, and a drifted
 * allowlist is a dead end with a confident sentence in front of it.
 *
 * Must be kept in step with src/app/(dashboard). `/migrate` is deliberately absent: it is a
 * one-off data tool, not somewhere to send a user.
 */
export const NAVIGABLE_EXACT: readonly string[] = [
  "/",
  "/appointments",
  "/attendance",
  "/finance",
  "/finance/recovery",
  "/help",
  "/inventory",
  "/leads",
  "/marketing",
  "/messages",
  "/ortho",
  "/patients",
  "/reports",
  "/settings",
  "/settings/clinic",
  "/settings/dentists",
  "/ai",
  // These three redirect into /ai now — the brief, the message queue and patient no-shows became
  // its three tabs. They stay on the list because they still resolve, and because the model has
  // been describing them by name for months.
  "/ai/attendance",
  "/ai/briefing",
  "/ai/operations",
  "/ai/reactivation",
  "/ai/revenue",
];

const EXACT = new Set(NAVIGABLE_EXACT);

/** The dynamic screens. The id segment is whatever Firestore generated, so it is matched by shape. */
const NAVIGABLE_PATTERNS: readonly RegExp[] = [
  /^\/patients\/[A-Za-z0-9_-]+$/,
  /^\/patients\/[A-Za-z0-9_-]+\/rx$/,
  /^\/patients\/[A-Za-z0-9_-]+\/diagnosis$/,
  /^\/ortho\/[A-Za-z0-9_-]+$/,
  /^\/help\/[A-Za-z0-9_-]+$/,
];

/** Every tab on a patient's file that is a valid deep link. Mirrors the patient page's own list. */
export const PATIENT_TABS: readonly string[] = [
  "overview",
  "clinical",
  "plan",
  "finance",
  "timeline",
  "xrays",
  "prescriptions",
  "notes",
];

/**
 * The one description of these routes, shared by the tool schema and the correction the model gets
 * when it picks something else. Written for a model to read.
 */
export const NAVIGABLE_PATHS_HINT =
  `${NAVIGABLE_EXACT.join(", ")}; ` +
  `/patients/{id} for one patient's file, optionally with ?tab=${PATIENT_TABS.join("|")}; ` +
  `/patients/{id}/rx, /patients/{id}/diagnosis, /ortho/{id}, /help/{slug}`;

/**
 * Returns the path to hand the client, or null if it is not a screen this app has.
 *
 * The query string is preserved but not validated: a wrong `?tab=` lands on that patient's default
 * tab rather than on nothing, so it is a slightly wrong landing, not a dead end. A wrong *path* is
 * the dead end, which is what this rejects.
 */
export function resolveNavigablePath(raw: unknown): string | null {
  const value = String(raw ?? "").trim();

  // Relative, single-slash paths only. A protocol or a `//host` prefix would send a member of
  // staff off this application entirely, on the say-so of a model whose context holds free text
  // that patients and colleagues typed into notes.
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  const [pathname] = value.split(/[?#]/);
  if (pathname.includes("..")) return null;

  // Trailing slashes are the model's, not the router's. "/patients/" is "/patients".
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  const known = EXACT.has(normalised) || NAVIGABLE_PATTERNS.some((re) => re.test(normalised));
  if (!known) return null;

  // Rebuilt from the normalised pathname so the client is never handed the trailing slash.
  const suffix = value.slice(pathname.length);
  return `${normalised}${suffix}`;
}
