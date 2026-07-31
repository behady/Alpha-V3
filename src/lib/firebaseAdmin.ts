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

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];

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
