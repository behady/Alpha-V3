/**
 * What one person earned, read off the rows rather than worked out again.
 *
 * There are four surfaces in this app that answer "what did this dentist earn": Reports → Dentist
 * Performance, Reports → Insurance & Payers, the owner's dashboard, and the attendance screen. The
 * first three add up the `doctorCommissionAmount` STAMPED on each payment when the money moved. The
 * attendance screen is the odd one out: it re-resolves the lab fee and recalculates the percentage,
 * so for any older row whose lab fee sits on the treatment rather than on the payment it reports a
 * smaller number than the other three.
 *
 * A staff member's own profile is the worst possible place for that disagreement, because it is the
 * figure a person is paid against — so this module does what the reports do and sums what is
 * stored. A payment carries the rate that was in force when it was taken; that is the whole point of
 * stamping it, and recomputing it undoes the promise the reports make in writing: change a rate
 * today and last month still says what it said yesterday.
 */

export type CommissionRow = {
  id?: unknown;
  type?: unknown;
  date?: unknown;
  paid?: unknown;
  amount?: unknown;
  doctorId?: unknown;
  doctorName?: unknown;
  doctor?: unknown;
  doctorCommissionAmount?: unknown;
  doctorCommissionPercentage?: unknown;
  labFee?: unknown;
  description?: unknown;
  patientName?: unknown;
  serviceName?: unknown;
  procedureId?: unknown;
};

export type StaffLite = { id: string; uid?: string; name?: string };

export type CommissionEntry = {
  id: string;
  date: string;
  patientName: string;
  serviceName: string;
  paid: number;
  labFee: number;
  /** The rate stamped on the payment, or null when the row predates the stamp. */
  pct: number | null;
  amount: number;
};

export type StaffCommission = {
  total: number;
  /** Payments attributed to this person, INCLUDING the ones that earned nothing. */
  payments: number;
  entries: CommissionEntry[];
};

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function normalizeName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Which staff member a payment belongs to.
 *
 * `doctorId` where it exists, and otherwise the dentist's NAME matched against the roster — the
 * same fallback the attendance screen uses, kept because rows written before `doctorId` existed
 * carry only a name and dropping them would quietly shrink somebody's earnings. The fragile half is
 * worth knowing about: rename a dentist and their older name-only rows stop matching.
 */
export function staffIdForRow(staff: readonly StaffLite[], row: CommissionRow): string | null {
  const byId = String(row.doctorId ?? "").trim();
  if (byId) return byId;
  const name = normalizeName(row.doctorName || row.doctor);
  if (!name) return null;
  return staff.find((s) => normalizeName(s.name) === name)?.id ?? null;
}

/** The treatment a payment settled, from whatever the row carries. */
function serviceOf(row: CommissionRow): string {
  const named = String(row.serviceName ?? "").trim();
  if (named) return named;
  const desc = String(row.description ?? "").trim();
  if (!desc) return "—";
  // Ledger descriptions are built as "Payment for <name> (T: 11) | 1x500=500".
  return desc.replace(/^Payment for\s+/i, "").split(/\s*[(|]/)[0].trim() || "—";
}

/**
 * Commission per staff id, over whatever rows are handed in.
 *
 * Only `payment` rows count. A treatment row carries the commission it WOULD earn once collected,
 * and this clinic pays on collection — counting both would pay twice for the same work.
 */
export function commissionByStaff(
  rows: readonly CommissionRow[],
  staff: readonly StaffLite[],
): Map<string, StaffCommission> {
  const out = new Map<string, StaffCommission>();
  for (const row of rows) {
    if (String(row.type ?? "") !== "payment") continue;
    const id = staffIdForRow(staff, row);
    if (!id) continue;

    const bucket = out.get(id) || { total: 0, payments: 0, entries: [] };
    const amount = num(row.doctorCommissionAmount);
    const pctRaw = row.doctorCommissionPercentage;
    bucket.total += amount;
    bucket.payments += 1;
    bucket.entries.push({
      id: String(row.id ?? ""),
      date: String(row.date ?? "").slice(0, 10),
      patientName: String(row.patientName ?? "").trim() || "—",
      serviceName: serviceOf(row),
      paid: num(row.paid) || num(row.amount),
      labFee: num(row.labFee),
      pct: pctRaw == null || pctRaw === "" ? null : num(pctRaw),
      amount,
    });
    out.set(id, bucket);
  }

  for (const bucket of out.values()) {
    bucket.entries.sort((a, b) => b.date.localeCompare(a.date));
    bucket.total = Number(bucket.total.toFixed(2));
  }
  return out;
}

/** Empty, so a profile can render its commission section without a null check. */
export const NO_COMMISSION: StaffCommission = { total: 0, payments: 0, entries: [] };
