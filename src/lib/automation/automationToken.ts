import { adminDb } from "@/lib/firebaseAdmin";

/**
 * How a scheduled Cloud Function proves a call to an automation route is its own.
 *
 * The routes already accept `CRON_SECRET`, which is how Vercel's own scheduler calls them — but
 * one of these jobs has to run every five minutes, and this project's Vercel plan refuses any
 * schedule finer than daily, so its clock lives in Firebase instead. Putting the same secret in
 * two places means somebody has to keep them equal for ever, and the day they drift the job stops
 * silently: an automation that fails by doing nothing is the worst failure this codebase has.
 *
 * So both sides read one value out of Firestore, from a path `firestore.rules` denies to every
 * client. The Admin SDK on either side can read it and nothing else can, which is the same
 * protection `clinic_secrets` has and for the same reason.
 */

const PATH = { collection: "system_secrets", doc: "automation" } as const;

/** Cached for the life of the lambda: this is read on every cron call, and it changes ~never. */
let cached: { value: string; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function readAutomationToken(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const snap = await adminDb().collection(PATH.collection).doc(PATH.doc).get();
    const value = String((snap.data() || {}).token || "").trim();
    cached = { value, at: Date.now() };
    return value;
  } catch {
    return "";
  }
}

/**
 * Does this request carry a credential the automation routes accept?
 *
 * Either the Vercel cron secret or the shared token — both are bearer values known only to the
 * servers that hold them, and a route that accepts neither is a route nobody can schedule.
 */
export async function isAutomationCallAuthorized(request: Request): Promise<boolean> {
  const header = (request.headers.get("authorization") || "").trim();
  if (!header.startsWith("Bearer ")) return false;
  const offered = header.slice(7).trim();
  if (!offered) return false;

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && offered === cronSecret) return true;

  const shared = await readAutomationToken();
  return Boolean(shared) && offered === shared;
}
