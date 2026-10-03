/**
 * A report as a document the phone can draw.
 *
 * The website draws each report with its own React component. The phone cannot run those, and
 * copying twenty-seven reports' arithmetic into Kotlin would give the clinic two answers to every
 * question. So the arithmetic stays in lib/reports and this module renders its OUTPUT into a
 * plain, typed document — figures, bar lists, month charts, a heat grid, tables, a P&L statement,
 * and the quiet notes under them — that a screen on any platform can draw without knowing what a
 * ledger row is. The phone fetches it from app/api/reports; a test can build it from fixtures.
 *
 * Bilingual: every label is produced here in the language asked for, so the phone shows Arabic
 * without carrying a second copy of the wording.
 */

import type { DateRange } from "@/lib/reportHelpers";
import { dayText, ledgerCashValue, rangeText } from "@/lib/reportHelpers";
import { reportMeta, type DatasetKey } from "@/lib/reports/catalog";
import {
  compareServices, delta, dentistTrend, discountLines, expenseLines, expensesByCategory, groupTotals, heatmap, hourOfTimestamp,
  paymentMethods, pnlByMonth, summarizeLedger, totalsByMonth, totalsByService, EXPENSE_CATEGORIES, type Delta,
} from "@/lib/reports/ledgerStats";
import { lastYearRange, monthLabel, monthLongLabel, monthKeyOf, previousRange, trailingMonths, WEEKDAYS_AR, WEEKDAYS_EN } from "@/lib/reports/periods";
import { receivables, type AgeBucket } from "@/lib/reports/receivables";
import { demographics, lifetimeValue, recallDue, retention, toYmd, type PatientDoc } from "@/lib/reports/patientStats";
import { appointmentStats, inventoryStats, labStats, outcomeOf, staffLines, type OutcomeCounts, type PayrollRow } from "@/lib/reports/opsStats";
import { planStats, type PlanStatus } from "@/lib/reports/plansStats";
import { whatsappStats } from "@/lib/reports/whatsappStats";
import { cashflow, compareExpenseCategories, expenseMatrix, incomeSources, INCOME_LABELS_AR, INCOME_LABELS_EN, type SourceGroup } from "@/lib/reports/financeStats";
import { adStats } from "@/lib/reports/adStats";
import { doctorLabel, partitionRows, rollupPatients, rowDate, type PatientRollup, type ReportLedgerRow, type ReportPatient } from "@/lib/reportPatients";
import { attributeService, buildProcedureIndex, type AttributableRow } from "@/lib/serviceAttribution";
import { buildPayerReport, type LedgerRowLite } from "@/lib/payerReport";
import { PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import { buildCaseSheet, settlementOf, sumCases } from "@/lib/caseSheet";
import { buildInsuranceStatement, caseLabel, type StatementRowLite } from "@/lib/insuranceStatement";
import { readMemberNumbers } from "@/lib/patientInsurance";
import { parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { statusLabel, workTypeLabel } from "@/lib/labCases";

// --- the document ----------------------------------------------------------------------------------

export type Tone = "ink" | "muted" | "bad";
export type DocFigure = { label: string; value: string; tone?: Tone; delta?: { pct: number | null; text: string; bad: boolean } };
export type DocBar = { label: string; value: number; text: string; mark?: boolean; warn?: boolean; drill?: string };
export type ColumnKind = "text" | "money" | "int" | "pct" | "date" | "delta";
export type DocColumn = { key: string; label: string; align?: "start" | "end"; kind?: ColumnKind };
export type DocRow = Record<string, string | number | boolean | null | undefined> & { _patientId?: string; _drill?: string; _bad?: boolean };
export type DocSection =
  | { type: "bars"; title: string; note?: string; rows: DocBar[] }
  | { type: "months"; title: string; note?: string; points: { label: string; value: number }[]; unit: "money" | "count" | "pct" }
  | { type: "heat"; title: string; note?: string; cells: { weekday: number; hour: number; value: number }[]; unit: "money" | "count" }
  | { type: "table"; title: string; note?: string; columns: DocColumn[]; rows: DocRow[]; total?: DocRow | null }
  | { type: "statement"; title: string; lines: { label: string; value: number; kind: "plus" | "minus" | "sub" | "result" }[] }
  | { type: "note"; text: string };

export type ReportDoc = {
  id: string;
  title: string;
  hint: string;
  range: { start: string; end: string; label: string };
  allTime: boolean;
  figures: DocFigure[];
  sections: DocSection[];
};

export type Row = Record<string, unknown> & { id: string };

/** Everything a report can ask for, already loaded. Mirrors what the website's page holds. */
export type ReportInputs = {
  procedures: Row[];
  payments: Row[];
  allPatients: Row[];
  leads: Row[];
  range: DateRange;
  today: string;
  lang: "en" | "ar";
  payers: Payer[];
  data: Partial<Record<DatasetKey, Row[]>>;
  /** From buildHrSection, when the caller may see wages. Null means "not allowed". */
  payroll: PayrollRow[] | null;
  /** The clinic's geofence and hours are not needed; the name is, for the title. */
  clinicName?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number | null, d = 0) => (n === null ? "—" : `${n.toFixed(d)}%`);
const EMPTY: Row[] = [];

function deltaFigure(d: Delta, goodWhen: "up" | "down" | "none", isAr: boolean): DocFigure["delta"] {
  const move = Math.sign(d.abs);
  const bad = goodWhen !== "none" && move !== 0 && (goodWhen === "up" ? move < 0 : move > 0);
  const arrow = move > 0 ? "▲" : move < 0 ? "▼" : "•";
  const text = d.pct === null ? (isAr ? "جديد" : "new") : `${arrow} ${Math.abs(d.pct)}% (${move >= 0 ? "+" : "−"}${fmt(Math.abs(d.abs))})`;
  return { pct: d.pct, text, bad };
}

function patientMapOf(rows: Row[]): Record<string, ReportPatient> {
  const m: Record<string, ReportPatient> = {};
  for (const p of rows) m[p.id] = { id: p.id, name: String(p.name || ""), phone: String(p.phone || "") };
  return m;
}

/**
 * A lead's stage in words. A copy of lib/leads' map, because that module boots the browser's
 * Firebase on import and this one must stay runnable on the server and in a test.
 */
function leadStageLabel(stage: string, lang: "en" | "ar"): string {
  const map: Record<string, { en: string; ar: string }> = {
    new: { en: "New", ar: "جديد" },
    contacted: { en: "Contacted", ar: "تم التواصل" },
    booked: { en: "Booked", ar: "محجوز" },
    won: { en: "In the chair", ar: "أصبح مريض" },
    lost: { en: "Lost", ar: "مفقود" },
  };
  const row = map[stage] || map.new;
  return lang === "ar" ? row.ar : row.en;
}

/** A patient list as a table section, the same shape everywhere a report opens to its people. */
function patientTable(title: string, rows: PatientRollup[], isAr: boolean, note?: string): DocSection {
  return {
    type: "table",
    title,
    note,
    columns: [
      { key: "name", label: isAr ? "المريض" : "Patient" },
      { key: "phone", label: isAr ? "الهاتف" : "Phone" },
      { key: "visits", label: isAr ? "زيارات" : "Visits", align: "end", kind: "int" },
      { key: "last", label: isAr ? "آخر زيارة" : "Last visit", kind: "date" },
      { key: "services", label: isAr ? "العلاج" : "Treatment" },
      { key: "doctors", label: isAr ? "الدكتور" : "Dentist" },
      { key: "paid", label: isAr ? "المدفوع" : "Paid", align: "end", kind: "money" },
    ],
    rows: rows.map((r) => ({
      _patientId: r.patientId,
      name: r.name,
      phone: r.phone,
      visits: r.visits,
      last: r.lastDate,
      services: r.services.join(" + ") || "—",
      doctors: r.doctors.join(", ") || "—",
      paid: r.paid,
      owed: r.charged > r.paid ? r.charged - r.paid : 0,
    })),
    total: { name: `${rows.length}`, paid: rows.reduce((s, r) => s + r.paid, 0) },
  };
}

/** Where a patient came from — the Sources tab's rule, kept identical. */
function patientChannel(patient: ReportPatient | undefined, rowReferral: unknown, extra?: Row): string {
  const raw = String((extra?.referral as string) || (extra?.source as string) || rowReferral || "").trim();
  return raw || "Unknown / Walk-in";
}

function outcomeColumns(isAr: boolean): DocColumn[] {
  return [
    { key: "total", label: isAr ? "الكل" : "Total", align: "end", kind: "int" },
    { key: "seen", label: isAr ? "حضروا" : "Seen", align: "end", kind: "int" },
    { key: "noShow", label: isAr ? "مجوش" : "No-show", align: "end", kind: "int" },
    { key: "cancelled", label: isAr ? "ملغي" : "Cancelled", align: "end", kind: "int" },
    { key: "open", label: isAr ? "قادم" : "Ahead", align: "end", kind: "int" },
    { key: "noShowPct", label: isAr ? "نسبة الغياب" : "No-show rate", align: "end", kind: "pct" },
  ];
}
function outcomeRow(c: OutcomeCounts): DocRow {
  return { total: c.total, seen: c.seen, noShow: c.noShow, cancelled: c.cancelled, open: c.open, noShowPct: c.noShowPct, _bad: c.noShowPct !== null && c.noShowPct >= 20 };
}

// --- the builder ---------------------------------------------------------------------------------------

export function buildReportDoc(id: string, input: ReportInputs): ReportDoc {
  const meta = reportMeta(id);
  const isAr = input.lang === "ar";
  const egp = isAr ? "ج.م" : "EGP";
  const ledger = [...input.procedures, ...input.payments];
  const range = input.range;
  const rangeLabel = rangeText(range, isAr);
  const patientMap = patientMapOf(input.allPatients);
  const patients = input.allPatients as unknown as PatientDoc[];
  const unknownName = isAr ? "بدون اسم" : "Unknown";
  const unassigned = isAr ? "غير محدد" : "Unassigned";
  const d = (k: DatasetKey) => input.data[k] || EMPTY;
  const figures: DocFigure[] = [];
  const sections: DocSection[] = [];
  const note = (text: string) => sections.push({ type: "note", text });
  const figure = (label: string, value: string, tone?: Tone) => figures.push({ label, value, tone });
  const money = (n: number) => `${fmt(n)} ${egp}`;

  switch (meta.id) {
    // --- overview ------------------------------------------------------------------------------------
    case "clinic": {
      const t = summarizeLedger(ledger);
      figure(isAr ? "إجمالي الدخل" : "Total income", money(t.income));
      figure(isAr ? "الاستقطاعات" : "Deductions", `(${fmt(t.commissions)}) ${egp}`, "muted");
      figure(isAr ? "المصروفات" : "Expenses", `(${fmt(t.expenses)}) ${egp}`, "muted");
      figure(isAr ? "صافي الربح" : "Net profit", money(t.income - t.commissions - t.expenses), t.income - t.commissions - t.expenses < 0 ? "bad" : "ink");
      // New vs returning, the Overview tab's rule: new = file opened inside the range.
      const active = new Set<string>();
      ledger.forEach((r) => { if (r.type !== "expense" && r.patientId) active.add(String(r.patientId)); });
      const created = new Map(input.allPatients.map((p) => [p.id, toYmd(p.createdAt)]));
      const newIds = new Set([...active].filter((pid) => { const c = created.get(pid) || ""; return c >= range.start && c <= range.end; }));
      const retIds = new Set([...active].filter((pid) => !newIds.has(pid)));
      let newInc = 0, retInc = 0;
      input.payments.forEach((p) => { if (p.type === "expense") return; const pid = String(p.patientId || ""); const v = ledgerCashValue(p); if (newIds.has(pid)) newInc += v; else if (retIds.has(pid)) retInc += v; });
      sections.push({ type: "bars", title: isAr ? "مرضى جدد وحاليين" : "New and returning patients", note: isAr ? "العدد، وفلوسهم. اضغط لعرض الأسماء." : "How many, and what they were worth. Tap for the names.", rows: [
        { label: isAr ? "مرضى جدد" : "New patients", value: newIds.size, text: `${newIds.size} · ${money(newInc)}`, mark: true, drill: "new" },
        { label: isAr ? "مرضى حاليون" : "Returning patients", value: retIds.size, text: `${retIds.size} · ${money(retInc)}`, drill: "returning" },
      ] });
      const days = trailingDays(range);
      const byDay = new Map<string, number>();
      input.payments.forEach((p) => { const day = rowDate(p); if (day && p.type !== "expense") byDay.set(day, (byDay.get(day) || 0) + ledgerCashValue(p)); });
      if (days.length <= 62) sections.push({ type: "months", title: isAr ? "الفلوس يوم بيوم" : "Money, day by day", unit: "money", points: days.map((day) => ({ label: String(Number(day.slice(8, 10))), value: Math.round(byDay.get(day) || 0) })) });
      const services = totalsByService(ledger);
      sections.push({ type: "table", title: isAr ? "الإجراءات" : "Procedures", note: isAr ? "اضغط سطر لعرض مرضاه." : "Tap a line for its patients.",
        columns: [{ key: "name", label: isAr ? "الإجراء" : "Procedure" }, { key: "count", label: isAr ? "العدد" : "Count", align: "end", kind: "int" }, { key: "income", label: isAr ? "الدخل" : "Income", align: "end", kind: "money" }, { key: "share", label: "%", align: "end", kind: "pct" }],
        rows: services.map((s) => ({ _drill: `service:${s.key}`, name: s.name, count: s.count, income: s.income, share: t.income > 0 ? Number(((s.income / t.income) * 100).toFixed(1)) : null })),
        total: { name: isAr ? "الإجمالي" : "Total", count: t.procedures, income: t.income, share: 100 } });
      break;
    }
    case "compare":
    case "lastYear": {
      const other = meta.id === "compare" ? d("ledgerPrev") : d("ledgerLastYear");
      const otherRange = meta.id === "compare" ? previousRange(range) : lastYearRange(range);
      const against = meta.id === "compare" ? (isAr ? "الفترة السابقة" : "the period before") : isAr ? "نفس الفترة السنة اللي فاتت" : "the same period last year";
      const now = summarizeLedger(ledger);
      const then = summarizeLedger(other);
      const count = (s: string, e: string) => input.allPatients.filter((p) => { const c = toYmd(p.createdAt); return c >= s && c <= e; }).length;
      const add = (label: string, a: number, b: number, goodWhen: "up" | "down" | "none" = "up", isMoney = true) =>
        figures.push({ label, value: isMoney ? money(b) : fmt(b), delta: deltaFigure(delta(a, b), goodWhen, isAr) });
      add(isAr ? "الدخل" : "Income", then.income, now.income);
      add(isAr ? "الصافي" : "Net", then.net, now.net);
      add(isAr ? "العلاجات" : "Treatments", then.procedures, now.procedures, "up", false);
      add(isAr ? "مرضى نشطين" : "Active patients", then.patients, now.patients, "up", false);
      add(isAr ? "ملفات جديدة" : "New patients", count(otherRange.start, otherRange.end), count(range.start, range.end), "up", false);
      add(isAr ? "المصروفات" : "Expenses", then.expenses, now.expenses, "down");
      add(isAr ? "نِسَب الأطباء" : "Commissions", then.commissions, now.commissions, "none");
      add(isAr ? "الخصومات" : "Discounts", then.discounts, now.discounts, "down");
      note(isAr ? `المقارنة: ${rangeLabel} مقابل ${rangeText(otherRange, true)}. السهم عن ${against}.` : `${rangeLabel}, against ${rangeText(otherRange, false)}. Arrows are vs ${against}.`);
      const dents = (() => { const cur = new Map(dentistTrend(ledger, ["x"]).map((x) => [x.doctor, x.total])); const prev = new Map(dentistTrend(other, ["x"]).map((x) => [x.doctor, x.total])); return [...new Set([...cur.keys(), ...prev.keys()])].map((doctor) => ({ doctor, now: cur.get(doctor) || 0, then: prev.get(doctor) || 0 })).sort((a, b) => b.now - a.now); })();
      sections.push({ type: "table", title: isAr ? "الأطباء" : "By dentist", columns: [{ key: "doctor", label: isAr ? "الدكتور" : "Dentist" }, { key: "then", label: isAr ? "قبل" : "Before", align: "end", kind: "money" }, { key: "now", label: isAr ? "دلوقتي" : "Now", align: "end", kind: "money" }, { key: "d", label: isAr ? "التغيّر" : "Change", align: "end", kind: "delta" }],
        rows: dents.map((x) => ({ doctor: x.doctor, then: x.then, now: x.now, d: delta(x.then, x.now).pct, _bad: x.now < x.then })) });
      const services = compareServices(ledger, other);
      sections.push({ type: "table", title: isAr ? "الخدمات، خدمة بخدمة" : "Service by service", note: isAr ? "مرتّبة حسب حجم التغيّر." : "Sorted by the size of the change.",
        columns: [{ key: "name", label: isAr ? "الخدمة" : "Service" }, { key: "prevCount", label: isAr ? "العدد قبل" : "Count before", align: "end", kind: "int" }, { key: "count", label: isAr ? "العدد" : "Count", align: "end", kind: "int" }, { key: "prevIncome", label: isAr ? "الدخل قبل" : "Income before", align: "end", kind: "money" }, { key: "income", label: isAr ? "الدخل" : "Income", align: "end", kind: "money" }, { key: "d", label: isAr ? "التغيّر" : "Change", align: "end", kind: "delta" }],
        rows: services.map((s) => ({ name: s.name, prevCount: s.prevCount, count: s.count, prevIncome: s.prevIncome, income: s.income, d: s.incomeDelta.pct, _bad: s.incomeDelta.abs < 0 })),
        total: { name: isAr ? "الإجمالي" : "Total", prevIncome: then.income, income: now.income, d: delta(then.income, now.income).pct } });
      // Gained and missing, by name.
      const ids = (rows: Row[]) => new Set(rows.map((r) => String(r.patientId || "")).filter(Boolean));
      const a = ids(ledger), b = ids(other);
      const roll = (want: Set<string>, from: Row[]) => rollupPatients(from.filter((r) => r.type === "procedure" && want.has(String(r.patientId))), from.filter((r) => r.type !== "procedure" && want.has(String(r.patientId))), patientMap, { unknownName });
      sections.push(patientTable(isAr ? "جُم دلوقتي ومكانوش قبل" : "Seen now, not then", roll(new Set([...a].filter((x) => !b.has(x))), ledger), isAr));
      sections.push(patientTable(isAr ? "كانوا قبل ومجوش دلوقتي" : "Seen then, not now", roll(new Set([...b].filter((x) => !a.has(x))), other), isAr, isAr ? "الناس اللي جابوا فلوس المرة اللي فاتت ومجوش المرة دي — أول قائمة تتصل بها." : "The people who brought money last time and did not come this time. The first list to call."));
      break;
    }
    case "year": {
      const { months } = trailingMonths(range.end, 12);
      const per = totalsByMonth(d("ledgerMonths12"), months);
      const withYear = months[0].slice(0, 4) !== months[11].slice(0, 4);
      const withData = per.filter((m) => m.income > 0 || m.procedures > 0);
      const best = withData.length ? withData.reduce((x, y) => (y.income > x.income ? y : x)) : null;
      const worst = withData.length > 1 ? withData.reduce((x, y) => (y.income < x.income ? y : x)) : null;
      const income = per.reduce((s, m) => s + m.income, 0), net = per.reduce((s, m) => s + m.net, 0);
      const newBy = months.map((m) => input.allPatients.filter((p) => monthKeyOf(toYmd(p.createdAt)) === m).length);
      figure(isAr ? "دخل ١٢ شهر" : "Income, 12 months", money(income));
      figure(isAr ? "الصافي" : "Net", money(net), net < 0 ? "bad" : "ink");
      figure(isAr ? "متوسط الشهر" : "Average month", money(withData.length ? income / withData.length : 0), "muted");
      figure(isAr ? "ملفات جديدة" : "New patients", fmt(newBy.reduce((s, v) => s + v, 0)));
      sections.push({ type: "months", title: isAr ? "الدخل شهر بشهر" : "Income, month by month", unit: "money", points: per.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.income })),
        note: best ? (isAr ? `أحسن شهر ${monthLongLabel(best.month, true)} بـ ${fmt(best.income)} ج.م${worst ? `، وأضعف شهر ${monthLongLabel(worst.month, true)}` : ""}.` : `Best month ${monthLongLabel(best.month, false)} at ${fmt(best.income)} EGP${worst ? `; weakest ${monthLongLabel(worst.month, false)}` : ""}.`) : undefined });
      sections.push({ type: "months", title: isAr ? "الصافي" : "Net", unit: "money", points: per.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.net })) });
      sections.push({ type: "months", title: isAr ? "ملفات جديدة كل شهر" : "New patient files each month", unit: "count", points: months.map((m, i) => ({ label: monthLabel(m, isAr, withYear), value: newBy[i] })) });
      sections.push({ type: "table", title: isAr ? "الجدول" : "The table", columns: [{ key: "month", label: isAr ? "الشهر" : "Month" }, { key: "procedures", label: isAr ? "علاجات" : "Treatments", align: "end", kind: "int" }, { key: "patients", label: isAr ? "مرضى" : "Patients", align: "end", kind: "int" }, { key: "newPatients", label: isAr ? "جديد" : "New", align: "end", kind: "int" }, { key: "income", label: isAr ? "الدخل" : "Income", align: "end", kind: "money" }, { key: "expenses", label: isAr ? "المصروفات" : "Expenses", align: "end", kind: "money" }, { key: "net", label: isAr ? "الصافي" : "Net", align: "end", kind: "money" }],
        rows: per.map((m, i) => ({ month: monthLongLabel(m.month, isAr), procedures: m.procedures, patients: m.patients, newPatients: newBy[i], income: m.income, expenses: m.expenses, net: m.net, _bad: m.net < 0 })),
        total: { month: isAr ? "الإجمالي" : "Total", procedures: per.reduce((s, m) => s + m.procedures, 0), income, expenses: per.reduce((s, m) => s + m.expenses, 0), net } });
      break;
    }
    case "heatmap": {
      const appts = d("appointments");
      const visits = heatmap(appts.filter((a) => outcomeOf(a, input.today) !== "cancelled"), (a) => toYmd(a.date), (a) => (a.time ? parseApptTimeToMinutes(String(a.time)) / 60 : null), () => 1);
      const cash = heatmap(input.payments.filter((p) => p.type === "payment" || p.type === "income"), (p) => rowDate(p), (p) => hourOfTimestamp(p.createdAt), (p) => ledgerCashValue(p));
      const days = isAr ? WEEKDAYS_AR : WEEKDAYS_EN;
      const byDay = (cells: typeof visits) => { const v = Array(7).fill(0) as number[]; cells.forEach((c) => (v[c.weekday] += c.value)); return v; };
      const v = byDay(visits), c = byDay(cash);
      const bestV = v.indexOf(Math.max(...v)), bestC = c.indexOf(Math.max(...c));
      figure(isAr ? "أكتر يوم مواعيد" : "Busiest day", visits.length ? days[bestV] : "—");
      figure(isAr ? "أكتر يوم فلوس" : "Best money day", cash.length ? days[bestC] : "—");
      figure(isAr ? "مواعيد" : "Visits", fmt(v.reduce((s, x) => s + x, 0)), "muted");
      sections.push({ type: "heat", title: isAr ? "المرضى: أنهي يوم وأنهي ساعة" : "Patients: which day, which hour", unit: "count", cells: visits.filter((x) => x.hour >= 0) });
      sections.push({ type: "heat", title: isAr ? "الفلوس: أنهي يوم وأنهي ساعة" : "Money: which day, which hour", unit: "money", cells: cash.filter((x) => x.hour >= 0) });
      sections.push({ type: "bars", title: isAr ? "المواعيد حسب اليوم" : "Visits by weekday", rows: days.map((day, i) => ({ label: day, value: v[i], text: String(v[i]), mark: i === bestV && v[i] > 0 })) });
      sections.push({ type: "bars", title: isAr ? "الفلوس حسب اليوم" : "Money by weekday", rows: days.map((day, i) => ({ label: day, value: c[i], text: money(c[i]), mark: i === bestC && c[i] > 0 })) });
      note(isAr ? "المواعيد بساعة الحجز؛ الفلوس بالساعة اللي اتسجلت فيها الدفعة. السبت أول يوم في الأسبوع." : "Visits by booked hour; money by the hour the payment was recorded. Saturday is the first day of the week.");
      break;
    }
    // --- money ------------------------------------------------------------------------------------------
    case "pnl": {
      const t = summarizeLedger(ledger);
      const { months } = trailingMonths(range.end, 12);
      const trend = pnlByMonth(d("ledgerMonths12"), months);
      const byCat: Record<string, number> = {};
      pnlByMonth(ledger, [range.start.slice(0, 7), range.end.slice(0, 7)].filter((x, i, a) => a.indexOf(x) === i)).forEach((m) => Object.entries(m.expensesByCategory).forEach(([k, v]) => (byCat[k] = (byCat[k] || 0) + v)));
      const margin = t.income > 0 ? (t.net / t.income) * 100 : null;
      figure(isAr ? "إجمالي الدخل" : "Gross income", money(t.income));
      figure(isAr ? "معمل + نِسَب" : "Lab + commissions", `(${fmt(t.labFees + t.commissions)}) ${egp}`, "muted");
      figure(isAr ? "المصروفات" : "Expenses", `(${fmt(t.expenses)}) ${egp}`, "muted");
      figure(`${isAr ? "صافي الربح" : "Net profit"} · ${pct(margin, 1)}`, money(t.net), t.net < 0 ? "bad" : "ink");
      const cats = [...new Set<string>([...EXPENSE_CATEGORIES, ...Object.keys(byCat)])];
      sections.push({ type: "statement", title: `${isAr ? "القائمة" : "The statement"} · ${rangeLabel}`, lines: [
        { label: isAr ? "إجمالي الدخل" : "Gross income", value: t.income, kind: "plus" },
        { label: isAr ? "مصاريف المعمل" : "Lab fees", value: -t.labFees, kind: "minus" },
        { label: isAr ? "نِسَب الأطباء" : "Dentists' commissions", value: -t.commissions, kind: "minus" },
        { label: isAr ? "هامش العلاج" : "Treatment margin", value: t.income - t.labFees - t.commissions, kind: "result" },
        ...cats.filter((c) => (byCat[c] || 0) > 0).map((c) => ({ label: `${isAr ? "مصروفات" : "Expenses"} · ${c}`, value: -(byCat[c] || 0), kind: "sub" as const })),
        { label: isAr ? "إجمالي المصروفات" : "Total expenses", value: -t.expenses, kind: "minus" },
        { label: isAr ? "صافي الربح" : "Net profit", value: t.net, kind: "result" },
      ] });
      const withYear = months[0].slice(0, 4) !== months[11].slice(0, 4);
      sections.push({ type: "months", title: isAr ? "هامش الربح شهر بشهر" : "Net margin, month by month", unit: "pct", points: trend.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.marginPct ?? 0 })) });
      sections.push({ type: "table", title: isAr ? "١٢ شهر" : "Twelve months", columns: [{ key: "month", label: isAr ? "الشهر" : "Month" }, { key: "income", label: isAr ? "الدخل" : "Income", align: "end", kind: "money" }, { key: "labFees", label: isAr ? "المعمل" : "Lab", align: "end", kind: "money" }, { key: "commissions", label: isAr ? "النِسَب" : "Commissions", align: "end", kind: "money" }, { key: "expenses", label: isAr ? "المصروفات" : "Expenses", align: "end", kind: "money" }, { key: "net", label: isAr ? "الصافي" : "Net", align: "end", kind: "money" }, { key: "margin", label: isAr ? "الهامش" : "Margin", align: "end", kind: "pct" }],
        rows: trend.map((m) => ({ month: monthLongLabel(m.month, isAr), income: m.income, labFees: m.labFees, commissions: m.commissions, expenses: m.expenses, net: m.net, margin: m.marginPct, _bad: m.net < 0 })) });
      note(isAr ? "الدخل = الفلوس اللي دخلت فعلاً. النِسَب من الدفعات، المعمل من العلاجات، المصروفات من صفحة المالية." : "Income is cash actually received. Commissions come off payments, lab fees off treatments, expenses off the Finance page.");
      break;
    }
    case "service": {
      const t = summarizeLedger(ledger);
      const index = buildProcedureIndex(input.procedures as AttributableRow[]);
      const map = new Map<string, { key: string; name: string; count: number; income: number; commission: number; labFee: number }>();
      const bucket = (row: Row) => { const { key, name } = attributeService(row as AttributableRow, index); let s = map.get(key); if (!s) { s = { key, name, count: 0, income: 0, commission: 0, labFee: 0 }; map.set(key, s); } return s; };
      input.procedures.forEach((p) => { const s = bucket(p); s.count += 1; s.labFee += Number(p.labFee) || 0; });
      input.payments.forEach((p) => { if (p.type === "expense") return; const s = bucket(p); s.income += ledgerCashValue(p); s.commission += Number(p.doctorCommissionAmount) || 0; });
      const stats = [...map.values()].sort((a, b) => b.income - a.income);
      figure(isAr ? "إجمالي الإجراءات" : "Total services", fmt(t.procedures));
      figure(isAr ? "إجمالي الدخل" : "Total income", money(t.income));
      figure(isAr ? "العمولات" : "Commissions", `(${fmt(t.commissions)}) ${egp}`, "muted");
      figure(isAr ? "صافي الدخل" : "Net income", money(t.income - t.commissions - t.labFees));
      sections.push({ type: "bars", title: isAr ? "الدخل حسب الخدمة" : "Income by service", note: isAr ? "أعلى ٨ خدمات." : "The eight biggest earners.", rows: stats.slice(0, 8).map((s, i) => ({ label: s.name, value: s.income, text: money(s.income), mark: i === 0, drill: `service:${s.key}` })) });
      sections.push({ type: "table", title: isAr ? "تفاصيل الخدمات" : "Service breakdown", note: isAr ? "اضغط سطر لعرض مرضاه." : "Tap a line for its patients.",
        columns: [{ key: "name", label: isAr ? "الخدمة" : "Service" }, { key: "count", label: isAr ? "العدد" : "Count", align: "end", kind: "int" }, { key: "income", label: isAr ? "الدخل" : "Income", align: "end", kind: "money" }, { key: "commission", label: isAr ? "العمولة" : "Comm.", align: "end", kind: "money" }, { key: "net", label: isAr ? "الصافي" : "Net", align: "end", kind: "money" }],
        rows: stats.map((s) => ({ _drill: `service:${s.key}`, name: s.name, count: s.count, income: s.income, commission: s.commission, net: s.income - s.commission - s.labFee })),
        total: { name: isAr ? "الإجمالي" : "Total", count: t.procedures, income: t.income, commission: t.commissions, net: t.income - t.commissions - t.labFees } });
      break;
    }
    case "dentist": {
      const trend = dentistTrend(ledger, [range.start.slice(0, 7), range.end.slice(0, 7)].filter((x, i, a) => a.indexOf(x) === i), unassigned);
      // Over a range that crosses months the single-month trick undercounts; sum the buckets instead.
      const rows = trend.map((t) => ({ doctor: t.doctor, income: t.total, cases: t.cases, commission: t.byMonth.reduce((s, m) => s + m.commission, 0) }));
      const labByDoctor = new Map<string, number>();
      input.procedures.forEach((p) => { const k = doctorLabel(p, unassigned); labByDoctor.set(k, (labByDoctor.get(k) || 0) + (Number(p.labFee) || 0)); });
      const income = rows.reduce((s, r) => s + r.income, 0), comm = rows.reduce((s, r) => s + r.commission, 0), lab = [...labByDoctor.values()].reduce((s, v) => s + v, 0);
      figure(isAr ? "إجمالي الدخل" : "Total income", money(income));
      figure(isAr ? "عمولات الأطباء" : "Doctor commissions", money(comm), "muted");
      figure(isAr ? "مصاريف المعمل" : "Lab fees", money(lab), "muted");
      figure(isAr ? "صافي العيادة" : "Net to clinic", money(income - comm - lab));
      sections.push({ type: "bars", title: isAr ? "الدخل حسب الدكتور" : "Income by dentist", note: isAr ? "اضغط لعرض مرضى الدكتور." : "Tap for the dentist's patients.", rows: rows.map((r, i) => ({ label: `Dr. ${r.doctor}`, value: r.income, text: money(r.income), mark: i === 0, drill: `dentist:${r.doctor}` })) });
      sections.push({ type: "table", title: isAr ? "الأطباء" : "Dentists", columns: [{ key: "doctor", label: isAr ? "الطبيب" : "Dentist" }, { key: "cases", label: isAr ? "الإجراءات" : "Procedures", align: "end", kind: "int" }, { key: "income", label: isAr ? "الدخل" : "Income", align: "end", kind: "money" }, { key: "commission", label: isAr ? "العمولة" : "Commission", align: "end", kind: "money" }, { key: "lab", label: isAr ? "المعمل" : "Lab fee", align: "end", kind: "money" }, { key: "net", label: isAr ? "صافي العيادة" : "Net to clinic", align: "end", kind: "money" }],
        rows: rows.map((r) => ({ _drill: `dentist:${r.doctor}`, doctor: `Dr. ${r.doctor}`, cases: r.cases, income: r.income, commission: r.commission, lab: labByDoctor.get(r.doctor) || 0, net: r.income - r.commission - (labByDoctor.get(r.doctor) || 0) })),
        total: { doctor: isAr ? "الإجمالي" : "Total", cases: rows.reduce((s, r) => s + r.cases, 0), income, commission: comm, lab, net: income - comm - lab } });
      break;
    }
    case "dentistTrend": {
      const { months } = trailingMonths(range.end, 12);
      const trend = dentistTrend(d("ledgerMonths12"), months, unassigned);
      const withYear = months[0].slice(0, 4) !== months[11].slice(0, 4);
      trend.slice(0, 3).forEach((t) => figure(`Dr. ${t.doctor}`, money(t.total)));
      trend.forEach((t) => sections.push({ type: "months", title: `Dr. ${t.doctor} · ${money(t.total)}`, unit: "money", points: t.byMonth.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.income })), note: isAr ? `${t.cases} حالة في ١٢ شهر` : `${t.cases} cases over twelve months` }));
      if (!trend.length) note(isAr ? "مفيش شغل متسجل باسم دكتور في آخر ١٢ شهر." : "No work attributed to a dentist in the last twelve months.");
      break;
    }
    case "payers": {
      const r = buildPayerReport(input.procedures as LedgerRowLite[], input.payments as LedgerRowLite[], input.payers);
      figure(isAr ? "المطلوب" : "Charged", money(r.totals.charged));
      figure(isAr ? "المحصّل" : "Collected", money(r.totals.collected));
      figure(isAr ? "لسه مجاش" : "Still owed", money(Math.max(0, r.totals.charged - r.totals.collected)), r.totals.charged > r.totals.collected ? "bad" : "muted");
      figure(isAr ? "صافي العيادة" : "Clinic net", money(r.totals.clinicNet));
      if (r.unstamped.procedures + r.unstamped.payments > 0) note(isAr ? `${r.unstamped.procedures} علاج و${r.unstamped.payments} دفعة اتسجلوا قبل ما تظبّط جهات الدفع، فمحسوبين «خاص».` : `${r.unstamped.procedures} treatments and ${r.unstamped.payments} payments were recorded before payers were set up, so they are counted as Private.`);
      sections.push({ type: "table", title: isAr ? "حسب جهة الدفع" : "By payer", note: isAr ? "اضغط جهة لعرض مرضاها." : "Tap a payer for its patients.",
        columns: [{ key: "payer", label: isAr ? "جهة الدفع" : "Payer" }, { key: "cases", label: isAr ? "الحالات" : "Cases", align: "end", kind: "int" }, { key: "patients", label: isAr ? "المرضى" : "Patients", align: "end", kind: "int" }, { key: "charged", label: isAr ? "المطلوب" : "Charged", align: "end", kind: "money" }, { key: "collected", label: isAr ? "المحصّل" : "Collected", align: "end", kind: "money" }, { key: "lab", label: isAr ? "المعمل" : "Lab", align: "end", kind: "money" }, { key: "commission", label: isAr ? "نسب الأطباء" : "Commission", align: "end", kind: "money" }, { key: "net", label: isAr ? "صافي العيادة" : "Clinic net", align: "end", kind: "money" }],
        rows: r.payers.map((p) => ({ _drill: `payer:${p.payerId}`, payer: p.payerName, cases: p.cases, patients: p.patients, charged: p.charged, collected: p.collected, lab: p.labFees, commission: p.commission, net: p.clinicNet })),
        total: { payer: isAr ? "الإجمالي" : "Total", cases: r.totals.cases, patients: r.totals.patients, charged: r.totals.charged, collected: r.totals.collected, lab: r.totals.labFees, commission: r.totals.commission, net: r.totals.clinicNet } });
      const doctors = new Map<string, DocRow>();
      r.payers.forEach((p) => p.doctors.forEach((dd) => { const row = doctors.get(dd.doctorId) || { doctor: dd.doctorName || unassigned, total: 0 }; row[p.payerName] = dd.commission; row.total = Number(row.total || 0) + dd.commission; doctors.set(dd.doctorId, row); }));
      if (doctors.size) sections.push({ type: "table", title: isAr ? "مستحقات كل دكتور، حسب الجهة" : "What each dentist earned, by payer", columns: [{ key: "doctor", label: isAr ? "الدكتور" : "Dentist" }, ...r.payers.map((p) => ({ key: p.payerName, label: p.payerName, align: "end" as const, kind: "money" as const })), { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", kind: "money" }], rows: [...doctors.values()] });
      note(isAr ? "«المطلوب» هو سعر العلاجات، و«المحصّل» هو اللي دخل فعلاً. النِسَب بتتحسب على المحصّل." : "Charged is what the treatments came to; collected is money actually received. Commission is calculated on what was collected.");
      break;
    }
    case "receivables": {
      const r = receivables(d("ledgerAll"), input.allPatients as (ReportPatient & { whatsappOptOut?: unknown })[], input.today);
      const label = (b: AgeBucket) => (isAr ? { "0-30": "٠–٣٠ يوم", "31-60": "٣١–٦٠ يوم", "61-90": "٦١–٩٠ يوم", "90+": "أكتر من ٩٠ يوم" }[b] : `${b} days`);
      figure(isAr ? "إجمالي المستحق" : "Outstanding", money(r.totals.balance), r.totals.balance > 0 ? "bad" : "ink");
      figure(isAr ? "مريض عليهم فلوس" : "Patients owing", fmt(r.totals.patients));
      figure(isAr ? "أكتر من ٩٠ يوم" : "Over 90 days", money(r.aging[3].total), r.aging[3].total > 0 ? "bad" : "muted");
      figure(isAr ? "رصيد دائن" : "Credit balances", money(r.totals.credits), "muted");
      sections.push({ type: "bars", title: isAr ? "حسب العمر" : "By age", rows: r.aging.map((a) => ({ label: `${label(a.bucket)} · ${a.count}`, value: a.total, text: money(a.total), warn: a.bucket === "90+" && a.total > 0 })) });
      sections.push({ type: "table", title: isAr ? "حسب جهة الدفع" : "By payer", columns: [{ key: "payer", label: isAr ? "الجهة" : "Payer" }, { key: "charged", label: isAr ? "المطلوب" : "Charged", align: "end", kind: "money" }, { key: "collected", label: isAr ? "المحصّل" : "Collected", align: "end", kind: "money" }, { key: "balance", label: isAr ? "الباقي" : "Owed", align: "end", kind: "money" }], rows: r.byPayer.filter((p) => p.charged > 0).map((p) => ({ payer: p.payerName, charged: p.charged, collected: p.collected, balance: p.balance, _bad: p.balance > 0 })) });
      sections.push({ type: "table", title: isAr ? `كل المستحقات (${r.lines.length})` : `Everyone who owes (${r.lines.length})`, columns: [{ key: "name", label: isAr ? "المريض" : "Patient" }, { key: "phone", label: isAr ? "الهاتف" : "Phone" }, { key: "since", label: isAr ? "من تاريخ" : "Since", kind: "date" }, { key: "days", label: isAr ? "الأيام" : "Days", align: "end", kind: "int" }, { key: "charged", label: isAr ? "المطلوب" : "Charged", align: "end", kind: "money" }, { key: "paid", label: isAr ? "المدفوع" : "Paid", align: "end", kind: "money" }, { key: "balance", label: isAr ? "الباقي" : "Owed", align: "end", kind: "money" }],
        rows: r.lines.map((l) => ({ _patientId: l.patientId, name: l.patientName + (l.whatsappOptOut ? (isAr ? " · اتصل" : " · call only") : ""), phone: l.phone, since: l.oldestUnpaid, days: l.ageDays, charged: l.charged, paid: l.paid, balance: l.balance, _bad: l.ageDays > 90 })),
        total: { name: isAr ? "الإجمالي" : "Total", balance: r.totals.balance } });
      note(isAr ? "الرصيد = كل اللي اتحسب على المريض ناقص كل اللي دفعه — نفس حساب شاشة التحصيل. العمر من أقدم علاج مغطّاش." : "Balance = everything charged minus everything paid — the Collect Dues arithmetic. Age counts from the oldest treatment the payments did not cover.");
      break;
    }
    case "expenses": {
      const lines = expenseLines(ledger);
      const cats = expensesByCategory(lines);
      const t = summarizeLedger(ledger);
      const { months } = trailingMonths(range.end, 12);
      const trend = pnlByMonth(d("ledgerMonths12"), months);
      const share = t.income > 0 ? (t.expenses / t.income) * 100 : null;
      figure(isAr ? "إجمالي المصروفات" : "Total expenses", money(t.expenses));
      figure(isAr ? "من الدخل" : "of income", pct(share, 1), share !== null && share > 60 ? "bad" : "muted");
      figure(isAr ? "مصروفات ثابتة" : "Recurring", money(lines.filter((l) => l.recurring).reduce((s, l) => s + l.amount, 0)), "muted");
      figure(isAr ? "عدد البنود" : "Entries", fmt(lines.length), "muted");
      sections.push({ type: "bars", title: isAr ? "حسب التصنيف" : "By category", rows: cats.map((c, i) => ({ label: `${c.category} · ${c.count}`, value: c.total, text: `${money(c.total)} · ${c.share}%`, mark: i === 0 })) });
      const withYear = months[0].slice(0, 4) !== months[11].slice(0, 4);
      sections.push({ type: "months", title: isAr ? "المصروفات شهر بشهر" : "Expenses, month by month", unit: "money", points: trend.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.expenses })) });
      sections.push({ type: "table", title: isAr ? "كل البنود" : "Every entry", columns: [{ key: "date", label: isAr ? "التاريخ" : "Date", kind: "date" }, { key: "category", label: isAr ? "التصنيف" : "Category" }, { key: "description", label: isAr ? "البيان" : "Description" }, { key: "amount", label: isAr ? "المبلغ" : "Amount", align: "end", kind: "money" }], rows: lines.map((l) => ({ date: l.date, category: l.category, description: (l.description || "—") + (l.recurring ? (isAr ? " · شهري" : " · recurring") : ""), amount: l.amount })), total: { date: isAr ? "الإجمالي" : "Total", amount: t.expenses } });
      break;
    }
    case "incomeSources": {
      const prevRange = previousRange(range);
      const labels = isAr ? INCOME_LABELS_AR : INCOME_LABELS_EN;
      const src = incomeSources(ledger, d("ledgerPrev"), input.allPatients, range, prevRange, labels);
      const top = (g: SourceGroup[]) => (g[0] && g[0].total > 0 ? `${g[0].name} · ${g[0].share}%` : "—");
      const newShare = src.newness.find((g) => g.name === labels.newPatient)?.share ?? 0;
      figures.push({ label: isAr ? "الدخل" : "Income", value: money(src.total), delta: deltaFigure(delta(src.prevTotal, src.total), "up", isAr) });
      figure(isAr ? "من مرضى جدد" : "From new patients", pct(newShare, 0), "muted");
      figure(isAr ? "أكبر علاج" : "Top treatment", top(src.services), "muted");
      figure(isAr ? "أكبر دكتور" : "Top dentist", top(src.dentists), "muted");
      figure(isAr ? "أكبر قناة" : "Top channel", top(src.channels), "muted");
      const moved = (g: SourceGroup) => (g.delta.pct === null ? (isAr ? "جديد" : "new") : `${g.delta.abs > 0 ? "▲" : g.delta.abs < 0 ? "▼" : "•"} ${Math.abs(g.delta.pct)}%`);
      const bars = (title: string, g: SourceGroup[], note?: string) =>
        sections.push({ type: "bars", title, note, rows: g.map((x, i) => ({ label: x.count ? `${x.name} · ${x.count}` : x.name, value: x.total, text: `${money(x.total)} · ${x.share}% · ${moved(x)}`, mark: i === 0 && x.total > 0, warn: x.prev > 0 && x.total === 0 })) });
      bars(isAr ? "حسب العلاج" : "By treatment", src.services);
      bars(isAr ? "حسب الدكتور" : "By dentist", src.dentists, isAr ? "الدفعة اللي من غير دكتور بتاخد دكتور العلاج." : "A payment with no dentist borrows the treatment's.");
      bars(isAr ? "جديد ولا راجع" : "New or returning", src.newness, isAr ? "جديد = الملف اتفتح جوه الفترة." : "New = the file was opened inside the period.");
      bars(isAr ? "حسب القناة" : "By channel", src.channels, isAr ? "من خانة المصدر في ملف المريض." : "From the source on the patient's file.");
      bars(isAr ? "حسب جهة الدفع" : "By payer", src.payers);
      bars(isAr ? "حسب طريقة الدفع" : "By payment method", src.methods);
      const { months } = trailingMonths(range.end, 12);
      const withYear = months[0].slice(0, 4) !== months[11].slice(0, 4);
      sections.push({ type: "months", title: isAr ? "الدخل شهر بشهر" : "Income, month by month", unit: "money", points: totalsByMonth(d("ledgerMonths12"), months).map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.income })) });
      note(isAr ? `الدخل = الفلوس اللي دخلت فعلاً. النسبة المئوية من إجمالي الفترة؛ السهم مقابل ${rangeText(prevRange, true)}. المصدر اللي جاب فلوس المرة اللي فاتت ومجابش المرة دي بيفضل في القائمة بصفر.` : `Income is cash actually received. Shares are of the period's total; arrows are against ${rangeText(prevRange, false)}. A source that paid last time and nothing this time stays on the list at zero.`);
      break;
    }
    case "expenseTrend": {
      const { months } = trailingMonths(range.end, 12);
      const mx = expenseMatrix(d("ledgerMonths12"), months);
      const now = summarizeLedger(ledger);
      const prevRange = previousRange(range);
      const vsPrev = compareExpenseCategories(ledger, d("ledgerPrev"));
      const vsYear = compareExpenseCategories(ledger, d("ledgerLastYear"));
      const thenPrev = summarizeLedger(d("ledgerPrev")).expenses;
      const thenYear = summarizeLedger(d("ledgerLastYear")).expenses;
      const withYear = months[0].slice(0, 4) !== months[11].slice(0, 4);
      figures.push({ label: isAr ? "مصروفات الفترة" : "This period", value: money(now.expenses), delta: deltaFigure(delta(thenPrev, now.expenses), "down", isAr) });
      figures.push({ label: isAr ? "نفس الفترة السنة اللي فاتت" : "Same period last year", value: money(thenYear), delta: deltaFigure(delta(thenYear, now.expenses), "down", isAr) });
      figure(isAr ? "متوسط الشهر" : "Monthly average", money(mx.average), "muted");
      figure(isAr ? "أعلى شهر" : "Heaviest month", mx.peak ? `${monthLabel(mx.peak.month, isAr, true)} · ${money(mx.peak.value)}` : "—", "muted");
      const mover = [...vsPrev].filter((c) => c.then > 0 && c.now > 0).sort((a, b) => Math.abs(b.delta.pct || 0) - Math.abs(a.delta.pct || 0))[0];
      figure(isAr ? "أكبر تغيّر" : "Biggest mover", mover ? `${mover.category} ${mover.delta.abs > 0 ? "▲" : "▼"} ${Math.abs(mover.delta.pct || 0)}%` : "—", mover && mover.delta.abs > 0 ? "bad" : "muted");
      const cols: DocColumn[] = [{ key: "category", label: isAr ? "التصنيف" : "Category" }, ...months.map((m, i) => ({ key: `m${i}`, label: monthLabel(m, isAr, withYear), align: "end" as const, kind: "money" as const })), { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", kind: "money" }, { key: "average", label: isAr ? "المتوسط" : "Average", align: "end", kind: "money" }];
      const monthRow = (vals: number[]) => Object.fromEntries(vals.map((v, i) => [`m${i}`, v]));
      sections.push({ type: "table", title: isAr ? "كل تصنيف، شهر بشهر" : "Every category, month by month", note: isAr ? "المتوسط على الشهور اللي فيها حركة بس." : "The average is over months that had any activity.",
        columns: cols, rows: mx.categories.map((c) => ({ category: c.category, ...monthRow(c.byMonth), total: c.total, average: c.average, _bad: c.before > 0 && (c.delta.pct || 0) >= 25 })),
        total: { category: isAr ? "الإجمالي" : "Total", ...monthRow(mx.totals), total: mx.total, average: mx.average } });
      sections.push({ type: "months", title: isAr ? "المصروفات من الدخل" : "Expenses as a share of income", note: isAr ? "فوق ١٠٠٪ يعني الشهر صرف أكتر ما دخّل." : "Above 100% means the month spent more than it took in.", unit: "pct", points: mx.incomeShare.map((v, i) => ({ label: monthLabel(months[i], isAr, withYear), value: v ?? 0 })) });
      const cmpTable = (title: string, rows: typeof vsPrev, then: number, against: string) =>
        sections.push({ type: "table", title, note: isAr ? `مقابل ${against}، مرتّبة حسب حجم التغيّر.` : `Against ${against}, sorted by the size of the change.`,
          columns: [{ key: "category", label: isAr ? "التصنيف" : "Category" }, { key: "then", label: isAr ? "قبل" : "Before", align: "end", kind: "money" }, { key: "now", label: isAr ? "دلوقتي" : "Now", align: "end", kind: "money" }, { key: "d", label: isAr ? "التغيّر" : "Change", align: "end", kind: "delta" }, { key: "share", label: isAr ? "الحصة" : "Share", align: "end", kind: "pct" }],
          rows: rows.map((c) => ({ category: c.category, then: c.then, now: c.now, d: c.delta.pct, share: c.share, _bad: c.delta.abs > 0 })), total: { category: isAr ? "الإجمالي" : "Total", then, now: now.expenses, d: delta(then, now.expenses).pct } });
      cmpTable(isAr ? "مقابل الفترة اللي قبلها" : "Against the period before", vsPrev, thenPrev, rangeText(prevRange, isAr));
      cmpTable(isAr ? "مقابل نفس الفترة السنة اللي فاتت" : "Against the same period last year", vsYear, thenYear, rangeText(lastYearRange(range), isAr));
      note(isAr ? "المصروفات هي اللي اتسجلت في صفحة المالية. نِسَب الأطباء ومصاريف المعمل ليهم تقاريرهم؛ الأحمر = تصنيف زاد." : "Expenses are what was entered on the Finance page. Commissions and lab fees have their own tabs. Red marks a category that grew.");
      break;
    }
    case "cashflow": {
      const { months } = trailingMonths(range.end, 12);
      const cf = cashflow(d("ledgerMonths12"), months);
      const withYear = months[0].slice(0, 4) !== months[11].slice(0, 4);
      figure(isAr ? "دخل" : "Money in", money(cf.inflow));
      figure(isAr ? "خرج" : "Money out", `(${fmt(cf.outflow)}) ${egp}`, "muted");
      figure(isAr ? "الصافي" : "Net", money(cf.net), cf.net < 0 ? "bad" : "ink");
      figure(isAr ? "متوسط الصافي في الشهر" : "Average net per month", money(cf.averageNet), cf.averageNet < 0 ? "bad" : "muted");
      figure(isAr ? "شهور بالسالب" : "Months in the red", fmt(cf.monthsInRed), cf.monthsInRed > 0 ? "bad" : "muted");
      figure(isAr ? "أحسن شهر" : "Best month", cf.best ? `${monthLabel(cf.best.month, isAr, true)} · ${money(cf.best.net)}` : "—", "muted");
      sections.push({ type: "months", title: isAr ? "الداخل" : "Money in", unit: "money", points: cf.months.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.inflow })) });
      sections.push({ type: "months", title: isAr ? "الخارج" : "Money out", note: isAr ? "مصروفات + معمل + نِسَب." : "Expenses + lab + commissions.", unit: "money", points: cf.months.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.outflow })) });
      sections.push({ type: "table", title: isAr ? "شهر بشهر" : "Month by month",
        columns: [{ key: "month", label: isAr ? "الشهر" : "Month" }, { key: "inflow", label: isAr ? "داخل" : "In", align: "end", kind: "money" }, { key: "expenses", label: isAr ? "مصروفات" : "Expenses", align: "end", kind: "money" }, { key: "lab", label: isAr ? "المعمل" : "Lab", align: "end", kind: "money" }, { key: "commissions", label: isAr ? "النِسَب" : "Commissions", align: "end", kind: "money" }, { key: "outflow", label: isAr ? "خارج" : "Out", align: "end", kind: "money" }, { key: "net", label: isAr ? "الصافي" : "Net", align: "end", kind: "money" }, { key: "running", label: isAr ? "التراكمي" : "Running", align: "end", kind: "money" }],
        rows: cf.months.map((m) => ({ month: monthLongLabel(m.month, isAr), inflow: m.inflow, expenses: m.expenses, lab: m.lab, commissions: m.commissions, outflow: m.outflow, net: m.net, running: m.running, _bad: m.net < 0 })),
        total: { month: isAr ? "الإجمالي" : "Total", inflow: cf.inflow, expenses: cf.months.reduce((s, m) => s + m.expenses, 0), lab: cf.months.reduce((s, m) => s + m.lab, 0), commissions: cf.months.reduce((s, m) => s + m.commissions, 0), outflow: cf.outflow, net: cf.net } });
      note(isAr ? "الداخل = الفلوس اللي اتقبضت. الخارج = المصروفات + مصاريف المعمل + نِسَب الأطباء، بشهر العلاج أو الدفعة مش بشهر ما اتدفعوا. الرصيد التراكمي بيبدأ من أول شهر في الشاشة." : "In is cash received. Out is expenses + lab fees + dentist commissions, counted in the month of the treatment or payment, not the month they were paid out. The running total starts at the first month on screen.");
      break;
    }
    case "discounts": {
      const lines = discountLines(ledger, unassigned);
      const t = summarizeLedger(ledger);
      const total = lines.reduce((s, l) => s + l.discount, 0);
      const listTotal = t.charged + total;
      figure(isAr ? "إجمالي الخصومات" : "Total discounted", money(total), total > 0 ? "bad" : "ink");
      figure(isAr ? "من سعر القائمة" : "of list price", pct(listTotal > 0 ? (total / listTotal) * 100 : null, 1), "muted");
      figure(isAr ? "علاجات فيها خصم" : "Treatments discounted", `${lines.length} / ${t.procedures}`, "muted");
      figure(isAr ? "خصم من غير سبب" : "Without a reason", fmt(lines.filter((l) => !l.reason).length), lines.some((l) => !l.reason) ? "bad" : "muted");
      const g = (name: (l: (typeof lines)[number]) => string, title: string) => sections.push({ type: "bars", title, rows: groupTotals(lines, name, (l) => l.discount).slice(0, 8).map((x, i) => ({ label: `${x.name} · ${x.count}`, value: x.total, text: money(x.total), mark: i === 0 })) });
      g((l) => l.doctor, isAr ? "حسب الدكتور" : "By dentist");
      g((l) => l.service, isAr ? "حسب الخدمة" : "By service");
      g((l) => l.reason || (isAr ? "بدون سبب" : "No reason given"), isAr ? "حسب السبب" : "By reason");
      sections.push({ type: "table", title: isAr ? "كل خصم" : "Every discount", columns: [{ key: "date", label: isAr ? "التاريخ" : "Date", kind: "date" }, { key: "patient", label: isAr ? "المريض" : "Patient" }, { key: "service", label: isAr ? "الخدمة" : "Service" }, { key: "doctor", label: isAr ? "الدكتور" : "Dentist" }, { key: "listPrice", label: isAr ? "السعر" : "List", align: "end", kind: "money" }, { key: "discount", label: isAr ? "الخصم" : "Discount", align: "end", kind: "money" }, { key: "pct", label: "%", align: "end", kind: "pct" }, { key: "reason", label: isAr ? "السبب" : "Reason" }], rows: lines.map((l) => ({ _patientId: l.patientId, date: l.date, patient: l.patientName, service: l.service, doctor: l.doctor, listPrice: l.listPrice, discount: l.discount, pct: l.pct, reason: l.reason || "—", _bad: !l.reason })), total: { date: isAr ? "الإجمالي" : "Total", discount: total } });
      break;
    }
    case "methods": {
      const r = paymentMethods(input.payments);
      const label = (m: string) => (isAr ? ({ Cash: "كاش", Card: "فيزا / كارت", InstaPay: "إنستاباي", Insurance: "تأمين", Other: "أخرى" } as Record<string, string>)[m] || m : m);
      const grand = r.totals.reduce((s, t) => s + t.total, 0);
      const cash = r.totals.find((t) => t.method === "Cash");
      figure(isAr ? "إجمالي المحصّل" : "Total collected", money(grand));
      figure(`${isAr ? "كاش" : "Cash"} · ${cash?.share ?? 0}%`, money(cash?.total || 0), "muted");
      figure(isAr ? "غير كاش" : "Non-cash", money(grand - (cash?.total || 0)), "muted");
      figure(isAr ? "عدد الدفعات" : "Payments", fmt(r.totals.reduce((s, t) => s + t.count, 0)), "muted");
      sections.push({ type: "bars", title: isAr ? "حسب طريقة الدفع" : "By method", rows: r.totals.map((t, i) => ({ label: `${label(t.method)} · ${t.count}`, value: t.total, text: `${money(t.total)} · ${t.share}%`, mark: i === 0 })) });
      const used = r.totals.filter((t) => t.total > 0).map((t) => t.method);
      sections.push({ type: "table", title: isAr ? "يوم بيوم" : "Day by day", columns: [{ key: "date", label: isAr ? "اليوم" : "Day", kind: "date" }, ...used.map((m) => ({ key: m, label: label(m), align: "end" as const, kind: "money" as const })), { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", kind: "money" }], rows: r.byDay.map((day) => ({ date: day.date, ...Object.fromEntries(used.map((m) => [m, day.byMethod[m]])), total: day.total })), total: { date: isAr ? "الإجمالي" : "Total", ...Object.fromEntries(used.map((m) => [m, r.totals.find((t) => t.method === m)?.total || 0])), total: grand } });
      note(isAr ? "«فيزا» و«كارت» طريقة واحدة. الدفعات اللي مكتوب عليهاش طريقة بتتحسب كاش." : "\"Visa\" and \"Card\" are one method. A payment with no method recorded counts as cash.");
      break;
    }
    case "cases": {
      const all = buildCaseSheet(input.procedures, input.payments);
      const totals = sumCases(all);
      figure(isAr ? "حالات" : "Cases", fmt(totals.cases));
      figure(isAr ? "السعر" : "Price", money(totals.price), "muted");
      figure(isAr ? "المدفوع" : "Paid", money(totals.paid));
      figure(isAr ? "الباقي" : "Outstanding", money(totals.outstanding), totals.outstanding > 0 ? "bad" : "muted");
      sections.push({ type: "table", title: isAr ? "سجل الحالات" : "The case sheet", columns: [{ key: "date", label: isAr ? "التاريخ" : "Date", kind: "date" }, { key: "payer", label: isAr ? "الشركة" : "Company" }, { key: "patient", label: isAr ? "المريض" : "Patient" }, { key: "service", label: isAr ? "الخدمة" : "Service" }, { key: "price", label: isAr ? "السعر" : "Price", align: "end", kind: "money" }, { key: "paid", label: isAr ? "المدفوع" : "Paid", align: "end", kind: "money" }, { key: "doctor", label: isAr ? "الدكتور" : "Dentist" }, { key: "share", label: isAr ? "نصيب الدكتور" : "Dentist's share", align: "end", kind: "money" }],
        rows: all.map((c) => ({ _patientId: c.patientId, date: c.date, payer: c.payerName, patient: c.patientName, service: c.service, price: c.price, paid: c.paid, doctor: c.doctorName, share: c.share, _bad: settlementOf(c) !== "paid" })),
        total: { date: `${totals.cases} ${isAr ? "حالة" : "cases"}`, price: totals.price, paid: totals.paid, share: totals.share } });
      note(isAr ? "المدفوع لكل حالة، مش رصيد المريض. الحالة اللي مش مدفوعة بالكامل بتظهر بالأحمر." : "Paid is per case, not the patient's balance. A case not fully paid is shown in red.");
      break;
    }
    case "insurance": {
      // The claim statement the clinic sends each insurer. On the phone: one table per insurer with
      // cases in the range, the same lines and subtotals the website's Excel carries.
      const insurers = input.payers.filter((p) => p.id !== PRIVATE_PAYER_ID && p.active);
      const month = range.start.slice(0, 7);
      let totalAll = 0;
      let casesAll = 0;
      for (const p of insurers) {
        const memberNumbers = new Map<string, string>();
        input.allPatients.forEach((pt) => { const n = readMemberNumbers(pt)[p.id]; if (n) memberNumbers.set(String(pt.id), n); });
        const st = buildInsuranceStatement({ rows: input.procedures as unknown as StatementRowLite[], payerId: p.id, payerName: isAr ? p.nameAr || p.name : p.name, month, range, memberNumbers });
        if (st.cases.length === 0) continue;
        totalAll += st.total;
        casesAll += st.cases.length;
        sections.push({ type: "table", title: st.payerName, note: isAr ? "كل حالة بسطر لكل خدمة، وإجمالي الحالة في آخر سطر." : "One line per service; the case's subtotal on its last line.",
          columns: [{ key: "serial", label: isAr ? "م" : "#", align: "end", kind: "int" }, { key: "name", label: isAr ? "اسم الحالة" : "Case" }, { key: "service", label: isAr ? "بيان الخدمة" : "Service" }, { key: "value", label: isAr ? "القيمة" : "Value", align: "end", kind: "money" }],
          rows: st.cases.flatMap((c) => c.lines.map((l, i) => ({ _patientId: c.patientId, serial: i === 0 ? c.serial : null, name: i === 0 ? caseLabel(c) : "", service: l.text, value: l.amount, _bad: !c.memberNumber && i === 0 }))),
          total: { name: `${st.cases.length} ${isAr ? "حالة" : "cases"}`, value: st.total } });
        if (st.missingMemberNumber.length) note(isAr ? `بدون رقم عضوية: ${st.missingMemberNumber.map((m) => m.patientName).join("، ")}` : `No member number: ${st.missingMemberNumber.map((m) => m.patientName).join(", ")}`);
      }
      figure(isAr ? "شركات التأمين" : "Insurers", fmt(insurers.length));
      figure(isAr ? "الحالات" : "Cases", fmt(casesAll));
      figure(isAr ? "إجمالي المطالبات" : "Claimed", money(totalAll));
      if (insurers.length === 0) note(isAr ? "لا توجد شركة تأمين مضافة. أضفها من الإعدادات ← جهات الدفع." : "No insurer is configured. Add one in Settings → Payers.");
      else if (casesAll === 0) note(isAr ? "لا توجد علاجات مسجلة على أي شركة تأمين في هذه الفترة." : "No treatments were recorded under an insurer in this period.");
      break;
    }
    // --- patients --------------------------------------------------------------------------------------
    case "source": {
      const file = new Map(input.allPatients.map((p) => [p.id, p]));
      const keyOf = (row: ReportLedgerRow) => patientChannel(undefined, row.patientReferral, file.get(String(row.patientId || "")));
      const groups = partitionRows(input.procedures, input.payments, keyOf);
      const index = buildProcedureIndex(input.procedures as AttributableRow[]);
      const stats = [...groups.entries()].map(([name, g]) => {
        const ids = new Set<string>();
        [...g.procedures, ...g.payments].forEach((r) => { if (r.patientId) ids.add(String(r.patientId)); });
        const income = g.payments.reduce((s, p) => s + ledgerCashValue(p), 0);
        const commission = g.payments.reduce((s, p) => s + (Number(p.doctorCommissionAmount) || 0), 0);
        const svc = new Map<string, { name: string; count: number }>();
        g.procedures.forEach((p) => { const a = attributeService(p as AttributableRow, index); const s = svc.get(a.key) || { name: a.name, count: 0 }; s.count += 1; svc.set(a.key, s); });
        return { name, patients: ids.size, income, commission, net: income - commission, services: [...svc.values()].sort((a, b) => b.count - a.count).slice(0, 3) };
      }).sort((a, b) => b.income - a.income);
      const totalIncome = stats.reduce((s, x) => s + x.income, 0);
      figure(isAr ? "المصادر" : "Sources", fmt(stats.length));
      figure(isAr ? "عدد المرضى" : "Patients (active)", fmt(stats.reduce((s, x) => s + x.patients, 0)));
      figure(isAr ? "إجمالي الدخل" : "Total income", money(totalIncome));
      sections.push({ type: "bars", title: isAr ? "الدخل حسب المصدر" : "Income by source", note: isAr ? "اضغط مصدر لعرض مرضاه." : "Tap a source for its patients.", rows: stats.slice(0, 8).map((s, i) => ({ label: s.name, value: s.income, text: money(s.income), mark: i === 0, drill: `source:${s.name}` })) });
      sections.push({ type: "table", title: isAr ? "تفاصيل المصادر" : "Source details", columns: [{ key: "name", label: isAr ? "المصدر" : "Source" }, { key: "patients", label: isAr ? "المرضى" : "Patients", align: "end", kind: "int" }, { key: "income", label: isAr ? "الدخل" : "Income", align: "end", kind: "money" }, { key: "commission", label: isAr ? "العمولة" : "Commission", align: "end", kind: "money" }, { key: "net", label: isAr ? "الصافي" : "Net", align: "end", kind: "money" }, { key: "top", label: isAr ? "أكتر العلاجات" : "Top treatments" }],
        rows: stats.map((s) => ({ _drill: `source:${s.name}`, name: s.name, patients: s.patients, income: s.income, commission: s.commission, net: s.net, top: s.services.map((x) => `${x.name} (${x.count})`).join(", ") || "—" })),
        total: { name: isAr ? "الإجمالي" : "Total", patients: stats.reduce((s, x) => s + x.patients, 0), income: totalIncome, commission: stats.reduce((s, x) => s + x.commission, 0), net: stats.reduce((s, x) => s + x.net, 0) } });
      break;
    }
    case "retention": {
      const later = trailingMonths(range.end, 12).range;
      const earlier = trailingMonths(trailingMonths(range.end, 13).range.start, 12).range;
      const r = retention(d("ledgerAll"), d("appointmentsWide"), patients, earlier, later, input.today);
      figure(isAr ? "نسبة الرجوع" : "Retention", pct(r.retentionPct), r.retentionPct !== null && r.retentionPct < 50 ? "bad" : "ink");
      figure(isAr ? "رجعوا" : "Came back", `${r.retained} / ${r.before}`);
      figure(isAr ? "مرجعوش" : "Did not", fmt(r.lost), r.lost > 0 ? "bad" : "muted");
      figure(isAr ? "جداد في الفترة التانية" : "New in later window", fmt(r.newcomers));
      figure(isAr ? "رجعوا بعد أول زيارة" : "Returned after first visit", pct(r.newReturned.pct), "muted");
      figure(isAr ? "شهور بين الزيارات" : "Months between visits", r.medianGapMonths === null ? "—" : String(r.medianGapMonths), "muted");
      note(isAr ? `الفترة الأولى ${rangeText(earlier, true)}، التانية ${rangeText(later, true)}.` : `Earlier window ${rangeText(earlier, false)}; later window ${rangeText(later, false)}.`);
      const bl = (l: string) => (isAr ? ({ "0-3": "آخر ٣ شهور", "3-6": "٣–٦ شهور", "6-12": "٦–١٢ شهر", "12-24": "سنة–سنتين", "24+": "أكتر من سنتين" } as Record<string, string>)[l] || l : `${l} months`);
      sections.push({ type: "bars", title: isAr ? "آخر زيارة كانت من" : "Last seen", rows: r.lastSeen.map((b, i) => ({ label: bl(b.label), value: b.count, text: String(b.count), mark: i === 0, warn: b.label === "24+" && b.count > 0 })) });
      sections.push({ type: "table", title: isAr ? `مرجعوش (${r.lostPatients.length})` : `Did not come back (${r.lostPatients.length})`, columns: [{ key: "name", label: isAr ? "المريض" : "Patient" }], rows: r.lostPatients.map((n) => ({ name: n })), note: isAr ? "كانوا في الفترة الأولى ومجوش في التانية. أول قائمة للاتصال." : "Active in the earlier window, absent in the later one. The first list to call." });
      break;
    }
    case "recall": {
      const settings = (d("recallSettings")[0] || {}) as { intervalMonths?: number; configured?: boolean };
      const interval = Number(settings.intervalMonths) || 6;
      const r = recallDue(patients, d("ledgerAll"), d("appointmentsWide"), input.today, interval);
      figure(isAr ? "مستحق ومش حاجز" : "Due, not booked", fmt(r.lines.length), r.lines.length > 0 ? "bad" : "ink");
      figure(isAr ? "عندهم موعد قادم" : "Already booked", fmt(r.booked), "muted");
      figure(isAr ? "ماتبعتلهمش تذكير" : "Never messaged", fmt(r.lines.filter((l) => !l.recallSentAt).length), "muted");
      figure(isAr ? "شهر فترة الاستدعاء" : "month recall interval", String(interval), "muted");
      if (!settings.configured) note(isAr ? `مفيش فترة استدعاء مضبوطة، فالتقرير بيفترض ${interval} شهور.` : `No recall interval is set, so this report assumes ${interval} months.`);
      const bl = (b: string) => (isAr ? ({ due: "مستحق (أقل من شهر)", "1-3m": "متأخر ١–٣ شهور", "3-6m": "متأخر ٣–٦ شهور", "6m+": "متأخر أكتر من ٦ شهور" } as Record<string, string>)[b] : ({ due: "Due (under a month)", "1-3m": "1–3 months overdue", "3-6m": "3–6 months overdue", "6m+": "6+ months overdue" } as Record<string, string>)[b]);
      sections.push({ type: "bars", title: isAr ? "حسب التأخير" : "By how overdue", rows: r.buckets.map((b, i) => ({ label: bl(b.bucket), value: b.count, text: String(b.count), mark: i === 0, warn: b.bucket === "6m+" && b.count > 0 })) });
      sections.push({ type: "table", title: isAr ? `قائمة الاستدعاء (${r.lines.length})` : `The recall list (${r.lines.length})`, columns: [{ key: "name", label: isAr ? "المريض" : "Patient" }, { key: "phone", label: isAr ? "الهاتف" : "Phone" }, { key: "last", label: isAr ? "آخر زيارة" : "Last visit", kind: "date" }, { key: "overdue", label: isAr ? "متأخر (يوم)" : "Overdue (days)", align: "end", kind: "int" }, { key: "sent", label: isAr ? "آخر تذكير" : "Last recall", kind: "date" }],
        rows: r.lines.map((l) => ({ _patientId: l.patientId, name: l.name + (l.whatsappOptOut ? (isAr ? " · اتصل" : " · call only") : ""), phone: l.phone, last: l.lastVisit, overdue: l.overdueDays, sent: l.recallSentAt || null, _bad: l.overdueDays > 180 })) });
      break;
    }
    case "ltv": {
      const r = lifetimeValue(d("ledgerAll"), patients, isAr ? "غير معروف / ووك إن" : "Unknown / Walk-in");
      figure(isAr ? "متوسط قيمة المريض" : "Average lifetime value", money(r.average));
      figure(isAr ? "الوسيط" : "Median", money(r.median), "muted");
      figure(isAr ? "مريض ليه حركة مالية" : "Patients with history", fmt(r.lines.length), "muted");
      sections.push({ type: "bars", title: isAr ? "متوسط القيمة حسب المصدر" : "Average value by source", rows: r.bySource.slice(0, 8).map((s, i) => ({ label: `${s.source} · ${s.patients}`, value: s.average, text: money(s.average), mark: i === 0 })) });
      sections.push({ type: "bars", title: isAr ? "توزيع المرضى حسب الإنفاق" : "Patients by lifetime spend", rows: r.distribution.map((x) => ({ label: `${x.label} ${egp}`, value: x.count, text: String(x.count) })) });
      sections.push({ type: "table", title: isAr ? "الأعلى قيمة" : "Highest value", columns: [{ key: "name", label: isAr ? "المريض" : "Patient" }, { key: "phone", label: isAr ? "الهاتف" : "Phone" }, { key: "source", label: isAr ? "المصدر" : "Source" }, { key: "first", label: isAr ? "أول زيارة" : "First visit", kind: "date" }, { key: "visits", label: isAr ? "زيارات" : "Visits", align: "end", kind: "int" }, { key: "perVisit", label: isAr ? "للزيارة" : "Per visit", align: "end", kind: "money" }, { key: "paid", label: isAr ? "إجمالي المدفوع" : "Lifetime paid", align: "end", kind: "money" }], rows: r.lines.slice(0, 100).map((l) => ({ _patientId: l.patientId, name: l.name, phone: l.phone, source: l.source, first: l.firstVisit, visits: l.visits, perVisit: l.perVisit, paid: l.paid })) });
      break;
    }
    case "demographics": {
      const dm = demographics(patients, ledger, range, input.today);
      const bl = (b: string) => (b === "?" ? (isAr ? "غير معروف" : "Unknown") : b);
      const gl = (g: string) => (isAr ? ({ Male: "ذكور", Female: "إناث", "?": "غير محدد" } as Record<string, string>)[g] || g : g === "?" ? "Unknown" : g);
      const known = dm.bands.filter((b) => b.band !== "?");
      const biggest = known.reduce((a, b) => (b.count > a.count ? b : a), known[0]);
      figure(isAr ? "إجمالي المرضى" : "Patients on file", fmt(dm.total));
      figure(isAr ? "متوسط العمر" : "Average age", dm.averageAge === null ? "—" : String(dm.averageAge), "muted");
      figure(isAr ? "أكبر شريحة" : "Largest band", biggest ? bl(biggest.band) : "—");
      figure(isAr ? "من غير تاريخ ميلاد" : "without a birthday", `${dm.total ? Math.round(((dm.total - dm.known) / dm.total) * 100) : 0}%`, "muted");
      sections.push({ type: "bars", title: isAr ? "حسب العمر" : "By age", note: isAr ? `${dm.newInPeriod} ملف جديد في الفترة.` : `${dm.newInPeriod} new files in this period.`, rows: dm.bands.map((b) => ({ label: bl(b.band), value: b.count, text: `${b.count}${b.newCount ? ` · +${b.newCount}` : ""}`, mark: biggest ? b.band === biggest.band : false })) });
      sections.push({ type: "bars", title: isAr ? "حسب النوع" : "By gender", rows: dm.gender.map((g, i) => ({ label: gl(g.gender), value: g.count, text: `${g.count} · ${money(g.paid)}`, mark: i === 0 })) });
      sections.push({ type: "table", title: isAr ? "كل شريحة، وبتيجي ليه" : "Each band, and what it comes in for", columns: [{ key: "band", label: isAr ? "العمر" : "Age" }, { key: "count", label: isAr ? "المرضى" : "Patients", align: "end", kind: "int" }, { key: "newCount", label: isAr ? "جديد" : "New", align: "end", kind: "int" }, { key: "paid", label: isAr ? "دفعوا" : "Paid", align: "end", kind: "money" }, { key: "top", label: isAr ? "أكتر العلاجات" : "Top treatments" }], rows: dm.bands.map((b) => ({ band: bl(b.band), count: b.count, newCount: b.newCount, paid: b.paid, top: b.topServices.map((s) => `${s.name} (${s.count})`).join(", ") || "—" })) });
      break;
    }
    case "plans": {
      const { months } = trailingMonths(range.end, 12);
      const r = planStats(d("treatmentPlans"), d("ledgerAll"), months, unassigned);
      const sl = (s: PlanStatus) => (isAr ? ({ draft: "مسودة", presented: "معروضة", accepted: "مقبولة", declined: "مرفوضة" } as Record<string, string>)[s] : ({ draft: "Draft", presented: "Presented", accepted: "Accepted", declined: "Declined" } as Record<string, string>)[s]);
      figure(isAr ? "خطط" : "Plans", fmt(r.total), "muted");
      figure(isAr ? "نسبة القبول" : "Acceptance", pct(r.acceptancePct), r.acceptancePct !== null && r.acceptancePct < 40 ? "bad" : "ink");
      figure(isAr ? "قيمة المقبول" : "Accepted value", money(r.acceptedValue));
      figure(`${isAr ? "اتعمل منه" : "Treated so far"} · ${pct(r.realizedPct)}`, money(r.realizedValue));
      figure(isAr ? "لسه في الخطط" : "Still in the plans", money(r.remainingValue), r.remainingValue > 0 ? "bad" : "muted");
      sections.push({ type: "bars", title: isAr ? "حسب الحالة" : "By status", rows: r.byStatus.map((s) => ({ label: `${sl(s.status)} · ${s.count}`, value: s.value, text: money(s.value), mark: s.status === "accepted" })) });
      sections.push({ type: "table", title: isAr ? "حسب الدكتور" : "By dentist", columns: [{ key: "doctor", label: isAr ? "الدكتور" : "Dentist" }, { key: "plans", label: isAr ? "خطط" : "Plans", align: "end", kind: "int" }, { key: "accepted", label: isAr ? "مقبولة" : "Accepted", align: "end", kind: "int" }, { key: "acc", label: isAr ? "القبول" : "Acceptance", align: "end", kind: "pct" }, { key: "value", label: isAr ? "قيمة المقبول" : "Accepted value", align: "end", kind: "money" }, { key: "realized", label: isAr ? "اتعمل" : "Treated", align: "end", kind: "money" }], rows: r.byDoctor.map((x) => ({ doctor: x.doctor, plans: x.plans, accepted: x.accepted, acc: x.acceptancePct, value: x.value, realized: x.realized })) });
      sections.push({ type: "table", title: isAr ? "الخطط المقبولة، الأكتر فلوس باقية أولاً" : "Accepted plans, most money remaining first", columns: [{ key: "date", label: isAr ? "التاريخ" : "Date", kind: "date" }, { key: "patient", label: isAr ? "المريض" : "Patient" }, { key: "title", label: isAr ? "الخطة" : "Plan" }, { key: "status", label: isAr ? "الحالة" : "Status" }, { key: "total", label: isAr ? "القيمة" : "Value", align: "end", kind: "money" }, { key: "realized", label: isAr ? "اتعمل" : "Treated", align: "end", kind: "money" }, { key: "remaining", label: isAr ? "الباقي" : "Remaining", align: "end", kind: "money" }], rows: r.lines.slice(0, 100).map((l) => ({ _patientId: l.patientId, date: l.created, patient: l.patientName, title: l.title || "—", status: sl(l.status), total: l.total, realized: l.status === "accepted" ? l.realized : null, remaining: l.status === "accepted" ? l.remaining : null, _bad: l.remaining > 0 })) });
      note(isAr ? "«اتعمل» = علاجات لنفس المريض ولنفس الخدمات بعد تاريخ الخطة — الخطط والعلاجات مش مربوطين مباشرة." : "\"Treated\" means treatments for the same patient and service after the plan's date — plans and treatments are not linked directly.");
      break;
    }
    // --- operations ------------------------------------------------------------------------------------
    case "appointments": {
      const s = appointmentStats(d("appointments"), input.today, unassigned);
      const days = isAr ? WEEKDAYS_AR : WEEKDAYS_EN;
      const src = (x: string) => (isAr ? ({ desk: "الاستقبال", online: "حجز أونلاين", whatsapp_bot: "مساعد واتساب" } as Record<string, string>)[x] || x : ({ desk: "Front desk", online: "Online booking", whatsapp_bot: "WhatsApp assistant" } as Record<string, string>)[x] || x);
      figure(isAr ? "مواعيد" : "Bookings", fmt(s.overall.total));
      figure(isAr ? "حضروا" : "Seen", fmt(s.overall.seen));
      figure(`${isAr ? "نسبة الغياب" : "No-show rate"} · ${s.overall.noShow}`, pct(s.overall.noShowPct), s.overall.noShowPct !== null && s.overall.noShowPct >= 20 ? "bad" : "ink");
      figure(isAr ? "ملغي" : "Cancelled", fmt(s.overall.cancelled), "muted");
      figure(isAr ? "ساعات كراسي / يوم" : "Chair hours / day", s.minutesPerDay === null ? "—" : `${(s.minutesPerDay / 60).toFixed(1)}h`, "muted");
      figure(isAr ? "انتظار قبل الكرسي" : "Wait before the chair", s.waitMinutes === null ? "—" : `${Math.round(s.waitMinutes)}m`, s.waitMinutes !== null && s.waitMinutes > 20 ? "bad" : "muted");
      if (s.unclosed > 0) note(isAr ? `${s.unclosed} موعد فات تاريخه ومحدش قفله — محسوب غياب هنا.` : `${s.unclosed} past bookings were never closed and count as no-shows here.`);
      sections.push({ type: "heat", title: isAr ? "أنهي يوم وأنهي ساعة" : "Which day, which hour", unit: "count", cells: s.heat.filter((c) => c.hour >= 0) });
      sections.push({ type: "table", title: isAr ? "حسب اليوم" : "By weekday", columns: [{ key: "day", label: isAr ? "اليوم" : "Day" }, ...outcomeColumns(isAr)], rows: s.byWeekday.map((r) => ({ day: days[r.weekday], ...outcomeRow(r) })) });
      sections.push({ type: "table", title: isAr ? "حسب الدكتور" : "By dentist", columns: [{ key: "doctor", label: isAr ? "الدكتور" : "Dentist" }, ...outcomeColumns(isAr)], rows: s.byDentist.map((r) => ({ doctor: r.doctor, ...outcomeRow(r) })) });
      sections.push({ type: "table", title: isAr ? "حسب المصدر" : "By source", columns: [{ key: "source", label: isAr ? "المصدر" : "Source" }, ...outcomeColumns(isAr)], rows: s.bySource.map((r) => ({ source: src(r.source), ...outcomeRow(r) })) });
      note(isAr ? "«حضروا» = تسجيل وصول أو بالكرسي أو مكتمل. نسبة الغياب = الغياب ÷ (الحضور + الغياب)." : "\"Seen\" is checked in, in chair or completed. No-show rate = misses ÷ (seen + missed).");
      break;
    }
    case "lab": {
      const s = labStats(d("labCases"), d("labPayments"), input.today);
      const lang = isAr ? "ar" : "en";
      figure(isAr ? "حالات" : "Cases", fmt(s.total));
      figure(isAr ? "في المعمل دلوقتي" : "At the lab now", fmt(s.atLab), "muted");
      figure(isAr ? "متأخرة" : "Overdue", fmt(s.overdue), s.overdue > 0 ? "bad" : "muted");
      figure(isAr ? "يوم متوسط التنفيذ" : "days average turnaround", s.turnaroundDays === null ? "—" : String(s.turnaroundDays), "muted");
      figure(`${isAr ? "إعادة" : "Remakes"} · ${s.remakes}`, pct(s.remakePct), s.remakePct !== null && s.remakePct >= 10 ? "bad" : "muted");
      figure(isAr ? "تكلفة المعمل" : "Lab cost", money(s.cost));
      sections.push({ type: "bars", title: isAr ? "حسب الحالة" : "By status", rows: s.byStatus.map((b, i) => ({ label: statusLabel(b.status, lang), value: b.count, text: String(b.count), mark: i === 0 })) });
      sections.push({ type: "bars", title: isAr ? "حسب نوع الشغل" : "By work type", rows: s.byWorkType.slice(0, 8).map((w, i) => ({ label: `${workTypeLabel(w.workType, lang)} · ${w.count}`, value: w.cost, text: money(w.cost), mark: i === 0 })) });
      sections.push({ type: "table", title: isAr ? "معمل بمعمل" : "Lab by lab", columns: [{ key: "lab", label: isAr ? "المعمل" : "Lab" }, { key: "sent", label: isAr ? "اتبعت" : "Sent", align: "end", kind: "int" }, { key: "back", label: isAr ? "رجع" : "Back", align: "end", kind: "int" }, { key: "overdue", label: isAr ? "متأخر" : "Overdue", align: "end", kind: "int" }, { key: "turnaround", label: isAr ? "أيام" : "Days", align: "end", kind: "int" }, { key: "remakes", label: isAr ? "إعادة" : "Remakes", align: "end", kind: "int" }, { key: "cost", label: isAr ? "التكلفة" : "Cost", align: "end", kind: "money" }, { key: "paid", label: isAr ? "المدفوع" : "Paid", align: "end", kind: "money" }], rows: s.byLab.map((l) => ({ lab: l.labName, sent: l.sent, back: l.back, overdue: l.overdue, turnaround: l.turnaroundDays, remakes: l.remakes, cost: l.cost, paid: l.paid, _bad: l.overdue > 0 })), total: { lab: isAr ? "الإجمالي" : "Total", cost: s.cost } });
      sections.push({ type: "table", title: isAr ? `متأخر دلوقتي (${s.overdueCases.length})` : `Overdue right now (${s.overdueCases.length})`, columns: [{ key: "code", label: isAr ? "الكود" : "Code" }, { key: "lab", label: isAr ? "المعمل" : "Lab" }, { key: "patient", label: isAr ? "المريض" : "Patient" }, { key: "work", label: isAr ? "الشغل" : "Work" }, { key: "due", label: isAr ? "كان المفروض" : "Was due", kind: "date" }, { key: "late", label: isAr ? "متأخر (يوم)" : "Days late", align: "end", kind: "int" }], rows: s.overdueCases.map((c) => ({ code: c.code, lab: c.labName, patient: c.patientName, work: workTypeLabel(c.workType, lang), due: c.dueDate, late: c.daysLate, _bad: true })) });
      break;
    }
    case "attendance": {
      if (!input.payroll) { note(isAr ? "المرتبات للي بيديروا الحضور بس." : "Payroll is limited to staff who administer attendance."); break; }
      const comm = new Map<string, number>();
      const staff = d("staff");
      const byName = new Map(staff.map((s) => [String(s.name || "").trim().toLowerCase(), s.id]));
      input.payments.forEach((p) => { if (p.type !== "payment") return; const id = String(p.doctorId || "") || byName.get(String(p.doctorName || p.doctor || "").trim().toLowerCase()) || ""; if (id) comm.set(id, (comm.get(id) || 0) + (Number(p.doctorCommissionAmount) || 0)); });
      const lines = staffLines(input.payroll, comm);
      const hours = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
      const totals = lines.reduce((t, l) => ({ pay: t.pay + l.estimatedPay, commission: t.commission + l.commission, hours: t.hours + l.hours, late: t.late + l.lateDays, absent: t.absent + l.absentDays }), { pay: 0, commission: 0, hours: 0, late: 0, absent: 0 });
      figure(isAr ? "أفراد" : "People", fmt(lines.length), "muted");
      figure(isAr ? "ساعات شغل" : "Hours worked", `${Math.round(totals.hours)}h`);
      figure(isAr ? "أيام تأخير" : "Late days", fmt(totals.late), totals.late > 0 ? "bad" : "muted");
      figure(isAr ? "أيام غياب" : "Absent days", fmt(totals.absent), totals.absent > 0 ? "bad" : "muted");
      figure(isAr ? "مرتبات تقديرية" : "Estimated wages", money(totals.pay));
      figure(isAr ? "نِسَب الأطباء" : "Commission earned", money(totals.commission));
      sections.push({ type: "bars", title: isAr ? "الساعات" : "Hours", rows: lines.map((l, i) => ({ label: l.name, value: l.hours, text: hours(l.minutesWorked), mark: i === 0 })) });
      sections.push({ type: "table", title: isAr ? "الفريق" : "The team", columns: [{ key: "name", label: isAr ? "الاسم" : "Name" }, { key: "days", label: isAr ? "أيام" : "Days", align: "end", kind: "int" }, { key: "hours", label: isAr ? "ساعات" : "Hours" }, { key: "late", label: isAr ? "تأخير" : "Late" }, { key: "absent", label: isAr ? "غياب" : "Absent", align: "end", kind: "int" }, { key: "overtime", label: isAr ? "إضافي" : "Overtime" }, { key: "pay", label: isAr ? "المرتب" : "Wages", align: "end", kind: "money" }, { key: "commission", label: isAr ? "النسبة" : "Commission", align: "end", kind: "money" }, { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", kind: "money" }],
        rows: lines.map((l) => ({ name: `${l.name} · ${l.role}${l.hasSchedule ? "" : isAr ? " · بدون روستر" : " · no roster"}`, days: l.daysWorked, hours: hours(l.minutesWorked), late: l.lateDays ? `${l.lateDays} · ${hours(l.lateMinutes)}` : "—", absent: l.absentDays, overtime: l.overtimeApprovedMinutes ? hours(l.overtimeApprovedMinutes) : "—", pay: l.estimatedPay, commission: l.commission, total: l.total, _bad: l.absentDays > 0 })),
        total: { name: isAr ? "الإجمالي" : "Total", pay: totals.pay, commission: totals.commission, total: totals.pay + totals.commission } });
      note(isAr ? "المرتب = الساعات × سعر الساعة من المرتب الأساسي والروستر، زائد الإضافي المعتمد. تقديري لحد ما يعتمد." : "Wages = hours × the hourly rate from base salary and roster, plus approved overtime. Estimates until approved.");
      break;
    }
    case "inventory": {
      const s = inventoryStats(d("inventory"), d("inventoryTx"));
      const income = summarizeLedger(ledger).income;
      figure(isAr ? "قيمة المخزون" : "Stock value", money(s.stockValue));
      figure(`${isAr ? "استهلاك الفترة" : "Used this period"}${income > 0 ? ` · ${((s.usedCost / income) * 100).toFixed(1)}%` : ""}`, money(s.usedCost));
      figure(isAr ? "تحت الحد" : "Below threshold", fmt(s.belowMin), s.belowMin > 0 ? "bad" : "muted");
      figure(isAr ? "صنف" : "Items", fmt(s.items), "muted");
      sections.push({ type: "bars", title: isAr ? "أكتر الأصناف استهلاكاً" : "Most used, by cost", rows: s.lines.filter((l) => l.usedCost > 0).slice(0, 8).map((l, i) => ({ label: `${l.name} · ${l.used} ${l.unit}`, value: l.usedCost, text: money(l.usedCost), mark: i === 0 })) });
      sections.push({ type: "table", title: isAr ? `قائمة الطلب (${s.reorder.length})` : `Reorder list (${s.reorder.length})`, columns: [{ key: "name", label: isAr ? "الصنف" : "Item" }, { key: "stock", label: isAr ? "المتاح" : "In stock" }, { key: "min", label: isAr ? "الحد" : "Threshold", align: "end", kind: "int" }, { key: "order", label: isAr ? "اطلب" : "Order", align: "end", kind: "int" }, { key: "cost", label: isAr ? "تكلفة الطلب" : "Order cost", align: "end", kind: "money" }], rows: s.reorder.map((l) => ({ name: l.name, stock: `${l.stock} ${l.unit}`, min: l.minStock, order: l.reorderQty, cost: l.reorderQty * l.costPerUnit, _bad: true })) });
      sections.push({ type: "table", title: isAr ? "كل الأصناف" : "Every item", columns: [{ key: "name", label: isAr ? "الصنف" : "Item" }, { key: "category", label: isAr ? "التصنيف" : "Category" }, { key: "stock", label: isAr ? "المتاح" : "In stock" }, { key: "value", label: isAr ? "القيمة" : "Value", align: "end", kind: "money" }, { key: "used", label: isAr ? "استُهلك" : "Used", align: "end", kind: "int" }, { key: "usedCost", label: isAr ? "تكلفة الاستهلاك" : "Used cost", align: "end", kind: "money" }], rows: s.lines.map((l) => ({ name: l.name, category: l.category, stock: `${l.stock} ${l.unit}`, value: l.value, used: l.used, usedCost: l.usedCost, _bad: l.below })), total: { name: isAr ? "الإجمالي" : "Total", value: s.stockValue, usedCost: s.usedCost } });
      break;
    }
    // --- marketing --------------------------------------------------------------------------------------
    case "leads": {
      type LeadRow = Row & { stage?: string; patientId?: string; isReturningPatient?: boolean; meta?: { campaignName?: string | null } | null; source?: string; name?: string; phone?: string; interest?: string; normDate?: string };
      const leads = input.leads as LeadRow[];
      const paid = new Map<string, number>();
      input.payments.forEach((p) => { if (p.type === "expense") return; const pid = String(p.patientId || ""); if (pid) paid.set(pid, (paid.get(pid) || 0) + ledgerCashValue(p)); });
      const bySource = new Map<string, LeadRow[]>();
      leads.forEach((l) => { const s = String(l.source || "").trim() || (isAr ? "غير محدد" : "Unspecified"); bySource.set(s, [...(bySource.get(s) || []), l]); });
      const summarize = (rows: LeadRow[], name: string) => {
        const won = rows.filter((l) => l.stage === "won").length, lost = rows.filter((l) => l.stage === "lost").length;
        const newP = new Set<string>(); const retP = new Set<string>();
        rows.forEach((l) => { if (l.stage === "won" && l.patientId) (l.isReturningPatient ? retP : newP).add(String(l.patientId)); });
        let revenue = 0; newP.forEach((p) => (revenue += paid.get(p) || 0));
        let returning = 0; retP.forEach((p) => { if (!newP.has(p)) returning += paid.get(p) || 0; });
        return { name, total: rows.length, open: rows.length - won - lost, lost, won, conversion: rows.length ? Math.round((won / rows.length) * 100) : 0, revenue, returning };
      };
      const stats = [...bySource.entries()].map(([name, rows]) => summarize(rows, name)).sort((a, b) => b.total - a.total);
      const totals = summarize(leads, "");
      figure(isAr ? "عملاء محتملين" : "Leads", fmt(totals.total));
      figure(isAr ? "وصلوا للكرسي" : "In the chair", fmt(totals.won));
      figure(isAr ? "نسبة التحويل" : "Conversion", `${totals.conversion}%`);
      figure(isAr ? "الدخل" : "Revenue", money(totals.revenue));
      sections.push({ type: "table", title: isAr ? "القنوات" : "Channels", note: isAr ? "اضغط قناة لعرض عملائها." : "Tap a channel for its leads.", columns: [{ key: "name", label: isAr ? "المصدر" : "Channel" }, { key: "total", label: isAr ? "عملاء" : "Leads", align: "end", kind: "int" }, { key: "open", label: isAr ? "قيد المتابعة" : "In progress", align: "end", kind: "int" }, { key: "lost", label: isAr ? "مفقود" : "Lost", align: "end", kind: "int" }, { key: "won", label: isAr ? "وصلوا للكرسي" : "In the chair", align: "end", kind: "int" }, { key: "conversion", label: isAr ? "التحويل" : "Conversion", align: "end", kind: "pct" }, { key: "revenue", label: isAr ? "الدخل" : "Revenue", align: "end", kind: "money" }],
        rows: stats.map((s) => ({ _drill: `leads:${s.name}`, name: s.name, total: s.total, open: s.open, lost: s.lost, won: s.won, conversion: s.conversion, revenue: s.revenue })),
        total: { name: isAr ? "الإجمالي" : "Total", total: totals.total, open: totals.open, lost: totals.lost, won: totals.won, conversion: totals.conversion, revenue: totals.revenue } });
      note(isAr ? `الدخل = المدفوعات خلال الفترة من المرضى اللي وصلوا لمرحلة «${leadStageLabel("won", "ar")}». فلوس المرضى القدامى محسوبة لوحدها.` : `Revenue = payments in this period from patients whose lead reached "${leadStageLabel("won", "en")}". Returning-patient money is counted separately.`);
      break;
    }
    case "whatsapp": {
      const s = whatsappStats(d("conversations"), d("appointments"), d("whatsappLogs"), d("smsOutbox"), patients, range);
      const ol = (o: string) => (isAr ? ({ booked: "حجز", handoff: "اتحوّل لشخص", quiet: "سكت", other: "أخرى" } as Record<string, string>)[o] || o : ({ booked: "Booked", handoff: "Handed to a person", quiet: "Went quiet", other: "Other" } as Record<string, string>)[o] || o);
      figure(isAr ? "محادثات" : "Conversations", fmt(s.conversations));
      figure(isAr ? "المساعد خلّصها لوحده" : "Handled by the assistant", pct(s.botAlonePct));
      figure(isAr ? "حجوزات من المساعد" : "Bookings by the assistant", fmt(s.bookingsByBot));
      figure(`${isAr ? "اتحوّلت لشخص" : "Handoffs"}${s.handoffs.open ? ` · ${s.handoffs.open} ${isAr ? "مفتوحة" : "open"}` : ""}`, fmt(s.handoffs.total), s.handoffs.open > 0 ? "bad" : "muted");
      figure(isAr ? "وسيط رد الموظف" : "Median staff response", s.handoffs.medianMinutes === null ? "—" : `${s.handoffs.medianMinutes}m`, s.handoffs.medianMinutes !== null && s.handoffs.medianMinutes > 60 ? "bad" : "muted");
      figure(isAr ? "طلبوا إيقاف الرسائل" : "Opted out", `${s.optOuts.inPeriod} · ${s.optOuts.total} ${isAr ? "إجمالي" : "total"}`, s.optOuts.inPeriod > 0 ? "bad" : "muted");
      sections.push({ type: "bars", title: isAr ? "المحادثات انتهت بإيه" : "How conversations ended", rows: s.outcomes.map((o) => ({ label: ol(o.outcome), value: o.count, text: String(o.count), mark: o.outcome === "booked" })) });
      sections.push({ type: "bars", title: isAr ? "ليه اتحوّلت" : "Why they were handed over", rows: s.handoffs.byReason.map((r, i) => ({ label: r.reason, value: r.count, text: String(r.count), mark: i === 0 })) });
      sections.push({ type: "table", title: isAr ? "رسائل واتساب التلقائية" : "Automated WhatsApp sends", columns: [{ key: "type", label: isAr ? "النوع" : "Type" }, { key: "sent", label: isAr ? "اتبعت" : "Sent", align: "end", kind: "int" }, { key: "queued", label: isAr ? "في الانتظار" : "Queued", align: "end", kind: "int" }, { key: "failed", label: isAr ? "فشل" : "Failed", align: "end", kind: "int" }], rows: s.sends.map((r) => ({ type: r.type.replace(/^appointment_/, "").replace(/_/g, " "), sent: r.sent, queued: r.queued, failed: r.failed, _bad: r.failed > 0 })) });
      if (s.sms.length) sections.push({ type: "table", title: "SMS", columns: [{ key: "type", label: isAr ? "النوع" : "Type" }, { key: "sent", label: isAr ? "اتبعت" : "Sent", align: "end", kind: "int" }, { key: "failed", label: isAr ? "فشل" : "Failed", align: "end", kind: "int" }], rows: s.sms.map((r) => ({ type: r.type, sent: r.sent, failed: r.failed, _bad: r.failed > 0 })) });
      note(isAr ? `المساعد عدّل ${s.reschedulesByBot} موعد وألغى ${s.cancellationsByBot}. زمن الرد من لحظة ما المساعد رفع إيده لأول رسالة من موظف.` : `The assistant moved ${s.reschedulesByBot} appointments and cancelled ${s.cancellationsByBot}. Response time runs from the assistant raising a hand to the first message a person typed.`);
      break;
    }
    case "ads": {
      const s = adStats(d("conversations"), d("appointments"), [...input.procedures, ...input.payments], range, input.leads);
      figure(isAr ? "محادثات من إعلانات" : "Chats from ads", fmt(s.totals.chats));
      figure(isAr ? "كتبوا رسالة" : "Wrote a message", fmt(s.totals.typed), "muted");
      figure(isAr ? "حجزوا" : "Booked", fmt(s.totals.booked));
      figure(isAr ? "حضروا" : "Attended", fmt(s.totals.attended), "muted");
      figure(isAr ? "محادثة ← حجز" : "Chat → booking", pct(s.totals.conversionPct), s.totals.conversionPct !== null && s.totals.conversionPct < 10 ? "bad" : "muted");
      figure(isAr ? "دفعوا" : "Paid", fmt(s.totals.revenue));
      sections.push({ type: "bars", title: isAr ? "الحجوزات لكل إعلان" : "Bookings per ad", rows: s.rows.slice(0, 8).map((r, i) => ({ label: r.label, value: r.booked, text: String(r.booked), mark: i === 0 })) });
      sections.push({ type: "bars", title: isAr ? "الإعلانات مقابل باقي واتساب" : "Ads versus the rest of WhatsApp", rows: [{ label: isAr ? "من إعلانات" : "From ads", value: s.totals.chats, text: String(s.totals.chats), mark: true }, { label: isAr ? "من غير إعلان" : "Not from an ad", value: s.organicChats, text: String(s.organicChats), mark: false }] });
      sections.push({
        type: "table",
        title: isAr ? "كل إعلان" : "Every ad",
        columns: [
          { key: "label", label: isAr ? "الإعلان" : "Ad" },
          { key: "chats", label: isAr ? "محادثات" : "Chats", align: "end", kind: "int" },
          { key: "typed", label: isAr ? "كتبوا" : "Typed", align: "end", kind: "int" },
          { key: "hot", label: isAr ? "ساخن" : "Hot", align: "end", kind: "int" },
          { key: "booked", label: isAr ? "حجزوا" : "Booked", align: "end", kind: "int" },
          { key: "attended", label: isAr ? "حضروا" : "Attended", align: "end", kind: "int" },
          { key: "revenue", label: isAr ? "دفعوا" : "Paid", align: "end", kind: "money" },
        ],
        rows: s.rows.map((r) => ({ label: r.label, chats: r.chats, typed: r.typed, hot: r.hot, booked: r.booked, attended: r.attended, revenue: r.revenue })),
        total: { label: isAr ? "الإجمالي" : "Total", chats: s.totals.chats, typed: s.totals.typed, hot: s.totals.hot, booked: s.totals.booked, attended: s.totals.attended, revenue: s.totals.revenue },
      });
      note(isAr ? "تكلفة الحجز = اللي دفعته لميتا ÷ «حجزوا». «كتبوا» أقل من «محادثات» لأن ناس بتفتح الشات من الإعلان من غير ما تكتب." : "Cost per booking = what you paid Meta ÷ Booked. Typed is lower than Chats because people open the chat from an ad without writing.");
      break;
    }
  }

  return { id: meta.id, title: isAr ? meta.ar : meta.en, hint: isAr ? meta.hintAr : meta.hintEn, range: { ...range, label: meta.allTime ? (isAr ? "كل الفترة" : "All time") : rangeLabel }, allTime: Boolean(meta.allTime), figures, sections };
}

/** Every day in a range, for the day-by-day chart. */
function trailingDays(range: DateRange): string[] {
  const out: string[] = [];
  const d = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * The people behind one figure — what a tap on a row or a bar opens.
 *
 * The key names the report's own grouping (`service:<key>`, `dentist:<name>`, `source:<channel>`,
 * `payer:<id>`, `new` / `returning`, `leads:<channel>`), so the drawer lists exactly the rows the
 * figure counted.
 */
export function buildDrillDoc(id: string, key: string, input: ReportInputs): DocSection {
  const isAr = input.lang === "ar";
  const patientMap = patientMapOf(input.allPatients);
  const unknownName = isAr ? "بدون اسم" : "Unknown";
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  const roll = (procedures: ReportLedgerRow[], payments: ReportLedgerRow[]) => rollupPatients(procedures, payments, patientMap, { unknownName });
  const title = (name: string) => (isAr ? `المرضى: ${name}` : `Patients: ${name}`);

  if (kind === "service") {
    const index = buildProcedureIndex(input.procedures as AttributableRow[]);
    const g = partitionRows(input.procedures, input.payments, (row) => attributeService(row as AttributableRow, index).key).get(value);
    const name = g ? attributeService((g.procedures[0] || g.payments[0]) as AttributableRow, index).name : value;
    return patientTable(title(name), g ? roll(g.procedures, g.payments) : [], isAr);
  }
  if (kind === "dentist") {
    const g = partitionRows(input.procedures, input.payments, (row) => doctorLabel(row, isAr ? "غير محدد" : "Unassigned")).get(value);
    return patientTable(title(`Dr. ${value}`), g ? roll(g.procedures, g.payments) : [], isAr);
  }
  if (kind === "source") {
    const file = new Map(input.allPatients.map((p) => [p.id, p]));
    const g = partitionRows(input.procedures, input.payments, (row) => patientChannel(undefined, row.patientReferral, file.get(String(row.patientId || "")))).get(value);
    return patientTable(title(value), g ? roll(g.procedures, g.payments) : [], isAr);
  }
  if (kind === "payer") {
    const g = partitionRows(input.procedures, input.payments, (row) => (typeof row.payerId === "string" && row.payerId.trim() ? row.payerId.trim() : PRIVATE_PAYER_ID)).get(value);
    return patientTable(title(input.payers.find((p) => p.id === value)?.name || (value === PRIVATE_PAYER_ID ? (isAr ? "خاص" : "Private") : value)), g ? roll(g.procedures, g.payments) : [], isAr);
  }
  if (kind === "new" || kind === "returning") {
    const created = new Map(input.allPatients.map((p) => [p.id, toYmd(p.createdAt)]));
    const isNew = (pid: string) => { const c = created.get(pid) || ""; return c >= input.range.start && c <= input.range.end; };
    const want = (row: Row) => { const pid = String(row.patientId || ""); return pid && (kind === "new" ? isNew(pid) : !isNew(pid)); };
    return patientTable(title(kind === "new" ? (isAr ? "مرضى جدد" : "New patients") : isAr ? "مرضى حاليون" : "Returning patients"), roll(input.procedures.filter(want), input.payments.filter(want)), isAr);
  }
  if (kind === "leads") {
    const rows = input.leads.filter((l) => (String(l.source || "").trim() || (isAr ? "غير محدد" : "Unspecified")) === value);
    return {
      type: "table",
      title: isAr ? `العملاء من ${value} (${rows.length})` : `Leads from ${value} (${rows.length})`,
      columns: [{ key: "name", label: isAr ? "العميل" : "Lead" }, { key: "phone", label: isAr ? "الهاتف" : "Phone" }, { key: "date", label: isAr ? "التاريخ" : "Date", kind: "date" }, { key: "interest", label: isAr ? "طلب" : "Asked for" }, { key: "stage", label: isAr ? "المرحلة" : "Stage" }],
      rows: rows.map((l) => ({ _patientId: l.patientId ? String(l.patientId) : undefined, name: String(l.name || (isAr ? "بدون اسم" : "Unnamed")), phone: String(l.phone || ""), date: String(l.normDate || toYmd(l.createdAt)), interest: String(l.interest || "—"), stage: leadStageLabel(String(l.stage || "new"), isAr ? "ar" : "en"), _bad: l.stage === "lost" })),
    };
  }
  return { type: "note", text: isAr ? "مفيش تفاصيل للسطر ده." : "Nothing to open for this line." };
}

/** Nothing to draw — said in words, for the phone to show instead of a blank. */
export function isEmptyDoc(doc: ReportDoc): boolean {
  return doc.sections.every((s) => (s.type === "bars" ? s.rows.length === 0 : s.type === "table" ? s.rows.length === 0 : s.type === "months" ? s.points.every((p) => p.value === 0) : s.type === "heat" ? s.cells.length === 0 : s.type === "note"));
}

/** For the tests: the day label a table uses. */
export { dayText };
