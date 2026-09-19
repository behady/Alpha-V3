import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * The credential a clinic hands to an outside AI assistant.
 *
 * A clinic owner who connects Claude (or any other MCP client) to Alpha Dental is handing a
 * program that is not ours a way into his clinic's data. That makes this a real credential, not
 * a convenience token, and it is built like one:
 *
 *   - Only the hash is stored. The plaintext is shown once, at mint time, and never again —
 *     there is no "show me my key" screen, because a key we can re-display is a key an attacker
 *     who reaches the database can re-display too.
 *   - The lookup id travels in the key itself, so verifying a call is one document read rather
 *     than a scan of every key on the platform.
 *   - The record lives in a root collection denied to every client by firestore.rules, for the
 *     same reason `clinic_secrets` does: the blanket clinic-member read grant inside
 *     `clinics/{id}/…` would otherwise let a receptionist read a key that can read everything.
 *
 * A key belongs to one clinic AND one staff member. That second half matters: it is what makes
 * the answer the assistant gets obey the same permissions the app obeys, so connecting Claude
 * cannot become a way around a permission checkbox.
 */

/** Root collection. Server-only — see the matching `if false` block in firestore.rules. */
const KEY_COLLECTION = "mcp_keys";

/**
 * `alpha_mcp_<id>_<secret>`.
 *
 * The prefix is there so the value is recognisable on sight — in a log, a screenshot, or a
 * support conversation — and so secret-scanning tools can be taught one pattern.
 */
export const MCP_KEY_PREFIX = "alpha_mcp_";

/**
 * What the holder of a key may do.
 *
 * `read` answers questions. `full` also writes and deletes, which is a different kind of trust:
 * an assistant acting on a misread instruction can book, charge, or remove records. Both exist
 * because the clinic owns this decision, but they are separate choices rather than one switch,
 * and a key is `read` unless somebody deliberately asked for more.
 */
export type McpKeyScope = "read" | "full";

export type McpKeyRecord = {
  id: string;
  clinicId: string;
  /** The staff account this key acts as. Its permissions are the ceiling on every answer. */
  uid: string;
  label: string;
  scope: McpKeyScope;
  createdAtMs: number;
  createdByName: string;
  lastUsedAtMs: number | null;
  revokedAtMs: number | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on a hash leaks how many leading characters matched through how long it took to fail.
 * That is a thin channel, but it is a free one to close, and the digests are fixed-length so
 * there is no length check to get wrong.
 */
function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function toRecord(id: string, data: Record<string, unknown>): McpKeyRecord {
  return {
    id,
    clinicId: String(data.clinicId || ""),
    uid: String(data.uid || ""),
    label: String(data.label || "Untitled key"),
    scope: data.scope === "full" ? "full" : "read",
    createdAtMs: Number(data.createdAtMs) || 0,
    createdByName: String(data.createdByName || ""),
    lastUsedAtMs: typeof data.lastUsedAtMs === "number" ? data.lastUsedAtMs : null,
    revokedAtMs: typeof data.revokedAtMs === "number" ? data.revokedAtMs : null,
  };
}

/**
 * Creates a key and returns the one and only copy of its plaintext.
 *
 * The caller must show `secret` to the user immediately and then forget it. Nothing in this
 * codebase can recover it afterwards.
 */
export async function mintMcpKey(args: {
  clinicId: string;
  uid: string;
  label: string;
  scope: McpKeyScope;
  createdByName: string;
}): Promise<{ record: McpKeyRecord; secret: string }> {
  const id = randomBytes(8).toString("hex");
  const secretPart = randomBytes(32).toString("base64url");
  const secret = `${MCP_KEY_PREFIX}${id}_${secretPart}`;

  const doc = {
    clinicId: args.clinicId,
    uid: args.uid,
    label: args.label.trim() || "Untitled key",
    scope: args.scope,
    // Hash of the secret half only. The id is public — it is a lookup, not a password.
    secretHash: sha256(secretPart),
    createdAtMs: Date.now(),
    createdByName: args.createdByName,
    lastUsedAtMs: null,
    revokedAtMs: null,
  };

  await adminDb().collection(KEY_COLLECTION).doc(id).set(doc);
  return { record: toRecord(id, doc), secret };
}

/**
 * Turns a presented key back into the clinic and staff member it speaks for.
 *
 * Returns null for anything that is not a live key — wrong shape, unknown id, wrong secret,
 * revoked. Deliberately one null rather than a reason: the caller answers 401 either way, and a
 * caller that cannot tell "no such key" from "wrong secret" cannot be used to enumerate ids.
 */
export async function verifyMcpKey(presented: string): Promise<McpKeyRecord | null> {
  const value = (presented || "").trim();
  if (!value.startsWith(MCP_KEY_PREFIX)) return null;

  const body = value.slice(MCP_KEY_PREFIX.length);
  const split = body.indexOf("_");
  if (split <= 0) return null;

  const id = body.slice(0, split);
  const secretPart = body.slice(split + 1);
  if (!id || !secretPart || !/^[a-f0-9]{16}$/.test(id)) return null;

  const snap = await adminDb().collection(KEY_COLLECTION).doc(id).get();
  const data = snap.data();
  if (!data) return null;

  if (!digestsMatch(sha256(secretPart), String(data.secretHash || ""))) return null;
  if (typeof data.revokedAtMs === "number") return null;

  return toRecord(id, data);
}

/**
 * Records that a key was used, without making the caller wait for it.
 *
 * This is the only way a clinic can tell a forgotten connector from a live one, so it is worth
 * writing — but it is bookkeeping, and a failed write here must never fail the request that
 * triggered it. One write per call is acceptable; these are conversational, not high-volume.
 */
export function touchMcpKey(id: string): void {
  void adminDb()
    .collection(KEY_COLLECTION)
    .doc(id)
    .update({ lastUsedAtMs: Date.now() })
    .catch(() => {});
}

/** Every key a clinic holds, newest first. Hashes are never returned. */
export async function listMcpKeys(clinicId: string): Promise<McpKeyRecord[]> {
  const snap = await adminDb().collection(KEY_COLLECTION).where("clinicId", "==", clinicId).get();
  return snap.docs
    .map((d) => toRecord(d.id, d.data()))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/**
 * Revokes a key, scoped to the clinic that owns it.
 *
 * The clinicId is a condition, not decoration: without it a caller who learned any key id could
 * revoke another practice's connector, which is a denial-of-service on somebody else's clinic.
 */
export async function revokeMcpKey(clinicId: string, id: string): Promise<boolean> {
  const ref = adminDb().collection(KEY_COLLECTION).doc(id);
  const snap = await ref.get();
  const data = snap.data();
  if (!data || String(data.clinicId || "") !== clinicId) return false;
  if (typeof data.revokedAtMs === "number") return true;
  await ref.update({ revokedAtMs: Date.now() });
  return true;
}
