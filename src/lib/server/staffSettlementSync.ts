/**
 * Stamp what has been paid onto the rows that earned it.
 *
 * The Team page works a dentist's settlements out live, over their whole history. The Finance
 * page lists one period of rows for every dentist and cannot afford that, so after every payout
 * or deduction is written, the result is stamped where the row already lives: `doctorCommissionPaid`
 * / `doctorCommissionDeducted` on a private payment row, and `paid` / `deducted` on the
 * approval's `dentists[i]` for an insurance line. A screen then reads paid and pending off the
 * row it is showing, the way it reads the commission itself.
 *
 * Same earnings, same order, same arithmetic as the Team page (`lib/staffSettlement.ts`), so the
 * two never disagree. A row that stops earning (its commission was zeroed, a line went back to
 * Planned) is stamped back to zero. Called by /api/staff/settlements, and by the treatment and
 * approval routes when an edit hands work from one dentist to another; nothing else writes these.
 */

import { adminDb } from "@/lib/firebaseAdmin";
import { reportServerError } from "@/lib/server/reportError";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { commissionByStaff, NO_COMMISSION } from "@/lib/staffCommission";
import { insuranceWorkByStaff, NO_INSURANCE_WORK } from "@/lib/staffInsurance";
import { CLAIMS_COLLECTION, parseClaim, type InsuranceClaim, type LineDentist } from "@/lib/insurance/claims";
import { parseSettlement, SETTLEMENTS_COLLECTION, settleEarnings, type Earning, type StaffSettlement } from "@/lib/staffSettlement";

const BATCH_LIMIT = 400;

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export async function restampStaffSettlements(clinicId: string, staffId: string): Promise<{ rows: number; claims: number }> {
  const [ledgerSnap, claimsSnap, settleSnap, staffSnap] = await Promise.all([
    adminClinicCollection(clinicId, "ledger").where("doctorId", "==", staffId).get(),
    adminClinicCollection(clinicId, CLAIMS_COLLECTION).where("status", "in", ["treated", "sent"]).get(),
    adminClinicCollection(clinicId, SETTLEMENTS_COLLECTION).where("staffId", "==", staffId).get(),
    adminClinicDoc(clinicId, "staff", staffId).get(),
  ]);
  const ledgerById = new Map(ledgerSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
  const ledger = [...ledgerById.entries()].map(([id, data]) => ({ id, ...data }));
  const claims = claimsSnap.docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is InsuranceClaim => c !== null);
  const settlements = settleSnap.docs.map((d) => parseSettlement(d.id, d.data())).filter((s): s is StaffSettlement => s !== null);
  const staff = [{ id: staffId, name: String(staffSnap.get("name") ?? "") }];

  const insuranceRowIds = new Set(claims.flatMap((c) => Object.values(c.ledgerIds).map((l) => l.ledgerId)));
  const privateWork = commissionByStaff(ledger, staff, insuranceRowIds).get(staffId) ?? NO_COMMISSION;
  const insuranceWork = insuranceWorkByStaff(claims).get(staffId) ?? NO_INSURANCE_WORK;
  const earnings: Earning[] = [
    ...privateWork.entries.map((e) => ({ key: e.id, date: e.date, amount: e.amount })),
    ...insuranceWork.entries.map((e) => ({ key: `${e.claimId}#${e.lineIndex}`, date: e.date, amount: e.share })),
  ];
  const result = settleEarnings(earnings, settlements);

  let batch = adminDb().batch();
  let pending = 0;
  let rows = 0;
  let claimsWritten = 0;
  const flush = async () => {
    if (pending === 0) return;
    await batch.commit();
    batch = adminDb().batch();
    pending = 0;
  };
  const queue = async (write: () => void) => {
    write();
    pending += 1;
    if (pending >= BATCH_LIMIT) await flush();
  };

  // Private payment rows: every row stamped with this dentist, earning or not.
  for (const [id, data] of ledgerById) {
    if (String(data.type ?? "") !== "payment") continue;
    const s = result.byKey.get(id);
    const paid = s?.paid ?? 0;
    const deducted = s?.deducted ?? 0;
    if (num(data.doctorCommissionPaid) === paid && num(data.doctorCommissionDeducted) === deducted) continue;
    await queue(() => batch.update(adminClinicDoc(clinicId, "ledger", id), { doctorCommissionPaid: paid, doctorCommissionDeducted: deducted }));
    rows += 1;
  }

  // Approval lines assigned to this dentist: the whole `dentists` map is rewritten, other
  // dentists' entries untouched.
  for (const claim of claims) {
    let changed = false;
    const dentists: Record<number, LineDentist> = {};
    for (const [k, d] of Object.entries(claim.dentists)) {
      const i = Number(k);
      if (d.staffId !== staffId) {
        dentists[i] = d;
        continue;
      }
      const s = result.byKey.get(`${claim.id}#${i}`);
      const paid = s?.paid ?? 0;
      const deducted = s?.deducted ?? 0;
      if ((d.paid ?? 0) !== paid || (d.deducted ?? 0) !== deducted) changed = true;
      dentists[i] = { staffId: d.staffId, name: d.name, rate: d.rate, share: d.share, paid, deducted };
    }
    if (!changed) continue;
    await queue(() => batch.update(adminClinicDoc(clinicId, CLAIMS_COLLECTION, claim.id), { dentists }));
    claimsWritten += 1;
  }
  await flush();
  return { rows, claims: claimsWritten };
}

/**
 * Re-stamp every dentist an edit moved work between, after that edit has committed.
 *
 * A receipt (or an approval line) handed from one dentist to another keeps the "paid" stamp the
 * FIRST dentist's payouts put on it, so the new dentist's Finance row shows money she never got,
 * and the old one's payouts point at nothing. Re-running the FIFO for both puts each payout back on
 * work its own dentist earned. Never throws: the edit is already saved, and a stale stamp is
 * repaired by the next payout or edit, which a failed save is not.
 */
export async function restampStaffSettlementsFor(clinicId: string, staffIds: Iterable<string | null | undefined>): Promise<void> {
  const ids = [...new Set([...staffIds].filter((id): id is string => typeof id === "string" && id.trim() !== ""))];
  for (const id of ids) {
    try {
      await restampStaffSettlements(clinicId, id);
    } catch (err) {
      reportServerError("Staff settlement re-stamp failed", err, { staffId: id });
    }
  }
}
