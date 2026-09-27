import type { Briefing, BriefingAccess, BriefingAppointment } from "@/lib/automation/briefing/types";
import type { ReportKind, ResolvedReportPrefs } from "@/lib/notificationCatalog";

/**
 * The scheduled reports as WhatsApp text.
 *
 * Pure: a briefing in, a string out. The briefing is the same object the Android brief and the
 * daily-briefing route are built from, so a figure here cannot disagree with the one on screen.
 * What this module decides is only what to say and in what order, which is a writing problem:
 *
 *  - Ten seconds on a phone. Bold section heads, one fact per line, the number first.
 *  - Nothing the reader is not allowed to see. `access` is resolved per person by the caller and
 *    a block they may not see is not rendered as zeros — it is absent.
 *  - Nothing the clinic switched off. `prefs.sections` decides which blocks exist at all.
 *  - Arrows only where a base exists. A comparison against a day with nothing on it is noise.
 *
 * WhatsApp's own markup: `*bold*`, `_italic_`. No headers, no tables — they do not render.
 */

export interface StaffReportInput {
  kind: ReportKind;
  clinicName: string;
  /** The briefing for the day the report is about (today, for both the morning brief and the close-out). */
  today: Briefing;
  /** Morning only: yesterday's briefing, for the money block. */
  yesterday?: Briefing;
  /** WhatsApp conversations waiting for a person. Counted by the caller; not part of the briefing. */
  handoffsWaiting?: number;
  prefs: ResolvedReportPrefs;
  access: BriefingAccess;
  /** The dentist's own day: their name and their appointments for today. */
  dentist?: { name: string; appointments: BriefingAppointment[] };
}

type L = "ar" | "en";

const T = {
  currency: { ar: "ج.م", en: "EGP" },
  closeOut: { ar: "إقفال اليوم", en: "The day, closed out" },
  morning: { ar: "صباح الخير", en: "Good morning" },
  yourDay: { ar: "يومك", en: "Your day" },
  money: { ar: "💰 الفلوس", en: "💰 Money" },
  yesterdayMoney: { ar: "💰 إمبارح", en: "💰 Yesterday" },
  collected: { ar: "تحصيل", en: "Collected" },
  expenses: { ar: "مصروفات", en: "Expenses" },
  net: { ar: "الصافي", en: "Net" },
  discounts: { ar: "خصومات", en: "Discounts" },
  billedUnpaid: { ar: "شغل اتعمل ولسه متدفعش", en: "Billed, not yet paid" },
  perDentist: { ar: "لكل دكتور", en: "Per dentist" },
  patientsShort: { ar: "مريض", en: "pts" },
  vsSameDay: { ar: "عن نفس اليوم الأسبوع اللي فات", en: "vs same day last week" },
  vsYesterday: { ar: "عن إمبارح", en: "vs yesterday" },
  noDoctorRows: { ar: "من غير دكتور مسجّل", en: "with no dentist recorded" },
  appointments: { ar: "🗓️ المواعيد", en: "🗓️ Appointments" },
  todayAppts: { ar: "🗓️ النهارده", en: "🗓️ Today" },
  booked: { ar: "محجوز", en: "booked" },
  seen: { ar: "اتشاف", en: "seen" },
  missed: { ar: "غاب", en: "no-show" },
  cancelled: { ar: "اتلغى", en: "cancelled" },
  stillToCome: { ar: "لسه جاي", en: "still to come" },
  tomorrow: { ar: "بكرة", en: "Tomorrow" },
  appts: { ar: "ميعاد", en: "appointments" },
  firstAt: { ar: "أول ميعاد", en: "first at" },
  unconfirmed: { ar: "غير مؤكد", en: "unconfirmed" },
  busiestHour: { ar: "أكتر ساعة زحمة", en: "Busiest hour" },
  dentists: { ar: "الدكاترة", en: "Dentists" },
  nothingBooked: { ar: "مفيش مواعيد", en: "Nothing booked" },
  patients: { ar: "🧑‍🤝‍🧑 المرضى والعملاء", en: "🧑‍🤝‍🧑 Patients & leads" },
  newPatients: { ar: "مرضى جداد", en: "New patients" },
  newLeads: { ar: "عملاء جداد", en: "New leads" },
  handoffs: { ar: "محادثات واتساب مستنية حد يرد", en: "WhatsApp chats waiting for a person" },
  overdueFollowups: { ar: "متابعات عملاء فاتت", en: "Lead follow-ups overdue" },
  seenNoNext: { ar: "اتشافوا ومحجزوش ميعاد جاي", en: "Seen, nothing booked next" },
  unresolved: { ar: "مواعيد قديمة من غير حالة", en: "Old appointments never closed" },
  staleBalances: { ar: "حسابات عليها رصيد وساكتة", en: "Quiet balances" },
  accounts: { ar: "حساب", en: "accounts" },
  toChase: { ar: "📌 محتاج متابعة", en: "📌 To chase" },
  team: { ar: "👥 الفريق", en: "👥 Team" },
  present: { ar: "حضر", en: "present" },
  late: { ar: "اتأخر", en: "late" },
  absent: { ar: "غاب", en: "absent" },
  min: { ar: "دقيقة", en: "min" },
  noSchedule: { ar: "من غير جدول شغل", en: "without a work schedule" },
  rostered: { ar: "شغالين النهارده", en: "Rostered today" },
  stockLow: { ar: "📦 مخزون قرب يخلص", en: "📦 Low stock" },
  items: { ar: "صنف", en: "items" },
  footer: { ar: "من نظام ألفا دنتال", en: "Sent by Alpha Dental" },
} as const;

const t = (key: keyof typeof T, l: L) => T[key][l];

const DAYS_AR = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayLabel(dateKey: string, l: L): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  const day = l === "ar" ? DAYS_AR[d.getUTCDay()] : DAYS_EN[d.getUTCDay()];
  const [y, m, dd] = dateKey.split("-");
  return `${day} ${Number(dd)}/${Number(m)}/${y}`;
}

function money(n: number, l: L): string {
  return `${Math.round(n).toLocaleString("en-US")} ${t("currency", l)}`;
}

/** "↑ 12%" against a base, or nothing when the base is zero. */
function arrow(current: number, previous: number | null | undefined): string {
  if (previous === null || previous === undefined || previous <= 0) return "";
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return "=";
  return `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}%`;
}

function withArrow(text: string, a: string, why: string): string {
  return a ? `${text}  (${a} ${why})` : text;
}

function countWord(n: number, one: string, many: string, l: L): string {
  if (l === "en") return `${n} ${n === 1 ? one : many}`;
  return `${n} ${many}`;
}

/* --- blocks ------------------------------------------------------------------------------------- */

function moneyBlock(b: Briefing, prefs: ResolvedReportPrefs, l: L, heading: string, dayCompare: boolean): string[] {
  const m = b.money;
  if (!m) return [];
  const lines: string[] = [`*${heading}*`];

  const comparisonWhy = m.comparison.sameWeekdayCollected !== null ? t("vsSameDay", l) : t("vsYesterday", l);
  const comparisonBase = m.comparison.sameWeekdayCollected ?? m.comparison.previousCollected;
  const collectedLine = `${t("collected", l)}: ${money(m.collected, l)}`;
  lines.push(prefs.comparisons && dayCompare ? withArrow(collectedLine, arrow(m.collected, comparisonBase), comparisonWhy) : collectedLine);

  if (m.expenses > 0 || prefs.moneyDetail !== "totals") {
    lines.push(`${t("expenses", l)}: ${money(m.expenses, l)} · ${t("net", l)}: ${money(m.netCash, l)}`);
  }

  if (prefs.moneyDetail === "full") {
    if (m.byMethod.length > 1) {
      lines.push(m.byMethod.map((x) => `${x.method} ${Math.round(x.amount).toLocaleString("en-US")}`).join(" · "));
    }
    const extras: string[] = [];
    if (m.discounts > 0) extras.push(`${t("discounts", l)} ${Math.round(m.discounts).toLocaleString("en-US")}`);
    if (m.billedUnpaid > 0) extras.push(`${t("billedUnpaid", l)} ${Math.round(m.billedUnpaid).toLocaleString("en-US")}`);
    if (extras.length) lines.push(extras.join(" · "));
  }

  if (prefs.moneyDetail !== "totals" && b.production && b.production.doctors.length > 0) {
    lines.push(`${t("perDentist", l)}:`);
    const doctors = [...b.production.doctors].sort((a, c) => c.collected - a.collected).slice(0, 8);
    for (const d of doctors) {
      lines.push(`• ${d.name} — ${countWord(d.patientsSeen, "pt", t("patientsShort", l), l)} · ${money(d.collected, l)}`);
    }
  }
  return lines;
}

function appointmentsBlock(b: Briefing, prefs: ResolvedReportPrefs, l: L): string[] {
  const c = b.counts;
  const lines: string[] = [`*${t("appointments", l)}*`];
  if (c.total === 0) {
    lines.push(t("nothingBooked", l));
  } else {
    const noShows = b.appointments.filter((a) => a.status === "No Show").length;
    const cancelled = b.appointments.filter((a) => a.status === "Cancelled").length;
    const parts = [`${c.total} ${t("booked", l)}`, `${c.attended} ${t("seen", l)}`];
    if (noShows > 0) parts.push(`${noShows} ${t("missed", l)}`);
    if (cancelled > 0) parts.push(`${cancelled} ${t("cancelled", l)}`);
    if (c.stillScheduled > 0) parts.push(`${c.stillScheduled} ${t("stillToCome", l)}`);
    lines.push(parts.join(" · "));
    if (prefs.moneyDetail === "full" && b.production?.busiestHour) {
      lines.push(`${t("busiestHour", l)}: ${b.production.busiestHour.hour}`);
    }
  }
  const n = b.nextUp;
  if (n.key === "tomorrow") {
    const parts = [`${t("tomorrow", l)}: ${countWord(n.appointments, "appointment", t("appts", l), l)}`];
    if (n.firstAppointmentTime) parts.push(`${t("firstAt", l)} ${n.firstAppointmentTime}`);
    if (n.unconfirmed > 0) parts.push(`${n.unconfirmed} ${t("unconfirmed", l)}`);
    lines.push(parts.join(" · "));
  }
  return lines;
}

function todayBlock(b: Briefing, l: L): string[] {
  const lines: string[] = [`*${t("todayAppts", l)}*`];
  const open = b.appointments.filter((a) => a.status !== "Cancelled");
  if (open.length === 0) {
    lines.push(t("nothingBooked", l));
    return lines;
  }
  const first = open.map((a) => a.time).filter(Boolean).sort()[0];
  const unconfirmed = open.filter((a) => a.status === "Scheduled").length;
  const parts = [countWord(open.length, "appointment", t("appts", l), l)];
  if (first) parts.push(`${t("firstAt", l)} ${first}`);
  if (unconfirmed > 0) parts.push(`${unconfirmed} ${t("unconfirmed", l)}`);
  lines.push(parts.join(" · "));
  const doctors = [...new Set(open.map((a) => a.doctor).filter(Boolean))];
  if (doctors.length > 0) lines.push(`${t("dentists", l)}: ${doctors.join(l === "ar" ? "، " : ", ")}`);
  return lines;
}

function patientsBlock(b: Briefing, handoffs: number | undefined, l: L): string[] {
  const lines: string[] = [`*${t("patients", l)}*`];
  const g = b.growth;
  const sources = g.leadsBySource
    .slice(0, 3)
    .map((s) => `${s.source} ${s.count}`)
    .join(l === "ar" ? "، " : ", ");
  lines.push(
    `${t("newPatients", l)}: ${g.newPatients} · ${t("newLeads", l)}: ${g.newLeads}${g.newLeads > 0 && sources ? ` (${sources})` : ""}`,
  );
  if (handoffs && handoffs > 0) lines.push(`${t("handoffs", l)}: ${handoffs}`);
  if (b.actions.overdueFollowUpCount > 0) lines.push(`${t("overdueFollowups", l)}: ${b.actions.overdueFollowUpCount}`);
  return lines;
}

function chaseBlock(b: Briefing, access: BriefingAccess, l: L): string[] {
  const a = b.actions;
  const items: string[] = [];
  if (a.unresolvedCount > 0) items.push(`${t("unresolved", l)}: ${a.unresolvedCount}`);
  if (a.seenWithoutNextVisitCount > 0) items.push(`${t("seenNoNext", l)}: ${a.seenWithoutNextVisitCount}`);
  if (a.overdueFollowUpCount > 0) items.push(`${t("overdueFollowups", l)}: ${a.overdueFollowUpCount}`);
  if (access.money && a.staleBalanceTotal !== null && a.staleBalances.length > 0) {
    items.push(`${t("staleBalances", l)}: ${a.staleBalances.length} ${t("accounts", l)} · ${money(a.staleBalanceTotal, l)}`);
  }
  if (items.length === 0) return [];
  return [`*${t("toChase", l)}*`, ...items];
}

function teamBlock(b: Briefing, l: L): string[] {
  const hr = b.hr;
  if (!hr) return [];
  const lines: string[] = [`*${t("team", l)}*`];
  const worked = hr.staff.filter((s) => s.daysWorked > 0 || s.activeNow);
  const late = hr.staff.filter((s) => s.lateDays > 0);
  const absent = hr.staff.filter((s) => s.absentDays > 0);
  const parts = [`${worked.length} ${t("present", l)}`];
  if (late.length > 0) parts.push(`${late.length} ${t("late", l)}`);
  if (absent.length > 0) parts.push(`${absent.length} ${t("absent", l)}`);
  lines.push(parts.join(" · "));
  for (const s of late.slice(0, 5)) lines.push(`• ${s.name} — ${t("late", l)} ${s.lateMinutes} ${t("min", l)}`);
  for (const s of absent.slice(0, 5)) lines.push(`• ${s.name} — ${t("absent", l)}`);
  if (hr.withoutSchedule > 0) lines.push(`_${hr.withoutSchedule} ${t("noSchedule", l)}_`);
  return lines;
}

function rosterBlock(b: Briefing, l: L): string[] {
  const r = b.nextUp.staffRostered;
  if (!r || r.length === 0) return [];
  return [`*${t("team", l)}*`, `${t("rostered", l)}: ${r.join(l === "ar" ? "، " : ", ")}`];
}

function stockLine(b: Briefing, l: L): string[] {
  if (b.stock.lowCount === 0) return [];
  const names = b.stock.low.slice(0, 3).map((x) => x.name).join(l === "ar" ? "، " : ", ");
  return [`*${t("stockLow", l)}*`, `${b.stock.lowCount} ${t("items", l)}${names ? `: ${names}` : ""}`];
}

/* --- the three reports -------------------------------------------------------------------------- */

export function renderStaffReport(input: StaffReportInput): string {
  const l = input.prefs.language;
  const { today, prefs, access } = input;
  const blocks: string[][] = [];

  if (input.kind === "dentistDay") {
    const appts = (input.dentist?.appointments || []).filter((a) => a.status !== "Cancelled");
    const head = [`*${input.clinicName}*`, `☀️ ${t("yourDay", l)} — ${dayLabel(today.dateKey, l)}`];
    if (appts.length === 0) return [...head, "", t("nothingBooked", l), "", `_${t("footer", l)}_`].join("\n");
    const first = appts.map((a) => a.time).filter(Boolean).sort()[0];
    const summary = [countWord(appts.length, "patient", t("patientsShort", l), l)];
    if (first) summary.push(`${t("firstAt", l)} ${first}`);
    const rows = appts
      .slice(0, 30)
      .map((a) => `${a.time || "--:--"} — ${a.patientName}${a.treatment ? ` — ${a.treatment}` : ""}`);
    return [...head, summary.join(" · "), "", ...rows, "", `_${t("footer", l)}_`].join("\n");
  }

  if (input.kind === "morning") {
    blocks.push([`*${input.clinicName}*`, `☀️ ${t("morning", l)} — ${dayLabel(today.dateKey, l)}`]);
    if (prefs.sections.appointments) blocks.push(todayBlock(today, l));
    if (prefs.sections.money && access.money && input.yesterday?.money) {
      blocks.push(moneyBlock(input.yesterday, { ...prefs, moneyDetail: prefs.moneyDetail === "full" ? "dentists" : "totals" }, l, t("yesterdayMoney", l), true));
    }
    if (prefs.sections.patients) {
      const chase = chaseBlock(input.yesterday || today, access, l);
      if (chase.length) blocks.push(chase);
      if (input.handoffsWaiting && input.handoffsWaiting > 0) blocks.push([`${t("handoffs", l)}: ${input.handoffsWaiting}`]);
    }
    if (prefs.sections.team && access.hr) {
      const roster = input.yesterday ? rosterBlock(input.yesterday, l) : [];
      if (roster.length) blocks.push(roster);
    }
    blocks.push(stockLine(today, l));
  } else {
    blocks.push([`*${input.clinicName}*`, `📋 ${t("closeOut", l)} — ${dayLabel(today.dateKey, l)}`]);
    if (prefs.sections.money && access.money) blocks.push(moneyBlock(today, prefs, l, t("money", l), true));
    if (prefs.sections.appointments) blocks.push(appointmentsBlock(today, prefs, l));
    if (prefs.sections.patients) blocks.push(patientsBlock(today, input.handoffsWaiting, l));
    if (prefs.sections.team && access.hr) blocks.push(teamBlock(today, l));
    blocks.push(stockLine(today, l));
  }

  const body = blocks
    .filter((b) => b.length > 0)
    .map((b) => b.join("\n"))
    .join("\n\n");
  return `${body}\n\n_${t("footer", l)}_`;
}

/** The one-line push that accompanies a report, so the phone buzz says something. */
export function reportPushLine(kind: ReportKind, b: Briefing, l: L): { title: string; body: string } {
  if (kind === "evening") {
    const parts = [
      b.money ? money(b.money.collected, l) : null,
      `${b.counts.attended} ${t("seen", l)}`,
    ].filter(Boolean) as string[];
    return { title: t("closeOut", l), body: parts.join(" · ") };
  }
  const open = b.appointments.filter((a) => a.status !== "Cancelled");
  const first = open.map((a) => a.time).filter(Boolean).sort()[0];
  return {
    title: kind === "morning" ? t("todayAppts", l).replace(/^\S+\s/, "") : t("yourDay", l),
    body: `${countWord(open.length, "appointment", t("appts", l), l)}${first ? ` · ${t("firstAt", l)} ${first}` : ""}`,
  };
}
