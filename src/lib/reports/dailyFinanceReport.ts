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
 * Pure: the sender passes the day's ledger rows, the test passes fixtures.
 */

import { dailySheet, sheetMethodLabel, type SheetLedgerRow } from "@/lib/dailySheet";
import { findPayer, type Payer } from "@/lib/payers";

export type ReportLedgerRow = SheetLedgerRow & {
  branchId?: unknown;
  serviceName?: unknown;
  description?: unknown;
  doctorName?: unknown;
  doctor?: unknown;
  doctorCommissionAmount?: unknown;
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
  total: number;
  paid: number;
  remaining: number;
  dentistShare: number;
};

export type ReportTotals = { patients: number; total: number; paid: number; remaining: number; dentistShare: number };

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
      total: line.total,
      paid: line.paid,
      remaining: line.remaining,
      dentistShare: round2(extra?.share ?? 0),
    };
  });
  return { lines: out, totals: totalsOf(out) };
}

function totalsOf(lines: readonly ReportLine[]): ReportTotals {
  const sum = (k: "total" | "paid" | "remaining" | "dentistShare") => round2(lines.reduce((t, l) => t + l[k], 0));
  return { patients: lines.length, total: sum("total"), paid: sum("paid"), remaining: sum("remaining"), dentistShare: sum("dentistShare") };
}

/**
 * The day's report. `branches` is the clinic's list in its own order; a clinic with none gets one
 * section with no branch name. Rows stamped with a branch that no longer exists, or with none,
 * go to a last section so no money drops out of the total.
 */
export function buildDailyFinanceReport(args: {
  date: string;
  rows: readonly ReportLedgerRow[];
  branches: readonly { id: string; name: string }[];
  payers: readonly Payer[];
  isAr: boolean;
}): DailyFinanceReport {
  const { date, branches, payers, isAr } = args;
  const rows = args.rows.map((r) => ({ ...r, date: text(r.date).slice(0, 10) })).filter((r) => r.date === date);

  const known = new Set(branches.map((b) => b.id));
  const sections: ReportSection[] = [];
  for (const branch of branches) {
    const mine = rows.filter((r) => text(r.branchId) === branch.id);
    const built = buildSection(mine, payers, isAr);
    if (built.lines.length > 0) sections.push({ branchId: branch.id, name: branch.name, ...built });
  }
  const loose = rows.filter((r) => !known.has(text(r.branchId)));
  const looseBuilt = buildSection(loose, payers, isAr);
  if (looseBuilt.lines.length > 0) {
    sections.push({ branchId: "", name: branches.length > 0 ? (isAr ? "بدون فرع" : "No branch") : "", ...looseBuilt });
  }

  const all = sections.flatMap((s) => s.lines);
  return { date, sections, totals: totalsOf(all) };
}

const money = (n: number, isAr: boolean) => Math.round(n).toLocaleString(isAr ? "ar-EG" : "en-US");

/** The WhatsApp message that goes with the file: the summary only, one line per branch. */
export function dailyFinanceReportText(report: DailyFinanceReport, clinicName: string, isAr: boolean): string {
  const [y, m, d] = report.date.split("-");
  const day = `${d}/${m}/${y}`;
  const line = (t: ReportTotals) =>
    isAr
      ? `المطلوب ${money(t.total, true)} · المدفوع ${money(t.paid, true)} · المتبقي ${money(t.remaining, true)} · نصيب الأطباء ${money(t.dentistShare, true)}`
      : `Due ${money(t.total, false)} · Paid ${money(t.paid, false)} · Left ${money(t.remaining, false)} · Dentists ${money(t.dentistShare, false)}`;
  const out = [`📊 *${clinicName}* — ${isAr ? "التقرير اليومي" : "Daily report"} ${day}`];
  if (report.sections.length === 0) {
    out.push(isAr ? "مفيش حركة فلوس النهارده." : "No money moved today.");
    return out.join("\n");
  }
  const named = report.sections.filter((s) => s.name);
  if (named.length > 0) {
    for (const s of report.sections) out.push("", `*${s.name || (isAr ? "بدون فرع" : "No branch")}* (${s.totals.patients})`, line(s.totals));
    if (report.sections.length > 1) out.push("", `*${isAr ? "الإجمالي" : "Total"}* (${report.totals.patients})`, line(report.totals));
  } else {
    out.push("", `${isAr ? "عدد المرضى" : "Patients"}: ${report.totals.patients}`, line(report.totals));
  }
  out.push("", isAr ? "التفاصيل في ملف الإكسل 👇" : "Details in the Excel file 👇");
  return out.join("\n");
}

export function dailyFinanceReportFileName(date: string, isAr: boolean): string {
  return isAr ? `التقرير-اليومي-${date}.xlsx` : `daily-report-${date}.xlsx`;
}
