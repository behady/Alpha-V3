import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";
import { firebasePublicConfig } from "./firebasePublicConfig";

const firebaseConfig = { ...firebasePublicConfig };

if (!firebaseConfig.apiKey?.trim()) {
  throw new Error(
    "Missing NEXT_PUBLIC_FIREBASE_API_KEY. Set NEXT_PUBLIC_FIREBASE_* in local/Vercel environment variables."
  );
}

if (!firebaseConfig.projectId?.trim()) {
  throw new Error(
    "Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID. Set NEXT_PUBLIC_FIREBASE_* in local/Vercel environment variables."
  );
}

// Initialize Firebase once to prevent "duplicate app" errors during Hot Reload
console.log("INIT FIREBASE WITH CONFIG:", firebaseConfig);
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Standard Exports
export const db = getFirestore(app, "default");
export const auth = getAuth(app);
export const storage = getStorage(app); // New: Storage instance for voice/media

/**
 * Initialize Messaging safely (Crash-Proof)
 * This only runs on the client-side (browser) to avoid Next.js SSR errors.
 */
export const getMessagingInstance = async () => {
  if (typeof window !== "undefined") {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
  }
  return null;
};

export default app;