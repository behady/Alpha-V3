"use client";

/**
 * The dashboard's list view: one day as a plain agenda, in time order, optionally grouped by
 * dentist or by treatment. It is the view for working down a list — confirming tomorrow by
 * phone, or reading the day out at the morning huddle — where a grid of boxes is in the way.
 */

import { useMemo, useState } from "react";
import { BriefcaseMedical, DoorOpen, Globe, Stethoscope } from "lucide-react";
import { parseApptTimeToMinutes } from "@/lib/bookingService";
import { getAppointmentStageLabel, getAppointmentStatusStyles } from "@/lib/appointmentStages";
import { doctorCardLabel, generalDoctorLabel } from "@/lib/generalDentist";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Appt = any;

type GroupBy = "time" | "doctor" | "service";

const ONLINE_SOURCES = new Set(["online", "Online Booking Request", "Online Booking"]);

/** The treatment a visit is filed under in the "by treatment" grouping. */
const serviceKey = (a: Appt) => String(a.serviceName || a.treatment || "");

export default function ScheduleListView({
  appointments,
  language,
  multiBranch,
  selectedId,
  onOpenAppointment,
}: {
  /** The day's visits, already scoped to the branch on screen. */
  appointments: Appt[];
  language: "en" | "ar";
  /** Name the branch on each row only when there is more than one. */
  multiBranch: boolean;
  selectedId?: string | null;
  onOpenAppointment: (apt: Appt) => void;
}) {
  const isAr = language === "ar";
  const [groupBy, setGroupBy] = useState<GroupBy>("time");

  const groups = useMemo(() => {
    const sorted = [...appointments].sort((a, b) => parseApptTimeToMinutes(a.time || "") - parseApptTimeToMinutes(b.time || ""));
    if (sorted.length === 0) return [] as Array<{ key: string; appts: Appt[] }>;
    if (groupBy === "time") return [{ key: "", appts: sorted }];
    const map = new Map<string, Appt[]>();
    for (const a of sorted) {
      const key =
        groupBy === "doctor"
          ? String(a.doctor || "").trim() || generalDoctorLabel(language)
          : serviceKey(a) || (isAr ? "بدون خدمة" : "No service");
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.entries()].map(([key, appts]) => ({ key, appts }));
  }, [appointments, groupBy, language, isAr]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-ink-muted">{isAr ? "عرض حسب" : "Group by"}</span>
        <div className="flex gap-1 rounded-xl bg-surface-muted p-1">
          {(
            [
              { id: "time", en: "Time", ar: "الوقت" },
              { id: "doctor", en: "Dentist", ar: "الدكتور" },
              { id: "service", en: "Treatment", ar: "الخدمة" },
            ] as const
          ).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroupBy(g.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${groupBy === g.id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
            >
              {isAr ? g.ar : g.en}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="py-16 text-center text-sm font-bold text-ink-muted">{isAr ? "مفيش مواعيد في اليوم ده." : "No appointments on this day."}</p>
      ) : (
        <div className="space-y-6 pb-8">
          {groups.map((group) => (
            <div key={group.key || "all"}>
              {groupBy !== "time" && (
                <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-black text-ink">
                  {groupBy === "doctor" ? <Stethoscope size={14} className="text-ink-muted" /> : <BriefcaseMedical size={14} className="text-ink-muted" />}
                  {group.key}
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-ink-muted">{group.appts.length}</span>
                </h3>
              )}
              <div className="space-y-2">
                {group.appts.map((apt) => {
                  const styles = getAppointmentStatusStyles(apt.status);
                  const place = [multiBranch || !apt.roomName ? apt.branchName : null, apt.roomName].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={apt.id}
                      type="button"
                      onClick={() => onOpenAppointment(apt)}
                      className={`flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-start shadow-sm transition-all hover:shadow-md ${selectedId === apt.id ? "ring-2 ring-ink-slab" : ""}`}
                    >
                      <div className="flex min-w-[64px] shrink-0 flex-col items-center justify-center rounded-xl bg-surface-subtle px-2.5 py-2">
                        <span className="whitespace-nowrap font-figure text-xs font-black text-ink" dir="ltr">
                          {isAr ? String(apt.time || "").replace("AM", "ص").replace("PM", "م") : apt.time}
                        </span>
                        <span className="text-[9px] font-bold text-ink-muted">{apt.duration || 30}m</span>
                      </div>
                      <div className={`h-10 w-1 shrink-0 rounded-full ${styles.accent}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {ONLINE_SOURCES.has(apt.source) && <Globe className="h-3 w-3 shrink-0 text-ink-muted" />}
                          <span className="truncate text-sm font-extrabold text-ink">{apt.patientName}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-bold text-ink-muted">
                          {apt.claimId && (
                            <span className="me-1 rounded bg-ink px-1 py-px align-middle text-[9px] font-black uppercase tracking-wider text-white">
                              {isAr ? "تأمين" : "Insurance"}
                            </span>
                          )}
                          {apt.treatment || (isAr ? "كشف" : "Consultation")} · {doctorCardLabel(apt.doctor, language)}
                        </p>
                        {place && (
                          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-bold text-ink-muted">
                            <DoorOpen size={10} className="shrink-0" />
                            {place}
                          </p>
                        )}
                      </div>
                      <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[10px] ${styles.pill}`}>
                        {getAppointmentStageLabel(apt.status, language)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
