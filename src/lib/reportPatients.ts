/**
 * The people behind a report figure.
 *
 * Every grouped report — by source, by service, by dentist, by payer — ends in a number, and the
 * first thing an owner asks of a number is "who?". Twelve patients from Instagram this month:
 * which twelve? Four crowns: on whom, and have they paid? The reports could not say. The Source
 * tab listed the ten biggest payers and nobody else; the rest listed nobody.
 *
 * This module turns the ledger rows already on the page into one line per patient, so any report
 * can open a drawer under any figure and show the names it is made of. It is pure — no database,
 * no React — so the arithmetic is testable and identical across tabs.
 *
 * Two rules worth stating:
 *
 *  - **A patient is counted once**, however many rows they have. The rows are folded by patient
 *    id; a patient who had three fillings and paid twice is one line with three treatments and
 *    the sum of both payments.
 *  - **Money comes off payment rows only.** A procedure row's `paid` mirrors the payments made
 *    against it, so counting both would double every settled case. Charged, on the other hand,
 *    comes off procedure rows only — it is the price of the work, whether or not it was paid.
 */

import { ledgerCashValue } from "@/lib/reportHelpers";
import { serviceLabel } from "@/lib/caseSheet";

export type ReportLedgerRow = Record<string, unknown>;

export type ReportPatient = { id: string; name?: string; phone?: string };

export type PatientRollup = {
  /** Empty when the rows never named a patient id — the line then cannot link anywhere. */
  patientId: string;
  name: string;
  phone: string;
  /** Distinct days with a row, within the period on screen. */
  visits: number;
  firstDate: string;
  lastDate: string;
  /** Procedure rows. Payments do not count as treatment. */
  procedures: number;
  /** Distinct treatment names, in the order they were first seen. */
  services: string[];
  /** Distinct dentists, "Dr." prefix removed, in the order first seen. */
  doctors: string[];
  /** Price of the treatments, off procedure rows. */
  charged: number;
  /** Cash received, off payment and income rows. */
  paid: number;
};

function text(raw: unknown): string {
  const v = String(raw ?? "").trim();
  return v === "undefined" || v === "null" ? "" : v;
}

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** YYYY-MM-DD off a row, preferring the normalised date the reports page stamps. */
export function rowDate(row: ReportLedgerRow): string {
  const raw = text(row.normDate) || text(row.date);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

/**
 * Who did the work, as the Dentist tab names them.
 *
 * Same normalisation as DentistReport's grouping — the honorific is stripped so "Dr. Omar" and
 * "Omar" are one dentist — and the same fallback, so a drawer opened under a dentist's card lists
 * exactly the rows that card was counting.
 */
export function doctorLabel(row: ReportLedgerRow, fallback = "Unassigned"): string {
  return text(row.doctor || row.doctorName).replace(/^Dr\.?\s*/i, "").trim() || fallback;
}

/** How to reach a patient's file: `patients` is whatever shape the page already holds. */
type PatientLookup = ReadonlyMap<string, ReportPatient> | Readonly<Record<string, ReportPatient>>;

function lookup(patients: PatientLookup | undefined, id: string): ReportPatient | undefined {
  if (!patients || !id) return undefined;
  return patients instanceof Map ? patients.get(id) : (patients as Record<string, ReportPatient>)[id];
}

export interface RollupOptions {
  /** How to name a treatment. Defaults to the case sheet's label, which reads the same fields. */
  serviceOf?: (row: ReportLedgerRow) => string;
  /** What to call a patient nobody named. */
  unknownName?: string;
}

/**
 * One line per patient across the given rows.
 *
 * Rows without a patient id are folded by name instead, so a walk-in typed straight into the
 * ledger still appears — without a link, because there is no file to link to. Sorted by money,
 * then by how much was done, then by name: the people the figure is mostly made of come first.
 */
export function rollupPatients(
  procedures: readonly ReportLedgerRow[],
  payments: readonly ReportLedgerRow[],
  patients?: PatientLookup,
  options: RollupOptions = {},
): PatientRollup[] {
  const serviceOf = options.serviceOf || ((row: ReportLedgerRow) => serviceLabel(row));
  const unknownName = options.unknownName || "Unknown";

  type Acc = PatientRollup & { days: Set<string>; serviceSet: Set<string>; doctorSet: Set<string> };
  const acc = new Map<string, Acc>();

  const bucket = (row: ReportLedgerRow): Acc => {
    const patientId = text(row.patientId);
    const rowName = text(row.patientName);
    const key = patientId || `name:${rowName.toLowerCase()}`;
    let line = acc.get(key);
    if (!line) {
      const file = lookup(patients, patientId);
      line = {
        patientId,
        name: text(file?.name) || rowName || unknownName,
        phone: text(file?.phone) || text(row.patientPhone),
        visits: 0,
        firstDate: "",
        lastDate: "",
        procedures: 0,
        services: [],
        doctors: [],
        charged: 0,
        paid: 0,
        days: new Set(),
        serviceSet: new Set(),
        doctorSet: new Set(),
      };
      acc.set(key, line);
    } else {
      // A later row may carry the name or phone an earlier one lacked.
      if (line.name === unknownName && rowName) line.name = rowName;
      if (!line.phone) line.phone = text(row.patientPhone);
    }
    const day = rowDate(row);
    if (day) line.days.add(day);
    const doctor = text(row.doctor || row.doctorName);
    if (doctor) {
      const label = doctorLabel(row);
      if (!line.doctorSet.has(label)) {
        line.doctorSet.add(label);
        line.doctors.push(label);
      }
    }
    return line;
  };

  for (const row of procedures) {
    if (text(row.type) && text(row.type) !== "procedure") continue;
    const line = bucket(row);
    line.procedures += 1;
    line.charged += num(row.cost) || num(row.amount);
    const service = text(serviceOf(row));
    if (service && service !== "—" && !line.serviceSet.has(service)) {
      line.serviceSet.add(service);
      line.services.push(service);
    }
  }

  for (const row of payments) {
    const type = text(row.type);
    if (type === "expense") continue;
    const line = bucket(row);
    line.paid += ledgerCashValue(row);
  }

  return Array.from(acc.values())
    .map((line): PatientRollup => {
      const sorted = Array.from(line.days).sort();
      return {
        patientId: line.patientId,
        name: line.name,
        phone: line.phone,
        visits: sorted.length,
        firstDate: sorted[0] || "",
        lastDate: sorted[sorted.length - 1] || "",
        procedures: line.procedures,
        services: line.services,
        doctors: line.doctors,
        charged: Number(line.charged.toFixed(2)),
        paid: Number(line.paid.toFixed(2)),
      };
    })
    .sort(
      (a, b) =>
        b.paid - a.paid ||
        b.procedures - a.procedures ||
        b.charged - a.charged ||
        a.name.localeCompare(b.name),
    );
}

/**
 * The rows behind each group, so a report can open a drawer per row of its own table.
 *
 * `keyOf` is the report's own grouping — the service key, the dentist name, the channel — applied
 * to procedures and payments alike, which is what keeps the drawer's people in step with the
 * figure above it. A row the grouping cannot place (`keyOf` returns "") is dropped.
 */
export function partitionRows(
  procedures: readonly ReportLedgerRow[],
  payments: readonly ReportLedgerRow[],
  keyOf: (row: ReportLedgerRow) => string,
): Map<string, { procedures: ReportLedgerRow[]; payments: ReportLedgerRow[] }> {
  const out = new Map<string, { procedures: ReportLedgerRow[]; payments: ReportLedgerRow[] }>();
  const ensure = (key: string) => {
    let group = out.get(key);
    if (!group) {
      group = { procedures: [], payments: [] };
      out.set(key, group);
    }
    return group;
  };
  for (const row of procedures) {
    const key = keyOf(row);
    if (key) ensure(key).procedures.push(row);
  }
  for (const row of payments) {
    if (text(row.type) === "expense") continue;
    const key = keyOf(row);
    if (key) ensure(key).payments.push(row);
  }
  return out;
}

/** The two figures a drawer's heading states. */
export function summarize(rows: readonly PatientRollup[]): { patients: number; visits: number; paid: number } {
  return rows.reduce(
    (sum, r) => ({ patients: sum.patients + 1, visits: sum.visits + r.visits, paid: sum.paid + r.paid }),
    { patients: 0, visits: 0, paid: 0 },
  );
}

/** Case-insensitive match on name or phone, for the search box over a long drawer. */
export function matchesPatient(row: PatientRollup, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || row.phone.replace(/\s+/g, "").includes(q.replace(/\s+/g, ""));
}
