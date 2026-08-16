import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";

/**
 * The phones willing to send a clinic's reminders.
 *
 * These live at `clinics/{clinicId}/sms_devices`, written by the Android app itself as a heartbeat
 * every time its background job wakes up.
 *
 * This replaced a pairing-code and device-token scheme (root `sms_devices` + `sms_pairing_codes`,
 * removed 2026-08-14). That existed because the old app was a WebView with no login of its own, so
 * it needed credentials of its own to call an API. The native app signs in with Firebase Auth and
 * reads the outbox straight from Firestore, so there is no API call to authenticate and nothing to
 * pair — a phone simply says "I am sending" and the security rules already know who it is.
 *
 * The trade is that any clinic member could write a heartbeat here. The worst that achieves is a
 * clinic queueing reminders that no phone collects, which the settings screen shows plainly. It
 * cannot send anything, read a message, or change one.
 */

export interface SmsDevice {
  deviceId: string;
  name: string;
  platform: string;
  lastSeenAt?: string;
  enabled: boolean;
  /** Where to reach this phone to wake it. Absent on phones running an older app. */
  fcmToken?: string;
}

/**
 * How stale a heartbeat may be before the phone counts as gone.
 *
 * The app checks in every fifteen minutes, so anything past an hour has missed several rounds —
 * flat battery, no signal, or the app killed by battery optimisation. Generous on purpose: a phone
 * briefly out of coverage should not stop the clinic queueing tomorrow's reminders.
 */
const HEARTBEAT_TIMEOUT_MS = 60 * 60 * 1000;

function toDevice(id: string, data: Record<string, unknown>): SmsDevice {
  return {
    deviceId: id,
    name: typeof data.name === "string" && data.name.trim() ? data.name : "Clinic phone",
    platform: typeof data.platform === "string" ? data.platform : "android",
    lastSeenAt: typeof data.lastSeenAt === "string" ? data.lastSeenAt : undefined,
    enabled: data.enabled !== false,
    fcmToken: typeof data.fcmToken === "string" && data.fcmToken ? data.fcmToken : undefined,
  };
}

/** Every phone that has ever offered to send for this clinic, most recently seen first. */
export async function listClinicDevices(clinicId: string): Promise<SmsDevice[]> {
  const snap = await adminClinicCollection(clinicId, "sms_devices").get();
  return snap.docs
    .map((d) => toDevice(d.id, (d.data() || {}) as Record<string, unknown>))
    .sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
}

/** True when a phone has checked in recently enough to be trusted to collect the queue. */
export function isDeviceAlive(device: SmsDevice, now: number = Date.now()): boolean {
  if (!device.enabled) return false;
  if (!device.lastSeenAt) return false;
  const seen = Date.parse(device.lastSeenAt);
  if (Number.isNaN(seen)) return false;
  return now - seen < HEARTBEAT_TIMEOUT_MS;
}

/**
 * Is there a phone that could actually send right now?
 *
 * Checked before anything is queued. Queueing with no live phone piles messages up where nothing
 * will ever collect them, and a clinic watching a list that only grows reasonably concludes the
 * whole feature is broken rather than that no phone is switched on.
 */
export async function hasActiveDevice(clinicId: string): Promise<boolean> {
  const devices = await listClinicDevices(clinicId);
  return devices.some((d) => isDeviceAlive(d));
}

/**
 * Stop a phone being treated as a sender.
 *
 * Disabled rather than deleted, so the record of which phone sent a clinic's messages, and until
 * when, survives. The phone itself also stops asking once its own switch is turned off.
 */
export async function revokeDevice(clinicId: string, deviceId: string): Promise<boolean> {
  const ref = adminClinicDoc(clinicId, "sms_devices", deviceId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  await ref.set({ enabled: false, revokedAt: new Date().toISOString() }, { merge: true });
  return true;
}


/**
 * Wake this clinic's sender phones NOW.
 *
 * A queued message used to wait for the phone's next fifteen-minute poll — Android's shortest
 * allowed repeat — which is fine for a reminder scheduled hours ahead and poor for a cancellation
 * the patient should hear about before they set off. Since the phone is already reachable by push,
 * the server can simply tell it that something is waiting.
 *
 * This is a DATA-ONLY message: no notification block, so nothing appears on screen. It is a nudge
 * between two machines, not something the clinic should have to look at. High priority, because a
 * normal-priority data message can be held until the device next wakes on its own, which is the
 * delay this exists to remove.
 *
 * Fire-and-forget, and the fifteen-minute poll stays exactly as it was: a push that is dropped —
 * force-stopped app, no network, Android throttling — costs latency, never a message.
 */
export async function wakeSenderPhones(clinicId: string): Promise<void> {
  try {
    const now = Date.now();
    const tokens = (await listClinicDevices(clinicId))
      .filter((device) => device.enabled && isDeviceAlive(device, now))
      .map((device) => device.fcmToken)
      .filter((token): token is string => Boolean(token));

    if (tokens.length === 0) return;

    const { adminMessaging } = await import("@/lib/firebaseAdmin");
    await adminMessaging().sendEachForMulticast({
      tokens: [...new Set(tokens)],
      data: { type: "sms_wake" },
      android: { priority: "high" },
    });
  } catch (error) {
    console.warn("Could not wake the sender phones:", error);
  }
}
