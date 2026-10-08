import { getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";
import { currentClinicId } from "@/lib/db-utils";
import { getMessagingInstance } from "@/lib/firebase";
import { auth } from "@/lib/firebase";
import { isNativeApp } from "@/lib/native";

const SW_PATH = "/firebase-messaging-sw.js";

function vapidKey(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() || "";
}

export async function registerSummonServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  } catch (e) {
    console.warn("FCM service worker registration failed", e);
    return null;
  }
}

/** Request notification permission, register SW, obtain FCM token, save on server. */
export async function enableFcmPushForUser(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === "undefined") return { ok: false, reason: "ssr" };

  // Inside the iOS app there is no service worker and no Notification API: the token comes from
  // APNs through the Firebase Messaging plugin. It is a real FCM token, so the server registers it
  // exactly as it does a browser's, and every existing sender reaches the phone unchanged.
  if (isNativeApp()) return enableNativePush();

  const supported = await isSupported();
  if (!supported) return { ok: false, reason: "unsupported" };

  const key = vapidKey();
  if (!key) return { ok: false, reason: "missing_vapid_key" };

  if (!("Notification" in window)) return { ok: false, reason: "unsupported" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: perm };

  const registration = await registerSummonServiceWorker();
  if (!registration) return { ok: false, reason: "service_worker" };

  const messaging = await getMessagingInstance();
  if (!messaging) return { ok: false, reason: "messaging" };

  let token: string;
  try {
    token = await getToken(messaging, { vapidKey: key, serviceWorkerRegistration: registration });
  } catch (e) {
    console.warn("FCM getToken failed", e);
    return { ok: false, reason: "token" };
  }

  if (!token) return { ok: false, reason: "empty_token" };

  return saveTokenOnServer(token);
}

async function saveTokenOnServer(token: string): Promise<{ ok: boolean; reason?: string }> {
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: "auth" };

  const idToken = await user.getIdToken();
  const res = await fetch("/api/push/register-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    return { ok: false, reason: typeof data?.error === "string" ? data.error : "register_failed" };
  }

  return { ok: true };
}

async function enableNativePush(): Promise<{ ok: boolean; reason?: string }> {
  // Loaded on demand so the browser bundle never carries the plugin's web shim.
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  try {
    let { receive } = await FirebaseMessaging.checkPermissions();
    if (receive === "prompt" || receive === "prompt-with-rationale") {
      ({ receive } = await FirebaseMessaging.requestPermissions());
    }
    if (receive !== "granted") return { ok: false, reason: "denied" };
    const { token } = await FirebaseMessaging.getToken();
    if (!token) return { ok: false, reason: "empty_token" };
    return saveTokenOnServer(token);
  } catch (e) {
    // Typically GoogleService-Info.plist missing from the Xcode project, or no APNs key uploaded
    // to Firebase — both are build-time setup, see ios/README.md.
    console.warn("native push registration failed", e);
    return { ok: false, reason: "token" };
  }
}

export async function subscribeFcmForeground(
  handler: (payload: { title?: string; body?: string; summonId?: string }) => void
): Promise<(() => void) | null> {
  if (isNativeApp()) {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const handle = await FirebaseMessaging.addListener("notificationReceived", ({ notification }) => {
      const data = (notification.data ?? {}) as Record<string, unknown>;
      handler({
        title: notification.title,
        body: notification.body,
        summonId: typeof data.summonId === "string" ? data.summonId : undefined,
      });
    });
    return () => void handle.remove();
  }

  const messaging = await getMessagingInstance();
  if (!messaging) return null;

  return onMessage(messaging as Messaging, (payload) => {
    handler({
      title: payload.notification?.title,
      body: payload.notification?.body,
      summonId: payload.data?.summonId,
    });
  });
}

export async function notifySummonPush(summonId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const idToken = await user.getIdToken();
    await fetch("/api/push/summon", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ summonId, clinicId: currentClinicId() }),
    });
  } catch (e) {
    console.warn("summon push notify failed", e);
  }
}
