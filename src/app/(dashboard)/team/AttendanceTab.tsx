"use client";

import { useState } from "react";
import { CheckCircle2, Edit2, Hourglass, MapPin, Save, Timer, Trash2 } from "lucide-react";
import type { PunchRecord } from "@/lib/automation/briefing/data";
import { shiftOvertimeMinutes } from "@/lib/automation/briefing/hr";
import { hoursText, type Schedule } from "@/lib/hrClient";
import { btnDark, btnGhost, CLINIC_TZ, dayOf, distanceWords, Empty, FAR_M, fieldInput, fieldLabel, hoursWords, inputValue, Section, timeOf } from "./profileKit";

/**
 * Every shift in the period: when they came, when they left, where they were, and — only on a
 * shift that ran past the roster — whether the extra time is paid.
 */
export default function AttendanceTab({
  punches,
  schedule,
  canEdit,
  isAr,
  onEditLog,
  onDeleteLog,
  onOvertime,
}: {
  punches: readonly PunchRecord[];
  schedule: Schedule;
  canEdit: boolean;
  isAr: boolean;
  onEditLog: (logId: string, checkIn: string, checkOut: string) => void;
  onDeleteLog: (logId: string) => void;
  onOvertime: (logId: string, decision: "approved" | "rejected") => void;
}) {
  const [editingLog, setEditingLog] = useState<string | null>(null);
  const [logIn, setLogIn] = useState("");
  const [logOut, setLogOut] = useState("");

  return (
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
        <ul className="divide-y divide-line">
          {punches.map((log) => {
            const editing = editingLog === log.id;
            const far = log.checkInDistanceM != null && log.checkInDistanceM > FAR_M;
            const extra = log.status === "completed" ? shiftOvertimeMinutes(log, schedule, CLINIC_TZ) : 0;
            return (
              <li key={log.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-muted text-ink-muted">
                      {log.status === "active" ? <Hourglass size={19} className="animate-pulse" /> : <CheckCircle2 size={19} />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[16px] font-extrabold text-ink">{dayOf(log.date, isAr)}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-semibold text-ink-body">
                        {/*
                          Arabic says the range in words. Forcing the span left-to-right (as the
                          English needs) scrambled "1:25 م – 9:00 م" into "م – 9:00 م 1:25".
                        */}
                        {isAr ? (
                          <span className="font-figure">
                            من {timeOf(log.checkIn, true)} لـ {timeOf(log.checkOut, true)}
                          </span>
                        ) : (
                          <span className="font-figure" dir="ltr">
                            {timeOf(log.checkIn, false)} – {timeOf(log.checkOut, false)}
                          </span>
                        )}
                        {log.status !== "active" && (
                          <span className="font-figure text-ink-muted">{hoursText(log.durationMinutes)}</span>
                        )}
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
                  <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl bg-surface-subtle p-4 sm:grid-cols-2">
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
                  a shift that actually ran past the roster. A stale "approved" on an on-time shift
                  is hidden too: with no extra minutes it moves no money.
                */}
                {extra > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-surface-subtle px-4 py-3">
                    <Timer size={18} className="shrink-0 text-ink-muted" />
                    <span className="text-[15px] font-semibold text-ink">
                      {isAr
                        ? `فضل ${hoursWords(extra, true)} زيادة عن ورديته.`
                        : `Stayed ${hoursWords(extra, false)} past their shift.`}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-[13px] font-bold ${
                        log.overtimeStatus === "approved"
                          ? "bg-ok-tint text-ok"
                          : log.overtimeStatus === "rejected"
                            ? "bg-danger-tint text-danger"
                            : "bg-accent text-ink"
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
  );
}
