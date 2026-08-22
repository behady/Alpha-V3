/**
 * The record of who moved money, and what it looked like before they did.
 *
 * `system_logs` already records that something happened, in a sentence meant for a human reading
 * the activity screen. This is the other half: the actual document, before and after, so
 * "who deleted this payment, and what was in it" has an answer months later. The existing
 * `ai_deletion_log` does the same job for the assistant's deletions and is the pattern this
 * follows.
 *
 * Written only through the Admin SDK, and `ledger_audit` is denied to clients in firestore.rules —
 * an audit trail the audited party can edit is not an audit trail. Staff can still read it.
 *
 * Never throws. A failure to record must not roll back the operation the user asked for, but it is
 * logged loudly so a silently-empty trail is noticeable.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { logActivityServer } from "@/lib/server/systemLog";

export const LEDGER_AUDIT_COLLECTION = "ledger_audit";

export type LedgerAuditAction = "create" | "update" | "delete";

export type LedgerAuditEntry = {
  clinicId: string;
  action: LedgerAuditAction;
  collection: "ledger" | "clinical_notes" | "appointments";
  documentId: string;
  /** The document as it stood before. Required for update and delete — that is the whole point. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actor: { uid?: string | null; name?: string | null; role?: string | null };
  /** Which route and action did this, e.g. "finance/ledger:create-payment". */
  via: string;
};

/** Firestore rejects `undefined`; strip it rather than letting a whole audit write fail. */
function clean(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export async function recordLedgerAudit(entry: LedgerAuditEntry): Promise<void> {
  try {
    await adminClinicCollection(entry.clinicId, LEDGER_AUDIT_COLLECTION).add({
      action: entry.action,
      collection: entry.collection,
      documentId: entry.documentId,
      before: clean(entry.before),
      after: clean(entry.after),
      byUid: entry.actor.uid || null,
      byName: entry.actor.name || "Unknown",
      byRole: entry.actor.role || null,
      via: entry.via,
      at: FieldValue.serverTimestamp(),
      date: new Date().toISOString().split("T")[0],
    });
  } catch (error) {
    console.error("recordLedgerAudit: failed to write audit entry", {
      clinicId: entry.clinicId,
      collection: entry.collection,
      documentId: entry.documentId,
    }, error);
  }
}

/** Several rows changed by one action — recorded individually so each is searchable by id. */
export async function recordLedgerAuditBatch(entries: LedgerAuditEntry[]): Promise<void> {
  await Promise.all(entries.map((entry) => recordLedgerAudit(entry)));
}

/**
 * The pair every money mutation should write: the human-readable activity line, and the
 * before/after record. Kept together so a route cannot remember one and forget the other.
 */
export async function recordMoneyChange(args: {
  entry: LedgerAuditEntry;
  /** Activity-log sentence, e.g. "Payment Received". */
  action: string;
  details: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}): Promise<void> {
  await Promise.all([
    recordLedgerAudit(args.entry),
    logActivityServer({
      clinicId: args.entry.clinicId,
      user: args.entry.actor,
      action: args.action,
      details: args.details,
      severity: args.severity || (args.entry.action === "delete" ? "HIGH" : "MEDIUM"),
      module: "finance",
    }),
  ]);
}
