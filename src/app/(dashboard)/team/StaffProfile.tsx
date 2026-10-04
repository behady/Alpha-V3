"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle, CalendarCheck, CheckCircle2, Clock, Edit2, ExternalLink, Hourglass,
  MapPin, Save, ShieldCheck, Smartphone, Timer, Trash2, UserX,
} from "lucide-react";
import type { HrStaffRow } from "@/lib/automation/briefing/types";
import type { PunchRecord } from "@/lib/automation/briefing/data";
import { shiftOvertimeMinutes } from "@/lib/automation/briefing/hr";
import { hoursText, weeklyMinutes, type Schedule } from "@/lib/hrClient";
import { formatStaffRoleLabel, isDentistStaff } from "@/lib/staffRoles";
import type { StaffCommission } from "@/lib/staffCommission";
import type { StaffInsuranceWork } from "@/lib/staffInsurance";
import { shortName } from "./TeamRail";

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_AR = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];

/** The clinic's clock. The payroll engine splits regular from extra time on it, so this page does too. */
const CLINIC_TZ = "Africa/Cairo";

/** A punch further than this from the clinic is shown in red. */
const FAR_M = 300;

/**
 * Arabic with Western digits. Every figure on this page is set in the figure face with 0-9, so a
 * date in Arabic-Indic digits next to them read as a different kind of number.
 */
const locale = (isAr: boolean) => (isAr ? "ar-EG-u-nu-latn" : "en-GB");

const money = (n: number) => Math.round(Number(n) || 0).toLocaleString();

function timeOf(d: Date | null, isAr: boolean): string {
  if (!d) return isAr ? "لسه" : "still in";
  return d.toLocaleTimeString(locale(isAr), { hour: "numeric", minute: "2-digit" });
}

/** "Mon 29 Sep" — a day someone can place, instead of 2026-09-29. Midday, so no zone moves it. */
function dayOf(ymd: string, isAr: boolean): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(locale(isAr), { weekday: "short", day: "numeric", month: "short" });
}

/** Hours in words for a sentence: "7 hr 30 min" / "٧ ساعات و٣٠ دقيقة" reads better than "7h 30m". */
function hoursWords(minutes: number, isAr: boolean): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (isAr) {
    const hp = h === 0 ? "" : h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h <= 10 ? `${h} ساعات` : `${h} ساعة`;
    const mp = r === 0 ? "" : `${r} دقيقة`;
    return [hp, mp].filter(Boolean).join(" و") || "٠ دقيقة";
  }
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

/** "3 days" / "٣ أيام", with the singular and the Arabic dual handled. */
function daysWords(n: number, isAr: boolean): string {
  if (isAr) return n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوم`;
  return `${n} day${n === 1 ? "" : "s"}`;
}

function timesWords(n: number, isAr: boolean): string {
  if (isAr) return n === 1 ? "مرة" : n === 2 ? "مرتين" : n <= 10 ? `${n} مرات` : `${n} مرة`;
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

function distanceWords(m: number, isAr: boolean): string {
  if (m <= FAR_M) return isAr ? "من العيادة" : "at the clinic";
  if (m >= 1000) {
    const km = (m / 1000).toFixed(1);
    return isAr ? `على بعد ${km} كم` : `${km} km away`;
  }
  return isAr ? `على بعد ${Math.round(m)} متر` : `${Math.round(m)} m away`;
}

/** A `datetime-local` value from a Date, in local time rather than UTC. */
function inputValue(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type ProfileStaff = {
  id: string;
  uid?: string;
  name: string;
  role: string;
  isDentist?: boolean;
  phone?: string;
  email?: string;
  bio?: string;
  speciality?: string;
  baseSalary: number;
  commissionPercentage: number;
  overtimeMultiplier: number;
  registeredDeviceId?: string | null;
  permissions?: string[];
};

export type PayDraft = {
  baseSalary: number;
  commissionPercentage: number;
  overtimeMultiplier: number;
  speciality: string;
  schedule: Schedule;
};

/* --- building blocks ------------------------------------------------------------------------- */

/**
 * One card with a heading a person can read from a chair.
 *
 * The page used the reports' ChartFrame, which is sized for a dashboard of twenty charts: an 11px
 * note under a small title. Here there are five sections and the owner reads them one at a time, so
 * the heading is 19px and the explanation is a 14px sentence rather than a footnote.
 */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-7">
      <h3 className="text-[19px] font-extrabold leading-tight text-ink">{title}</h3>
      {note && <p className="mt-1.5 max-w-3xl text-[14px] font-medium leading-relaxed text-ink-muted">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line bg-surface-subtle px-6 py-10 text-center text-[15px] font-semibold text-ink-muted">
      {text}
    </p>
  );
}

/** A figure on a white card: 30px number, 14px label in everyday words. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="font-figure text-[30px] font-extrabold leading-none text-ink">{value}</p>
      <p className="mt-2 text-[14px] font-semibold leading-tight text-ink-muted">{label}</p>
    </div>
  );
}

const fieldLabel = "mb-2 block text-[14px] font-bold text-ink-body";
const fieldInput =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-[16px] font-bold text-ink outline-none focus:border-accent";
const btnGhost =
  "inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[14px] font-bold text-ink-body transition-colors hover:text-ink";
const btnDark = "inline-flex items-center gap-2 rounded-xl bg-ink-slab px-4 py-2.5 text-[14px] font-bold text-white";

/**
 * One person, everything about them, in the order the question is usually asked.
 *
 * Redesigned 2026-10 on the owner's ask: "easier, with bigger font and easier to understand".
 * The figures and the rules behind them are unchanged; what changed is how they are said:
 *
 *  - The slab opens with a SENTENCE ("Hana came in on 14 days and worked 112 hr…") before any
 *    number, so the card can be understood without decoding the figures under it.
 *  - The period is a short list of plain statements ("Late on 2 days", "Forgot to clock out once")
 *    instead of six stat tiles, and only a problem is coloured.
 *  - Every punch says its day as a day, its distance as "at the clinic" or "1.2 km away", and asks
 *    about extra time ONLY when the shift ran past the roster. It used to ask under every shift.
 *  - Nothing on the page is smaller than 13px; most text is 14–16px.
 *
 * Two things stay said out loud: a person with no roster is shown the assumption being made about
 * them, and lateness/absence are hidden for them (see the page and the team-page memory).
 */
export default function StaffProfile({
  staff,
  row,
  schedule,
  scheduleAssumed,
  punches,
  commission,
  insurance,
  canEdit,
  isAr,
  saving,
  onSavePay,
  onEditLog,
  onDeleteLog,
  onOvertime,
  onUnlinkDevice,
  onSetPct,
}: {
  staff: ProfileStaff;
  row: HrStaffRow | null;
  schedule: Schedule;
  scheduleAssumed: boolean;
  punches: readonly PunchRecord[];
  commission: StaffCommission;
  /** Insurance work assigned to this dentist in the period: paid apart from private commission. */
  insurance: StaffInsuranceWork;
  canEdit: boolean;
  isAr: boolean;
  saving: boolean;
  onSavePay: (draft: PayDraft) => void;
  onEditLog: (logId: string, checkIn: string, checkOut: string) => void;
  onDeleteLog: (logId: string) => void;
  onOvertime: (logId: string, decision: "approved" | "rejected") => void;
  onUnlinkDevice: () => void;
  /** Set one payment's rate by hand. Recomputed and audited server-side. */
  onSetPct: (paymentId: string, pct: number) => void;
}) {
  const [editingLog, setEditingLog] = useState<string | null>(null);
  const [logIn, setLogIn] = useState("");
  const [logOut, setLogOut] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [draft, setDraft] = useState<PayDraft | null>(null);
  /**
   * The rate cell being typed in, keyed by payment id.
   *
   * Held separately from the row so a half-typed "1" on the way to "15" never reaches the server,
   * and so the table keeps showing the stored figure until the box is left.
   */
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});

  const days = isAr ? DAYS_AR : DAYS_EN;
  const dentist = isDentistStaff(staff);
  const first = shortName(staff.name);
  const basePay = row?.estimatedPay ?? 0;
  const total = basePay + commission.total + insurance.total;
  const daysWorked = row?.daysWorked ?? 0;
  const minutesWorked = row?.minutesWorked ?? 0;

  const openPay = () => {
    setDraft({
      baseSalary: staff.baseSalary,
      commissionPercentage: staff.commissionPercentage,
      overtimeMultiplier: staff.overtimeMultiplier || 1.5,
      speciality: staff.speciality || "",
      schedule: JSON.parse(JSON.stringify(schedule)) as Schedule,
    });
    setPayOpen(true);
  };

  const setDay = (day: number, patch: Partial<{ active: boolean; start: string; end: string }>) =>
    setDraft((d) => (d ? { ...d, schedule: { ...d.schedule, [day]: { ...d.schedule[day], ...patch } } } : d));

  const rosterMins = draft ? weeklyMinutes(draft.schedule) : weeklyMinutes(schedule);

  /* --- the sentence at the top --------------------------------------------------------------- */
  const summary =
    daysWorked === 0
      ? isAr
        ? `${first} مسجّلش حضور في الفترة دي.`
        : `${first} has not clocked in during this period.`
      : isAr
        ? `${first} حضر ${daysWorked === 1 ? "يوم واحد" : daysWorked === 2 ? "يومين" : `${daysWorked} أيام`} واشتغل ${hoursWords(minutesWorked, true)} في الفترة دي.`
        : `${first} came in on ${daysWords(daysWorked, false)} and worked ${hoursWords(minutesWorked, false)} in this period.`;
  const owedLine = isAr
    ? `المستحق لحد النهارده حوالي ${money(total)}.`
    : `So far that comes to about ${money(total)}.`;

  /* --- the period, as statements ------------------------------------------------------------- */
  type Fact = { icon: ReactNode; text: string; bad?: boolean };
  const facts: Fact[] = [];
  if (row) {
    facts.push({
      icon: <CalendarCheck size={20} />,
      text: scheduleAssumed
        ? isAr
          ? `حضر ${daysWords(row.daysWorked, true)}`
          : `Came in on ${daysWords(row.daysWorked, false)}`
        : isAr
          ? `حضر ${row.daysWorked} من ${row.scheduledDays} يوم مطلوب`
          : `Came in on ${row.daysWorked} of ${row.scheduledDays} scheduled days`,
    });
    /*
      Lateness and absence are dropped when the roster is assumed. The engine judges a person
      against whatever roster it is handed, so an assumed one reported "16 absences" for somebody
      nobody has ever rostered — a fact about the assumption, not about them.
    */
    if (!scheduleAssumed) {
      facts.push(
        row.lateDays > 0
          ? { icon: <Clock size={20} />, bad: true, text: isAr ? `اتأخر ${daysWords(row.lateDays, true)}` : `Late on ${daysWords(row.lateDays, false)}` }
          : { icon: <Clock size={20} />, text: isAr ? "مااتأخرش ولا يوم" : "Never late" },
      );
      facts.push(
        row.absentDays > 0
          ? { icon: <UserX size={20} />, bad: true, text: isAr ? `غاب ${daysWords(row.absentDays, true)} من غير ما يسجّل` : `Missed ${daysWords(row.absentDays, false)} without clocking in` }
          : { icon: <UserX size={20} />, text: isAr ? "مفيش غياب" : "No missed days" },
      );
    }
    if (row.openShifts > 0) {
      facts.push({
        icon: <AlertTriangle size={20} />,
        bad: true,
        text: isAr
          ? `نسي يسجّل خروج ${timesWords(row.openShifts, true)}. صلّح الوقت تحت.`
          : `Forgot to clock out ${timesWords(row.openShifts, false)}. Fix the time below.`,
      });
    }
    if (row.overtimePendingMinutes > 0) {
      facts.push({
        icon: <Timer size={20} />,
        bad: true,
        text: isAr
          ? `${hoursWords(row.overtimePendingMinutes, true)} وقت زيادة مستنية موافقتك. وافق أو ارفض تحت.`
          : `${hoursWords(row.overtimePendingMinutes, false)} of extra time is waiting for your OK. Decide below.`,
      });
    }
    if (row.overtimeApprovedMinutes > 0) {
      facts.push({
        icon: <Timer size={20} />,
        text: isAr
          ? `${hoursWords(row.overtimeApprovedMinutes, true)} وقت زيادة متوافق عليها`
          : `${hoursWords(row.overtimeApprovedMinutes, false)} of extra time approved`,
      });
    }
  }

  const slabFigures = [
    { v: hoursText(minutesWorked), l: isAr ? "ساعات الشغل" : "Hours worked" },
    { v: money(basePay), l: isAr ? "المرتب" : "Base pay" },
    ...(dentist ? [{ v: money(commission.total), l: isAr ? "العمولة" : "Commission" }] : []),
    ...(dentist && insurance.total > 0 ? [{ v: money(insurance.total), l: isAr ? "نصيب التأمين" : "Insurance share" }] : []),
  ];

  return (
    <div className="space-y-5">
      {/* --- who, and what they are owed ------------------------------------------------------ */}
      <div className="rounded-3xl bg-ink-slab p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-[28px] font-black leading-tight">{staff.name}</h2>
            <p className="mt-1 text-[15px] font-semibold text-white/60">
              {formatStaffRoleLabel(staff, isAr)}
              {staff.speciality ? ` · ${staff.speciality}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {row?.activeNow && (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold text-white/85">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: "var(--ok)" }} />
                {isAr ? "في العيادة دلوقتي" : "At work right now"}
              </span>
            )}
            {!staff.registeredDeviceId && (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold text-white/65">
                <Smartphone size={14} /> {isAr ? "مفيش موبايل مربوط" : "No phone linked yet"}
              </span>
            )}
          </div>
        </div>

        <p className="mt-6 max-w-3xl text-[17px] font-semibold leading-relaxed text-white/85">
          {summary} {daysWorked > 0 || total > 0 ? owedLine : ""}
        </p>

        <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-6">
          {slabFigures.map((k) => (
            <div key={k.l} className="min-w-0">
              <p className="font-figure text-[34px] font-extrabold leading-none">{k.v}</p>
              <p className="mt-2 text-[14px] font-semibold leading-tight text-white/55">{k.l}</p>
            </div>
          ))}
          {/* The one figure that answers the question, marked with the page's single yellow. */}
          <div className="min-w-0 border-s-4 border-accent ps-5">
            <p className="font-figure text-[40px] font-extrabold leading-none">{money(total)}</p>
            <p className="mt-2 text-[14px] font-bold leading-tight text-white/75">{isAr ? "الإجمالي المستحق" : "Owed in total"}</p>
          </div>
        </div>

        {/*
          The assumption, stated. The payroll engine treats a person with no roster as unjudgeable
          and pays them zero; this screen keeps the clinic's long-standing default instead, because
          a young practice has rostered nobody and a page of zeroes reads as broken. Saying which
          one produced the figure is the difference between an estimate and a guess.
        */}
        {scheduleAssumed && (
          <p className="mt-6 flex items-start gap-2.5 rounded-2xl bg-white/5 px-4 py-3 text-[14px] font-semibold leading-relaxed text-white/70">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            {isAr
              ? "الشخص ده مالوش ورديات متسجلة، فالأرقام محسوبة على مواعيد العيادة العادية: الأحد لـ الخميس، من ١ الضهر لـ ٩ بالليل. حدد ورديته تحت عشان الحساب يبقى مظبوط."
              : "No shifts are set for this person, so the figures assume the clinic's usual hours: Sunday to Thursday, 1pm to 9pm. Set their shifts below to make the figures exact."}
          </p>
        )}
      </div>

      {/* --- what the period looked like ------------------------------------------------------ */}
      {facts.length > 0 && (
        <Section title={isAr ? "الفترة دي باختصار" : "This period at a glance"}>
          <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {facts.map((f) => (
              <li key={f.text} className={`flex items-start gap-3 text-[16px] font-semibold leading-snug ${f.bad ? "text-danger" : "text-ink"}`}>
                <span className={`mt-0.5 shrink-0 ${f.bad ? "text-danger" : "text-ink-muted"}`}>{f.icon}</span>
                {f.text}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* --- the punches --------------------------------------------------------------------- */}
      <Section
        title={isAr ? "مواعيد الدخول والخروج" : "Clock-in and clock-out times"}
        note={
          isAr
            ? "كل يوم حضره، وكان فين وهو بيسجّل دخول. لو وقت غلط، اضغط تعديل."
            : "Every shift in this period, and where they were when they clocked in. If a time is wrong, press Edit."
        }
      >
        {punches.length === 0 ? (
          <Empty text={isAr ? "مفيش حضور متسجل في الفترة دي." : "No clock-ins in this period."} />
        ) : (
          <ul className="space-y-3">
            {punches.map((log) => {
              const editing = editingLog === log.id;
              const far = log.checkInDistanceM != null && log.checkInDistanceM > FAR_M;
              const extra = log.status === "completed" ? shiftOvertimeMinutes(log, schedule, CLINIC_TZ) : 0;
              const decided = log.overtimeStatus === "approved" || log.overtimeStatus === "rejected";
              return (
                <li key={log.id} className="rounded-2xl border border-line bg-surface-subtle p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-muted text-ink-muted">
                        {log.status === "active" ? <Hourglass size={20} className="animate-pulse" /> : <CheckCircle2 size={20} />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[16px] font-extrabold text-ink">{dayOf(log.date, isAr)}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-semibold text-ink-body">
                          <span className="font-figure" dir="ltr">
                            {timeOf(log.checkIn, isAr)} – {timeOf(log.checkOut, isAr)}
                          </span>
                          <span className="font-figure text-ink-muted">{hoursText(log.durationMinutes)}</span>
                          {log.checkInDistanceM != null && (
                            <span className={`inline-flex items-center gap-1.5 ${far ? "font-bold text-danger" : "text-ink-muted"}`}>
                              <MapPin size={15} />
                              {distanceWords(log.checkInDistanceM, isAr)}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-2">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => { onEditLog(log.id, logIn, logOut); setEditingLog(null); }}
                              className={btnDark}
                            >
                              <Save size={16} /> {isAr ? "حفظ" : "Save"}
                            </button>
                            <button type="button" onClick={() => setEditingLog(null)} className={btnGhost}>
                              {isAr ? "إلغاء" : "Cancel"}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => { setEditingLog(log.id); setLogIn(inputValue(log.checkIn)); setLogOut(inputValue(log.checkOut)); }}
                              className={btnGhost}
                            >
                              <Edit2 size={16} /> {isAr ? "تعديل" : "Edit"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteLog(log.id)}
                              className={`${btnGhost} hover:bg-danger-tint hover:text-danger`}
                              aria-label={isAr ? "حذف" : "Delete"}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {editing && (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className={fieldLabel}>{isAr ? "وقت الدخول" : "Clocked in at"}</span>
                        <input type="datetime-local" value={logIn} onChange={(e) => setLogIn(e.target.value)} className={fieldInput} />
                      </label>
                      <label className="block">
                        <span className={fieldLabel}>{isAr ? "وقت الخروج (سيبه فاضي لو لسه جوه)" : "Clocked out at (leave empty if still in)"}</span>
                        <input type="datetime-local" value={logOut} onChange={(e) => setLogOut(e.target.value)} className={fieldInput} />
                      </label>
                    </div>
                  )}

                  {/*
                    Extra time is a decision, so it is asked on the shift it belongs to — and only on
                    a shift that actually ran past the roster, or one already decided (so a decision
                    can be reversed). It used to be asked under every shift.
                  */}
                  {log.status === "completed" && (extra > 0 || decided) && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                      <Timer size={18} className="shrink-0 text-ink-muted" />
                      <span className="text-[15px] font-semibold text-ink">
                        {extra > 0
                          ? isAr
                            ? `فضل ${hoursWords(extra, true)} زيادة عن ورديته.`
                            : `Stayed ${hoursWords(extra, false)} past their shift.`
                          : isAr
                            ? "وقت زيادة"
                            : "Extra time"}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[13px] font-bold ${
                          log.overtimeStatus === "approved"
                            ? "bg-ok-tint text-ok"
                            : log.overtimeStatus === "rejected"
                              ? "bg-danger-tint text-danger"
                              : "bg-surface-muted text-ink-body"
                        }`}
                      >
                        {log.overtimeStatus === "approved"
                          ? isAr ? "هيتدفع" : "Will be paid"
                          : log.overtimeStatus === "rejected"
                            ? isAr ? "مش هيتدفع" : "Not paid"
                            : isAr ? "مستني قرارك" : "Waiting for you"}
                      </span>
                      {canEdit && (
                        <span className="ms-auto flex gap-2">
                          {log.overtimeStatus !== "approved" && (
                            <button type="button" onClick={() => onOvertime(log.id, "approved")} className={btnGhost}>
                              {isAr ? "ادفعه" : "Pay it"}
                            </button>
                          )}
                          {log.overtimeStatus !== "rejected" && (
                            <button type="button" onClick={() => onOvertime(log.id, "rejected")} className={`${btnGhost} hover:text-danger`}>
                              {isAr ? "متدفعوش" : "Don't pay"}
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* --- insurance work, line by line: paid apart from private work --------------------- */}
      {dentist && insurance.entries.length > 0 && (
        <Section
          title={isAr ? "شغل التأمين" : "Insurance work"}
          note={
            isAr
              ? "الخدمات اللي الطبيب ده عملها على موافقات التأمين. النسبة اتحسبت على المبلغ الموافق عليه، ومنفصلة عن الشغل الخاص."
              : "Services this dentist did on insurance approvals. Their share is worked out on the approved amount and kept apart from private work."
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-[13px] font-bold text-ink-muted">
                  <th className="py-2.5 pe-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "المريض" : "Patient"}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "رقم الموافقة" : "Approval no."}</th>
                  <th className="py-2.5 pe-3 text-start">{isAr ? "الخدمة" : "Service"}</th>
                  <th className="py-2.5 pe-3 text-end">{isAr ? "الموافق عليه" : "Approved"}</th>
                  <th className="py-2.5 pe-3 text-end">%</th>
                  <th className="py-2.5 text-end">{isAr ? "نصيبه" : "Their share"}</th>
                </tr>
              </thead>
              <tbody>
                {insurance.entries.map((e) => (
                  <tr key={e.claimId + "-" + e.lineIndex} className="border-b border-line/60">
                    <td className="py-3 pe-3 font-semibold text-ink-muted">{dayOf(e.date, isAr)}</td>
                    <td className="py-3 pe-3 font-semibold text-ink">{e.patientName}</td>
                    <td className="py-3 pe-3 font-figure font-semibold text-ink-body" dir="ltr">{e.approvalNumber}</td>
                    <td className="py-3 pe-3 font-semibold text-ink-body">{e.service}</td>
                    <td className="py-3 pe-3 text-end font-figure font-semibold text-ink-body">{money(e.approved)}</td>
                    <td className="py-3 pe-3 text-end font-figure font-semibold text-ink-body">{e.rate}%</td>
                    <td className="py-3 text-end font-figure font-extrabold text-ink">{money(e.share)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="py-3 pe-3 text-[15px] font-bold text-ink">{isAr ? "الإجمالي" : "Total"}</td>
                  <td className="py-3 pe-3 text-end font-figure text-[18px] font-extrabold text-ink">{money(insurance.approved)}</td>
                  <td />
                  <td className="py-3 text-end font-figure text-[18px] font-extrabold text-ink">{money(insurance.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      )}

      {/* --- what they earned, payment by payment -------------------------------------------- */}
      {dentist && (
        <Section
          title={isAr ? "العمولة من كل دفعة" : "Commission from each payment"}
          note={
            isAr
              ? canEdit
                ? "النسبة اللي اتسجلت وقت ما المريض دفع. لو اتفقت على نسبة مختلفة لحالة واحدة، غيّرها هنا للدفعة دي بس."
                : "النسبة اللي اتسجلت وقت ما المريض دفع."
              : canEdit
                ? "The rate recorded when the patient paid. If you agreed a different rate for one case, change it here for that payment only."
                : "The rate recorded when the patient paid."
          }
        >
          {commission.entries.length === 0 ? (
            <Empty text={isAr ? "مفيش فلوس اتحصّلت على شغله في الفترة دي." : "No payments for their work in this period yet."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[13px] font-bold text-ink-muted">
                    <th className="py-2.5 pe-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                    <th className="py-2.5 pe-3 text-start">{isAr ? "المريض" : "Patient"}</th>
                    <th className="py-2.5 pe-3 text-start">{isAr ? "العلاج" : "Treatment"}</th>
                    <th className="py-2.5 pe-3 text-end">{isAr ? "المدفوع" : "Paid"}</th>
                    <th className="py-2.5 pe-3 text-end">%</th>
                    <th className="py-2.5 text-end">{isAr ? "نصيبه" : "Their share"}</th>
                  </tr>
                </thead>
                <tbody>
                  {commission.entries.map((e) => (
                    <tr key={e.id} className="border-b border-line/60">
                      <td className="py-3 pe-3 font-semibold text-ink-muted">{dayOf(e.date, isAr)}</td>
                      <td className="py-3 pe-3 font-semibold text-ink">{e.patientName}</td>
                      <td className="py-3 pe-3 font-semibold text-ink-body">{e.serviceName}</td>
                      <td className="py-3 pe-3 text-end font-figure font-semibold text-ink-body">{money(e.paid)}</td>
                      {/*
                        Editable, as it was on the old team table. This is the one-off: a case where
                        the dentist took a different cut, set on that payment rather than by moving
                        their standing rate and rewriting everything else. The server recomputes the
                        share and the clinic's profit from it and stamps the row as set by hand, so a
                        later repair pass can tell a deliberate override from a row that was never
                        computed properly.
                      */}
                      <td className="py-3 pe-3 text-end">
                        {canEdit ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.5"
                              inputMode="decimal"
                              aria-label={isAr ? "نسبة الدفعة" : "Rate on this payment"}
                              value={pctDraft[e.id] ?? (e.pct == null ? "" : String(e.pct))}
                              onChange={(ev) => setPctDraft((d) => ({ ...d, [e.id]: ev.target.value }))}
                              onBlur={(ev) => {
                                const raw = ev.target.value.trim();
                                setPctDraft((d) => {
                                  const next = { ...d };
                                  delete next[e.id];
                                  return next;
                                });
                                if (raw === "") return;
                                const next = Math.max(0, Math.min(100, Number(raw) || 0));
                                if (e.pct != null && next === e.pct) return;
                                onSetPct(e.id, next);
                              }}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                                if (ev.key === "Escape") {
                                  setPctDraft((d) => {
                                    const next = { ...d };
                                    delete next[e.id];
                                    return next;
                                  });
                                  (ev.target as HTMLInputElement).blur();
                                }
                              }}
                              className="w-20 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-end font-figure text-[15px] font-bold text-ink outline-none focus:border-accent"
                            />
                            <span className="font-figure text-[14px] font-semibold text-ink-muted">%</span>
                          </span>
                        ) : (
                          <span className="font-figure font-semibold text-ink-muted">
                            {e.pct == null ? "—" : `${e.pct}%`}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-end font-figure font-extrabold text-ink">{money(e.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5} className="py-3 pe-3 text-end text-[15px] font-bold text-ink">
                      {isAr ? "الإجمالي" : "Total"}
                    </td>
                    <td className="py-3 text-end font-figure text-[18px] font-extrabold text-ink">{money(commission.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* --- the settings that produced all of the above ------------------------------------- */}
      <Section
        title={isAr ? "الورديات والمرتب" : "Shifts and pay"}
        note={
          isAr
            ? `الأرقام اللي فوق محسوبة من هنا.${dentist ? " والورديات دي هي كمان اللي بوت الواتساب بيعرض منها مواعيد الدكتور." : ""}`
            : `The figures above are worked out from these settings.${dentist ? " The WhatsApp bot also uses these shifts to offer this dentist's free times." : ""}`
        }
      >
        {!canEdit ? (
          <p className="text-[15px] font-semibold text-ink-muted">
            {isAr ? "المالك والمديرين بس يقدروا يغيّروا دول." : "Only the owner and admins can change these."}
          </p>
        ) : !payOpen || !draft ? (
          <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
            <Stat value={money(staff.baseSalary)} label={isAr ? "المرتب الشهري" : "Monthly salary"} />
            {dentist && <Stat value={`${staff.commissionPercentage}%`} label={isAr ? "نسبة العمولة" : "Commission rate"} />}
            <Stat value={`${staff.overtimeMultiplier || 1.5}×`} label={isAr ? "الساعة الزيادة بتتحسب" : "Extra hours are paid at"} />
            <Stat value={hoursText(weeklyMinutes(schedule))} label={isAr ? "ساعات في الأسبوع" : "Hours a week"} />
            <button type="button" onClick={openPay} className={`ms-auto ${btnDark} px-5 py-3 text-[15px]`}>
              <Edit2 size={16} /> {isAr ? "تعديل الورديات والمرتب" : "Change shifts and pay"}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); onSavePay(draft); setPayOpen(false); }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { k: "baseSalary" as const, l: isAr ? "المرتب الشهري" : "Monthly salary", step: "1" },
                { k: "commissionPercentage" as const, l: isAr ? "نسبة العمولة %" : "Commission %", step: "0.5" },
                { k: "overtimeMultiplier" as const, l: isAr ? "الساعة الزيادة × كام" : "Extra hours paid at (×)", step: "0.1" },
              ].map((f) => (
                <label key={f.k} className="block">
                  <span className={fieldLabel}>{f.l}</span>
                  <input
                    type="number"
                    min={0}
                    step={f.step}
                    value={draft[f.k]}
                    onChange={(e) => setDraft({ ...draft, [f.k]: Number(e.target.value) })}
                    className={`${fieldInput} font-figure`}
                  />
                </label>
              ))}
              <label className="block">
                <span className={fieldLabel}>{isAr ? "التخصص" : "Speciality"}</span>
                <input
                  type="text"
                  value={draft.speciality}
                  onChange={(e) => setDraft({ ...draft, speciality: e.target.value })}
                  placeholder={isAr ? "مثال: تقويم" : "e.g. Orthodontics"}
                  className={fieldInput}
                />
              </label>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[16px] font-extrabold text-ink">{isAr ? "أيام ومواعيد الشغل" : "Working days and hours"}</span>
                <span className="font-figure text-[15px] font-bold text-ink-body">
                  {hoursText(rosterMins)} {isAr ? "في الأسبوع" : "a week"}
                </span>
              </div>
              <div className="space-y-2">
                {days.map((label, day) => {
                  const cfg = draft.schedule[day] || { active: false, start: "13:00", end: "21:00" };
                  return (
                    <div
                      key={day}
                      className={`flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-3 transition-colors ${
                        cfg.active ? "border-line bg-surface" : "border-line/60 bg-surface-subtle"
                      }`}
                    >
                      <label className="flex min-w-[9rem] cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={cfg.active}
                          onChange={(e) => setDay(day, { active: e.target.checked })}
                          className="size-5 cursor-pointer accent-[#111318]"
                        />
                        <span className={`text-[16px] font-bold ${cfg.active ? "text-ink" : "text-ink-muted"}`}>{label}</span>
                      </label>
                      {cfg.active ? (
                        <div className="flex items-center gap-2.5">
                          <span className="text-[14px] font-semibold text-ink-muted">{isAr ? "من" : "From"}</span>
                          <input
                            type="time"
                            value={cfg.start}
                            onChange={(e) => setDay(day, { start: e.target.value })}
                            className="rounded-xl border border-line bg-surface px-3 py-2 font-figure text-[15px] font-bold text-ink outline-none"
                          />
                          <span className="text-[14px] font-semibold text-ink-muted">{isAr ? "لـ" : "to"}</span>
                          <input
                            type="time"
                            value={cfg.end}
                            onChange={(e) => setDay(day, { end: e.target.value })}
                            className="rounded-xl border border-line bg-surface px-3 py-2 font-figure text-[15px] font-bold text-ink outline-none"
                          />
                        </div>
                      ) : (
                        <span className="text-[14px] font-semibold text-ink-muted">{isAr ? "أجازة" : "Day off"}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/*
              Said where the decision is made. The percentage is not only a future setting: the
              money routes re-read it from the staff record when a payment is edited, so changing it
              can move commission on work already recorded. The reports keep what was stamped at the
              time, which is why they and this figure can differ after a change.
            */}
            {dentist && (
              <p className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-[14px] font-semibold leading-relaxed text-ink-muted">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                {isAr
                  ? "النسبة الجديدة بتتطبّق على الشغل الجديد. لو دفعة قديمة اتعدّلت بعد كده، هتتحسب بالنسبة الجديدة."
                  : "A new commission rate applies to new work. If an older payment is edited later, it is recalculated at the new rate."}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="submit"
                disabled={saving || draft.commissionPercentage < 0 || draft.commissionPercentage > 100 || draft.overtimeMultiplier < 1}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-[15px] font-bold text-ink disabled:opacity-50"
              >
                <Save size={16} /> {isAr ? "حفظ" : "Save"}
              </button>
              <button type="button" onClick={() => setPayOpen(false)} className={`${btnGhost} px-5 py-3 text-[15px]`}>
                {isAr ? "إلغاء" : "Cancel"}
              </button>
              {staff.registeredDeviceId && (
                <button
                  type="button"
                  onClick={onUnlinkDevice}
                  className={`ms-auto ${btnGhost} px-5 py-3 text-[15px] hover:text-danger`}
                >
                  <Smartphone size={16} /> {isAr ? "فك ربط الموبايل" : "Unlink their phone"}
                </button>
              )}
            </div>
          </form>
        )}
      </Section>

      {/* --- access -------------------------------------------------------------------------- */}
      {canEdit && (
        <Section
          title={isAr ? "الصلاحيات" : "What they can open"}
          note={isAr ? "الدور والصلاحيات بيتغيّروا من صفحة المستخدمين." : "Role and permissions are changed on the Users page."}
        >
          <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
            <Stat value={formatStaffRoleLabel(staff, isAr)} label={isAr ? "الدور" : "Role"} />
            <Stat value={String(staff.permissions?.length ?? 0)} label={isAr ? "صلاحية مفتوحة" : "Permissions given"} />
            {/*
              A LINK, not a second editor. Roles and permissions are changed through a server route
              with its own guards, and a copy of that panel here would be a second door onto the one
              thing in this app that can lock somebody out of their own clinic.
            */}
            <Link href="/settings/users" className={`ms-auto ${btnGhost} px-5 py-3 text-[15px]`}>
              <ShieldCheck size={16} /> {isAr ? "إدارة الصلاحيات" : "Manage access"}
              <ExternalLink size={14} />
            </Link>
          </div>
        </Section>
      )}
    </div>
  );
}
