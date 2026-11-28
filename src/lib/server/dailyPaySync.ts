/**
 * Keep a paid-daily dentist's automatic day's-share payouts in step with their payments.
 *
 * Called after any server write that adds, changes or removes a ledger row (`syncDailyPayFor`),
 * and by the nightly check over every day (`syncDailyPay(…, "all")`). For a dentist whose switch is
 * off it reads one staff document and writes nothing — so a clinic that never turns the switch on
 * sees no change at all.
 *
 * Each automatic payout is a `staff_settlements` document with a fixed id plus its "Salary" ledger
 * row (the same shape a Team-page payout writes, with `dailyPay: true`), so Finance and every report
 * count it as cash leaving. Afterwards the dentist's rows are re-stamped with what is paid.
 *
 * Never throws from `syncDailyPayFor`: the edit that triggered it is already saved, and anything
 * missed is put right by the next edit that day or by the nightly check.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { reportServerError } from "@/lib/server/reportError";
import { writeLedgerAudit, type LedgerAuditEntry } from "@/lib/server/ledgerAuditWrite";
import { restampStaffSettlements } from "@/lib/server/staffSettlementSync";
import { buildManualEntryRow } from "@/lib/ledgerWrite";
import { CLAIMS_COLLECTION, parseClaim, type InsuranceClaim } from "@/lib/insurance/claims";
import { parseSettlement, SETTLEMENTS_COLLECTION, type StaffSettlement } from "@/lib/staffSettlement";
import { DAILY_PAY_ACTOR, dailyPayLedgerId, dailyPayStart, dailyShares, planDailyPay, type DailyPayOp, type DailyShare } from "@/lib/dailyPay";

const BATCH_LIMIT = 400;

export type DailyPaySyncResult = { upserted: number; deleted: number };

/** The "Salary" row an automatic payout writes: a Team-page payout's row, marked as the day's share. */
export function dailyPayLedgerRow(args: { staffId: string; staffName: string; share: DailyShare }): Record<string, unknown> {
  return {
    ...buildManualEntryRow({
      type: "expense",
      amount: args.share.amount,
      description: `Day's share – ${args.staffName}`,
      category: "Salary",
      date: args.share.date,
      method: "Cash",
      isRecurring: false,
      actor: { uid: DAILY_PAY_ACTOR.uid, name: DAILY_PAY_ACTOR.name },
    }),
    staffId: args.staffId,
    settlementId: args.share.id,
    note: "",
    dailyPay: true,
    ...(args.share.branchId ? { branchId: args.share.branchId } : {}),
  };
}

/** The automatic payout document itself. */
export function dailyPaySettlementDoc(args: { staffId: string; staffName: string; share: DailyShare }): Record<string, unknown> {
  return {
    staffId: args.staffId,
    staffName: args.staffName,
    kind: "payout",
    auto: "daily",
    amount: args.share.amount,
    date: args.share.date,
    note: "",
    method: "Cash",
    paymentIds: args.share.paymentIds,
    ledgerId: dailyPayLedgerId(args.staffId, args.share.date, args.share.branchId),
    ...(args.share.branchId ? { branchId: args.share.branchId } : {}),
  };
}

/** Everything the plan needs about one dentist, read once. */
export async function loadDailyPayState(clinicId: string, staffId: string) {
  const [staffSnap, ledgerSnap, claimsSnap, settleSnap] = await Promise.all([
    adminClinicDoc(clinicId, "staff", staffId).get(),
    adminClinicCollection(clinicId, "ledger").where("doctorId", "==", staffId).get(),
    adminClinicCollection(clinicId, CLAIMS_COLLECTION).where("status", "in", ["treated", "sent"]).get(),
    adminClinicCollection(clinicId, SETTLEMENTS_COLLECTION).where("staffId", "==", staffId).get(),
  ]);
  const staff = staffSnap.exists ? (staffSnap.data() as Record<string, unknown>) : null;
  const rows = ledgerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  const claims = claimsSnap.docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is InsuranceClaim => c !== null);
  const insuranceRowIds = new Set(claims.flatMap((c) => Object.values(c.ledgerIds).map((l) => l.ledgerId)));
  const settlements = settleSnap.docs.map((d) => parseSettlement(d.id, d.data())).filter((s): s is StaffSettlement => s !== null);
  const staffName = String(staff?.name ?? "").trim() || "Staff";
  const shares = dailyShares(rows, { id: staffId, name: staffName }, insuranceRowIds);
  return { staff, staffName, shares, settlements };
}

/**
 * Bring one dentist's automatic payouts in line with their payments on `dates` (or every day).
 * Writes only what differs; returns how many day lines were written and removed.
 */
export async function syncDailyPay(clinicId: string, staffId: string, dates: Iterable<string> | "all"): Promise<DailyPaySyncResult> {
  if (!clinicId || !staffId) return { upserted: 0, deleted: 0 };
  // The switch is checked first and alone, so a dentist who is not paid daily costs one read.
  const staffSnap = await adminClinicDoc(clinicId, "staff", staffId).get();
  if (!staffSnap.exists || !dailyPayStart(staffSnap.data())) return { upserted: 0, deleted: 0 };

  const { staff, staffName, shares, settlements } = await loadDailyPayState(clinicId, staffId);
  const ops = planDailyPay({ staff, shares, existing: settlements, dates });
  if (ops.length === 0) return { upserted: 0, deleted: 0 };
  return applyDailyPayOps({ clinicId, staffId, staffName, ops, settlements });
}

/** Write a plan: each day's payout and its Salary row together, with an audit entry per row. */
export async function applyDailyPayOps(args: {
  clinicId: string;
  staffId: string;
  staffName: string;
  ops: readonly DailyPayOp[];
  settlements: readonly StaffSettlement[];
}): Promise<DailyPaySyncResult> {
  const { clinicId, staffId, staffName, ops } = args;
  const existingById = new Map(args.settlements.map((s) => [s.id, s]));

  // The ledger rows as they stand, for the audit's "before".
  const ledgerIds = ops.map((op) => (op.kind === "upsert" ? dailyPayLedgerId(staffId, op.share.date, op.share.branchId) : existingById.get(op.id)?.ledgerId || ""));
  const refs = ledgerIds.filter(Boolean).map((id) => adminClinicDoc(clinicId, "ledger", id));
  const beforeSnaps = refs.length > 0 ? await adminDb().getAll(...refs) : [];
  const beforeById = new Map(beforeSnaps.map((s) => [s.id, s.exists ? (s.data() as Record<string, unknown>) : null]));

  let batch = adminDb().batch();
  let pending = 0;
  const audits: LedgerAuditEntry[] = [];
  let upserted = 0;
  let deleted = 0;

  for (const op of ops) {
    if (op.kind === "upsert") {
      const ledgerId = dailyPayLedgerId(staffId, op.share.date, op.share.branchId);
      const before = beforeById.get(ledgerId) ?? null;
      const row = dailyPayLedgerRow({ staffId, staffName, share: op.share });
      const isNew = !existingById.has(op.share.id);
      batch.set(
        adminClinicDoc(clinicId, SETTLEMENTS_COLLECTION, op.share.id),
        { ...dailyPaySettlementDoc({ staffId, staffName, share: op.share }), updatedAt: FieldValue.serverTimestamp(), ...(isNew ? { createdAt: FieldValue.serverTimestamp(), createdByUid: DAILY_PAY_ACTOR.uid, createdByName: DAILY_PAY_ACTOR.name } : {}) },
        { merge: true },
      );
      batch.set(adminClinicDoc(clinicId, "ledger", ledgerId), { ...row, updatedAt: FieldValue.serverTimestamp(), ...(before ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
      audits.push({ clinicId, action: before ? "update" : "create", collection: "ledger", documentId: ledgerId, before, after: row, actor: DAILY_PAY_ACTOR, via: "daily-pay:sync" });
      upserted += 1;
      pending += 2;
    } else {
      const ledgerId = existingById.get(op.id)?.ledgerId || "";
      batch.delete(adminClinicDoc(clinicId, SETTLEMENTS_COLLECTION, op.id));
      pending += 1;
      if (ledgerId) {
        const before = beforeById.get(ledgerId) ?? null;
        batch.delete(adminClinicDoc(clinicId, "ledger", ledgerId));
        pending += 1;
        if (before) audits.push({ clinicId, action: "delete", collection: "ledger", documentId: ledgerId, before, actor: DAILY_PAY_ACTOR, via: "daily-pay:sync" });
      }
      deleted += 1;
    }
    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = adminDb().batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  await Promise.all(audits.map((a) => writeLedgerAudit(a)));
  await restampStaffSettlements(clinicId, staffId);
  return { upserted, deleted };
}

/** The dentists and days a set of ledger rows (before and after an edit) touch. */
export function touchedByRows(...rows: Array<Record<string, unknown> | null | undefined>): Array<{ staffId: string; date: string }> {
  const out: Array<{ staffId: string; date: string }> = [];
  for (const row of rows) {
    if (!row) continue;
    const staffId = typeof row.doctorId === "string" ? row.doctorId.trim() : "";
    const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
    if (staffId && date) out.push({ staffId, date });
  }
  return out;
}

/**
 * After a ledger write has committed: re-check every day of every dentist the write touched.
 *
 * Every day, not only the touched one: an edit to a treatment re-works the commission on payments
 * dated on other days, and a payment moved to another dentist leaves the first dentist's line naming
 * it. The whole history is read anyway, the comparison is in memory, and only days that differ are
 * written, so checking them all costs nothing extra and misses nothing.
 *
 * Never throws — a failure is reported and the nightly check repairs it.
 */
export async function syncDailyPayFor(clinicId: string, touched: Iterable<{ staffId?: string | null; date?: string | null }>): Promise<void> {
  if (!clinicId) return;
  const staffIds = new Set<string>();
  for (const t of touched) {
    const staffId = String(t.staffId ?? "").trim();
    if (staffId) staffIds.add(staffId);
  }
  for (const staffId of staffIds) {
    try {
      await syncDailyPay(clinicId, staffId, "all");
    } catch (err) {
      reportServerError("Daily pay sync failed", err, { clinicId, staffId });
    }
  }
}
