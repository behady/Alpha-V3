import { readFile } from "node:fs/promises";
import path from "node:path";
import { jsPDF } from "jspdf";
import autoTableImport from "jspdf-autotable";
import type { Briefing, BriefingAccess } from "@/lib/automation/briefing/types";
import type { ReportKind, ResolvedReportPrefs } from "@/lib/notificationCatalog";

/**
 * The report as a PDF: what the text says, laid out for a screen or a printer.
 *
 * Built on the server with jsPDF, which is already in the bundle for the client's PDFs, so the
 * cron needs no browser. Two constraints shaped the layout:
 *
 *  - **Arabic.** jsPDF shapes Arabic through the font's presentation-form glyphs, and its
 *    bidi is naive: a sentence that mixes Arabic, digits and brackets comes out with the pieces
 *    reordered. So the PDF is tables — one value per cell, labels in one cell, numbers in
 *    another — and headings are words only. What reads perfectly in a WhatsApp bubble would
 *    read scrambled here, and vice versa.
 *  - **The font.** The Cairo file the site ships is a Latin subset with no Arabic glyphs at
 *    all. An Arabic report needs a real Arabic font in `public/fonts` (see ARABIC_FONT_FILES) or a
 *    URL in REPORT_ARABIC_FONT_URL. Without either, an Arabic report is rendered in English and
 *    the caller is told so — a page of blank lines is not a fallback.
 *
 * The figures come from the same `Briefing` as the text and the phone app, and `access` is the
 * reader's, so a PDF handed to a receptionist has no money table to begin with.
 */

type PdfKind = Exclude<ReportKind, "summary" | "dentistDay">;
type L = "ar" | "en";

const autoTable = ((autoTableImport as unknown as { default?: unknown }).default || autoTableImport) as (
  doc: jsPDF,
  options: Record<string, unknown>,
) => void;

/** Fonts tried, in order, under public/fonts. Any TTF with Arabic Presentation Forms-B works. */
export const ARABIC_FONT_FILES = ["NotoNaskhArabic-Regular.ttf", "Amiri-Regular.ttf", "Arabic.ttf"];

let arabicFontCache: { base64: string } | null | undefined;

/**
 * Where the deployed server fetches an Arabic font when none ships in public/fonts: Amiri, OFL,
 * from Google's own font repository on jsDelivr. Only on Vercel — a local run or a test never
 * reaches the network for it. REPORT_ARABIC_FONT_URL overrides; "none" switches it off.
 */
export const DEFAULT_ARABIC_FONT_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf";

/**
 * Does this TrueType font map the Arabic presentation forms?
 *
 * jsPDF shapes Arabic by swapping each letter for its contextual form (U+FE70–FEFC) and then
 * drawing that glyph. A font that carries only the base letters (U+0600–06FF) — Cairo's web
 * subset is one — produces a page of blanks, not an error. Checked on the cmap so a font that
 * cannot do it is refused before a clinic receives an empty PDF.
 */
export function hasArabicPresentationForms(buf: Buffer): boolean {
  try {
    const u16 = (o: number) => buf.readUInt16BE(o);
    const u32 = (o: number) => buf.readUInt32BE(o);
    const numTables = u16(4);
    let cmap = 0;
    for (let i = 0; i < numTables; i++) {
      if (buf.toString("ascii", 12 + i * 16, 16 + i * 16) === "cmap") cmap = u32(12 + i * 16 + 8);
    }
    if (!cmap) return false;
    const want = [0xfe8d /* alef isolated */, 0xfee3 /* meem initial */, 0xfeea /* heh final */];
    const found = new Set<number>();
    const subtables = u16(cmap + 2);
    for (let i = 0; i < subtables; i++) {
      const off = cmap + u32(cmap + 4 + i * 8 + 4);
      const format = u16(off);
      if (format === 4) {
        const segX2 = u16(off + 6);
        for (let seg = 0; seg < segX2 / 2; seg++) {
          const end = u16(off + 14 + seg * 2);
          const start = u16(off + 16 + segX2 + seg * 2);
          for (const c of want) if (c >= start && c <= end) found.add(c);
        }
      } else if (format === 12) {
        const groups = u32(off + 12);
        for (let g = 0; g < groups; g++) {
          const start = u32(off + 16 + g * 12);
          const end = u32(off + 20 + g * 12);
          for (const c of want) if (c >= start && c <= end) found.add(c);
        }
      }
    }
    return want.every((c) => found.has(c));
  } catch {
    return false;
  }
}

async function loadArabicFont(): Promise<{ base64: string } | null> {
  if (arabicFontCache !== undefined) return arabicFontCache;
  for (const name of ARABIC_FONT_FILES) {
    try {
      const buf = await readFile(path.join(process.cwd(), "public", "fonts", name));
      if (!hasArabicPresentationForms(buf)) continue;
      arabicFontCache = { base64: buf.toString("base64") };
      return arabicFontCache;
    } catch {
      /* next candidate */
    }
  }
  const configured = process.env.REPORT_ARABIC_FONT_URL?.trim();
  const url = configured === "none" ? "" : configured || (process.env.VERCEL ? DEFAULT_ARABIC_FONT_URL : "");
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (hasArabicPresentationForms(buf)) {
          arabicFontCache = { base64: buf.toString("base64") };
          return arabicFontCache;
        }
        console.warn("Arabic report font has no presentation forms; PDFs fall back to English.");
      }
    } catch {
      /* no font */
    }
  }
  arabicFontCache = null;
  return null;
}

/** Tests and the settings page ask whether Arabic PDFs are possible on this deployment. */
export async function arabicPdfAvailable(): Promise<boolean> {
  return (await loadArabicFont()) !== null;
}

const T = {
  dayClose: { ar: "إقفال اليوم", en: "Day close-out" },
  morning: { ar: "ملخص الصباح", en: "Morning brief" },
  weekly: { ar: "تقرير الأسبوع", en: "Weekly report" },
  monthly: { ar: "تقرير الشهر", en: "Monthly report" },
  payroll: { ar: "كشف الحضور والمرتبات", en: "Attendance & pay" },
  collected: { ar: "التحصيل", en: "Collected" },
  seen: { ar: "اتشاف", en: "Seen" },
  missed: { ar: "غاب أو اتلغى", en: "Missed" },
  newPatients: { ar: "مرضى جداد", en: "New patients" },
  money: { ar: "الفلوس", en: "Money" },
  expenses: { ar: "المصروفات", en: "Expenses" },
  net: { ar: "الصافي", en: "Net" },
  discounts: { ar: "الخصومات", en: "Discounts" },
  billedUnpaid: { ar: "شغل متفوتر ولسه متدفعش", en: "Billed, not yet paid" },
  labFees: { ar: "المعامل", en: "Lab fees" },
  commissions: { ar: "عمولات الدكاترة", en: "Dentist commissions" },
  clinicProfit: { ar: "صافي العيادة", en: "Clinic share" },
  previous: { ar: "الفترة اللي فاتت", en: "Previous period" },
  sameWeekday: { ar: "نفس اليوم الأسبوع اللي فات", en: "Same day last week" },
  change: { ar: "التغيير", en: "Change" },
  byMethod: { ar: "طرق الدفع", en: "By method" },
  method: { ar: "الطريقة", en: "Method" },
  amount: { ar: "المبلغ", en: "Amount" },
  count: { ar: "العدد", en: "Count" },
  perDentist: { ar: "لكل دكتور", en: "Per dentist" },
  dentist: { ar: "الدكتور", en: "Dentist" },
  patients: { ar: "مرضى", en: "Patients" },
  procedures: { ar: "إجراءات", en: "Procedures" },
  commission: { ar: "عمولة", en: "Commission" },
  appointments: { ar: "المواعيد", en: "Appointments" },
  booked: { ar: "محجوز", en: "Booked" },
  noShow: { ar: "غاب", en: "No-show" },
  cancelled: { ar: "اتلغى", en: "Cancelled" },
  stillToCome: { ar: "لسه جاي", en: "Still to come" },
  busiestHour: { ar: "أكتر ساعة زحمة", en: "Busiest hour" },
  utilisation: { ar: "إشغال الكراسي", en: "Chair utilisation" },
  byDay: { ar: "يوم بيوم", en: "Day by day" },
  day: { ar: "اليوم", en: "Day" },
  next: { ar: "الفترة الجاية", en: "Coming up" },
  unconfirmed: { ar: "غير مؤكد", en: "Unconfirmed" },
  growth: { ar: "المرضى والعملاء", en: "Patients & leads" },
  newLeads: { ar: "عملاء جداد", en: "New leads" },
  bySource: { ar: "حسب المصدر", en: "By source" },
  converted: { ar: "اتحولوا لمرضى", en: "Converted" },
  untouched: { ar: "لسه محدش كلمهم", en: "Untouched" },
  overdueFollowups: { ar: "متابعات فاتت", en: "Overdue follow-ups" },
  handoffs: { ar: "محادثات مستنية رد", en: "Chats waiting for a person" },
  chase: { ar: "محتاج متابعة", en: "To chase" },
  unresolved: { ar: "مواعيد قديمة من غير حالة", en: "Old appointments never closed" },
  seenNoNext: { ar: "اتشافوا ومحجزوش تاني", en: "Seen, nothing booked next" },
  billedNoBooking: { ar: "اتفوتروا ومحجزوش", en: "Billed, nothing booked" },
  staleBalances: { ar: "حسابات عليها رصيد وساكتة", en: "Quiet balances" },
  team: { ar: "الفريق", en: "Team" },
  person: { ar: "الاسم", en: "Name" },
  role: { ar: "الدور", en: "Role" },
  daysWorked: { ar: "أيام", en: "Days" },
  hours: { ar: "ساعات", en: "Hours" },
  lateMin: { ar: "تأخير (د)", en: "Late (min)" },
  absent: { ar: "غياب", en: "Absent" },
  otPending: { ar: "إضافي معلق (س)", en: "OT pending (h)" },
  estPay: { ar: "مستحق تقديري", en: "Est. pay" },
  labour: { ar: "تكلفة العمالة", en: "Labour cost" },
  payrollTotal: { ar: "إجمالي المرتبات التقديري", en: "Estimated payroll" },
  noSchedule: { ar: "من غير جدول شغل", en: "Without a work schedule" },
  stock: { ar: "مخزون قرب يخلص", en: "Low stock" },
  item: { ar: "الصنف", en: "Item" },
  stockLeft: { ar: "المتبقي", en: "Left" },
  minStock: { ar: "الحد الأدنى", en: "Minimum" },
  topProcedures: { ar: "أكتر إجراءات", en: "Top procedures" },
  procedure: { ar: "الإجراء", en: "Procedure" },
  revenue: { ar: "الإيراد", en: "Revenue" },
  bestDay: { ar: "أحسن يوم", en: "Best day" },
  quietestDay: { ar: "أهدأ يوم", en: "Quietest day" },
  collectionRate: { ar: "نسبة التحصيل من الفواتير", en: "Collection rate" },
  generated: { ar: "من نظام ألفا دنتال", en: "Generated by Alpha Dental" },
  page: { ar: "صفحة", en: "Page" },
  noteCommission: { ar: "العمولات في شاشة المرتبات. الغياب هنا يشمل الإجازات المتفق عليها.", en: "Commission is on the payroll screen. An agreed day off counts as an absence here." },
} as const;

const t = (k: keyof typeof T, l: L) => T[k][l];

const DAYS = {
  ar: ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function pct(current: number, previous: number | null | undefined): string {
  if (previous === null || previous === undefined || previous <= 0) return "—";
  const p = Math.round(((current - previous) / previous) * 100);
  return p === 0 ? "=" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
}
function dayLabel(dateKey: string, l: L): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  const [y, m, dd] = dateKey.split("-");
  return `${DAYS[l][d.getUTCDay()]} ${Number(dd)}/${Number(m)}/${y}`;
}
function rangeLabel(b: Briefing, l: L): string {
  if (b.startDate === b.endDate) return dayLabel(b.endDate, l);
  const [y1, m1, d1] = b.startDate.split("-");
  const [y2, m2, d2] = b.endDate.split("-");
  return `${Number(d1)}/${Number(m1)}/${y1} – ${Number(d2)}/${Number(m2)}/${y2}`;
}

export interface ReportPdfInput {
  kind: PdfKind;
  clinicName: string;
  briefing: Briefing;
  /** Morning only: yesterday, for the money block. */
  yesterday?: Briefing;
  handoffsWaiting?: number;
  prefs: ResolvedReportPrefs;
  access: BriefingAccess;
}

export interface ReportPdfResult {
  bytes: Uint8Array;
  /** The language actually used — English when Arabic was asked for but no Arabic font exists. */
  language: L;
  filename: string;
}

export async function buildReportPdf(input: ReportPdfInput): Promise<ReportPdfResult> {
  const wantAr = input.prefs.language === "ar";
  const font = wantAr ? await loadArabicFont() : null;
  const l: L = wantAr && font ? "ar" : "en";
  const rtl = l === "ar";

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let fontName = "helvetica";
  if (font) {
    doc.addFileToVFS("ArabicReport.ttf", font.base64);
    doc.addFont("ArabicReport.ttf", "ArabicReport", "normal");
    fontName = "ArabicReport";
  }
  doc.setFont(fontName, "normal");

  const x = (leftX: number) => (rtl ? W - leftX : leftX);
  const align = rtl ? "right" : "left";
  const text = (s: string, leftX: number, y: number, size: number, color: [number, number, number] = [20, 20, 20]) => {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(s, x(leftX), y, { align });
  };
  /** Label first in English, last in Arabic: the reading eye lands on it either way. */
  const row = (label: string, ...values: string[]) => (rtl ? [...values.reverse(), label] : [label, ...values]);
  const head = (label: string, ...values: string[]) => row(label, ...values);

  const b = input.briefing;
  const { prefs, access } = input;
  const title =
    input.kind === "evening" ? t("dayClose", l)
    : input.kind === "morning" ? t("morning", l)
    : input.kind === "weekly" ? t("weekly", l)
    : input.kind === "monthly" ? t("monthly", l)
    : t("payroll", l);

  // --- header band -------------------------------------------------------------------------------
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, W, 96, "F");
  text(input.clinicName, M, 36, 12, [255, 255, 255]);
  text(title, M, 64, 22, [255, 255, 255]);
  text(rangeLabel(b, l), M, 84, 10, [200, 200, 200]);

  let y = 120;

  // --- KPI tiles -----------------------------------------------------------------------------------
  const tiles: { label: string; value: string }[] = [];
  if (access.money && b.money && prefs.sections.money && input.kind !== "payroll") tiles.push({ label: t("collected", l), value: fmt(b.money.collected) });
  if (input.kind !== "payroll") {
    tiles.push({ label: t("seen", l), value: String(b.counts.attended) });
    tiles.push({ label: t("missed", l), value: String(b.counts.cancelled) });
    tiles.push({ label: t("newPatients", l), value: String(b.growth.newPatients) });
  } else if (b.hr) {
    tiles.push({ label: t("labour", l), value: fmt(b.hr.labourCost) });
    tiles.push({ label: t("lateMin", l), value: String(hrLateMinutes(b)) });
    tiles.push({ label: t("absent", l), value: String(b.hr.absentDays) });
  }
  if (tiles.length > 0) {
    const gap = 10;
    const w = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((tile, i) => {
      const leftX = M + i * (w + gap);
      const bx = rtl ? W - leftX - w : leftX;
      doc.setFillColor(245, 245, 243);
      doc.roundedRect(bx, y, w, 54, 8, 8, "F");
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 110);
      doc.text(tile.label, rtl ? bx + w - 10 : bx + 10, y + 18, { align });
      doc.setFontSize(18);
      doc.setTextColor(20, 20, 20);
      doc.text(tile.value, rtl ? bx + w - 10 : bx + 10, y + 42, { align });
    });
    y += 74;
  }

  const table = (heading: string, headRow: string[], body: string[][], colStyles?: Record<number, Record<string, unknown>>) => {
    if (body.length === 0) return;
    if (y > H - 120) {
      doc.addPage();
      y = M;
    }
    text(heading, M, y, 13);
    y += 8;
    // A key/value table has no header worth a black band.
    const hasHead = headRow.some((h) => h.trim() !== "");
    autoTable(doc, {
      startY: y,
      ...(hasHead ? { head: [headRow] } : {}),
      body,
      theme: "grid",
      margin: { left: M, right: M },
      styles: { font: fontName, fontStyle: "normal", fontSize: 9.5, halign: rtl ? "right" : "left", cellPadding: 5, textColor: [30, 30, 30], lineColor: [225, 225, 222] },
      headStyles: { fillColor: [17, 17, 17], textColor: [255, 255, 255], fontStyle: "normal" },
      alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: colStyles || {},
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 22;
  };
  const numCols = (n: number) => {
    // Numeric columns right-aligned in English; in Arabic every column already is.
    const styles: Record<number, Record<string, unknown>> = {};
    if (!rtl) for (let i = 1; i <= n; i++) styles[i] = { halign: "right" };
    return styles;
  };

  const money = access.money && prefs.sections.money ? b.money : undefined;
  const periodic = input.kind === "weekly" || input.kind === "monthly";

  // --- money -----------------------------------------------------------------------------------------
  if (money && input.kind !== "payroll") {
    const src = input.kind === "morning" && input.yesterday?.money ? input.yesterday.money : money;
    const rows: string[][] = [row(t("collected", l), fmt(src.collected))];
    if (prefs.comparisons) {
      if (src.comparison.sameWeekdayCollected !== null) rows.push(row(t("sameWeekday", l), `${fmt(src.comparison.sameWeekdayCollected)}  ${pct(src.collected, src.comparison.sameWeekdayCollected)}`));
      else if (src.comparison.previousCollected !== null) rows.push(row(t("previous", l), `${fmt(src.comparison.previousCollected)}  ${pct(src.collected, src.comparison.previousCollected)}`));
    }
    rows.push(row(t("expenses", l), fmt(src.expenses)), row(t("net", l), fmt(src.netCash)));
    if (prefs.moneyDetail === "full") {
      rows.push(row(t("discounts", l), fmt(src.discounts)), row(t("billedUnpaid", l), fmt(src.billedUnpaid)));
      if (src.labFees > 0) rows.push(row(t("labFees", l), fmt(src.labFees)));
      if (src.doctorCommissions > 0) rows.push(row(t("commissions", l), fmt(src.doctorCommissions)));
      if (src.clinicProfit > 0) rows.push(row(t("clinicProfit", l), fmt(src.clinicProfit)));
    }
    if (periodic && b.trend?.collectionRate !== null && b.trend?.collectionRate !== undefined) rows.push(row(t("collectionRate", l), `${b.trend.collectionRate}%`));
    table(input.kind === "morning" ? `${t("money", l)} — ${dayLabel(input.yesterday?.dateKey || b.dateKey, l)}` : t("money", l), head("", ""), rows, numCols(1));

    if (prefs.moneyDetail === "full" && src.byMethod.length > 0) {
      table(t("byMethod", l), head(t("method", l), t("amount", l), t("count", l)), src.byMethod.map((m) => row(m.method, fmt(m.amount), String(m.count))), numCols(2));
    }
    const production = input.kind === "morning" ? input.yesterday?.production : b.production;
    if (prefs.moneyDetail !== "totals" && production && production.doctors.length > 0) {
      const full = prefs.moneyDetail === "full";
      table(
        t("perDentist", l),
        full ? head(t("dentist", l), t("patients", l), t("procedures", l), t("collected", l), t("commission", l)) : head(t("dentist", l), t("patients", l), t("collected", l)),
        [...production.doctors]
          .sort((a, c) => c.collected - a.collected)
          .map((d) => (full ? row(d.name, String(d.patientsSeen), String(d.procedures), fmt(d.collected), fmt(d.commission)) : row(d.name, String(d.patientsSeen), fmt(d.collected)))),
        numCols(full ? 4 : 2),
      );
    }
  }

  // --- appointments ------------------------------------------------------------------------------
  if (prefs.sections.appointments && input.kind !== "payroll") {
    const noShows = b.appointments.filter((a) => a.status === "No Show").length;
    const cancelled = b.appointments.filter((a) => a.status === "Cancelled").length;
    const rows: string[][] = [row(t("booked", l), String(b.counts.total)), row(t("seen", l), String(b.counts.attended))];
    // The per-status split needs the appointment rows; a period briefing may carry only counts.
    if (noShows + cancelled > 0) rows.push(row(t("noShow", l), String(noShows)), row(t("cancelled", l), String(cancelled)));
    else if (b.counts.cancelled > 0) rows.push(row(t("missed", l), String(b.counts.cancelled)));
    if (b.counts.stillScheduled > 0) rows.push(row(t("stillToCome", l), String(b.counts.stillScheduled)));
    if (b.production?.busiestHour) rows.push(row(t("busiestHour", l), b.production.busiestHour.hour));
    if (b.production?.chairUtilisation) rows.push(row(t("utilisation", l), `${b.production.chairUtilisation.percent}%`));
    rows.push(row(`${t("next", l)} (${b.nextUp.key === "tomorrow" ? DAYS[l][new Date(`${b.nextUp.startDate}T12:00:00Z`).getUTCDay()] : rangeLabelRaw(b.nextUp.startDate, b.nextUp.endDate)})`, `${b.nextUp.appointments}${b.nextUp.unconfirmed > 0 ? ` · ${t("unconfirmed", l)} ${b.nextUp.unconfirmed}` : ""}`));
    table(t("appointments", l), head("", ""), rows, numCols(1));

    if (periodic && b.trend) {
      table(
        t("byDay", l),
        access.money ? head(t("day", l), t("seen", l), t("collected", l)) : head(t("day", l), t("seen", l)),
        b.trend.daily.map((d) => (access.money ? row(dayLabel(d.dateKey, l), String(d.patientsSeen), fmt(d.collected || 0)) : row(dayLabel(d.dateKey, l), String(d.patientsSeen)))),
        numCols(access.money ? 2 : 1),
      );
      if (b.trend.topProcedures.length > 0) {
        table(
          t("topProcedures", l),
          access.money ? head(t("procedure", l), t("count", l), t("revenue", l)) : head(t("procedure", l), t("count", l)),
          b.trend.topProcedures.map((p) => (access.money ? row(p.name, String(p.count), fmt(p.revenue || 0)) : row(p.name, String(p.count)))),
          numCols(access.money ? 2 : 1),
        );
      }
    }
  }

  // --- patients & leads --------------------------------------------------------------------------
  if (prefs.sections.patients && input.kind !== "payroll") {
    const g = b.growth;
    const rows: string[][] = [row(t("newPatients", l), String(g.newPatients)), row(t("newLeads", l), String(g.newLeads))];
    for (const s of g.leadsBySource.slice(0, 5)) rows.push(row(`  ${s.source}`, String(s.count)));
    if (g.leadsConverted > 0) rows.push(row(t("converted", l), String(g.leadsConverted)));
    if (g.leadsUntouched > 0) rows.push(row(t("untouched", l), String(g.leadsUntouched)));
    if (input.handoffsWaiting) rows.push(row(t("handoffs", l), String(input.handoffsWaiting)));
    table(t("growth", l), head("", ""), rows, numCols(1));

    const a = b.actions;
    // Same call as the text: the "to chase" list is a week's or a month's business, not the morning's.
    const chase: string[][] = [];
    if (a.unresolvedCount > 0) chase.push(row(t("unresolved", l), String(a.unresolvedCount)));
    if (a.seenWithoutNextVisitCount > 0) chase.push(row(t("seenNoNext", l), String(a.seenWithoutNextVisitCount)));
    if (a.billedWithoutBookingCount > 0) chase.push(row(t("billedNoBooking", l), String(a.billedWithoutBookingCount)));
    if (a.overdueFollowUpCount > 0) chase.push(row(t("overdueFollowups", l), String(a.overdueFollowUpCount)));
    if (access.money && a.staleBalanceTotal !== null && a.staleBalances.length > 0) chase.push(row(t("staleBalances", l), `${a.staleBalances.length} · ${fmt(a.staleBalanceTotal)}`));
    if (periodic) table(t("chase", l), head("", ""), chase, numCols(1));
  }

  // --- team / payroll ----------------------------------------------------------------------------
  if ((prefs.sections.team || input.kind === "payroll") && access.hr && b.hr) {
    const hr = b.hr;
    const staff = [...hr.staff].sort((a, c) => c.minutesWorked - a.minutesWorked);
    if (input.kind === "payroll" || periodic) {
      table(
        input.kind === "payroll" ? t("payroll", l) : t("team", l),
        head(t("person", l), t("daysWorked", l), t("hours", l), t("lateMin", l), t("absent", l), t("otPending", l), t("estPay", l)),
        staff.map((s) =>
          row(
            `${s.name}${s.role ? ` · ${s.role}` : ""}`,
            String(s.daysWorked),
            (s.minutesWorked / 60).toFixed(1),
            String(s.lateMinutes),
            String(s.absentDays),
            (s.overtimePendingMinutes / 60).toFixed(1),
            fmt(s.estimatedPay),
          ),
        ),
        numCols(6),
      );
      const total = staff.reduce((sum, s) => sum + s.estimatedPay, 0);
      text(`${t("payrollTotal", l)}: ${fmt(total)}`, M, y, 11);
      y += 16;
      if (hr.withoutSchedule > 0) {
        text(`${hr.withoutSchedule} ${t("noSchedule", l)}`, M, y, 9, [120, 120, 120]);
        y += 14;
      }
      if (input.kind === "payroll") {
        text(t("noteCommission", l), M, y, 9, [120, 120, 120]);
        y += 22;
      } else {
        y += 8;
      }
    } else {
      const rows = staff
        .filter((s) => s.daysWorked > 0 || s.lateDays > 0 || s.absentDays > 0 || s.activeNow)
        .map((s) => row(s.name, s.daysWorked > 0 || s.activeNow ? "✓" : "—", String(s.lateMinutes), String(s.absentDays)));
      table(t("team", l), head(t("person", l), t("seen", l).replace(/.*/, l === "ar" ? "حضر" : "Present"), t("lateMin", l), t("absent", l)), rows, numCols(3));
    }
  }

  // --- stock -----------------------------------------------------------------------------------------
  if (b.stock.lowCount > 0 && input.kind !== "payroll") {
    table(t("stock", l), head(t("item", l), t("stockLeft", l), t("minStock", l)), b.stock.low.slice(0, 15).map((i) => row(i.name, `${i.stock} ${i.unit}`, String(i.minStock))), numCols(2));
  }

  // --- footer on every page ----------------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`${t("generated", l)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, rtl ? W - M : M, H - 24, { align });
    doc.text(`${t("page", l)} ${p}/${pages}`, rtl ? M : W - M, H - 24, { align: rtl ? "left" : "right" });
  }

  const stem = input.kind === "evening" ? "close-out" : input.kind;
  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    language: l,
    filename: `${stem}-${b.endDate}.pdf`,
  };
}

function rangeLabelRaw(a: string, z: string): string {
  const [, m1, d1] = a.split("-");
  const [, m2, d2] = z.split("-");
  return `${Number(d1)}/${Number(m1)} – ${Number(d2)}/${Number(m2)}`;
}

function hrLateMinutes(b: Briefing): number {
  return (b.hr?.staff || []).reduce((sum, s) => sum + s.lateMinutes, 0);
}

/* --- a document the assistant lays out ------------------------------------------------------- */

/**
 * One table in a document the assistant composed: a day-by-day attendance sheet, a dentist-share
 * statement, a list of payments. The assistant fills it from what its tools returned; this only
 * lays it out, the same way as the scheduled reports.
 */
export interface CustomPdfSection {
  heading?: string;
  columns?: string[];
  rows?: string[][];
  /** A short line under the table: a caveat the tool reported, a total. */
  note?: string;
}

export interface CustomPdfInput {
  clinicName: string;
  title: string;
  subtitle?: string;
  language: L;
  sections: CustomPdfSection[];
}

const MAX_ROWS = 400;
const MAX_COLS = 10;

/** Trims and bounds what a model sent, so a malformed document cannot crash the render. */
export function cleanCustomSections(raw: unknown): CustomPdfSection[] {
  if (!Array.isArray(raw)) return [];
  const cell = (v: unknown) => {
    let text = (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, 120);
    // jsPDF does not mirror brackets inside Arabic, so "(تأخير د)" prints as "(تأخير )د".
    if (/[؀-ۿ]/.test(text)) text = text.replace(/\s*\(\s*([^()]*?)\s*\)\s*/g, " · $1 ").replace(/\s+/g, " ").trim();
    return text;
  };
  return raw
    .slice(0, 20)
    .map((sec): CustomPdfSection => {
      const x = (sec || {}) as Record<string, unknown>;
      const columns = Array.isArray(x.columns) ? x.columns.slice(0, MAX_COLS).map(cell) : [];
      const width = columns.length || MAX_COLS;
      const rows = Array.isArray(x.rows)
        ? x.rows.slice(0, MAX_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, width).map(cell) : [cell(r)]))
        : [];
      return {
        heading: typeof x.heading === "string" ? x.heading.trim().slice(0, 120) : undefined,
        columns,
        rows,
        note: typeof x.note === "string" ? x.note.trim().slice(0, 400) : undefined,
      };
    })
    .filter((sec) => (sec.rows && sec.rows.length > 0) || sec.note);
}

export async function buildCustomPdf(input: CustomPdfInput): Promise<ReportPdfResult> {
  const wantAr = input.language === "ar";
  const font = wantAr ? await loadArabicFont() : null;
  // Arabic cells need the Arabic font even in an English document: patient names are Arabic.
  const anyArabic = /[\u0600-\u06FF]/.test(JSON.stringify(input.sections) + input.title + (input.subtitle || ""));
  const fontForCells = font || (anyArabic ? await loadArabicFont() : null);
  const l: L = wantAr && font ? "ar" : "en";
  const rtl = l === "ar";

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let fontName = "helvetica";
  if (fontForCells) {
    doc.addFileToVFS("ArabicReport.ttf", fontForCells.base64);
    doc.addFont("ArabicReport.ttf", "ArabicReport", "normal");
    fontName = "ArabicReport";
  }
  doc.setFont(fontName, "normal");
  const align = rtl ? "right" : "left";
  const at = (leftX: number) => (rtl ? W - leftX : leftX);

  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, W, 96, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text(input.clinicName, at(M), 36, { align });
  doc.setFontSize(20);
  doc.text(input.title.slice(0, 80), at(M), 64, { align });
  if (input.subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(200, 200, 200);
    doc.text(input.subtitle.slice(0, 120), at(M), 84, { align });
  }

  let y = 122;
  for (const sec of input.sections) {
    if (y > H - 120) {
      doc.addPage();
      y = M;
    }
    if (sec.heading) {
      doc.setFontSize(13);
      doc.setTextColor(20, 20, 20);
      doc.text(sec.heading, at(M), y, { align });
      y += 8;
    }
    if (sec.rows && sec.rows.length > 0) {
      const flip = <T,>(r: T[]) => (rtl ? [...r].reverse() : r);
      const width = Math.max(sec.columns?.length || 0, ...sec.rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill("")];
      const numeric = (col: number) => sec.rows!.every((r) => !r[col] || /^[\d.,:%+\-− ]+$/.test(r[col]));
      const colStyles: Record<number, Record<string, unknown>> = {};
      if (!rtl) for (let c = 0; c < width; c++) if (numeric(c)) colStyles[c] = { halign: "right" };
      autoTable(doc, {
        startY: y,
        ...(sec.columns && sec.columns.length ? { head: [flip(pad(sec.columns))] } : {}),
        body: sec.rows.map((r) => flip(pad(r))),
        theme: "grid",
        margin: { left: M, right: M },
        styles: { font: fontName, fontStyle: "normal", fontSize: 9.5, halign: rtl ? "right" : "left", cellPadding: 5, textColor: [30, 30, 30], lineColor: [225, 225, 222] },
        headStyles: { fillColor: [17, 17, 17], textColor: [255, 255, 255], fontStyle: "normal" },
        alternateRowStyles: { fillColor: [250, 250, 249] },
        columnStyles: colStyles,
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 16;
    }
    if (sec.note) {
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 110);
      const lines = doc.splitTextToSize(sec.note, W - 2 * M) as string[];
      for (const line of lines) {
        if (y > H - 50) {
          doc.addPage();
          y = M;
        }
        doc.text(line, at(M), y, { align });
        y += 12;
      }
      y += 10;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`${t("generated", l)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, rtl ? W - M : M, H - 24, { align });
    doc.text(`${t("page", l)} ${p}/${pages}`, rtl ? M : W - M, H - 24, { align: rtl ? "left" : "right" });
  }

  const stem = input.title.replace(/[^\w\u0600-\u06FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
  return { bytes: new Uint8Array(doc.output("arraybuffer")), language: l, filename: `${stem}.pdf` };
}
