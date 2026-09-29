/**
 * Every case as one line: who paid, for whom, what was done, and what the dentist earned on it.
 *
 * The other reports answer questions by grouping — by payer, by dentist, by service. This one
 * refuses to group at all, because the clinic asked for the thing it was keeping on paper: a
 * ledger sheet you can run your finger down, one row per treatment, and filter until only the
 * rows you are arguing about remain.
 *
 * That makes it the report people will actually check the others against, so every figure here is
 * read off the stored rows rather than recomputed:
 *
 *  - **Price** is what the treatment was charged at, after any discount.
 *  - **Paid** is money actually received against THAT treatment, summed from its own payments —
 *    not the patient's balance, and not the visit's. A part-paid case shows part paid.
 *  - **The dentist's share** is the commission stamped on those payments when the money moved.
 *    A case with nothing paid shows nothing earned, which is the truth: this clinic pays on
 *    collection.
 *
 * Pure. No database, no React. The filtering and the paging live here too so the meaning of "how
 * many rows match" is settled in one place and can be tested without a browser.
 */

import { payerOf } from "@/lib/payers";

/** What this sheet needs off a ledger row. Everything else on the row is ignored. */
export type SheetLedgerRow = {
  id?: unknown;
  type?: unknown;
  procedureId?: unknown;
  payerId?: unknown;
  payerName?: unknown;
  patientId?: unknown;
  patientName?: unknown;
  doctorId?: unknown;
  doctorName?: unknown;
  serviceName?: unknown;
  procedures?: unknown;
  description?: unknown;
  cost?: unknown;
  amount?: unknown;
  paid?: unknown;
  labFee?: unknown;
  doctorCommissionAmount?: unknown;
  date?: unknown;
  normDate?: unknown;
};

export type CaseRow = {
  id: string;
  date: string;
  payerId: string;
  payerName: string;
  patientId: string;
  patientName: string;
  service: string;
  price: number;
  paid: number;
  doctorId: string;
  doctorName: string;
  /** What the dentist earned, from the commission stamped on this case's payments. */
  share: number;
  labFee: number;
};

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function money(v: number): number {
  return Number(v.toFixed(2));
}

function text(raw: unknown): string {
  return String(raw ?? "").trim();
}

/**
 * What to call the treatment.
 *
 * `serviceName` is set when the treatment was picked from the price list, which is most of them.
 * The `procedures` array holds what was actually typed, and carries the multi-treatment case
 * ("Filling + Polish") that a single service name would misrepresent. The description is the last
 * resort and is trimmed of the tooth and formula noise the ledger appends to it.
 */
export function serviceLabel(row: SheetLedgerRow): string {
  const named = text(row.serviceName);
  if (named) return named;
  const list = Array.isArray(row.procedures) ? row.procedures.map(text).filter(Boolean) : [];
  if (list.length > 0) return list.join(" + ");
  return text(row.description).split(" (T:")[0].split(" |")[0] || "—";
}

/**
 * One row per treatment, with its own payments folded in.
 *
 * Payments are indexed by `procedureId` first: a payment that names its treatment belongs to that
 * treatment and nothing else. Advance payments name no treatment and are deliberately absent from
 * this sheet — money on account is real, but it is not a case, and a row for it would have no
 * service, no dentist and no price to sit under.
 */
export function buildCaseSheet(
  procedures: readonly SheetLedgerRow[],
  payments: readonly SheetLedgerRow[],
): CaseRow[] {
  const paidByProcedure = new Map<string, { paid: number; share: number }>();
  for (const p of payments) {
    if (text(p.type) !== "payment") continue;
    const target = text(p.procedureId);
    if (!target) continue;
    const bucket = paidByProcedure.get(target) || { paid: 0, share: 0 };
    bucket.paid += num(p.paid) || num(p.amount);
    bucket.share += num(p.doctorCommissionAmount);
    paidByProcedure.set(target, bucket);
  }

  return procedures
    .filter((row) => text(row.type) === "procedure")
    .map((row) => {
      const id = text(row.id);
      const settled = paidByProcedure.get(id) || { paid: 0, share: 0 };
      const { payerId, payerName } = payerOf(row);
      return {
        id,
        date: text(row.normDate) || text(row.date),
        payerId,
        payerName,
        patientId: text(row.patientId),
        patientName: text(row.patientName) || "—",
        service: serviceLabel(row),
        price: money(num(row.cost) || num(row.amount)),
        paid: money(settled.paid),
        doctorId: text(row.doctorId),
        // A treatment the clinic did rather than a person. Named rather than left blank, because
        // an empty cell in a sheet reads as missing data instead of as a deliberate answer.
        doctorName: text(row.doctorName) || "General",
        share: money(settled.share),
        labFee: money(num(row.labFee)),
      };
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.patientName.localeCompare(b.patientName));
}

/* --- filtering ---------------------------------------------------------------------------- */

export type CaseFilters = {
  payerId: string;
  doctorId: string;
  service: string;
  /** Matches the patient's name, case-insensitively, anywhere in it. */
  patient: string;
  /** "paid" | "partly" | "unpaid" — settlement, which is the filter a clinic actually chases. */
  settled: string;
};

export const EMPTY_FILTERS: CaseFilters = {
  payerId: "",
  doctorId: "",
  service: "",
  patient: "",
  settled: "",
};

/**
 * Arabic and Latin both, folded to something comparable.
 *
 * A receptionist typing "ahmed" must find "Ahmed", and one typing "أحمد" must find "احمد" — the
 * hamza forms are the same name to everyone except a string comparison. See
 * [[arabic-keyword-matching-traps]]: matching without this silently finds nothing, which reads as
 * "we have no record of that patient".
 */
export function foldForSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "")
    .replace(/\s+/g, " ");
}

export function settlementOf(row: CaseRow): "paid" | "partly" | "unpaid" {
  if (row.paid <= 0) return "unpaid";
  // A rounding tail must not make a settled case look outstanding, so the comparison has a
  // one-piastre tolerance rather than being exact.
  if (row.paid + 0.01 >= row.price) return "paid";
  return "partly";
}

export function filterCases(rows: readonly CaseRow[], filters: CaseFilters): CaseRow[] {
  const patient = foldForSearch(filters.patient);
  return rows.filter((row) => {
    if (filters.payerId && row.payerId !== filters.payerId) return false;
    if (filters.doctorId && row.doctorId !== filters.doctorId) return false;
    if (filters.service && row.service !== filters.service) return false;
    if (patient && !foldForSearch(row.patientName).includes(patient)) return false;
    if (filters.settled && settlementOf(row) !== filters.settled) return false;
    return true;
  });
}

/** The totals under the sheet, which describe the FILTERED rows — never the whole period. */
export function sumCases(rows: readonly CaseRow[]) {
  return {
    cases: rows.length,
    price: money(rows.reduce((n, r) => n + r.price, 0)),
    paid: money(rows.reduce((n, r) => n + r.paid, 0)),
    share: money(rows.reduce((n, r) => n + r.share, 0)),
    outstanding: money(rows.reduce((n, r) => n + Math.max(0, r.price - r.paid), 0)),
  };
}

/* --- paging ------------------------------------------------------------------------------- */

export const PAGE_SIZES = [25, 50, 100, 250] as const;

export type Paged<T> = {
  rows: T[];
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
};

/**
 * One page of rows, with the page number corrected rather than trusted.
 *
 * Every filter change can shrink the list under the reader's feet, and a page number that survives
 * that shows an empty table on page 7 of 2 — which looks exactly like "no results" and sends
 * somebody hunting for a bug in the filter. Clamped here so the caller cannot get it wrong.
 */
export function pageOf<T>(rows: readonly T[], page: number, size: number): Paged<T> {
  const perPage = Math.max(1, Math.floor(size) || PAGE_SIZES[0]);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * perPage;
  return {
    rows: rows.slice(start, start + perPage),
    page: current,
    pages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + perPage, total),
  };
}

/** The distinct values a column offers, for its dropdown. Sorted, and only what is present. */
export function optionsFor(rows: readonly CaseRow[], key: "payer" | "doctor" | "service") {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (key === "payer") seen.set(row.payerId, row.payerName);
    else if (key === "doctor") seen.set(row.doctorId || "general", row.doctorName);
    else seen.set(row.service, row.service);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
