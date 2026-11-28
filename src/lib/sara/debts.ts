import { insurerOutstanding } from "@/lib/ledgerInsurer";
import { ledgerCashValue } from "@/lib/reportHelpers";
import { receivables, type AgingTotal, type ReceivableLine } from "@/lib/reports/receivables";
import type { PdfSection } from "./reportDigest";

/**
 * "Who owes us" in the forms people actually ask it.
 *
 * The balance is the Outstanding Balances report's (`receivables`): what the patient was charged
 * minus what the patient paid, over the whole ledger, with an insurer's unpaid part left on the
 * insurer. This file only chooses which of those lines answer the question: everyone, the
 * biggest, the old ones, today's patients, one patient, people in credit, or people whose
 * treatment is finished.
 */

export type DebtFilter = "all" | "top" | "older" | "today" | "patient" | "credit" | "finished";
export const DEBT_FILTERS: DebtFilter[] = ["all", "top", "older", "today", "patient", "credit", "finished"];

type Row = Record<string, unknown>;
type PatientLite = { id: string; name?: string; phone?: string; whatsappOptOut?: unknown };

export type DebtLine = { patientId: string; name: string; phone: string; amount: number; since: string; days: number };

export type Debts = {
  filter: DebtFilter;
  /** Sum of the lines that answer this question. */
  total: number;
  count: number;
  lines: DebtLine[];
  /** The whole clinic, whatever the filter: so "top ten" can still say what the ten are out of. */
  clinic: { owed: number; patients: number; credit: number; creditPatients: number };
  aging: AgingTotal[];
  note: string;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number) => Number(n.toFixed(2));

const toLine = (l: ReceivableLine): DebtLine => ({ patientId: l.patientId, name: l.patientName || "Unnamed patient", phone: l.phone, amount: l.balance, since: l.oldestUnpaid, days: l.ageDays });

/** People the clinic holds money for: paid more than they were charged. Same sums as `receivables`. */
export function creditLines(ledger: readonly Row[], patients: readonly PatientLite[]): DebtLine[] {
  const files = new Map(patients.map((p) => [p.id, p]));
  const acc = new Map<string, { name: string; charged: number; paid: number; last: string }>();
  for (const row of ledger) {
    const type = String(row.type || "");
    if (type !== "procedure" && type !== "payment") continue;
    const pid = String(row.patientId || "").trim();
    if (!pid) continue;
    const a = acc.get(pid) || { name: String(row.patientName || "").trim(), charged: 0, paid: 0, last: "" };
    const date = String(row.normDate || row.date || "").slice(0, 10);
    if (date > a.last) a.last = date;
    if (type === "procedure") a.charged += (num(row.cost) || num(row.amount)) - insurerOutstanding(row);
    else a.paid += ledgerCashValue(row);
    acc.set(pid, a);
  }
  const lines: DebtLine[] = [];
  for (const [patientId, a] of acc) {
    const credit = round(a.paid - a.charged);
    if (credit <= 0.005) continue;
    const file = files.get(patientId);
    lines.push({ patientId, name: String(file?.name || a.name || "").trim() || "Unnamed patient", phone: String(file?.phone || "").trim(), amount: credit, since: a.last, days: 0 });
  }
  return lines.sort((x, y) => y.amount - x.amount);
}

export function buildDebts(args: {
  ledger: readonly Row[];
  patients: readonly PatientLite[];
  today: string;
  filter: DebtFilter;
  /** `older`: owed for at least this many days. */
  days?: number;
  /** `top`: how many. */
  limit?: number;
  patientId?: string;
  /** `today`: patients with an appointment today. */
  todayPatientIds?: ReadonlySet<string>;
  /** `finished`: patients who still have planned or ongoing treatment (they are left out). */
  openTreatmentPatientIds?: ReadonlySet<string>;
}): Debts {
  const r = receivables(args.ledger, args.patients, args.today);
  const all = r.lines.map(toLine);
  const clinic = { owed: r.totals.balance, patients: r.totals.patients, credit: r.totals.credits, creditPatients: r.totals.creditPatients };

  let lines = all;
  let note = "Balance = what the patient was charged minus what the patient paid, over the whole history. An insurer's unpaid part is not counted against the patient.";

  switch (args.filter) {
    case "top": {
      const n = Math.max(1, Math.min(50, Math.floor(args.limit || 10)));
      lines = all.slice(0, n);
      break;
    }
    case "older": {
      const days = Math.max(1, Math.floor(args.days || 90));
      lines = all.filter((l) => l.days >= days);
      note += ` Listed: owed for ${days} days or more, counted from the oldest treatment the payments did not cover.`;
      break;
    }
    case "today": {
      const ids = args.todayPatientIds || new Set<string>();
      lines = all.filter((l) => ids.has(l.patientId));
      note += " Listed: patients with an appointment today.";
      break;
    }
    case "patient": {
      lines = all.filter((l) => l.patientId === args.patientId);
      if (lines.length === 0) {
        const credit = creditLines(args.ledger, args.patients).find((l) => l.patientId === args.patientId);
        note = credit
          ? `This patient owes nothing. The clinic holds ${Math.round(credit.amount).toLocaleString("en-US")} EGP for them (paid in advance).`
          : "This patient owes nothing.";
      }
      break;
    }
    case "credit": {
      lines = creditLines(args.ledger, args.patients);
      note = "People who paid more than they were charged so far. The amount is what the clinic holds for them.";
      break;
    }
    case "finished": {
      const open = args.openTreatmentPatientIds || new Set<string>();
      lines = all.filter((l) => !open.has(l.patientId));
      note += " Listed: patients who owe money and have no planned or ongoing treatment on file.";
      break;
    }
    case "all":
    default:
      break;
  }

  return { filter: args.filter, total: round(lines.reduce((s, l) => s + l.amount, 0)), count: lines.length, lines, clinic, aging: r.aging, note };
}

/** What the model sees: the sums, and the first few names. */
export function debtsDigest(d: Debts, maxLines = 12) {
  return {
    filter: d.filter,
    currency: "EGP",
    total: d.total,
    patients: d.count,
    lines: d.lines.slice(0, maxLines).map((l) => ({ name: l.name, phone: l.phone, amount: l.amount, ...(d.filter === "credit" ? {} : { owedSince: l.since, days: l.days }) })),
    shown: Math.min(maxLines, d.lines.length),
    moreInPdf: d.lines.length > maxLines,
    wholeClinic: d.clinic,
    ...(d.filter === "all" || d.filter === "older" ? { byAge: d.aging } : {}),
    notes: [d.note],
  };
}

const money = (n: number) => Math.round(n).toLocaleString("en-US");

export function debtsPdfSections(d: Debts, isAr: boolean, maxRows = 400): PdfSection[] {
  const t = (en: string, ar: string) => (isAr ? ar : en);
  const credit = d.filter === "credit";
  const sections: PdfSection[] = [
    {
      heading: t("Summary", "الملخص"),
      columns: ["", ""],
      rows: [
        [credit ? t("Held for patients", "رصيد للمرضى") : t("Owed in this list", "المستحق في القائمة"), money(d.total)],
        [t("Patients in this list", "عدد المرضى"), String(d.count)],
        [t("Owed to the clinic, all patients", "إجمالي المستحق للعيادة"), money(d.clinic.owed)],
        [t("Patients who owe", "عدد المدينين"), String(d.clinic.patients)],
      ],
    },
  ];
  if (d.lines.length > 0) {
    const cut = d.lines.length > maxRows ? t(`${d.lines.length - maxRows} more rows not printed.`, `${d.lines.length - maxRows} سطر لم يُطبع.`) : "";
    sections.push({
      heading: credit ? t("Paid in advance", "دافعين مقدم") : t("Who owes", "المستحقات"),
      columns: credit
        ? [t("Patient", "المريض"), t("Phone", "الهاتف"), t("EGP", "ج.م")]
        : [t("Patient", "المريض"), t("Phone", "الهاتف"), t("Since", "من"), t("Days", "أيام"), t("EGP", "ج.م")],
      rows: d.lines.slice(0, maxRows).map((l) => (credit ? [l.name, l.phone, money(l.amount)] : [l.name, l.phone, l.since, String(l.days), money(l.amount)])),
      note: [d.note, cut].filter(Boolean).join(" "),
    });
  } else {
    sections.push({ note: d.note });
  }
  return sections;
}
