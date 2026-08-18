import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";

/** Default Firebase project bucket; override if you use a non-default bucket. */
function resolveStorageBucket(projectId: string): string {
  const explicit =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;
  return `${projectId}.appspot.com`;
}

/** Normalize FIREBASE_PRIVATE_KEY from env (Vercel quotes, escaped newlines, whitespace). */
export function parseFirebasePrivateKey(raw: string | undefined): string {
  return (raw || "")
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

/** firebase-admin's name for the unnamed app created by initializeApp() with no second argument. */
const DEFAULT_APP_NAME = "[DEFAULT]";

function getAdminApp(): App {
  /**
   * Resolve the default app BY NAME, not by position.
   *
   * `getApps()[0]` means "whichever app was initialised first", which was harmless while this
   * project only ever had one. It is not harmless now: the clinic migration opens each clinic's
   * old Firebase project as a second, named app. If one of those were ever created first in a
   * serverless instance, `getApps()[0]` would return it, and every adminDb() caller in that
   * instance would silently read and write the OLD clinic's database instead of this one —
   * including the migration itself, which exists to never write there.
   */
  const existing = getApps().find((app) => app.name === DEFAULT_APP_NAME);
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = parseFirebasePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars");
  }

  const storageBucket = resolveStorageBucket(projectId);

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    storageBucket,
  });
}

export function adminDb() {
  return getFirestore(getAdminApp(), "default");
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

/** Resolves the same bucket as Admin app init (explicit env or projectId.appspot.com). */
export function adminBucket() {
  const app = getAdminApp();
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is missing");
  const name = resolveStorageBucket(projectId);
  return getStorage(app).bucket(name);
}

export function adminMessaging() {
  return getMessaging(getAdminApp());
}
