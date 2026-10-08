"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CalendarCheck, Clock, Smartphone, Timer, UserX } from "lucide-react";
import type { HrStaffRow } from "@/lib/automation/briefing/types";
import type { PunchRecord } from "@/lib/automation/briefing/data";
import { shiftOvertimeMinutes } from "@/lib/automation/briefing/hr";
import { hoursText, type Schedule } from "@/lib/hrClient";
import { formatStaffRoleLabel, isDentistStaff } from "@/lib/staffRoles";
import type { StaffCommission } from "@/lib/staffCommission";
import type { StaffInsuranceWork } from "@/lib/staffInsurance";
import type { StaffSettlementDraft } from "@/lib/moneyApi";
import { shortName } from "./TeamList";
import AttendanceTab from "./AttendanceTab";
import MoneyTab from "./MoneyTab";
import SettingsTab from "./SettingsTab";
import {
  CLINIC_TZ, daysWords, hoursWords, money, Section, timesWords,
  type PayDraft, type ProfileStaff, type ProfileTab, type RateRow, type SettlementView,
} from "./profileKit";

export type { PayDraft, ProfileStaff, ProfileTab, RateRow, SettlementView } from "./profileKit";

/**
 * One person, in four tabs.
 *
 * Until 2026-10 the profile was one column of seven cards — the dark header, the period, every
 * punch, two commission tables, the payouts, the roster editor, the access link — and the owner's
 * verdict was "hard to read and find what you want": the roster sat at the bottom under three empty
 * boxes, and the header tried to show six figures at once.
 *
 * Now the header says who and how much, and four tabs hold the rest: Summary (the period in plain
 * statements), Attendance (the punches), Money (earned and paid), Settings (shifts, pay, phone,
 * access). The tab lives in the URL next to the person, so a refresh or a shared link lands on the
 * same place. The figures and the rules behind them did not change — see the page for the three
 * rules that must not be undone.
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
  tab,
  onTab,
  onSavePay,
  onEditLog,
  onDeleteLog,
  onOvertime,
  onUnlinkDevice,
  onSetPct,
  onExportCommission,
  settlement,
  onSaveSettlement,
  onDeleteSettlement,
  rateRows,
  onSetRate,
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
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onSavePay: (draft: PayDraft) => void;
  onEditLog: (logId: string, checkIn: string, checkOut: string) => void;
  onDeleteLog: (logId: string) => void;
  onOvertime: (logId: string, decision: "approved" | "rejected") => void;
  onUnlinkDevice: () => void;
  /** Set one payment's rate by hand. Recomputed and audited server-side. */
  onSetPct: (paymentId: string, pct: number) => void;
  /** Download this dentist's commission for the period, both tables, as an Excel file. */
  onExportCommission: () => Promise<void>;
  /** Payouts and deductions over the dentist's history; null while loading. */
  settlement: SettlementView | null;
  /** Record a payout or deduction, or change one (`id`). Resolves true when it was saved. */
  onSaveSettlement: (draft: StaffSettlementDraft, id: string | null) => Promise<boolean>;
  onDeleteSettlement: (id: string) => Promise<void>;
  /** This dentist's rate per insurance company and per price list. */
  rateRows: RateRow[];
  /** Set (or with null, clear) this dentist's own rate on one company or list. */
  onSetRate: (row: RateRow, value: number | null) => void;
}) {
  const dentist = isDentistStaff(staff);
  const first = shortName(staff.name);
  const basePay = row?.estimatedPay ?? 0;
  // With the settlements loaded, what is owed is the whole history's earnings less what was paid —
  // not just this period's work, or last month's unpaid share would vanish on the first of the month.
  // A dentist is owed their commission history less what was paid, plus this period's base pay.
  // Anyone else is owed this period's base pay less what was paid in it — and with no salary set
  // the payouts are simply recorded, not held against a figure nobody typed.
  const total = dentist
    ? basePay + (settlement ? settlement.owed : commission.total + insurance.total)
    : Math.max(0, basePay - (settlement?.paidInPeriod ?? 0) - (settlement?.deductedInPeriod ?? 0));
  const daysWorked = row?.daysWorked ?? 0;
  const minutesWorked = row?.minutesWorked ?? 0;
  const earned = commission.total + insurance.total;

  /** Shifts waiting on a decision: ran past the roster and nobody has said pay / don't pay. */
  const pendingExtra = punches.filter(
    (p) => p.status === "completed" && p.overtimeStatus !== "approved" && p.overtimeStatus !== "rejected" && shiftOvertimeMinutes(p, schedule, CLINIC_TZ) > 0,
  ).length;
  const attendanceTodo = pendingExtra + (row?.openShifts ?? 0);

  /* --- the sentence at the top --------------------------------------------------------------- */
  const summary =
    daysWorked === 0
      ? isAr
        ? `${first} مسجّلش حضور في الفترة دي.`
        : `${first} has not clocked in during this period.`
      : isAr
        ? `${first} حضر ${daysWords(daysWorked, true)} واشتغل ${hoursWords(minutesWorked, true)} في الفترة دي.`
        : `${first} came in on ${daysWords(daysWorked, false)} and worked ${hoursWords(minutesWorked, false)} in this period.`;

  const owedNote = !settlement
    ? ""
    : dentist
      ? settlement.owed < 0
        ? isAr ? `مدفوع مقدّم ${money(-settlement.owed)}` : `Paid ahead by ${money(-settlement.owed)}`
        : settlement.owedBefore > 0
          ? isAr ? `منها ${money(settlement.owedBefore)} من قبل الفترة دي` : `incl. ${money(settlement.owedBefore)} from before this period`
          : ""
      : basePay === 0 && settlement.paidInPeriod > 0
        ? isAr ? "مفيش مرتب متسجل؛ الدفعات بتتسجل بس" : "No salary set; payouts are just recorded"
        : "";

  /* --- the period, as statements ------------------------------------------------------------- */
  type Fact = { icon: ReactNode; text: string; bad?: boolean; goTo?: ProfileTab };
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
          ? { icon: <Clock size={20} />, bad: true, text: isAr ? `اتأخر ${daysWords(row.lateDays, true)}` : `Late on ${daysWords(row.lateDays, false)}`, goTo: "attendance" }
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
        goTo: "attendance",
        text: isAr
          ? `نسي يسجّل خروج ${timesWords(row.openShifts, true)}.`
          : `Forgot to clock out ${timesWords(row.openShifts, false)}.`,
      });
    }
    if (row.overtimePendingMinutes > 0) {
      facts.push({
        icon: <Timer size={20} />,
        bad: true,
        goTo: "attendance",
        text: isAr
          ? `${hoursWords(row.overtimePendingMinutes, true)} وقت زيادة مستنية موافقتك.`
          : `${hoursWords(row.overtimePendingMinutes, false)} of extra time is waiting for your OK.`,
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
  if (scheduleAssumed) {
    facts.push({
      icon: <AlertTriangle size={20} />,
      bad: true,
      goTo: "settings",
      text: isAr ? "مفيش ورديات متسجلة، فالأرقام تقريبية." : "No shifts set, so the figures are an estimate.",
    });
  }
  if (!staff.registeredDeviceId) {
    facts.push({
      icon: <Smartphone size={20} />,
      text: isAr ? "مفيش موبايل مربوط لسه" : "No phone linked yet",
      goTo: "settings",
    });
  }

  /* --- the tabs ------------------------------------------------------------------------------ */
  const tabs: { id: ProfileTab; label: string; badge?: string; warn?: boolean }[] = [
    { id: "summary", label: isAr ? "الملخص" : "Summary" },
    {
      id: "attendance",
      label: isAr ? "الحضور" : "Attendance",
      badge: attendanceTodo > 0 ? String(attendanceTodo) : punches.length > 0 ? String(punches.length) : undefined,
      warn: attendanceTodo > 0,
    },
    { id: "money", label: isAr ? "الفلوس" : "Money", badge: dentist && earned > 0 ? money(earned) : undefined },
    { id: "settings", label: isAr ? "الإعدادات" : "Settings", warn: scheduleAssumed },
  ];

  const slabFigures = [
    { v: hoursText(minutesWorked), l: isAr ? "ساعات الشغل" : "Hours worked" },
    ...(dentist ? [{ v: money(earned), l: isAr ? "كسب في الفترة دي" : "Earned this period" }] : [{ v: money(basePay), l: isAr ? "المرتب" : "Base pay" }]),
    ...(settlement ? [{ v: money(settlement.paidInPeriod), l: isAr ? "اتدفع له" : "Paid out" }] : []),
  ];

  return (
    <div className="min-w-0">
      {/* --- who, and what they are owed ------------------------------------------------------ */}
      <div className="rounded-t-3xl bg-ink-slab px-6 pt-6 pb-7 text-white sm:px-8 sm:pt-8 sm:pb-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-[30px] font-black leading-tight tracking-tight">{staff.name}</h2>
            <p className="mt-1 text-[15px] font-semibold text-white/60">
              {formatStaffRoleLabel(staff, isAr)}
              {staff.speciality ? ` · ${staff.speciality}` : ""}
            </p>
          </div>
          {row?.activeNow && (
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold text-white/85">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: "var(--ok)" }} />
              {isAr ? "في العيادة دلوقتي" : "At work right now"}
            </span>
          )}
        </div>

        <p className="mt-5 max-w-3xl text-[17px] font-semibold leading-relaxed text-white/80">{summary}</p>

        <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-6">
          {/* The one figure that answers the question, marked with the page's single yellow. */}
          <div className="min-w-0 border-s-4 border-accent ps-5">
            <p className="font-figure text-[44px] font-extrabold leading-none">{money(total)}</p>
            <p className="mt-2 text-[14px] font-bold leading-tight text-white/75">{isAr ? "الإجمالي المستحق" : "Owed in total"}</p>
            {owedNote && <p className="mt-1 text-[13px] font-semibold leading-tight text-white/50">{owedNote}</p>}
          </div>
          {slabFigures.map((k) => (
            <div key={k.l} className="min-w-0">
              <p className="font-figure text-[28px] font-extrabold leading-none text-white/90">{k.v}</p>
              <p className="mt-2 text-[14px] font-semibold leading-tight text-white/50">{k.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* --- the tab bar: one row, sticks under the band so it is always a click away ---------- */}
      <div
        role="tablist"
        aria-label={isAr ? "أقسام الملف" : "Profile sections"}
        className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-x border-b border-line bg-surface px-2 no-scrollbar sm:px-4"
      >
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(t.id)}
              className={`relative flex shrink-0 items-center gap-2 px-3 py-4 text-[16px] font-bold transition-colors sm:px-4 ${
                active ? "text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
              {t.badge && (
                <span
                  className={`font-figure rounded-full px-2 py-0.5 text-[12px] font-bold ${
                    t.warn ? "bg-accent text-ink" : "bg-surface-muted text-ink-body"
                  }`}
                >
                  {t.badge}
                </span>
              )}
              {!t.badge && t.warn && <span aria-hidden className="size-2 rounded-full" style={{ background: "var(--warn)" }} />}
              {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-accent sm:inset-x-4" />}
            </button>
          );
        })}
      </div>

      {/* --- the open tab ------------------------------------------------------------------- */}
      <div className="divide-y divide-line rounded-b-3xl border-x border-b border-line bg-surface">
        {tab === "summary" && (
          <Section title={isAr ? "الفترة دي باختصار" : "This period at a glance"}>
            {facts.length === 0 ? (
              <p className="text-[15px] font-semibold text-ink-muted">{isAr ? "مفيش حاجة تتقال عن الفترة دي لسه." : "Nothing to report for this period yet."}</p>
            ) : (
              <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {facts.map((f) => (
                  <li key={f.text} className={`flex items-start gap-3 text-[16px] font-semibold leading-snug ${f.bad ? "text-danger" : "text-ink"}`}>
                    <span className={`mt-0.5 shrink-0 ${f.bad ? "text-danger" : "text-ink-muted"}`}>{f.icon}</span>
                    <span className="min-w-0">
                      {f.text}
                      {f.goTo && (
                        <button
                          type="button"
                          onClick={() => onTab(f.goTo!)}
                          className="ms-2 inline-flex items-center gap-1 text-[14px] font-bold text-ink-body underline decoration-line underline-offset-4 hover:text-ink"
                        >
                          {f.goTo === "attendance" ? (isAr ? "افتح الحضور" : "Open Attendance") : isAr ? "افتح الإعدادات" : "Open Settings"}
                          <ArrowRight size={14} className={isAr ? "rotate-180" : ""} />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === "attendance" && (
          <AttendanceTab
            punches={punches}
            schedule={schedule}
            canEdit={canEdit}
            isAr={isAr}
            onEditLog={onEditLog}
            onDeleteLog={onDeleteLog}
            onOvertime={onOvertime}
          />
        )}

        {tab === "money" && (
          <MoneyTab
            first={first}
            dentist={dentist}
            commission={commission}
            insurance={insurance}
            settlement={settlement}
            canEdit={canEdit}
            isAr={isAr}
            onSetPct={onSetPct}
            onExportCommission={onExportCommission}
            onSaveSettlement={onSaveSettlement}
            onDeleteSettlement={onDeleteSettlement}
          />
        )}

        {tab === "settings" && (
          <SettingsTab
            staff={staff}
            dentist={dentist}
            schedule={schedule}
            scheduleAssumed={scheduleAssumed}
            canEdit={canEdit}
            isAr={isAr}
            saving={saving}
            onSavePay={onSavePay}
            onUnlinkDevice={onUnlinkDevice}
            rateRows={rateRows}
            onSetRate={onSetRate}
          />
        )}
      </div>
    </div>
  );
}
