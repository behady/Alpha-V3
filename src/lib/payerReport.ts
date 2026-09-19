/**
 * The books, split by who paid for the work.
 *
 * Three questions a clinic doing insurance work has to be able to answer, and could not:
 *
 *   1. How much work came from each insurer — cases, patients, and what it was worth.
 *   2. What each dentist earned on each payer's work, which is the payroll question, because the
 *      same dentist is paid a different percentage on an insurance case than on a private one.
 *   3. Whether the two agree with the clinic's own totals, which is the only reason anyone trusts
 *      either of them.
 *
 * Pure, and deliberately so. Every figure here is read straight off the rows the money routes
 * already wrote — the payer, the dentist, the commission percentage and the commission amount are
 * all stamped at the moment the money moved, so this function adds up history rather than
 * recomputing it. Change a rate in Settings tomorrow and last month's report says what it said
 * yesterday, which is the whole difference between a report and an estimate.
 *
 * Two deliberate choices about which number is "revenue":
 *
 *  - **Charged** is what the treatments came to — production. It is the number that answers "how
 *    much work did this insurer send us".
 *  - **Collected** is money actually received — cash basis, the same basis the evening digest and
 *    every other figure in this app use. It is the number the dentist's commission is calculated
 *    from, because that is how this clinic pays.
 *
 * Both are shown, never blended. On private work they are usually close; on insurance work the gap
 * between them IS the story, and a report that quietly picked one would hide it.
 */

import { PRIVATE_PAYER_ID, payerOf, isUnstamped, type Payer } from "@/lib/payers";

/** The fields this report needs off a ledger row. Anything else on the row is ignored. */
export type LedgerRowLite = {
  type?: unknown;
  payerId?: unknown;
  payerName?: unknown;
  patientId?: unknown;
  doctorId?: unknown;
  doctorName?: unknown;
  cost?: unknown;
  amount?: unknown;
  paid?: unknown;
  labFee?: unknown;
  doctorCommissionAmount?: unknown;
  doctorCommissionPercentage?: unknown;
};

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

export type DoctorSplit = {
  doctorId: string;
  doctorName: string;
  /** Treatments recorded for this payer by this dentist, in the period. */
  cases: number;
  charged: number;
  collected: number;
  commission: number;
  /**
   * The rate actually applied, or null when the period's payments used more than one.
   *
   * Null is information, not a gap: it means a rate changed mid-period, and a payroll sheet that
   * printed one number would be describing neither half accurately.
   */
  ratePct: number | null;
};

export type PayerTotals = {
  payerId: string;
  payerName: string;
  cases: number;
  patients: number;
  charged: number;
  collected: number;
  labFees: number;
  commission: number;
  /** Collected, less what the dentists earned and what the lab took. */
  clinicNet: number;
  doctors: DoctorSplit[];
};

export type PayerReport = {
  payers: PayerTotals[];
  totals: {
    cases: number;
    patients: number;
    charged: number;
    collected: number;
    labFees: number;
    commission: number;
    clinicNet: number;
  };
  /**
   * Rows recorded before the payer field existed, counted as Private.
   *
   * Surfaced rather than buried. A clinic that switched payers on last week is looking at a report
   * whose Private column is mostly history, and being told so is the difference between a number
   * they can act on and one they will quietly mistrust.
   */
  unstamped: { procedures: number; payments: number };
};

function blankTotals(payerId: string, payerName: string): PayerTotals & { patientIds: Set<string> } {
  return {
    payerId,
    payerName,
    cases: 0,
    patients: 0,
    charged: 0,
    collected: 0,
    labFees: 0,
    commission: 0,
    clinicNet: 0,
    doctors: [],
    patientIds: new Set<string>(),
  };
}

/**
 * Build the whole report from one period's rows.
 *
 * `payers` is only used to give a column its current name and to keep a payer with no activity
 * visible — an insurer that sent nothing this month is a fact worth seeing, and a report that
 * silently omits it reads as if it were never set up.
 */
export function buildPayerReport(
  procedures: readonly LedgerRowLite[],
  payments: readonly LedgerRowLite[],
  payers: readonly Payer[] = [],
): PayerReport {
  const byPayer = new Map<string, ReturnType<typeof blankTotals>>();
  const doctorKeys = new Map<string, Map<string, DoctorSplit & { rates: Set<number> }>>();

  const ensure = (payerId: string, payerName: string) => {
    let row = byPayer.get(payerId);
    if (!row) {
      row = blankTotals(payerId, payerName);
      byPayer.set(payerId, row);
      doctorKeys.set(payerId, new Map());
    }
    return row;
  };

  // Active payers first, so a clinic sees its whole list rather than only what happened to be busy.
  for (const p of payers) {
    if (p.active) ensure(p.id, p.name);
  }

  const ensureDoctor = (payerId: string, doctorId: string, doctorName: string) => {
    const map = doctorKeys.get(payerId)!;
    let row = map.get(doctorId);
    if (!row) {
      row = {
        doctorId,
        doctorName,
        cases: 0,
        charged: 0,
        collected: 0,
        commission: 0,
        ratePct: null,
        rates: new Set<number>(),
      };
      map.set(doctorId, row);
    }
    // A dentist renamed since the treatment keeps the name the row carries, but a row that never
    // had one takes the first name we do see rather than staying blank.
    if (!row.doctorName && doctorName) row.doctorName = doctorName;
    return row;
  };

  const unstamped = { procedures: 0, payments: 0 };

  for (const row of procedures) {
    const { payerId, payerName } = payerOf(row);
    if (isUnstamped(row)) unstamped.procedures++;
    const totals = ensure(payerId, payerName);
    totals.cases++;
    // `cost` is what the treatment was charged at, after any discount.
    totals.charged += num(row.cost) || num(row.amount);
    totals.labFees += num(row.labFee);
    const patientId = String(row.patientId ?? "").trim();
    if (patientId) totals.patientIds.add(patientId);

    const doctorId = String(row.doctorId ?? "").trim();
    if (doctorId) {
      const doctor = ensureDoctor(payerId, doctorId, String(row.doctorName ?? "").trim());
      doctor.cases++;
      doctor.charged += num(row.cost) || num(row.amount);
    }
  }

  for (const row of payments) {
    // Only money in. Expenses and clinic-level income belong to nobody's payer and nobody's
    // commission — counting them here would inflate an insurer's column with the electricity bill.
    if (String(row.type ?? "") !== "payment") continue;
    const { payerId, payerName } = payerOf(row);
    if (isUnstamped(row)) unstamped.payments++;
    const totals = ensure(payerId, payerName);
    const received = num(row.paid) || num(row.amount);
    totals.collected += received;
    totals.commission += num(row.doctorCommissionAmount);

    const doctorId = String(row.doctorId ?? "").trim();
    if (doctorId) {
      const doctor = ensureDoctor(payerId, doctorId, String(row.doctorName ?? "").trim());
      doctor.collected += received;
      doctor.commission += num(row.doctorCommissionAmount);
      const pct = num(row.doctorCommissionPercentage);
      // Only rates that actually paid something. A zero on an unattributed row would look like a
      // rate change that never happened.
      if (received > 0) doctor.rates.add(pct);
    }
  }

  const rows: PayerTotals[] = [...byPayer.values()].map((row) => {
    const doctors = [...(doctorKeys.get(row.payerId)?.values() ?? [])]
      .map(({ rates, ...doctor }) => ({
        ...doctor,
        charged: money(doctor.charged),
        collected: money(doctor.collected),
        commission: money(doctor.commission),
        ratePct: rates.size === 1 ? [...rates][0] : null,
      }))
      .sort((a, b) => b.collected - a.collected || a.doctorName.localeCompare(b.doctorName));

    return {
      payerId: row.payerId,
      payerName: row.payerName,
      cases: row.cases,
      patients: row.patientIds.size,
      charged: money(row.charged),
      collected: money(row.collected),
      labFees: money(row.labFees),
      commission: money(row.commission),
      clinicNet: money(row.collected - row.commission - row.labFees),
      doctors,
    };
  });

  // Private first — it is the clinic's own work and the column most people read — then the rest by
  // what they actually brought in.
  rows.sort((a, b) => {
    if (a.payerId === PRIVATE_PAYER_ID) return -1;
    if (b.payerId === PRIVATE_PAYER_ID) return 1;
    return b.collected - a.collected || a.payerName.localeCompare(b.payerName);
  });

  const allPatients = new Set<string>();
  for (const row of procedures) {
    const id = String(row.patientId ?? "").trim();
    if (id) allPatients.add(id);
  }

  return {
    payers: rows,
    totals: {
      cases: rows.reduce((n, r) => n + r.cases, 0),
      // Distinct across the whole period, not the sum of the columns: one patient treated under
      // both an insurer and privately is one patient, and adding the columns would count them twice.
      patients: allPatients.size,
      charged: money(rows.reduce((n, r) => n + r.charged, 0)),
      collected: money(rows.reduce((n, r) => n + r.collected, 0)),
      labFees: money(rows.reduce((n, r) => n + r.labFees, 0)),
      commission: money(rows.reduce((n, r) => n + r.commission, 0)),
      clinicNet: money(rows.reduce((n, r) => n + r.clinicNet, 0)),
    },
    unstamped,
  };
}

/**
 * The same figures turned inside out: one row per dentist, one column per payer.
 *
 * This is the payroll view. "What do I owe Dr Omar this month, and how much of it came from which
 * insurer" is a different question from "how did MetLife do", and a reader should not have to add
 * up four sections to answer it.
 */
export type DoctorPayrollRow = {
  doctorId: string;
  doctorName: string;
  byPayer: Record<string, { cases: number; collected: number; commission: number; ratePct: number | null }>;
  totalCases: number;
  totalCollected: number;
  totalCommission: number;
};

export function byDoctor(report: PayerReport): DoctorPayrollRow[] {
  const rows = new Map<string, DoctorPayrollRow>();
  for (const payer of report.payers) {
    for (const doctor of payer.doctors) {
      let row = rows.get(doctor.doctorId);
      if (!row) {
        row = {
          doctorId: doctor.doctorId,
          doctorName: doctor.doctorName,
          byPayer: {},
          totalCases: 0,
          totalCollected: 0,
          totalCommission: 0,
        };
        rows.set(doctor.doctorId, row);
      }
      row.byPayer[payer.payerId] = {
        cases: doctor.cases,
        collected: doctor.collected,
        commission: doctor.commission,
        ratePct: doctor.ratePct,
      };
      row.totalCases += doctor.cases;
      row.totalCollected = money(row.totalCollected + doctor.collected);
      row.totalCommission = money(row.totalCommission + doctor.commission);
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.totalCommission - a.totalCommission || a.doctorName.localeCompare(b.doctorName),
  );
}
