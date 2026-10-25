/**
 * The owner's nightly money sheet: one line per patient per day, split by branch, with what was
 * done, by whom, what the patient owed and paid, and the dentist's share of the work.
 *
 * The owner of a two-branch clinic asked for it on WhatsApp as an Excel file shaped like the sheet
 * the desk kept by hand. The money columns are the Finance page's "Daily sheet" exactly
 * (`dailySheet`), run once per branch, so the file and the screen can never disagree; this module
 * only adds what that sheet does not carry — the treatments, the dentists and their share.
 *
 * The dentist's share is the one stamped on each treatment when it was charged
 * (`doctorCommissionAmount`, at that dentist's rate for that payer) — the share of the work done
 * that day, not of the money that came in. A payment row carries its own copy of the commission;
 * reading both would count every paid treatment twice.
 *
 * Two things the day's rows cannot say on their own, so the sender passes more:
 *
 * - The patient's ACCOUNT balance at the end of the day. "Remaining" is the day's work less the
 *   day's money, and a deposit paid last week is not in the day. DENT INN, 24 Oct 2026: an implant
 *   of 20,000, 8,500 paid that day and 11,500 paid on the 21st — the sheet said 11,500 remaining,
 *   the patient's file said nothing owed, and the file was right. The balance is the profile's
 *   rule (every treatment's patient part, less every payment, up to the end of the day), so the
 *   report and the file agree on what a person owes.
 * - Payments recorded on the day for another day: entered late, or moved there by a date edit.
 *   They change a day whose report has already gone out, so they are listed where the owner will
 *   see them instead of quietly rewriting that day.
 *
 * Pure: the sender passes the ledger rows, the test passes fixtures.
 */

import { dailySheet, sheetDay, sheetMethodLabel, type SheetLedgerRow } from "@/lib/dailySheet";
import { INSURER_PAYMENT_METHOD, patientPortion } from "@/lib/ledgerInsurer";
import { findPayer, type Payer } from "@/lib/payers";
import { ledgerCashValue } from "@/lib/reportHelpers";

export type ReportLedgerRow = SheetLedgerRow & {
  branchId?: unknown;
  serviceName?: unknown;
  description?: unknown;
  doctorName?: unknown;
  doctor?: unknown;
  doctorCommissionAmount?: unknown;
  addedBy?: unknown;
  receivedBy?: unknown;
};

export type ReportLine = {
  n: number;
  date: string;
  /** "File" / "ملف" for the clinic's own patient, else the insurance companies' names. */
  source: string;
  patient: string;
  procedures: string;
  dentists: string;
  methods: string;
  /** Full price of the day's treatments, whoever pays. */
  work: number;
  /** The insurance or contract company's part. */
  company: number;
  /** The patient's part (المطلوب). */
  total: number;
  paid: number;
  remaining: number;
  dentistShare: number;
  /**
   * What the patient's account stands at once the day is done: positive is owed, negative is money
   * the clinic holds for them. Null when it was not looked up (a row with no patient file).
   */
  balance: number | null;
};

export type ReportTotals = {
  patients: number; work: number; company: number; total: number; paid: number; remaining: number; dentistShare: number;
  /** What the day's patients still owe on their accounts: the positive balances only. */
  owed: number;
};

/** A patient payment recorded on the report's day for a different day. */
export type LatePayment = {
  id: string;
  /** The day the payment is dated, now. */
  date: string;
  /** The day it was dated before a date edit made on the report's day; null when entered late. */
  movedFrom: string | null;
  patient: string;
  branch: string;
  method: string;
  amount: number;
  /** Who entered it, or who moved it. */
  by: string;
};

/** A date edit made on the report's day, from the ledger's audit trail. */
export type PaymentMove = { id: string; from: string; to: string; by: string };

export type ReportSection = {
  /** "" for rows recorded before the clinic had branches, or a clinic with none. */
  branchId: string;
  name: string;
  lines: ReportLine[];
  totals: ReportTotals;
};

export type DailyFinanceReport = {
  date: string;
  sections: ReportSection[];
  totals: ReportTotals;
  /** Whether account balances were looked up; the text and the file only show them if so. */
  hasBalances: boolean;
  late: LatePayment[];
  lateTotal: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The treatment's name: the matched service, else the description before its "(T: …)" tail. */
export function procedureName(row: ReportLedgerRow): string {
  const service = text(row.serviceName);
  if (service) return service;
  const description = text(row.description);
  return description.split(/\s*\(T:|\s*\|/)[0].trim();
}

const isLiveCharge = (row: ReportLedgerRow) =>
  String(row.type || "") === "procedure" && !["deleted", "cancelled"].includes(String(row.status || "").toLowerCase());

/** The same key `dailySheet` groups a patient's day by. */
const lineKey = (row: { date?: unknown; patientId?: unknown; patientName?: unknown }) => {
  const id = text(row.patientId);
  return `${text(row.date)}|${id || `name:${text(row.patientName)}`}`;
};

const addUnique = (list: string[], value: string) => {
  if (value && !list.includes(value)) list.push(value);
};

function buildSection(
  rows: readonly ReportLedgerRow[],
  payers: readonly Payer[],
  isAr: boolean,
  balances: ReadonlyMap<string, number> | null,
): { lines: ReportLine[]; totals: ReportTotals } {
  const extras = new Map<string, { procedures: string[]; dentists: string[]; share: number }>();
  for (const row of rows) {
    if (!isLiveCharge(row)) continue;
    const key = lineKey(row);
    const extra = extras.get(key) ?? { procedures: [], dentists: [], share: 0 };
    addUnique(extra.procedures, procedureName(row));
    addUnique(extra.dentists, text(row.doctorName) || text(row.doctor));
    extra.share += Math.max(0, num(row.doctorCommissionAmount));
    extras.set(key, extra);
  }

  const { lines } = dailySheet(rows);
  const out: ReportLine[] = lines.map((line) => {
    const extra = extras.get(lineKey(line));
    const names = line.payerIds.map((id, i) => {
      const payer = findPayer(payers, id);
      return (payer ? (isAr && payer.nameAr ? payer.nameAr : payer.name) : "") || line.payerNames[i] || id;
    });
    return {
      n: line.n,
      date: line.date,
      source: names.join(" + ") || (isAr ? "ملف" : "File"),
      patient: line.patientName,
      // A line with no treatment that day is a patient settling an earlier balance.
      procedures: extra?.procedures.join(" + ") || (isAr ? "سداد حساب" : "Balance payment"),
      dentists: extra?.dentists.join(" + ") || "—",
      methods: line.methods.map((m) => sheetMethodLabel(m, isAr)).join(" + ") || "—",
      work: line.work,
      company: line.company,
      total: line.total,
      paid: line.paid,
      remaining: line.remaining,
      dentistShare: round2(extra?.share ?? 0),
      balance: balances && line.patientId ? round2(balances.get(line.patientId) ?? 0) : null,
    };
  });
  return { lines: out, totals: totalsOf(out) };
}

function totalsOf(lines: readonly ReportLine[]): ReportTotals {
  const sum = (k: "work" | "company" | "total" | "paid" | "remaining" | "dentistShare") => round2(lines.reduce((t, l) => t + l[k], 0));
  return {
    patients: lines.length, work: sum("work"), company: sum("company"), total: sum("total"),
    paid: sum("paid"), remaining: sum("remaining"), dentistShare: sum("dentistShare"),
    owed: round2(lines.reduce((t, l) => t + Math.max(0, l.balance ?? 0), 0)),
  };
}

const isLive = (row: ReportLedgerRow) => !["deleted", "cancelled"].includes(String(row.status || "").toLowerCase());

/**
 * Each patient's account at the end of `date`, by patient id: the patient's part of every
 * treatment, less every payment, dated on or before that day. The rule the patient's file and the
 * receivables report use (`patientPortion`, `ledgerCashValue`), so the three never disagree.
 */
export function accountBalances(rows: readonly ReportLedgerRow[], date: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const patientId = text(row.patientId);
    if (!patientId || !isLive(row)) continue;
    const day = text(row.date).slice(0, 10);
    if (day && day > date) continue;
    const type = String(row.type || "");
    const delta = type === "procedure" ? patientPortion(row) : type === "payment" ? -ledgerCashValue(row) : 0;
    if (delta !== 0) out.set(patientId, (out.get(patientId) ?? 0) + delta);
  }
  return out;
}

/**
 * The patient payments recorded on `date` for another day. `created` is the rows created on the
 * day and `moved` the rows a date edit touched on the day, both as they stand now; `moves` are that
 * day's date edits. A payment moved and moved back is not listed; the insurer's own payments are
 * not the patient's money and are left out, as on the sheet.
 */
export function latePayments(args: {
  date: string;
  created: readonly ReportLedgerRow[];
  moved: readonly ReportLedgerRow[];
  moves: readonly PaymentMove[];
  branches: readonly { id: string; name: string }[];
}): LatePayment[] {
  const { date, branches } = args;
  // The day's first edit holds where the payment stood that morning; the last, who moved it.
  const moved = new Map<string, { from: string; by: string }>();
  for (const m of args.moves) {
    const prior = moved.get(m.id);
    moved.set(m.id, { from: prior?.from ?? m.from.slice(0, 10), by: m.by || prior?.by || "" });
  }
  const createdIds = new Set(args.created.map((r) => r.id));
  const seen = new Set<string>();
  const out: { item: LatePayment; order: number }[] = [];
  for (const row of [...args.created, ...args.moved]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (String(row.type || "") !== "payment" || !isLive(row) || text(row.method) === INSURER_PAYMENT_METHOD) continue;
    const amount = ledgerCashValue(row);
    if (amount <= 0) continue;
    const day = text(row.date).slice(0, 10);
    const move = moved.get(row.id);
    const from = move && move.from !== day ? move.from : null;
    if (!from && (day === date || !createdIds.has(row.id))) continue;
    out.push({
      item: {
        id: row.id,
        date: day,
        movedFrom: from,
        patient: text(row.patientName),
        branch: branches.find((b) => b.id === text(row.branchId))?.name ?? "",
        method: text(row.method),
        amount: round2(amount),
        by: (from ? move?.by : "") || text(row.addedBy) || text(row.receivedBy),
      },
      order: millisOf(row.createdAt),
    });
  }
  return out
    .sort((a, b) => (a.item.date !== b.item.date ? (a.item.date < b.item.date ? -1 : 1) : a.order - b.order))
    .map((o) => o.item);
}

function millisOf(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Date.parse(v) || 0;
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/**
 * The day's report. `branches` is the clinic's list in its own order; a clinic with none gets one
 * section with no branch name. Rows stamped with a branch that no longer exists, or with none,
 * go to a last section so no money drops out of the total.
 *
 * `accountRows` is the whole ledger of the day's patients, for their balances; without it the
 * balance is not shown. `createdRows`, `movedRows` and `moves` are what `latePayments` reads.
 */
export function buildDailyFinanceReport(args: {
  date: string;
  rows: readonly ReportLedgerRow[];
  branches: readonly { id: string; name: string }[];
  payers: readonly Payer[];
  isAr: boolean;
  accountRows?: readonly ReportLedgerRow[];
  createdRows?: readonly ReportLedgerRow[];
  movedRows?: readonly ReportLedgerRow[];
  moves?: readonly PaymentMove[];
}): DailyFinanceReport {
  const { date, branches, payers, isAr } = args;
  const balances = args.accountRows ? accountBalances(args.accountRows, date) : null;
  const rows = args.rows.map((r) => ({ ...r, date: text(r.date).slice(0, 10) })).filter((r) => r.date === date);

  const known = new Set(branches.map((b) => b.id));
  const sections: ReportSection[] = [];
  for (const branch of branches) {
    const mine = rows.filter((r) => text(r.branchId) === branch.id);
    const built = buildSection(mine, payers, isAr, balances);
    if (built.lines.length > 0) sections.push({ branchId: branch.id, name: branch.name, ...built });
  }
  const loose = rows.filter((r) => !known.has(text(r.branchId)));
  const looseBuilt = buildSection(loose, payers, isAr, balances);
  if (looseBuilt.lines.length > 0) {
    sections.push({ branchId: "", name: branches.length > 0 ? (isAr ? "بدون فرع" : "No branch") : "", ...looseBuilt });
  }

  const all = sections.flatMap((s) => s.lines);
  const late = latePayments({ date, created: args.createdRows ?? [], moved: args.movedRows ?? [], moves: args.moves ?? [], branches });
  return {
    date, sections, totals: totalsOf(all), hasBalances: balances !== null,
    late, lateTotal: round2(late.reduce((t, l) => t + l.amount, 0)),
  };
}

/** A report with nothing in it: no patient's money moved and nothing was recorded late. */
export function isEmptyReport(report: DailyFinanceReport): boolean {
  return report.sections.length === 0 && report.late.length === 0;
}

const money = (n: number, isAr: boolean) => Math.round(n).toLocaleString(isAr ? "ar-EG" : "en-US");

/** The WhatsApp message that goes with the file: the summary only, one line per branch. */
export function dailyFinanceReportText(report: DailyFinanceReport, clinicName: string, isAr: boolean): string {
  const [y, m, d] = report.date.split("-");
  const day = `${d}/${m}/${y}`;
  // Two lines per block: the work and who answers for it, then the patients' money and the share.
  // The account line only when balances were looked up: a missing figure must not read as zero.
  const line = (t: ReportTotals) =>
    (isAr
      ? [
          `قيمة الشغل ${money(t.work, true)} · على الشركات ${money(t.company, true)}`,
          `المطلوب من المرضى ${money(t.total, true)} · المدفوع ${money(t.paid, true)} · المتبقي ${money(t.remaining, true)}`,
          ...(report.hasBalances ? [`المستحق فعلاً على حساباتهم (بعد المدفوع مقدماً) ${money(t.owed, true)}`] : []),
          `نصيب الأطباء ${money(t.dentistShare, true)}`,
        ]
      : [
          `Work ${money(t.work, false)} · Companies ${money(t.company, false)}`,
          `Patients owe ${money(t.total, false)} · Paid ${money(t.paid, false)} · Left ${money(t.remaining, false)}`,
          ...(report.hasBalances ? [`Still owed on their accounts (after earlier payments) ${money(t.owed, false)}`] : []),
          `Dentists ${money(t.dentistShare, false)}`,
        ]
    ).join("\n");
  const out = [`📊 *${clinicName}* — ${isAr ? "التقرير اليومي" : "Daily report"} ${day}`];
  if (report.sections.length === 0) {
    out.push(isAr ? "مفيش حركة فلوس النهارده." : "No money moved today.");
    out.push(...lateBlock(report, isAr));
    return out.join("\n");
  }
  const named = report.sections.filter((s) => s.name);
  if (named.length > 0) {
    for (const s of report.sections) out.push("", `*${s.name || (isAr ? "بدون فرع" : "No branch")}* (${s.totals.patients})`, line(s.totals));
    if (report.sections.length > 1) out.push("", `*${isAr ? "الإجمالي" : "Total"}* (${report.totals.patients})`, line(report.totals));
  } else {
    out.push("", `${isAr ? "عدد المرضى" : "Patients"}: ${report.totals.patients}`, line(report.totals));
  }
  out.push(...lateBlock(report, isAr));
  out.push("", isAr ? "التفاصيل في ملف الإكسل 👇" : "Details in the Excel file 👇");
  return out.join("\n");
}

/** How many late payments the message names one by one; the file has them all. */
const LATE_LINES = 5;

function lateBlock(report: DailyFinanceReport, isAr: boolean): string[] {
  if (report.late.length === 0) return [];
  const head = isAr
    ? `⚠️ *دفعات اتسجلت النهارده على أيام تانية* (${report.late.length}) · ${money(report.lateTotal, true)}`
    : `⚠️ *Payments recorded today for other days* (${report.late.length}) · ${money(report.lateTotal, false)}`;
  const items = report.late.slice(0, LATE_LINES).map((l) => `• ${lateLine(l, isAr)}`);
  const more = report.late.length - LATE_LINES;
  if (more > 0) items.push(isAr ? `• و${more} كمان في الملف` : `• and ${more} more in the file`);
  return ["", head, ...items];
}

/** One late payment in words: who, how much, the day it is on now, and how it got there. */
export function lateLine(l: LatePayment, isAr: boolean): string {
  const how = l.movedFrom
    ? isAr ? `اتنقلت من ${sheetDay(l.movedFrom)} لـ ${sheetDay(l.date)}` : `moved from ${sheetDay(l.movedFrom)} to ${sheetDay(l.date)}`
    : isAr ? `بتاريخ ${sheetDay(l.date)}` : `dated ${sheetDay(l.date)}`;
  const by = l.by ? ` — ${l.by}` : "";
  return `${l.patient || "—"} ${money(l.amount, isAr)} · ${how}${by}`;
}

/** The note column of a late payment in the file. */
export function lateNote(l: LatePayment, isAr: boolean): string {
  if (l.movedFrom) return isAr ? `اتنقلت من ${sheetDay(l.movedFrom)}` : `Moved from ${sheetDay(l.movedFrom)}`;
  return isAr ? "اتسجلت متأخر" : "Entered late";
}

export function dailyFinanceReportFileName(date: string, isAr: boolean): string {
  return isAr ? `التقرير-اليومي-${date}.xlsx` : `daily-report-${date}.xlsx`;
}
