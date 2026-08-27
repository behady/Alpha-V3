import { adminClinicCollection } from "@/lib/adminClinicDb";
import { pickPatientPhone } from "@/lib/patientPhone";
import { chargeAmount, overAllocation } from "@/lib/paymentAllocation";
import { rowAmount } from "@/lib/revenueRecovery";

/**
 * The collection list for the Recover Payments screen: who owes the clinic money, and how to
 * reach them.
 *
 * This is deliberately a different thing from `lib/revenueRecovery`, which is an AI-assisted audit
 * that hunts for bookkeeping mistakes — duplicates, underpricing, balances that have gone quiet
 * for 45 days — and is gated behind a paid feature. This one is the everyday debtors list every
 * clinic needs whether or not they pay for AI: every patient with a balance, sorted by size, with
 * a phone number beside each name so someone can pick up the phone and call.
 *
 * Two kinds of money appear here, and they are kept apart on purpose because a clinic acts on
 * them differently:
 *
 *   `balance`  — charged to the patient and not paid. Chase the patient.
 *   `unbilled` — treatment recorded in the clinical notes that never reached the ledger. Nobody
 *                has asked the patient for this yet, so the first step is to invoice it, not to
 *                phone them demanding payment for a bill they never received.
 */

/** Below this, a balance is rounding noise rather than a debt worth a phone call. */
const MIN_OWED = 1;

/** Ledger and note volume is unbounded; cap reads so one large clinic cannot stall the request. */
const SCAN_LIMIT = 4000;

/**
 * A payment sitting on a charge it does not belong to.
 *
 * This list exists because the debtors list below deliberately cannot show it. A credit balance is
 * clamped to zero there, so that one patient's prepayment does not cancel out another's arrears in
 * the headline — which is correct for a call list, and means a patient whose books say she is owed
 * 1,200 EGP she was never given appears nowhere at all.
 *
 * Two shapes, same disease:
 *
 *   `over_allocated`   — more money settles a charge than the charge is worth. A 200 EGP
 *                        consultation reading "paid 1,400".
 *   `orphaned_payment` — the charge a payment settled has been deleted and the payment stayed.
 *                        Usually a duplicate treatment cleaned up from a screen that removed the
 *                        charge without its money.
 *
 * Both distort the patient's balance by exactly the excess, and neither is visible from any screen
 * that reports totals.
 */
export interface LedgerMisallocation {
  kind: "over_allocated" | "orphaned_payment";
  patientId: string;
  patientName: string;
  /** The charge these payments point at. Still set for an orphan — that is the id that dangles. */
  procedureId: string;
  /** Empty for an orphan: the row that would have named it is gone. */
  procedureDescription: string;
  procedureCost: number;
  paidTotal: number;
  /** How far past the charge this goes. The whole amount, when the charge no longer exists. */
  excess: number;
  /** The most recent date among the payments, for sorting a work queue. */
  date: string;
  paymentIds: string[];
}

export interface UnbilledItem {
  noteId: string;
  procedure: string;
  cost: number;
  date: string;
}

export interface RecoveryRow {
  patientId: string;
  patientName: string;
  /** Empty string when the patient record carries no phone at all — the UI has to say so. */
  phone: string;
  /** Patients who asked not to be messaged. Surfaced so staff call instead of messaging. */
  whatsappOptOut: boolean;
  /** Charged and unpaid. */
  balance: number;
  /** Treated but never invoiced. */
  unbilled: number;
  /** balance + unbilled — what the list is sorted by. */
  totalOwed: number;
  /** ISO date of the most recent ledger activity, or "" if the rows carry no usable date. */
  lastActivity: string;
  /** Days since that activity. Undefined when there is no dated activity at all. */
  ageDays?: number;
  unbilledItems: UnbilledItem[];
}

export interface RecoveryList {
  scannedAt: string;
  clinicId: string;
  rows: RecoveryRow[];
  totals: {
    patients: number;
    balance: number;
    unbilled: number;
    totalOwed: number;
  };
  /** Payments settling a charge they do not belong to. Never empty-by-design — see the type. */
  misallocations: LedgerMisallocation[];
  /** Total distortion those misallocations put into patients' balances. */
  misallocatedTotal: number;
  /** True when a scan cap was hit, so the totals are a floor rather than the full picture. */
  truncated: boolean;
  notes: string[];
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(d: Date | null, now: number): number | undefined {
  if (!d) return undefined;
  return Math.max(0, Math.round((now - d.getTime()) / 86400000));
}

/**
 * Build the debtors list from already-loaded records.
 *
 * Kept as a pure function so the money math can be exercised with fixtures — this decides what a
 * clinic tells a patient they owe, and arithmetic nobody can test is arithmetic nobody should
 * repeat down a phone line.
 *
 * `now` is injected rather than read from the clock so that "45 days ago" means the same thing in
 * a test on any day of the year.
 */
export function buildRecoveryList(
  clinicId: string,
  ledger: Record<string, unknown>[],
  notes: Record<string, unknown>[],
  patients: Record<string, unknown>[],
  now: number = Date.now()
): RecoveryList {
  const patientById = new Map(patients.map((p) => [String(p.id), p]));

  type Tally = { charged: number; paid: number; lastActivity: Date | null; name: string };
  const tallies = new Map<string, Tally>();

  const tallyFor = (patientId: string, fallbackName: string): Tally => {
    const existing = tallies.get(patientId);
    if (existing) return existing;
    const created: Tally = { charged: 0, paid: 0, lastActivity: null, name: fallbackName };
    tallies.set(patientId, created);
    return created;
  };

  for (const row of ledger) {
    const patientId = String(row.patientId || "");
    if (!patientId) continue;

    const type = String(row.type || "");
    // Clinic overheads are the clinic's own spending; no patient owes them.
    if (type === "expense") continue;

    const tally = tallyFor(patientId, String(row.patientName || ""));
    if (type === "procedure") tally.charged += rowAmount(row);
    else tally.paid += rowAmount(row);

    const when = parseDate(row.date);
    if (when && (!tally.lastActivity || when > tally.lastActivity)) tally.lastActivity = when;
  }

  /**
   * Payments settling a charge they do not belong to.
   *
   * Walked separately from the tallies above because those work per patient, and this question is
   * per charge: a patient whose totals happen to balance can still have 1,200 EGP sitting on a
   * 200 EGP consultation, and the totals will never say so.
   */
  const procedureById = new Map<string, Record<string, unknown>>();
  for (const row of ledger) {
    if (String(row.type || "") === "procedure") procedureById.set(String(row.id || ""), row);
  }

  type PaymentGroup = { total: number; ids: string[]; date: string; patientId: string; patientName: string };
  const paymentsByProcedure = new Map<string, PaymentGroup>();
  for (const row of ledger) {
    if (String(row.type || "") !== "payment") continue;
    const procedureId = typeof row.procedureId === "string" ? row.procedureId.trim() : "";
    if (!procedureId) continue; // A payment on account settles no charge, so it cannot overshoot one.

    const group = paymentsByProcedure.get(procedureId) ?? {
      total: 0,
      ids: [],
      date: "",
      patientId: String(row.patientId || ""),
      patientName: String(row.patientName || ""),
    };
    group.total += rowAmount(row);
    group.ids.push(String(row.id || ""));
    const when = String(row.date || "");
    if (when > group.date) group.date = when;
    if (!group.patientName && typeof row.patientName === "string") group.patientName = row.patientName;
    paymentsByProcedure.set(procedureId, group);
  }

  const misallocations: LedgerMisallocation[] = [];
  for (const [procedureId, group] of paymentsByProcedure) {
    const procedure = procedureById.get(procedureId);
    const patient = patientById.get(group.patientId);
    const patientName =
      (patient && typeof patient.name === "string" && patient.name.trim()) ||
      group.patientName.trim() ||
      "Unknown patient";

    if (!procedure) {
      // The charge was deleted and its money stayed behind. The whole payment is the distortion.
      misallocations.push({
        kind: "orphaned_payment",
        patientId: group.patientId,
        patientName,
        procedureId,
        procedureDescription: "",
        procedureCost: 0,
        paidTotal: group.total,
        excess: group.total,
        date: group.date,
        paymentIds: group.ids,
      });
      continue;
    }

    // The same tolerant reading the server guard uses, so a charge the guard treats as unpriced is
    // not reported here as overpaid.
    const cost = chargeAmount(procedure);
    // An unpriced charge is a different problem — see lib/paymentAllocation. Reporting every
    // payment against one as an overpayment would bury the real ones.
    if (cost <= 0) continue;

    const excess = overAllocation(cost, group.total);
    if (excess <= 0) continue;

    misallocations.push({
      kind: "over_allocated",
      patientId: group.patientId,
      patientName,
      procedureId,
      procedureDescription: String(procedure.description || "Treatment"),
      procedureCost: cost,
      paidTotal: group.total,
      excess,
      date: group.date,
      paymentIds: group.ids,
    });
  }

  // Biggest distortion first: this is a work queue like the debtors list beside it.
  misallocations.sort((a, b) => b.excess - a.excess);
  const misallocatedTotal = misallocations.reduce((sum, m) => sum + m.excess, 0);

  /**
   * Work recorded clinically but never posted to the ledger.
   *
   * The app's own write order is clinical_notes → ledger → link back via ledgerId. A note carrying
   * a cost but no ledgerId means that chain broke, so the patient was treated and never invoiced.
   */
  const unbilledByPatient = new Map<string, UnbilledItem[]>();
  for (const note of notes) {
    const ledgerId = typeof note.ledgerId === "string" ? note.ledgerId.trim() : "";
    if (ledgerId) continue;

    const cost = toNumber(note.cost);
    // A zero-cost note is a follow-up or a comped visit, not money anyone forgot to collect.
    if (cost <= 0) continue;

    const patientId = String(note.patientId || "");
    if (!patientId) continue;

    const list = unbilledByPatient.get(patientId) ?? [];
    list.push({
      noteId: String(note.id || ""),
      procedure: String(note.procedure || "Procedure"),
      cost,
      date: String(note.date || ""),
    });
    unbilledByPatient.set(patientId, list);
  }

  const patientIds = new Set<string>([...tallies.keys(), ...unbilledByPatient.keys()]);
  const rows: RecoveryRow[] = [];

  for (const patientId of patientIds) {
    const tally = tallies.get(patientId);
    const unbilledItems = unbilledByPatient.get(patientId) ?? [];

    // A credit balance (the patient overpaid) is not a debt. Clamping at zero stops one patient's
    // prepayment from cancelling out another's arrears in the headline total.
    const balance = Math.max(0, (tally?.charged ?? 0) - (tally?.paid ?? 0));
    const unbilled = unbilledItems.reduce((sum, item) => sum + item.cost, 0);
    const totalOwed = balance + unbilled;
    if (totalOwed < MIN_OWED) continue;

    const patient = patientById.get(patientId);
    // clinical_notes documents in this app never store a patientName, and ledger rows only
    // sometimes do, so the patient record is the reliable source for the name on the call list.
    const patientName =
      (patient && typeof patient.name === "string" && patient.name.trim()) ||
      (tally?.name && tally.name.trim()) ||
      "Unknown patient";

    rows.push({
      patientId,
      patientName,
      phone: patient ? pickPatientPhone(patient) : "",
      whatsappOptOut: Boolean(patient?.whatsappOptOut),
      balance,
      unbilled,
      totalOwed,
      lastActivity: tally?.lastActivity ? tally.lastActivity.toISOString() : "",
      ageDays: daysSince(tally?.lastActivity ?? null, now),
      unbilledItems: unbilledItems.sort((a, b) => b.cost - a.cost),
    });
  }

  // Biggest first: this is a work queue, and whoever is making calls starts at the top.
  rows.sort((a, b) => b.totalOwed - a.totalOwed);

  const totals = rows.reduce(
    (acc, row) => {
      acc.balance += row.balance;
      acc.unbilled += row.unbilled;
      acc.totalOwed += row.totalOwed;
      return acc;
    },
    { patients: rows.length, balance: 0, unbilled: 0, totalOwed: 0 }
  );

  const truncated = ledger.length >= SCAN_LIMIT || notes.length >= SCAN_LIMIT || patients.length >= SCAN_LIMIT;
  const notesOut: string[] = [];
  if (truncated) {
    notesOut.push(
      `Only the first ${SCAN_LIMIT} records of each type were read, so these totals are a floor rather than the full picture.`
    );
  }
  const missingPhones = rows.filter((r) => !r.phone).length;
  if (missingPhones > 0) {
    notesOut.push(`${missingPhones} of these patients have no phone number on file and cannot be contacted from here.`);
  }
  if (misallocations.length > 0) {
    notesOut.push(
      `${misallocations.length} treatment(s) have payments recorded against them that do not fit — ` +
        `${Math.round(misallocatedTotal).toLocaleString()} EGP in total. Those patients' balances are wrong by that much, ` +
        `in the patient's favour, so they do not appear on the list above.`
    );
  }

  return {
    scannedAt: new Date(now).toISOString(),
    clinicId,
    rows,
    totals,
    misallocations,
    misallocatedTotal: Number(misallocatedTotal.toFixed(2)),
    truncated,
    notes: notesOut,
  };
}

async function readCollection(clinicId: string, path: string): Promise<Record<string, unknown>[]> {
  const snap = await adminClinicCollection(clinicId, path).limit(SCAN_LIMIT).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Load a clinic's records and build the debtors list. */
export async function loadRecoveryList(clinicId: string): Promise<RecoveryList> {
  const [ledger, notes, patients] = await Promise.all([
    readCollection(clinicId, "ledger"),
    readCollection(clinicId, "clinical_notes"),
    readCollection(clinicId, "patients"),
  ]);

  return buildRecoveryList(clinicId, ledger, notes, patients);
}
