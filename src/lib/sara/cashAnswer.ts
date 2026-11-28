import { ledgerCashValue } from "@/lib/reportHelpers";
import { normalizeMethod, type PaymentMethod } from "@/lib/reports/ledgerStats";
import type { PdfSection } from "./reportDigest";

/**
 * "How much did we take, where did it go, and who took it" for any period.
 *
 * The owner's note on the first review was "details, not just the total", so this carries the
 * lines themselves beside the sums: every payment with its patient, method and collector, every
 * expense with its category. The model is handed the sums and the first few lines; the PDF gets
 * all of them.
 *
 * Cash rule: the Finance page's. Treatment rows are plans, not money, and are skipped; a row's
 * money is read with `ledgerCashValue`, never a `??` chain (a placeholder 0 would win).
 */

export type LedgerRow = Record<string, unknown>;
export type Branch = { id: string; name: string };

export type MoneyLine = { date: string; who: string; what: string; method: string; amount: number; by: string };
export type GroupSum = { name: string; total: number; count: number };

export type MoneyDay = {
  startDate: string;
  endDate: string;
  collected: number;
  expenses: number;
  dentistShare: number;
  labFees: number;
  net: number;
  byMethod: GroupSum[];
  byCollector: GroupSum[];
  byBranch: { name: string; collected: number; expenses: number }[];
  drawer: { cashIn: number; cashOut: number; left: number };
  payments: MoneyLine[];
  expenseLines: MoneyLine[];
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const round = (n: number) => Number(n.toFixed(2));
const NOT_RECORDED = "Not recorded";

function addTo(map: Map<string, GroupSum>, name: string, amount: number) {
  const row = map.get(name) || { name, total: 0, count: 0 };
  row.total += amount;
  row.count += 1;
  map.set(name, row);
}

const sorted = (map: Map<string, GroupSum>) =>
  [...map.values()].map((g) => ({ ...g, total: round(g.total) })).sort((a, b) => b.total - a.total);

export function buildMoneyDay(args: { rows: readonly LedgerRow[]; startDate: string; endDate: string; branches?: readonly Branch[] }): MoneyDay {
  const { rows, startDate, endDate } = args;
  const branchName = new Map((args.branches || []).map((b) => [b.id, b.name]));

  let collected = 0;
  let expenses = 0;
  let dentistShare = 0;
  let labFees = 0;
  let cashIn = 0;
  let cashOut = 0;
  const methods = new Map<string, GroupSum>();
  const collectors = new Map<string, GroupSum>();
  const branches = new Map<string, { name: string; collected: number; expenses: number }>();
  const payments: MoneyLine[] = [];
  const expenseLines: MoneyLine[] = [];

  const branchOf = (row: LedgerRow) => {
    const id = text(row.branchId);
    const name = id ? branchName.get(id) || id : "No branch";
    let b = branches.get(name);
    if (!b) {
      b = { name, collected: 0, expenses: 0 };
      branches.set(name, b);
    }
    return b;
  };

  for (const row of rows) {
    const type = text(row.type);
    if (type === "procedure") continue;
    const status = text(row.status).toLowerCase();
    if (status === "deleted" || status === "cancelled") continue;
    const date = text(row.date).slice(0, 10);
    if (date && (date < startDate || date > endDate)) continue;

    const amount = ledgerCashValue(row);
    if (amount <= 0) continue;
    const method: PaymentMethod = normalizeMethod(row.method);
    const by = text(row.addedBy) || text(row.receivedBy) || NOT_RECORDED;

    if (type === "expense") {
      expenses += amount;
      if (method === "Cash") cashOut += amount;
      branchOf(row).expenses += amount;
      expenseLines.push({ date, who: text(row.category) || "General", what: text(row.description), method, amount: round(amount), by });
      continue;
    }

    collected += amount;
    dentistShare += num(row.doctorCommissionAmount);
    labFees += num(row.labFee);
    if (method === "Cash") cashIn += amount;
    addTo(methods, method, amount);
    addTo(collectors, by, amount);
    branchOf(row).collected += amount;
    payments.push({
      date,
      who: text(row.patientName) || (type === "income" ? "Other income" : "No patient"),
      what: text(row.serviceName) || text(row.description),
      method,
      amount: round(amount),
      by,
    });
  }

  const byDateThenAmount = (a: MoneyLine, b: MoneyLine) => b.date.localeCompare(a.date) || b.amount - a.amount;

  return {
    startDate,
    endDate,
    collected: round(collected),
    expenses: round(expenses),
    dentistShare: round(dentistShare),
    labFees: round(labFees),
    net: round(collected - expenses - dentistShare - labFees),
    byMethod: sorted(methods),
    byCollector: sorted(collectors),
    byBranch: [...branches.values()].map((b) => ({ name: b.name, collected: round(b.collected), expenses: round(b.expenses) })).sort((a, b) => b.collected - a.collected),
    drawer: { cashIn: round(cashIn), cashOut: round(cashOut), left: round(cashIn - cashOut) },
    payments: payments.sort(byDateThenAmount),
    expenseLines: expenseLines.sort(byDateThenAmount),
  };
}

/** What the model sees: every sum, and the first few lines of each list. */
export function moneyDayDigest(m: MoneyDay, maxLines = 12, clinicHasBranches = false) {
  return {
    period: m.startDate === m.endDate ? m.startDate : `${m.startDate} to ${m.endDate}`,
    currency: "EGP",
    collected: m.collected,
    expenses: m.expenses,
    dentistShare: m.dentistShare,
    labFees: m.labFees,
    net: m.net,
    byMethod: m.byMethod,
    byCollector: m.byCollector,
    // Always answered for a clinic with branches, even when only one took money: otherwise the
    // model goes looking for the split in raw records.
    ...(clinicHasBranches || m.byBranch.length > 1 ? { byBranch: m.byBranch } : { branches: "This clinic has one location; no branches are set up." }),
    cashDrawer: {
      ...m.drawer,
      note: "Cash payments minus cash expenses in this period. It does not know what was in the drawer before the period started.",
    },
    payments: { count: m.payments.length, shown: Math.min(maxLines, m.payments.length), lines: m.payments.slice(0, maxLines) },
    expenseLines: { count: m.expenseLines.length, shown: Math.min(maxLines, m.expenseLines.length), lines: m.expenseLines.slice(0, maxLines) },
    moreInPdf: m.payments.length > maxLines || m.expenseLines.length > maxLines,
    notes: ["Same cash rule as the Finance page: treatments are not counted until they are paid."],
  };
}

const money = (n: number) => Math.round(n).toLocaleString("en-US");

/** Every line, as table sections for the PDF. */
export function moneyDayPdfSections(m: MoneyDay, isAr: boolean, maxRows = 400): PdfSection[] {
  const t = (en: string, ar: string) => (isAr ? ar : en);
  const sections: PdfSection[] = [
    {
      heading: t("Summary", "الملخص"),
      columns: ["", t("EGP", "ج.م")],
      rows: [
        [t("Collected", "المحصّل"), money(m.collected)],
        [t("Expenses", "المصروفات"), money(m.expenses)],
        [t("Dentists' share", "نسبة الأطباء"), money(m.dentistShare)],
        [t("Lab fees", "المعمل"), money(m.labFees)],
        [t("Net", "الصافي"), money(m.net)],
        [t("Cash left in drawer", "الكاش في الدرج"), money(m.drawer.left)],
      ],
    },
  ];
  if (m.byMethod.length > 0) {
    sections.push({ heading: t("By payment method", "حسب طريقة الدفع"), columns: [t("Method", "الطريقة"), t("Payments", "عدد"), t("EGP", "ج.م")], rows: m.byMethod.map((g) => [g.name, String(g.count), money(g.total)]) });
  }
  if (m.byCollector.length > 0) {
    sections.push({ heading: t("By who collected", "حسب المحصّل"), columns: [t("Collected by", "المحصّل"), t("Payments", "عدد"), t("EGP", "ج.م")], rows: m.byCollector.map((g) => [g.name, String(g.count), money(g.total)]) });
  }
  if (m.byBranch.length > 1) {
    sections.push({ heading: t("By branch", "حسب الفرع"), columns: [t("Branch", "الفرع"), t("Collected", "المحصّل"), t("Expenses", "المصروفات")], rows: m.byBranch.map((b) => [b.name, money(b.collected), money(b.expenses)]) });
  }
  const cut = (n: number) => (n > maxRows ? t(`${n - maxRows} more rows not printed.`, `${n - maxRows} سطر لم يُطبع.`) : "");
  if (m.payments.length > 0) {
    const note = cut(m.payments.length);
    sections.push({
      heading: t("Payments", "المدفوعات"),
      columns: [t("Date", "التاريخ"), t("Patient", "المريض"), t("For", "البيان"), t("Method", "الطريقة"), t("By", "المحصّل"), t("EGP", "ج.م")],
      rows: m.payments.slice(0, maxRows).map((l) => [l.date, l.who, l.what, l.method, l.by, money(l.amount)]),
      ...(note ? { note } : {}),
    });
  }
  if (m.expenseLines.length > 0) {
    const note = cut(m.expenseLines.length);
    sections.push({
      heading: t("Expenses", "المصروفات"),
      columns: [t("Date", "التاريخ"), t("Category", "التصنيف"), t("For", "البيان"), t("Method", "الطريقة"), t("By", "بواسطة"), t("EGP", "ج.م")],
      rows: m.expenseLines.slice(0, maxRows).map((l) => [l.date, l.who, l.what, l.method, l.by, money(l.amount)]),
      ...(note ? { note } : {}),
    });
  }
  return sections;
}
