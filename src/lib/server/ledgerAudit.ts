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

import { logActivityServer } from "@/lib/server/systemLog";
import { syncDailyPayFor, touchedByRows } from "@/lib/server/dailyPaySync";
import { writeLedgerAudit, type LedgerAuditEntry } from "@/lib/server/ledgerAuditWrite";

export { LEDGER_AUDIT_COLLECTION, type LedgerAuditAction, type LedgerAuditEntry } from "@/lib/server/ledgerAuditWrite";

/**
 * Every money change is audited here once it has been saved, so this is also where a paid-daily
 * dentist's automatic day's share is brought back in line (`lib/server/dailyPaySync.ts`). For a
 * dentist whose switch is off it costs one read and writes nothing. Never throws.
 */
async function syncDailyPayAfter(entries: readonly LedgerAuditEntry[]): Promise<void> {
  const ledger = entries.filter((e) => e.collection === "ledger");
  if (ledger.length === 0) return;
  await syncDailyPayFor(ledger[0].clinicId, ledger.flatMap((e) => touchedByRows(e.before, e.after)));
}

export async function recordLedgerAudit(entry: LedgerAuditEntry): Promise<void> {
  await writeLedgerAudit(entry);
  await syncDailyPayAfter([entry]);
}

/** Several rows changed by one action — recorded individually so each is searchable by id. */
export async function recordLedgerAuditBatch(entries: LedgerAuditEntry[]): Promise<void> {
  await Promise.all(entries.map((entry) => writeLedgerAudit(entry)));
  const byClinic = new Map<string, LedgerAuditEntry[]>();
  for (const e of entries) byClinic.set(e.clinicId, [...(byClinic.get(e.clinicId) || []), e]);
  for (const group of byClinic.values()) await syncDailyPayAfter(group);
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
