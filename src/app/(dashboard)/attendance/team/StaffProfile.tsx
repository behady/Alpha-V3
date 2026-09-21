"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, Hourglass, MapPin, Save, ShieldCheck,
  Smartphone, Trash2, Edit2, ExternalLink,
} from "lucide-react";
import type { HrStaffRow } from "@/lib/automation/briefing/types";
import type { PunchRecord } from "@/lib/automation/briefing/data";
import { hoursText, weeklyMinutes, type Schedule } from "@/lib/hrClient";
import { formatStaffRoleLabel, isDentistStaff } from "@/lib/staffRoles";
import { ChartFrame, Figure, ReportEmpty } from "@/components/reports/chartKit";
import type { StaffCommission } from "@/lib/staffCommission";

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_AR = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];

const money = (n: number) => Math.round(Number(n) || 0).toLocaleString();

function timeOf(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

/**
 * One person, everything about them, in the order the question is usually asked.
 *
 * The owner's words were "more useful, more user friendly": what made the old team table hard was
 * that a person's answer was spread across a row, a ⚙ modal and a Logs modal, and none of the three
 * showed the same period. So this is one column — what they are owed, then the punches it is made
 * of, then what they earned, then the settings that produced the figures. Nothing opens over
 * anything else.
 *
 * Two things are said out loud that the old screen left implicit. A person with no roster is shown
 * the assumption being made about them rather than a silently invented wage; and every punch shows
 * how far from the clinic it was taken, which is recorded on every clock-in and was displayed
 * nowhere.
 */
export default function StaffProfile({
  staff,
  row,
  schedule,
  scheduleAssumed,
  punches,
  commission,
  canEdit,
  isAr,
  saving,
  onSavePay,
  onEditLog,
  onDeleteLog,
  onOvertime,
  onUnlinkDevice,
}: {
  staff: ProfileStaff;
  row: HrStaffRow | null;
  schedule: Schedule;
  scheduleAssumed: boolean;
  punches: readonly PunchRecord[];
  commission: StaffCommission;
  canEdit: boolean;
  isAr: boolean;
  saving: boolean;
  onSavePay: (draft: PayDraft) => void;
  onEditLog: (logId: string, checkIn: string, checkOut: string) => void;
  onDeleteLog: (logId: string) => void;
  onOvertime: (logId: string, decision: "approved" | "rejected") => void;
  onUnlinkDevice: () => void;
}) {
  const [editingLog, setEditingLog] = useState<string | null>(null);
  const [logIn, setLogIn] = useState("");
  const [logOut, setLogOut] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [draft, setDraft] = useState<PayDraft | null>(null);

  const days = isAr ? DAYS_AR : DAYS_EN;
  const dentist = isDentistStaff(staff);
  const basePay = row?.estimatedPay ?? 0;
  const total = basePay + commission.total;

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

  return (
    <div className="space-y-4">
      {/* --- who, and what they are owed ------------------------------------------------------ */}
      <div className="rounded-3xl bg-ink-slab p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black">{staff.name}</h2>
            <p className="mt-0.5 text-[12px] font-semibold text-white/50">
              {formatStaffRoleLabel(staff, isAr)}
              {staff.speciality ? ` · ${staff.speciality}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {row?.activeNow && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
                <Hourglass size={11} /> {isAr ? "موجود دلوقتي" : "On the floor"}
              </span>
            )}
            {!staff.registeredDeviceId && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/60">
                <Smartphone size={11} /> {isAr ? "مفيش موبايل مربوط" : "No phone linked"}
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            { v: hoursText(row?.minutesWorked ?? 0), l: isAr ? "ساعات الفترة" : "Hours this period" },
            { v: money(basePay), l: isAr ? "الأساسي التقديري" : "Estimated base pay" },
            { v: money(commission.total), l: isAr ? "العمولة" : "Commission" },
            { v: money(total), l: isAr ? "الإجمالي" : "Total" },
          ].map((k) => (
            <div key={k.l} className="min-w-0">
              <p className="font-figure text-[24px] font-extrabold leading-none">{k.v}</p>
              <p className="mt-1 text-[11px] font-semibold leading-tight text-white/45">{k.l}</p>
            </div>
          ))}
        </div>

        {/*
          The assumption, stated. The payroll engine treats a person with no roster as unjudgeable
          and pays them zero; this screen keeps the clinic's long-standing default instead, because
          a young practice has rostered nobody and a page of zeroes reads as broken. Saying which
          one produced the figure is the difference between an estimate and a guess.
        */}
        {scheduleAssumed && (
          <p className="mt-5 flex items-start gap-2 rounded-2xl bg-white/5 px-4 py-2.5 text-[11.5px] font-semibold text-white/60">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {isAr
              ? "مفيش ورديات محددة للشخص ده، فبنحسب على الافتراضي: الأحد لـ الخميس، ١ بعد الضهر لـ ٩ بالليل."
              : "No roster is set for this person, so the figures assume the clinic default: Sunday to Thursday, 1pm to 9pm."}
          </p>
        )}
      </div>

      {/* --- what the period looked like ------------------------------------------------------ */}
      {row && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { v: String(row.daysWorked), l: isAr ? "أيام حضور" : "Days worked" },
            { v: String(row.scheduledDays), l: isAr ? "أيام مطلوبة" : "Days scheduled" },
            { v: String(row.lateDays), l: isAr ? "أيام تأخير" : "Late days", bad: row.lateDays > 0 },
            { v: String(row.absentDays), l: isAr ? "غياب" : "Absent", bad: row.absentDays > 0 },
            { v: hoursText(row.overtimePendingMinutes), l: isAr ? "إضافي مستني" : "Overtime pending", bad: row.overtimePendingMinutes > 0 },
          ].map((k) => (
            <div key={k.l} className="rounded-2xl border border-line bg-surface p-4">
              <Figure value={k.v} label={k.l} tone={k.bad ? "bad" : "ink"} />
            </div>
          ))}
        </div>
      )}

      {/* --- the punches --------------------------------------------------------------------- */}
      <ChartFrame
        title={isAr ? "الحضور والانصراف" : "Clock in and out"}
        note={
          isAr
            ? "كل دخول بيتسجل معاه بعده عن العيادة."
            : "Every clock-in records how far from the clinic it was taken."
        }
      >
        {punches.length === 0 ? (
          <ReportEmpty reason="period" isAr={isAr} />
        ) : (
          <ul className="space-y-2">
            {punches.map((log) => {
              const editing = editingLog === log.id;
              const far = log.checkInDistanceM != null && log.checkInDistanceM > 300;
              return (
                <li key={log.id} className="rounded-2xl border border-line bg-surface-subtle p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                          log.status === "active" ? "bg-emerald-50 text-emerald-600" : "bg-surface-muted text-ink-muted"
                        }`}
                      >
                        {log.status === "active" ? <Hourglass size={17} className="animate-pulse" /> : <CheckCircle2 size={17} />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-ink">{log.date}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] font-semibold text-ink-muted">
                          <span className="font-figure">{timeOf(log.checkIn)} → {timeOf(log.checkOut)}</span>
                          <span className="text-ink-faint">·</span>
                          <span className="font-figure text-ink-body">{hoursText(log.durationMinutes)}</span>
                          {log.checkInDistanceM != null && (
                            <>
                              <span className="text-ink-faint">·</span>
                              <span className={`inline-flex items-center gap-1 ${far ? "text-danger" : ""}`}>
                                <MapPin size={11} />
                                {Math.round(log.checkInDistanceM)} m
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => { onEditLog(log.id, logIn, logOut); setEditingLog(null); }}
                              className="inline-flex items-center gap-1 rounded-lg bg-ink-slab px-2.5 py-1.5 text-[11px] font-bold text-white"
                            >
                              <Save size={12} /> {isAr ? "حفظ" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingLog(null)}
                              className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-ink-body"
                            >
                              {isAr ? "إلغاء" : "Cancel"}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => { setEditingLog(log.id); setLogIn(inputValue(log.checkIn)); setLogOut(inputValue(log.checkOut)); }}
                              className="rounded-lg border border-line p-1.5 text-ink-muted transition-colors hover:text-ink"
                              aria-label={isAr ? "تعديل" : "Edit"}
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteLog(log.id)}
                              className="rounded-lg border border-line p-1.5 text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
                              aria-label={isAr ? "حذف" : "Delete"}
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {editing && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-ink-muted">
                          {isAr ? "الدخول" : "Clock in"}
                        </span>
                        <input
                          type="datetime-local"
                          value={logIn}
                          onChange={(e) => setLogIn(e.target.value)}
                          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-bold text-ink outline-none focus:border-accent"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-ink-muted">
                          {isAr ? "الانصراف (سيبه فاضي لو لسه)" : "Clock out (blank if still in)"}
                        </span>
                        <input
                          type="datetime-local"
                          value={logOut}
                          onChange={(e) => setLogOut(e.target.value)}
                          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-bold text-ink outline-none focus:border-accent"
                        />
                      </label>
                    </div>
                  )}

                  {/* Overtime is a decision, so it is asked on the shift it belongs to. */}
                  {log.status === "completed" && log.durationMinutes > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-ink-muted">
                        {isAr ? "وقت إضافي" : "Overtime"}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                          log.overtimeStatus === "approved"
                            ? "bg-emerald-50 text-emerald-700"
                            : log.overtimeStatus === "rejected"
                              ? "bg-danger-tint text-danger"
                              : "bg-surface-muted text-ink-body"
                        }`}
                      >
                        {log.overtimeStatus || (isAr ? "مستني" : "pending")}
                      </span>
                      {canEdit && (
                        <span className="ms-auto flex gap-1.5">
                          {log.overtimeStatus !== "approved" && (
                            <button type="button" onClick={() => onOvertime(log.id, "approved")} className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-bold text-ink-body hover:text-ink">
                              {isAr ? "موافقة" : "Approve"}
                            </button>
                          )}
                          {log.overtimeStatus !== "rejected" && (
                            <button type="button" onClick={() => onOvertime(log.id, "rejected")} className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-bold text-ink-body hover:text-danger">
                              {isAr ? "رفض" : "Reject"}
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
      </ChartFrame>

      {/* --- what they earned, payment by payment -------------------------------------------- */}
      {dentist && (
        <ChartFrame
          title={isAr ? "العمولة، دفعة دفعة" : "Commission, payment by payment"}
          note={
            isAr
              ? "النسبة المحفوظة على كل دفعة وقت ما اتحصّلت — مش النسبة الحالية."
              : "The rate stamped on each payment when it was taken, not today's rate."
          }
        >
          {commission.entries.length === 0 ? (
            <ReportEmpty reason="money" isAr={isAr} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-[10px] font-black uppercase tracking-wider text-ink-muted">
                    <th className="py-2 pe-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                    <th className="py-2 pe-3 text-start">{isAr ? "المريض" : "Patient"}</th>
                    <th className="py-2 pe-3 text-start">{isAr ? "العلاج" : "Treatment"}</th>
                    <th className="py-2 pe-3 text-end">{isAr ? "المدفوع" : "Paid"}</th>
                    <th className="py-2 pe-3 text-end">%</th>
                    <th className="py-2 text-end">{isAr ? "نصيبه" : "Their share"}</th>
                  </tr>
                </thead>
                <tbody>
                  {commission.entries.map((e) => (
                    <tr key={e.id} className="border-b border-line/60">
                      <td className="py-2.5 pe-3 font-figure font-semibold text-ink-muted">{e.date}</td>
                      <td className="py-2.5 pe-3 font-semibold text-ink">{e.patientName}</td>
                      <td className="py-2.5 pe-3 font-semibold text-ink-body">{e.serviceName}</td>
                      <td className="py-2.5 pe-3 text-end font-figure font-semibold text-ink-body">{money(e.paid)}</td>
                      <td className="py-2.5 pe-3 text-end font-figure font-semibold text-ink-muted">
                        {e.pct == null ? "—" : `${e.pct}%`}
                      </td>
                      <td className="py-2.5 text-end font-figure font-extrabold text-ink">{money(e.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5} className="py-2.5 pe-3 text-end text-[10px] font-black uppercase tracking-wider text-ink-muted">
                      {isAr ? "الإجمالي" : "Total"}
                    </td>
                    <td className="py-2.5 text-end font-figure text-[15px] font-extrabold text-ink">{money(commission.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </ChartFrame>
      )}

      {/* --- the settings that produced all of the above ------------------------------------- */}
      <ChartFrame
        title={isAr ? "الورديات والأجر" : "Shift and pay"}
        note={
          isAr
            ? "الورديات دي هي كمان اللي البوت بيحدد بيها مواعيد الطبيب المتاحة على واتساب."
            : "This roster is also what the WhatsApp bot uses to decide when this dentist is free."
        }
      >
        {!canEdit ? (
          <p className="text-[13px] font-semibold text-ink-muted">
            {isAr ? "الإعدادات دي للمالك والمديرين بس." : "Only the owner and admins can change these."}
          </p>
        ) : !payOpen || !draft ? (
          <div className="flex flex-wrap items-center gap-6">
            <Figure value={money(staff.baseSalary)} label={isAr ? "الأساسي الشهري" : "Monthly base"} />
            <Figure value={`${staff.commissionPercentage}%`} label={isAr ? "نسبة العمولة" : "Commission rate"} />
            <Figure value={`${staff.overtimeMultiplier || 1.5}×`} label={isAr ? "معامل الإضافي" : "Overtime rate"} />
            <Figure value={hoursText(weeklyMinutes(schedule))} label={isAr ? "أسبوعياً" : "Per week"} />
            <button
              type="button"
              onClick={openPay}
              className="ms-auto inline-flex items-center gap-2 rounded-xl bg-ink-slab px-4 py-2.5 text-[13px] font-bold text-white"
            >
              <Edit2 size={14} /> {isAr ? "تعديل" : "Edit"}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); onSavePay(draft); setPayOpen(false); }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { k: "baseSalary" as const, l: isAr ? "الأساسي الشهري" : "Monthly base", step: "1" },
                { k: "commissionPercentage" as const, l: isAr ? "نسبة العمولة %" : "Commission %", step: "0.5" },
                { k: "overtimeMultiplier" as const, l: isAr ? "معامل الإضافي" : "Overtime rate", step: "0.1" },
              ].map((f) => (
                <label key={f.k} className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-ink-muted">{f.l}</span>
                  <input
                    type="number"
                    min={0}
                    step={f.step}
                    value={draft[f.k]}
                    onChange={(e) => setDraft({ ...draft, [f.k]: Number(e.target.value) })}
                    className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 font-figure text-[15px] font-extrabold text-ink outline-none focus:border-accent"
                  />
                </label>
              ))}
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-ink-muted">
                  {isAr ? "التخصص" : "Speciality"}
                </span>
                <input
                  type="text"
                  value={draft.speciality}
                  onChange={(e) => setDraft({ ...draft, speciality: e.target.value })}
                  placeholder={isAr ? "مثال: تقويم" : "e.g. Orthodontics"}
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] font-bold text-ink outline-none focus:border-accent"
                />
              </label>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-ink-muted">
                  {isAr ? "ورديات الأسبوع" : "Weekly roster"}
                </span>
                <span className="font-figure text-[12px] font-bold text-ink-body">{hoursText(rosterMins)}</span>
              </div>
              <div className="space-y-1.5">
                {days.map((label, day) => {
                  const cfg = draft.schedule[day] || { active: false, start: "13:00", end: "21:00" };
                  return (
                    <div
                      key={day}
                      className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                        cfg.active ? "border-line bg-surface" : "border-line/60 bg-surface-subtle"
                      }`}
                    >
                      <label className="flex min-w-[8rem] items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={cfg.active}
                          onChange={(e) => setDay(day, { active: e.target.checked })}
                          className="size-4 cursor-pointer accent-[#111318]"
                        />
                        <span className={`text-[13px] font-bold ${cfg.active ? "text-ink" : "text-ink-muted"}`}>{label}</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          disabled={!cfg.active}
                          value={cfg.start}
                          onChange={(e) => setDay(day, { start: e.target.value })}
                          className="rounded-lg border border-line bg-surface px-2.5 py-1.5 font-figure text-[13px] font-bold text-ink outline-none disabled:opacity-40"
                        />
                        <span className="text-[11px] font-bold text-ink-muted">{isAr ? "لـ" : "to"}</span>
                        <input
                          type="time"
                          disabled={!cfg.active}
                          value={cfg.end}
                          onChange={(e) => setDay(day, { end: e.target.value })}
                          className="rounded-lg border border-line bg-surface px-2.5 py-1.5 font-figure text-[13px] font-bold text-ink outline-none disabled:opacity-40"
                        />
                      </div>
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
            <p className="flex items-start gap-2 rounded-2xl border border-line bg-surface-subtle px-4 py-2.5 text-[11.5px] font-semibold text-ink-muted">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {isAr
                ? "تغيير النسبة بيطبّق على الشغل الجديد. لو دفعة قديمة اتعدّلت بعد كده، هتتحسب بالنسبة الجديدة."
                : "A new rate applies to new work. If an older payment is edited afterwards, it is recalculated at the new rate."}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving || draft.commissionPercentage < 0 || draft.commissionPercentage > 100 || draft.overtimeMultiplier < 1}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-bold text-ink disabled:opacity-50"
              >
                <Save size={14} /> {isAr ? "حفظ" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setPayOpen(false)}
                className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-bold text-ink-body"
              >
                {isAr ? "إلغاء" : "Cancel"}
              </button>
              {staff.registeredDeviceId && (
                <button
                  type="button"
                  onClick={onUnlinkDevice}
                  className="ms-auto inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[13px] font-bold text-ink-body hover:text-danger"
                >
                  <Smartphone size={14} /> {isAr ? "فك ربط الموبايل" : "Unlink phone"}
                </button>
              )}
            </div>
          </form>
        )}
      </ChartFrame>

      {/* --- access -------------------------------------------------------------------------- */}
      {canEdit && (
        <ChartFrame title={isAr ? "الصلاحيات" : "Access"}>
          <div className="flex flex-wrap items-center gap-6">
            <Figure value={formatStaffRoleLabel(staff, isAr)} label={isAr ? "الدور" : "Role"} />
            <Figure
              value={String(staff.permissions?.length ?? 0)}
              label={isAr ? "صلاحية مفتوحة" : "Permissions granted"}
            />
            {/*
              A LINK, not a second editor. Roles and permissions are changed through a server route
              with its own guards, and a copy of that panel here would be a second door onto the one
              thing in this app that can lock somebody out of their own clinic.
            */}
            <Link
              href="/settings/users"
              className="ms-auto inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[13px] font-bold text-ink-body transition-colors hover:text-ink"
            >
              <ShieldCheck size={14} /> {isAr ? "إدارة الصلاحيات" : "Manage access"}
              <ExternalLink size={12} />
            </Link>
          </div>
        </ChartFrame>
      )}

    </div>
  );
}
