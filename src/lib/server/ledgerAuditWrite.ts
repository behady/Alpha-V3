/**
 * The bare `ledger_audit` write, with nothing hung off it.
 *
 * `ledgerAudit.ts` is what routes call: it writes this entry and then lets a paid-daily dentist's
 * day's share catch up (`dailyPaySync.ts`). The daily-pay sync writes its own audit entries through
 * this file instead, so the two modules never import each other.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";

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

/** Never throws: a failure to record must not roll back what the user asked for. */
export async function writeLedgerAudit(entry: LedgerAuditEntry): Promise<void> {
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
