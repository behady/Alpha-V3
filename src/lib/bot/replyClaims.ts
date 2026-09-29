import { adminClinicCollection } from "@/lib/adminClinicDb";

/**
 * "Say this once": a lock that lets exactly one of two concurrent replies through.
 *
 * The duplicates in the real clinic's history were never the model repeating itself. They were a
 * patient tapping "تأكيد الحضور" twice, or sending "وجع خفيف" and "الحمدلله" two seconds apart, and
 * two serverless invocations composing the same answer at the same moment — the gap between the
 * two sends was zero seconds. A check that reads the thread before sending cannot catch that:
 * neither invocation has sent yet when the other looks. An atomic `create()` can: both race for
 * the same document, one wins, the other stays silent.
 *
 * Two uses, both keyed on the conversation plus a fingerprint of the text:
 *   - inbound: the same words from the same number inside 20 seconds are one message;
 *   - outbound: the same reply to the same number inside 90 seconds goes out once.
 *
 * Fails open: if Firestore is unreachable the reply is sent, because a lost answer costs more
 * than a repeated one.
 */

const COLLECTION = "whatsapp_claims";

/** FNV-1a, eight hex characters: enough to tell two texts apart, short enough for a doc id. */
export function textFingerprint(text: string): string {
  const norm = normaliseForClaim(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The text as a patient would recognise it: whitespace folded, the opt-out footer and the
 * after-hours note stripped, so "the same reply with a footer" counts as the same reply.
 */
export function normaliseForClaim(text: string): string {
  return String(text || "")
    .replace(/\n—[^\n]*$/g, "")
    .replace(/العيادة مقفولة دلوقتي[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function claimKey(kind: "in" | "out", phoneKey: string, text: string): string {
  return `${kind}_${String(phoneKey).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}_${textFingerprint(text)}`;
}

/**
 * True when this caller is the first to claim `key` inside `windowMs`; false when somebody else
 * already did. A stale claim (older than the window) is taken over.
 */
export async function claimOnce(clinicId: string, key: string, windowMs: number, now: number = Date.now()): Promise<boolean> {
  const ref = adminClinicCollection(clinicId, COLLECTION).doc(key);
  try {
    await ref.create({ atMs: now });
    return true;
  } catch (e) {
    const code = (e as { code?: number | string })?.code;
    if (code !== 6 && code !== "already-exists" && code !== "ALREADY_EXISTS") return true; // fail open
  }
  try {
    const snap = await ref.get();
    const atMs = Number(snap.data()?.atMs) || 0;
    if (atMs >= now - windowMs) return false;
    await ref.set({ atMs: now });
    return true;
  } catch {
    return true;
  }
}
