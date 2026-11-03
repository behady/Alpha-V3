/**
 * What the clinic owes each lab.
 *
 * This is a DEBT LIST, not a second profit report, and the distinction is the whole design.
 *
 * A lab fee on a treatment is booked as a cost the moment the treatment is saved:
 * `computeProcedurePricing` subtracts it before the dentist's commission. But many orders are
 * raised straight from the Lab page with no treatment behind them, and their cost reached Finance
 * nowhere — the owner paid a lab and Finance never showed it.
 *
 * So since November 2026 a payment also lands in Finance as a Lab expense, MINUS whatever the
 * linked treatments already booked (`labPaymentExpenseAmount`). Without that subtraction every
 * treatment-linked case would be charged against profit twice, invisibly. Lab payments still live
 * in their own collection; the expense row is written through the money API and its id kept on
 * the payment. `set-lab-fee` on the ledger route still corrects a booked ESTIMATE.
 *
 * Firebase-free on purpose, like `labCases.ts` — the arithmetic behind "you owe them 4,200" has to
 * be checkable without a database.
 */

import { statusFor, type LabCase } from "@/lib/labCases";

/** Subcollection under clinics/{clinicId}. Writes are gated on the finance permissions. */
export const LAB_PAYMENTS_COLLECTION = "lab_payments";

export type LabPayment = {
  id: string;
  labId: string;
  /** Denormalised so a renamed lab does not rewrite the history of what was paid to it. */
  labName: string;
  amount: number;
  /** yyyy-mm-dd, on the clinic's own clock. */
  date: string;
  method: string;
  reference?: string;
  note?: string;
  createdAt?: string;
  createdBy?: string;
  /**
   * The cases this payment settles, snapshotted so the payment still says who it was for after a
   * case is edited or deleted. Optional: a lump sum against the whole account names none.
   */
  cases?: LabPaymentCase[];
  /** The Lab expense this payment put in Finance, so editing or deleting it keeps the two in step. */
  expenseLedgerId?: string;
  /** How much of the payment went to Finance as an expense (less than the payment when part was already booked). */
  expenseAmount?: number;
};

/**
 * How much of a lab payment is a NEW expense in Finance.
 *
 * A case raised from a treatment already booked its lab fee there when the treatment was saved,
 * and Finance subtracts it as "Lab fees". Paying for that case must not subtract it a second time,
 * so whatever those treatments booked comes off the payment first. Everything else — standalone
 * orders, lump sums, the part of a payment above the booked estimate — is a real cost Finance
 * has not seen yet.
 */
export function labPaymentExpenseAmount(amount: number, bookedLabFees: number[]): number {
  const booked = bookedLabFees.reduce((s, n) => s + (Number(n) > 0 ? Number(n) : 0), 0);
  return money(Math.max(0, (Number(amount) || 0) - booked));
}

export type LabPaymentCase = {
  id: string;
  code: string;
  /** Full name, for the clinic's own screens. */
  patient: string;
  /** First name only, for anything that goes to the lab. */
  patientFirst?: string;
};

/** Reads the `cases` snapshot off a stored payment, dropping anything malformed. */
export function parseLabPaymentCases(raw: unknown): LabPaymentCase[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const r = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      const id = String(r.id || "").trim();
      if (!id) return null;
      const patientFirst = String(r.patientFirst || "").trim();
      return {
        id,
        code: String(r.code || "").trim(),
        patient: String(r.patient || "").trim(),
        ...(patientFirst ? { patientFirst } : {}),
      };
    })
    .filter(Boolean) as LabPaymentCase[];
}

/** Ids of every case some payment names — how the board marks a case as paid for. */
export function paidCaseIds(payments: LabPayment[]): Set<string> {
  const out = new Set<string>();
  for (const p of payments) for (const c of p.cases || []) out.add(c.id);
  return out;
}

export function labPaymentMethodLabel(id: string, language: "en" | "ar"): string {
  const m = LAB_PAYMENT_METHODS.find((x) => x.id === id);
  return m ? (language === "ar" ? m.ar : m.en) : id;
}

export const LAB_PAYMENT_METHODS = [
  { id: "cash", en: "Cash", ar: "كاش" },
  { id: "transfer", en: "Bank transfer", ar: "تحويل بنكي" },
  { id: "instapay", en: "InstaPay", ar: "إنستاباي" },
  { id: "cheque", en: "Cheque", ar: "شيك" },
  { id: "other", en: "Other", ar: "أخرى" },
];

function money(n: number): number {
  return Number((Number(n) || 0).toFixed(2));
}

/**
 * When does a case become money you owe?
 *
 * On delivery, not on dispatch. A crown sitting at the lab has been ordered but not received, and
 * a clinic that counted it as owed would show a debt for work it might yet cancel or have remade.
 * Once it is back in the building, you have the thing and you owe for it — whether it has been
 * fitted yet is between you and the patient, not you and the lab.
 *
 * A cancelled case is owed nothing. A draft never left.
 */
export function isBillable(labCase: Pick<LabCase, "status">): boolean {
  return labCase.status === "back" || labCase.status === "fitted";
}

/** Out at the lab: committed, chargeable soon, but not yet a debt. */
export function isCommitted(labCase: Pick<LabCase, "status">): boolean {
  return statusFor(labCase.status).atLab || labCase.status === "tryin_back";
}

export type LabAccount = {
  labId: string;
  labName: string;
  /** Cases delivered and therefore owed for. */
  delivered: number;
  deliveredCount: number;
  /** Cases still out at the lab — coming, but not owed yet. */
  committed: number;
  committedCount: number;
  paid: number;
  /** delivered − paid. Negative means the clinic has paid ahead. */
  outstanding: number;
  /** Cases the lab remade at its own cost, for the conversation about quality. */
  remakesAtLabCost: number;
  remakesTotal: number;
};

/**
 * One lab's account, from its cases and its payments.
 *
 * Both lists are filtered here rather than by the caller, so a screen cannot accidentally total
 * one lab's cases against another lab's payments.
 */
export function labAccountFor(
  labId: string,
  labName: string,
  cases: LabCase[],
  payments: LabPayment[]
): LabAccount {
  let delivered = 0;
  let deliveredCount = 0;
  let committed = 0;
  let committedCount = 0;
  let remakesAtLabCost = 0;
  let remakesTotal = 0;

  for (const c of cases) {
    if (c.labId !== labId) continue;
    if (c.remakeOfId) {
      remakesTotal += 1;
      if (c.remakeFault === "lab") remakesAtLabCost += 1;
    }
    if (isBillable(c)) {
      delivered += Number(c.agreedPrice) || 0;
      deliveredCount += 1;
    } else if (isCommitted(c)) {
      committed += Number(c.agreedPrice) || 0;
      committedCount += 1;
    }
  }

  const paid = payments.reduce((sum, p) => (p.labId === labId ? sum + (Number(p.amount) || 0) : sum), 0);

  return {
    labId,
    labName,
    delivered: money(delivered),
    deliveredCount,
    committed: money(committed),
    committedCount,
    paid: money(paid),
    outstanding: money(delivered - paid),
    remakesAtLabCost,
    remakesTotal,
  };
}

/** Every lab's account, in the order the labs are configured. */
export function labAccounts(
  labs: Array<{ id: string; name: string }>,
  cases: LabCase[],
  payments: LabPayment[]
): LabAccount[] {
  return labs.map((l) => labAccountFor(l.id, l.name, cases, payments));
}

/**
 * The totals across every lab.
 *
 * `unpriced` is the number worth surfacing: cases delivered with no agreed price on them are the
 * reason a balance and a lab's own invoice disagree, and without a count of them the difference
 * looks like a bug in the arithmetic rather than a gap in what was recorded.
 */
export function labAccountsTotal(accounts: LabAccount[], cases: LabCase[]) {
  const unpriced = cases.filter((c) => isBillable(c) && !(Number(c.agreedPrice) > 0)).length;
  return {
    delivered: money(accounts.reduce((s, a) => s + a.delivered, 0)),
    committed: money(accounts.reduce((s, a) => s + a.committed, 0)),
    paid: money(accounts.reduce((s, a) => s + a.paid, 0)),
    outstanding: money(accounts.reduce((s, a) => s + a.outstanding, 0)),
    unpriced,
  };
}

/**
 * Cases whose agreed price differs from the lab fee booked against the treatment.
 *
 * The clinic's price list holds an ESTIMATE, and that estimate is what came off the dentist's
 * commission when the treatment was saved. Where the lab actually charged something else, the
 * books are quietly wrong until somebody corrects them — this is the list of those.
 *
 * Only cases that came from a treatment can drift: a standalone repair has no ledger row to
 * disagree with.
 */
export type LabFeeDrift = {
  labCase: LabCase;
  bookedLabFee: number;
  agreedPrice: number;
  difference: number;
};

export function labFeeDrifts(
  cases: LabCase[],
  bookedFeeFor: (ledgerId: string) => number | null
): LabFeeDrift[] {
  const out: LabFeeDrift[] = [];
  for (const c of cases) {
    if (!c.ledgerId) continue;
    const agreed = Number(c.agreedPrice) || 0;
    if (agreed <= 0) continue;
    const booked = bookedFeeFor(c.ledgerId);
    if (booked === null) continue;
    const difference = money(agreed - booked);
    // A round-off of a piastre is not a correction worth offering anybody.
    if (Math.abs(difference) < 1) continue;
    out.push({ labCase: c, bookedLabFee: money(booked), agreedPrice: money(agreed), difference });
  }
  return out;
}

/** One lab's statement lines: what it delivered, and what has been paid against it. */
export type StatementLine = {
  date: string;
  code: string;
  patient: string;
  work: string;
  charge: number;
  payment: number;
};

/**
 * The statement, oldest first, with a running balance the clinic can settle against.
 *
 * Deliveries and payments are interleaved by date because that is how a lab reads its own book —
 * "you took these six crowns and paid me twice in between" — rather than two separate columns
 * neither side can reconcile.
 */
export function buildStatement(
  labId: string,
  cases: LabCase[],
  payments: LabPayment[],
  workLabel: (c: LabCase) => string,
  paymentLabel: (p: LabPayment) => string = (p) => [p.method, p.reference, p.note].filter(Boolean).join(" · ")
): { lines: Array<StatementLine & { balance: number }>; closing: number } {
  const rows: StatementLine[] = [];

  for (const c of cases) {
    if (c.labId !== labId || !isBillable(c)) continue;
    rows.push({
      date: c.receivedAt || c.fittedAt || c.sentAt || "",
      code: c.code,
      patient: c.patientFirstName || c.patientName || "",
      work: workLabel(c),
      charge: Number(c.agreedPrice) || 0,
      payment: 0,
    });
  }

  for (const p of payments) {
    if (p.labId !== labId) continue;
    const named = p.cases || [];
    rows.push({
      date: p.date,
      code: named.map((c) => c.code).filter(Boolean).join(", "),
      // First names only: this sheet goes to the lab.
      patient: [...new Set(named.map((c) => c.patientFirst || c.patient).filter(Boolean))].join(", "),
      work: paymentLabel(p),
      charge: 0,
      payment: Number(p.amount) || 0,
    });
  }

  // On the same day the work comes before the money paid for it. Otherwise a payment handed over
  // with the delivery prints first and the running balance dips below zero for one line.
  rows.sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      Number(a.payment > 0) - Number(b.payment > 0) ||
      a.code.localeCompare(b.code)
  );

  let balance = 0;
  const lines = rows.map((r) => {
    balance = money(balance + r.charge - r.payment);
    return { ...r, balance };
  });

  return { lines, closing: balance };
}
