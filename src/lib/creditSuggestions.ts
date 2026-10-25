/**
 * A patient's money on account that a treatment could now take.
 *
 * A deposit paid before the dentist has recorded the work has nothing to settle, so the desk takes
 * it as a general payment (`procedureId: null`). When the treatment is added later, nothing joins
 * the two: the account adds up, but the treatment reads unpaid and the deposit sits beside it as
 * credit. DENT INN, 24 Oct 2026: a 1,500 implant deposit from the 21st was still on its own when
 * the implant was charged on the 24th.
 *
 * This lists, for each general payment, the treatments it would fit, so the patient's money screen
 * can offer "apply it to the implant?". Nothing is linked unless someone presses the button, and
 * the link itself goes through the ledger route, which re-checks it and moves the dentist and the
 * commission with it.
 *
 * A payment is offered only to a treatment with room for all of it: one payment row settles one
 * treatment, and the route refuses a link that would pay a treatment more than it costs. The
 * insurer's own payments are the insurer's, and a contract company's treatment is not the
 * patient's to pay (the route refuses both), so neither is offered.
 *
 * Pure: the screen passes the patient's ledger rows, the test passes fixtures.
 */

import { INSURER_PAYMENT_METHOD, isCompanyRow, patientPortion } from "@/lib/ledgerInsurer";

export type CreditRow = {
  id: string;
  type?: unknown;
  date?: unknown;
  description?: unknown;
  serviceName?: unknown;
  procedureId?: unknown;
  cost?: unknown;
  amount?: unknown;
  paid?: unknown;
  method?: unknown;
  status?: unknown;
  payerId?: unknown;
  claimId?: unknown;
  insurerCovered?: unknown;
  insurerPaidAt?: unknown;
  branchId?: unknown;
  createdAt?: unknown;
};

export type CreditTarget = { procedureId: string; name: string; date: string; remaining: number };

export type CreditSuggestion = {
  paymentId: string;
  amount: number;
  date: string;
  branchId: string;
  /** Treatments with room for the whole payment, the newest first: usually the one just added. */
  targets: CreditTarget[];
};

const EPSILON = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isLive = (row: CreditRow) => !["deleted", "cancelled"].includes(String(row.status || "").toLowerCase());
const paymentValue = (row: CreditRow) => num(row.paid) || num(row.amount);

function millis(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Date.parse(v) || 0;
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/** The treatment's name: the matched service, else the description before its "(T: …)" tail. */
function treatmentName(row: CreditRow): string {
  return text(row.serviceName) || text(row.description).split(/\s*\(T:|\s*\|/)[0].trim();
}

export function creditSuggestions(rows: readonly CreditRow[]): CreditSuggestion[] {
  const live = rows.filter(isLive);
  const payments = live.filter((r) => String(r.type || "") === "payment");

  const targets = live
    .filter((r) => String(r.type || "") === "procedure" && !isCompanyRow(r))
    .map((proc) => {
      const settled = payments.filter((p) => text(p.procedureId) === proc.id).reduce((t, p) => t + paymentValue(p), 0);
      const target: CreditTarget = {
        procedureId: proc.id,
        name: treatmentName(proc),
        date: text(proc.date).slice(0, 10),
        remaining: round2(patientPortion(proc) - settled),
      };
      return { target, order: millis(proc.createdAt) };
    })
    .filter(({ target }) => target.remaining > EPSILON)
    .sort((a, b) => (a.target.date !== b.target.date ? (a.target.date > b.target.date ? -1 : 1) : b.order - a.order))
    .map(({ target }) => target);

  return payments
    .filter((p) => !text(p.procedureId) && text(p.method) !== INSURER_PAYMENT_METHOD && paymentValue(p) > EPSILON)
    .map((p) => {
      const amount = round2(paymentValue(p));
      return {
        paymentId: p.id,
        amount,
        date: text(p.date).slice(0, 10),
        branchId: text(p.branchId),
        targets: targets.filter((t) => t.remaining >= amount - EPSILON),
      };
    })
    .filter((s) => s.targets.length > 0);
}
