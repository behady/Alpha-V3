/**
 * The team page's clock-in sheet as an Excel file: one person, or the whole team (a summary sheet,
 * then a sheet per person).
 *
 * Written from the same `AttendanceSheet` the page draws, so the file cannot disagree with the
 * screen it was downloaded from. Times are real Excel times and the totals are SUM formulas with
 * the figure cached beside them, so the owner can add, sort and check the file himself.
 *
 * Uses xlsx-js-style (bold headings, number formats); imported dynamically by the page so it only
 * reaches a browser when somebody presses the button.
 */

import XLSX from "xlsx-js-style";
import type { AttendanceSheet, SheetRow } from "./attendanceSheet";

type Style = NonNullable<XLSX.CellObject["s"]>;
type Cell = XLSX.CellObject | null;

export type AttendanceXlsxPerson = {
  name: string;
  sheet: AttendanceSheet;
  /** The roster is the clinic default, not theirs: the file says so. */
  assumed: boolean;
  baseSalary: number;
  overtimeMultiplier: number;
};

const MONEY = "#,##0.00";
const DATE = "dd/mm/yyyy";
const CLOCK = "h:mm AM/PM";
const SPAN = "[h]:mm";

const BORDER = {
  top: { style: "thin", color: { rgb: "D0D0D0" } },
  bottom: { style: "thin", color: { rgb: "D0D0D0" } },
  left: { style: "thin", color: { rgb: "D0D0D0" } },
  right: { style: "thin", color: { rgb: "D0D0D0" } },
} as const;
const HEAD_FILL = { patternType: "solid", fgColor: { rgb: "EFEFEF" } } as const;
const TOTAL_FILL = { patternType: "solid", fgColor: { rgb: "F7F7F7" } } as const;
const STYLE = {
  title: { font: { sz: 14, bold: true } } satisfies Style,
  muted: { font: { color: { rgb: "666666" } } } satisfies Style,
  note: { font: { color: { rgb: "444444" } }, alignment: { wrapText: true, vertical: "top" } } satisfies Style,
  head: { font: { bold: true }, fill: HEAD_FILL, border: BORDER, alignment: { horizontal: "center", vertical: "center", wrapText: true } } satisfies Style,
  text: { border: BORDER } satisfies Style,
  red: { border: BORDER, font: { color: { rgb: "B42318" }, bold: true } } satisfies Style,
  date: { border: BORDER, numFmt: DATE, alignment: { horizontal: "center" } } satisfies Style,
  clock: { border: BORDER, numFmt: CLOCK, alignment: { horizontal: "center" } } satisfies Style,
  span: { border: BORDER, numFmt: SPAN, alignment: { horizontal: "center" } } satisfies Style,
  int: { border: BORDER, alignment: { horizontal: "center" } } satisfies Style,
  money: { border: BORDER, numFmt: MONEY } satisfies Style,
  total: { font: { bold: true }, fill: TOTAL_FILL, border: BORDER } satisfies Style,
  totalSpan: { font: { bold: true }, fill: TOTAL_FILL, border: BORDER, numFmt: SPAN, alignment: { horizontal: "center" } } satisfies Style,
  totalInt: { font: { bold: true }, fill: TOTAL_FILL, border: BORDER, alignment: { horizontal: "center" } } satisfies Style,
  totalMoney: { font: { bold: true }, fill: TOTAL_FILL, border: BORDER, numFmt: MONEY } satisfies Style,
};

const s = (v: string, style: Style = {}): XLSX.CellObject => ({ v, t: "s", s: style });
const n = (v: number, style: Style): XLSX.CellObject => ({ v, t: "n", s: style });
const f = (formula: string, value: number, style: Style): XLSX.CellObject => ({ f: formula, v: value, t: "n", s: style });
const ref = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
const round2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => Math.round(x * 100) / 100;

/** A real Excel date from the calendar day, so no time zone moves it. */
function dateCell(ymd: string): XLSX.CellObject {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return s(ymd || "—", STYLE.text);
  const serial = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return { v: serial, t: "n", z: DATE, s: STYLE.date };
}

/** The wall-clock time on the clinic's clock, as an Excel time (a fraction of a day). */
function clockCell(at: Date | null, timeZone: string, missing: string): XLSX.CellObject {
  if (!at) return s(missing, STYLE.int);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { v: ((get("hour") % 24) * 60 + get("minute")) / 1440, t: "n", z: CLOCK, s: STYLE.clock };
}

const span = (minutes: number): XLSX.CellObject => ({ v: minutes / 1440, t: "n", z: SPAN, s: STYLE.span });

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

const DAYS = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ar: ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"],
};
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

const LABELS = {
  en: {
    title: (name: string) => `Clock-in sheet — ${name}`,
    teamTitle: "Clock-in sheet — whole team",
    period: (a: string, b: string) => (a === b ? `Period: ${a}` : `Period: ${a} to ${b}`),
    rule: (rate: number, salary: number, hours: number, mult: number) =>
      `Hour price ${fmt(rate).toLocaleString("en-US")} EGP = salary ${salary.toLocaleString("en-US")} ÷ ${fmt(hours)} hours a month. Time inside the shift is paid; extra time is paid at ${mult}× once approved.`,
    noSalary: "No fixed salary set, so no day's pay.",
    assumed: "No shifts set for this person: the clinic's usual hours (Sunday to Thursday, 1 pm to 9 pm) were assumed.",
    head: ["Date", "Day", "In", "Out", "Hours", "Late (min)", "Extra time", "Extra time decision", "Day's pay", "Where", "Note"],
    still: "still in",
    none: "—",
    total: "Total",
    decision: { approved: "Paid", rejected: "Not paid", pending: "Waiting for you" },
    atClinic: "At the clinic",
    away: (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km away` : `${Math.round(m)} m away`),
    absent: "Missed — no clock-in",
    forgot: "Forgot to clock out",
    auto: "Clock-out made by the system",
    stillIn: "Still at work",
    summary: "Summary",
    summaryHead: ["Name", "Days", "Hours", "Extra time", "Late days", "Missed days", "Pay"],
    empty: "No clock-ins in this period.",
  },
  ar: {
    title: (name: string) => `شيت الحضور — ${name}`,
    teamTitle: "شيت الحضور — الفريق كله",
    period: (a: string, b: string) => (a === b ? `الفترة: ${a}` : `الفترة: من ${a} إلى ${b}`),
    rule: (rate: number, salary: number, hours: number, mult: number) =>
      `سعر الساعة ${fmt(rate).toLocaleString("en-US")} ج.م = المرتب ${salary.toLocaleString("en-US")} ÷ ${fmt(hours)} ساعة في الشهر. الوقت جوه الوردية بيتحسب، والوقت الزيادة بيتحسب ×${mult} بعد موافقتك.`,
    noSalary: "مفيش مرتب ثابت متسجل، فمفيش أجر يومي.",
    assumed: "مفيش ورديات متسجلة للشخص ده: اتحسب على مواعيد العيادة العادية (من الأحد للخميس، من ١ الضهر لـ ٩ بالليل).",
    head: ["التاريخ", "اليوم", "دخول", "خروج", "الساعات", "تأخير (دقيقة)", "وقت زيادة", "قرار الوقت الزيادة", "أجر اليوم", "المكان", "ملاحظة"],
    still: "لسه",
    none: "—",
    total: "الإجمالي",
    decision: { approved: "هيتدفع", rejected: "مش هيتدفع", pending: "مستني قرارك" },
    atClinic: "من العيادة",
    away: (m: number) => (m >= 1000 ? `على بعد ${(m / 1000).toFixed(1)} كم` : `على بعد ${Math.round(m)} متر`),
    absent: "غاب — مسجّلش حضور",
    forgot: "نسي يسجّل انصراف",
    auto: "الانصراف اتسجل تلقائي",
    stillIn: "لسه في الشغل",
    summary: "الملخص",
    summaryHead: ["الاسم", "الأيام", "الساعات", "وقت زيادة", "أيام تأخير", "أيام غياب", "الأجر"],
    empty: "مفيش حضور في الفترة دي.",
  },
};
type Labels = (typeof LABELS)["en"] | (typeof LABELS)["ar"];

function where(r: Extract<SheetRow, { kind: "shift" }>, L: Labels): string {
  if (r.distanceM == null) return r.branchName ?? "";
  const far = r.far ? L.away(r.distanceM) : "";
  if (r.branchName) return far ? `${r.branchName} · ${far}` : r.branchName;
  return far || L.atClinic;
}

/** One person's sheet: title, period, the pay rule, then a line per row and the totals. */
function personSheet(p: AttendanceXlsxPerson, start: string, end: string, isAr: boolean, timeZone: string): { ws: XLSX.WorkSheet; totalRow: number } {
  const L = isAr ? LABELS.ar : LABELS.en;
  const days = isAr ? DAYS.ar : DAYS.en;
  const showPay = p.sheet.payShown;
  const head = showPay ? L.head : L.head.filter((_, i) => i !== 8);
  const col = (name: string) => head.indexOf(name);
  const rows: Cell[][] = [];
  rows.push([s(L.title(p.name), STYLE.title)]);
  rows.push([s(L.period(dayLabel(start), dayLabel(end)), STYLE.muted)]);
  rows.push([s(showPay ? L.rule(p.sheet.hourlyRate, p.baseSalary, p.sheet.monthlyHours, p.overtimeMultiplier || 1.5) : L.noSalary, STYLE.note)]);
  if (p.assumed) rows.push([s(L.assumed, STYLE.note)]);
  const topLines = rows.length;
  rows.push([]);
  rows.push(head.map((h) => s(h, STYLE.head)));
  const first = rows.length;

  // Oldest first, like a statement; the page lists newest first because it is read from the top.
  for (const r of [...p.sheet.rows].reverse()) {
    const line: Cell[] = [dateCell(r.date), s(days[weekday(r.date)], STYLE.text)];
    if (r.kind === "absent") {
      line.push(s(L.none, STYLE.int), s(L.none, STYLE.int), null, null, null, null);
      if (showPay) line.push(n(0, STYLE.money));
      line.push(s("", STYLE.text), s(L.absent, STYLE.red));
    } else {
      line.push(
        clockCell(r.checkIn, timeZone, L.none),
        clockCell(r.checkOut, timeZone, L.still),
        span(r.worked),
        r.late > 0 ? n(r.late, STYLE.int) : s("", STYLE.int),
        r.extra > 0 ? span(r.extra) : s("", STYLE.span),
        s(r.extraDecision ? L.decision[r.extraDecision] : "", r.extraDecision === "pending" ? STYLE.red : STYLE.text),
      );
      if (showPay) line.push(n(round2(r.pay ?? 0), STYLE.money));
      const note = r.forgot ? L.forgot : r.autoClosed ? L.auto : r.stillIn ? L.stillIn : "";
      line.push(s(where(r, L), r.far ? STYLE.red : STYLE.text), s(note, r.forgot || r.autoClosed ? STYLE.red : STYLE.text));
    }
    rows.push(line);
  }
  const last = rows.length - 1;
  const sum = (c: number, value: number, style: Style) =>
    last >= first ? f(`SUM(${ref(first, c)}:${ref(last, c)})`, value, style) : n(value, style);
  const total: Cell[] = head.map(() => s("", STYLE.total));
  total[0] = s(L.total, STYLE.total);
  total[1] = s(`${p.sheet.totals.days}`, STYLE.totalInt);
  total[col(L.head[4])] = sum(col(L.head[4]), p.sheet.totals.worked / 1440, STYLE.totalSpan);
  total[col(L.head[5])] = sum(col(L.head[5]), p.sheet.totals.lateMinutes, STYLE.totalInt);
  total[col(L.head[6])] = sum(col(L.head[6]), p.sheet.totals.extra / 1440, STYLE.totalSpan);
  if (showPay) total[col(L.head[8])] = sum(col(L.head[8]), round2(p.sheet.rows.reduce((t, r) => t + round2(r.pay ?? 0), 0)), STYLE.totalMoney);
  rows.push(total);
  if (p.sheet.rows.length === 0) rows.splice(first, 0, [s(L.empty, STYLE.muted)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  // The title, the period and the pay rule each span the whole sheet, so they read as lines of text
  // rather than spilling over (or being cut by) the cells beside them.
  ws["!merges"] = Array.from({ length: topLines }, (_, r) => ({ s: { r, c: 0 }, e: { r, c: head.length - 1 } }));
  ws["!rows"] = Array.from({ length: topLines }, (_, r) => (r >= 2 ? { hpt: 32 } : {}));
  const widths = [12, 11, 11, 11, 9, 11, 11, 16, 12, 22, 24];
  ws["!cols"] = (showPay ? widths : widths.filter((_, i) => i !== 8)).map((wch) => ({ wch }));
  return { ws, totalRow: rows.length - 1 };
}

/** Excel's sheet-name rules: at most 31 characters, none of : \ / ? * [ ], unique in the book. */
function sheetName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i += 1) {
    const tail = ` (${i})`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

export function attendanceWorkbook(input: {
  people: AttendanceXlsxPerson[];
  start: string;
  end: string;
  isAr: boolean;
  /** The whole team: a summary sheet first. */
  team?: boolean;
  timeZone: string;
}): XLSX.WorkBook {
  const L = input.isAr ? LABELS.ar : LABELS.en;
  const wb = XLSX.utils.book_new();
  const taken = new Set<string>();

  if (input.team) {
    const rows: Cell[][] = [];
    rows.push([s(L.teamTitle, STYLE.title)]);
    rows.push([s(L.period(dayLabel(input.start), dayLabel(input.end)), STYLE.muted)]);
    const titleLines = rows.length;
    rows.push([]);
    rows.push(L.summaryHead.map((h) => s(h, STYLE.head)));
    const first = rows.length;
    for (const p of input.people) {
      const t = p.sheet.totals;
      rows.push([
        s(p.name, STYLE.text),
        n(t.days, STYLE.int),
        span(t.worked),
        span(t.extra),
        n(t.lateDays, STYLE.int),
        n(t.absentDays, STYLE.int),
        p.sheet.payShown ? n(round2(t.pay), STYLE.money) : s(L.none, STYLE.int),
      ]);
    }
    const last = rows.length - 1;
    const sum = (c: number, value: number, style: Style) =>
      last >= first ? f(`SUM(${ref(first, c)}:${ref(last, c)})`, value, style) : n(value, style);
    const all = input.people.map((p) => p.sheet.totals);
    rows.push([
      s(L.total, STYLE.total),
      sum(1, all.reduce((x, t) => x + t.days, 0), STYLE.totalInt),
      sum(2, all.reduce((x, t) => x + t.worked, 0) / 1440, STYLE.totalSpan),
      sum(3, all.reduce((x, t) => x + t.extra, 0) / 1440, STYLE.totalSpan),
      sum(4, all.reduce((x, t) => x + t.lateDays, 0), STYLE.totalInt),
      sum(5, all.reduce((x, t) => x + t.absentDays, 0), STYLE.totalInt),
      sum(6, round2(input.people.reduce((x, p) => x + (p.sheet.payShown ? round2(p.sheet.totals.pay) : 0), 0)), STYLE.totalMoney),
    ]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!merges"] = Array.from({ length: titleLines }, (_, r) => ({ s: { r, c: 0 }, e: { r, c: L.summaryHead.length - 1 } }));
    ws["!cols"] = [26, 8, 10, 11, 10, 11, 14].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(L.summary, taken));
  }

  for (const p of input.people) {
    const { ws } = personSheet(p, input.start, input.end, input.isAr, input.timeZone);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(p.name, taken));
  }
  // The only right-to-left switch this library writes: a sheet's own `!views` is dropped on save.
  if (input.isAr) wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}

/** ASCII only, like the other downloads: an Arabic name simply drops out of the file name. */
export function attendanceFileName(name: string, start: string, end: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `attendance-${ascii ? `${ascii}-` : ""}${start}-to-${end}.xlsx`;
}
