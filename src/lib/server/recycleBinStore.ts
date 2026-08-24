import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  BIN_ENTRIES_COLLECTION,
  BIN_HISTORY_COLLECTION,
  BIN_PAYLOAD_DOC,
  BIN_PAYLOAD_SUBCOLLECTION,
} from "@/lib/recycleBin";
import { createHash } from "node:crypto";

/**
 * Where deleted records are kept, and why it is not where you would expect.
 *
 * The bin is a ROOT collection, not `clinics/{clinicId}/deleted_records`. That looks wrong for a
 * multi-tenant system until you read the blanket grant in firestore.rules: every clinic
 * subcollection is readable by every clinic member, and rules OR together, so a narrower block
 * underneath cannot take that back. A bin under the clinic would therefore be readable by the
 * whole clinic by construction — and its entries are full patient records: allergies, medical
 * history, the odontogram, live image URLs. The narrower block would have looked like protection
 * and provided none.
 *
 * At the root with `allow read, write: if false`, no client reads or writes it at all; the routes
 * serve it, filtered by what the caller may see. Same shape as `clinic_secrets`, for the same
 * reason.
 *
 * A second reason: a member-writable bin entry would be an arbitrary-write capability into any
 * collection, because restore executes whatever the entry says using the Admin SDK.
 */

export const RETENTION_DAYS = 30;

/**
 * The live entry's id is derived from its target, so a collection can hold at most one un-restored
 * entry per document. Two identical rows in the bin, and "restore the wrong one" becomes possible;
 * this makes it unrepresentable. Restored and purged entries move to history and free the id.
 */
export function liveEntryId(clinicId: string, collection: string, documentId: string): string {
  return createHash("sha1").update(`${clinicId}|${collection}|${documentId}`).digest("hex");
}

export const binCollection = () => adminDb().collection(BIN_ENTRIES_COLLECTION);
export const binEntry = (entryId: string) => binCollection().doc(entryId);
export const binPayload = (entryId: string) =>
  binEntry(entryId).collection(BIN_PAYLOAD_SUBCOLLECTION).doc(BIN_PAYLOAD_DOC);
export const binHistory = () => adminDb().collection(BIN_HISTORY_COLLECTION);

/** Firestore rejects `undefined` anywhere in a document; a snapshot must survive the round trip. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Timestamp)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** Rough serialized size, to refuse an oversized snapshot before a transaction opens. */
export function approximateBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER; // circular or unserialisable — refuse rather than guess
  }
}

/**
 * The permanent record that a deletion happened, carrying no snapshot.
 *
 * Retention removes copies of data; it must never remove the fact. A history row outlives every
 * entry it describes and nothing deletes it.
 */
export async function writeHistory(entry: Record<string, unknown>, transition: string): Promise<void> {
  await binHistory().add({
    clinicId: entry.clinicId ?? null,
    collection: entry.collection ?? null,
    documentId: entry.documentId ?? null,
    label: entry.label ?? null,
    deletedByUid: entry.deletedByUid ?? null,
    deletedByName: entry.deletedByName ?? null,
    deletedAt: entry.deletedAt ?? null,
    storagePaths: entry.storagePaths ?? [],
    transition,
    at: FieldValue.serverTimestamp(),
  });
}

/**
 * Advisory only. Nothing deletes on this date.
 *
 * A TTL policy was considered and rejected: it would be an untriggered permanent delete of what is
 * by then the only copy of a patient record, it cannot be declared from this repo (firebase.json
 * carries rules and indexes only) so CI could never assert it exists, and the house pattern for
 * expiry fields is a plain number — which a TTL policy silently ignores, producing a bin everyone
 * believes expires and which never does. Written as a real Timestamp so that if a policy is ever
 * attached deliberately, the field is the right type.
 */
export function expiryTimestamp(): Timestamp {
  return Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Object paths for any Cloud Storage files the snapshot names.
 *
 * Paths, never download URLs: a URL carries an access token that can be rotated, and a snapshot is
 * static JSON nothing will ever rewrite, so a verbatim URL written back weeks later can point at
 * nothing while the restore reports success. Recorded so the objects stay findable — the bin entry
 * is, after a delete, the last document anywhere that names them.
 *
 * Nothing here deletes a blob. One object can be referenced by several documents (duplicating a
 * media item copies the URL without re-uploading), so a refcount taken now is stale later.
 */
export function storagePathsFrom(collection: string, snapshot: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) paths.add(v.trim());
  };
  const fromUrl = (v: unknown) => {
    if (typeof v !== "string") return;
    // .../o/<url-encoded-object-path>?alt=media&token=...
    const m = v.match(/\/o\/([^?]+)/);
    if (m) {
      try {
        add(decodeURIComponent(m[1]));
      } catch {
        /* a malformed URL names nothing */
      }
    }
  };

  if (collection === "patient_media") {
    add(snapshot.storagePath);
    if (!snapshot.storagePath) fromUrl(snapshot.url);
  }
  if (collection === "patients") {
    add(snapshot.storagePath);
    fromUrl(snapshot.imageUrl);
    const teeth = snapshot.teethData;
    if (teeth && typeof teeth === "object") {
      for (const tooth of Object.values(teeth as Record<string, unknown>)) {
        if (tooth && typeof tooth === "object") fromUrl((tooth as Record<string, unknown>).imageUrl);
      }
    }
  }
  return [...paths];
}
