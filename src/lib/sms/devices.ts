import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * The registry of phones allowed to send a clinic's reminders.
 *
 * Both collections live at the ROOT, not under `clinics/{clinicId}/`. That subtree is covered by a
 * blanket rule granting read to every member of the clinic, and a device token is a credential
 * that sends messages in the clinic's name — a receptionist who could read it could send texts to
 * every patient from the clinic's number. Firestore rules OR together, so a narrower deny inside
 * that subtree cannot take the access back; a separate top-level collection can. Same reasoning as
 * `clinic_secrets`, and these are likewise written and read only through the Admin SDK.
 */
const DEVICES = "sms_devices";
const PAIRING_CODES = "sms_pairing_codes";

/** A pairing code is typed by a human under time pressure and is useless after one use. */
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export interface SmsDevice {
  deviceId: string;
  clinicId: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt?: string;
  lastSentAt?: string;
  /** Set when someone unpairs the phone. Kept rather than deleted so the history stays readable. */
  revokedAt?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Digits and letters that cannot be confused with each other when read off one screen and typed
 * into another: no O/0, no I/1/l, no S/5. Clinic staff pair these phones, not engineers.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

function generatePairingCode(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Codes are compared and stored upper-case with the dash optional, so typing is forgiving. */
export function normalizePairingCode(raw: string): string {
  const cleaned = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length === 8 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

/**
 * Issue a code that a phone can exchange for a device token.
 *
 * The code — not the token — is what a person handles, so it is short-lived and single-use. The
 * token it becomes never appears on a screen.
 */
export async function createPairingCode(clinicId: string, createdByUid: string): Promise<{ code: string; expiresAt: string }> {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();

  await adminDb().collection(PAIRING_CODES).doc(code).set({
    clinicId,
    createdByUid,
    createdAt: new Date().toISOString(),
    expiresAt,
    usedAt: null,
  });

  return { code, expiresAt };
}

export type PairResult =
  | { ok: true; deviceId: string; token: string; clinicId: string }
  | { ok: false; error: string };

/**
 * Exchange a pairing code for a device token.
 *
 * The code is consumed inside a transaction: two phones racing on the same code means exactly one
 * of them gets a token, rather than both quietly becoming senders for the clinic.
 */
export async function redeemPairingCode(rawCode: string, deviceName: string, platform: string): Promise<PairResult> {
  const code = normalizePairingCode(rawCode);
  if (!code) return { ok: false, error: "Enter the pairing code shown in Settings → SMS." };

  const db = adminDb();
  const codeRef = db.collection(PAIRING_CODES).doc(code);
  const deviceId = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");

  try {
    const clinicId = await db.runTransaction(async (tx) => {
      const snap = await tx.get(codeRef);
      if (!snap.exists) throw new Error("That pairing code is not valid.");

      const data = snap.data() || {};
      if (data.usedAt) throw new Error("That pairing code has already been used. Generate a new one.");
      if (typeof data.expiresAt === "string" && Date.parse(data.expiresAt) < Date.now()) {
        throw new Error("That pairing code has expired. Generate a new one.");
      }

      const resolvedClinicId = String(data.clinicId || "");
      if (!resolvedClinicId) throw new Error("That pairing code is not linked to a clinic.");

      tx.update(codeRef, { usedAt: new Date().toISOString(), deviceId });
      tx.set(db.collection(DEVICES).doc(deviceId), {
        clinicId: resolvedClinicId,
        // Only the hash is stored. A leaked database backup does not hand anyone a working sender.
        secretHash: sha256(secret),
        name: deviceName.trim() || "Clinic phone",
        platform: platform.trim() || "android",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        revokedAt: null,
      });

      return resolvedClinicId;
    });

    return { ok: true, deviceId, token: `${deviceId}.${secret}`, clinicId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Pairing failed." };
  }
}

export type DeviceAuth = { ok: true; deviceId: string; clinicId: string } | { ok: false; error: string };

/**
 * Verify the `Authorization: Bearer <deviceId>.<secret>` a paired phone sends.
 *
 * Compared with a constant-time check: a plain `===` on a hex digest leaks, through how long the
 * comparison takes, how many leading characters a guess got right — which is enough to walk a
 * token out one character at a time.
 */
export async function authenticateDevice(request: Request): Promise<DeviceAuth> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const [deviceId, secret] = token.split(".");
  if (!deviceId || !secret) return { ok: false, error: "This phone is not paired." };

  const snap = await adminDb().collection(DEVICES).doc(deviceId).get();
  if (!snap.exists) return { ok: false, error: "This phone is not paired." };

  const data = snap.data() || {};
  if (data.revokedAt) return { ok: false, error: "This phone was unpaired from the clinic." };

  const expected = Buffer.from(String(data.secretHash || ""), "utf8");
  const actual = Buffer.from(sha256(secret), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, error: "This phone is not paired." };
  }

  return { ok: true, deviceId, clinicId: String(data.clinicId || "") };
}

export async function touchDevice(deviceId: string, fields: Record<string, unknown> = {}): Promise<void> {
  await adminDb()
    .collection(DEVICES)
    .doc(deviceId)
    .set({ lastSeenAt: new Date().toISOString(), ...fields }, { merge: true });
}

/** Every phone ever paired to this clinic, newest first. Secrets are never included. */
export async function listClinicDevices(clinicId: string): Promise<SmsDevice[]> {
  const snap = await adminDb().collection(DEVICES).where("clinicId", "==", clinicId).get();
  return snap.docs
    .map((d) => {
      const data = d.data() || {};
      return {
        deviceId: d.id,
        clinicId: String(data.clinicId || ""),
        name: String(data.name || "Clinic phone"),
        platform: String(data.platform || ""),
        createdAt: String(data.createdAt || ""),
        lastSeenAt: data.lastSeenAt ? String(data.lastSeenAt) : undefined,
        lastSentAt: data.lastSentAt ? String(data.lastSentAt) : undefined,
        revokedAt: data.revokedAt ? String(data.revokedAt) : undefined,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Is there a phone that could actually send right now? */
export async function hasActiveDevice(clinicId: string): Promise<boolean> {
  const devices = await listClinicDevices(clinicId);
  return devices.some((d) => !d.revokedAt);
}

/**
 * Unpair a phone.
 *
 * Revoked rather than deleted, so the token stops working immediately but the record of which
 * phone sent a clinic's messages, and until when, survives.
 */
export async function revokeDevice(clinicId: string, deviceId: string): Promise<boolean> {
  const ref = adminDb().collection(DEVICES).doc(deviceId);
  const snap = await ref.get();
  // Checked rather than assumed: the deviceId arrives in a request, so without this one clinic
  // could unpair another clinic's phone by guessing an id.
  if (!snap.exists || String(snap.data()?.clinicId || "") !== clinicId) return false;

  await ref.set({ revokedAt: new Date().toISOString() }, { merge: true });
  return true;
}
