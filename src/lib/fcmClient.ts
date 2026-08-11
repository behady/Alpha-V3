import { getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";
import { getMessagingInstance } from "@/lib/firebase";
import { auth } from "@/lib/firebase";const SW_PATH = "/firebase-messaging-sw.js";

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

export async function subscribeFcmForeground(
  handler: (payload: { title?: string; body?: string; summonId?: string }) => void
): Promise<(() => void) | null> {
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
      body: JSON.stringify({ summonId }),
    });
  } catch (e) {
    console.warn("summon push notify failed", e);
  }
}
