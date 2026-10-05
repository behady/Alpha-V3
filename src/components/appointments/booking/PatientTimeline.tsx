"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { Loader2, Plus } from "lucide-react";
import { getClinicCollection } from "@/lib/db-utils";
import { getAppointmentStageLabel, getAppointmentStatusStyles } from "@/lib/appointmentStages";
import { parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { doctorCardLabel } from "@/lib/generalDentist";

/** One of the patient's appointments, as stored. Spread into the popup's edit snapshot when picked. */
export type TimelineAppointment = {
  id: string;
  patientId: string;
  patientName: string;
  date?: string;
  time?: string;
  duration?: number;
  doctor?: string;
  treatment?: string;
  status?: string;
  [key: string]: unknown;
};

type Props = {
  patientId: string;
  /** The appointment open in the popup; null while a new visit is being booked. */
  activeId: string | null;
  language: string;
  onPick: (appt: TimelineAppointment) => void;
  onNew: () => void;
  /** False while a brand-new patient is being typed in: there is nothing to list and no "new visit" to start. */
  canBookAnother: boolean;
};

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDayLabel(dateKey: string, isAr: boolean, withWeekday = true): string {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB", {
    ...(withWeekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "short",
  });
}

/** "09:30 AM" → "9:30 AM" (or "9:30 ص"). */
export function formatTimeLabel(time: string | undefined, isAr: boolean): string {
  if (!time) return "";
  const t = time.replace(/^0(\d:)/, "$1");
  return isAr ? t.replace("AM", "ص").replace("PM", "م") : t;
}

/**
 * The patient's visits, upcoming first (soonest at the top) and then the past (latest first).
 * Picking one switches the popup to editing it; "New visit" books another for the same patient.
 */
export default function PatientTimeline({ patientId, activeId, language, onPick, onNew, canBookAnother }: Props) {
  const isAr = language === "ar";
  const [rows, setRows] = useState<{ patientId: string; list: TimelineAppointment[] } | null>(null);

  useEffect(() => {
    if (!patientId) return;
    return onSnapshot(
      query(getClinicCollection("appointments"), where("patientId", "==", patientId)),
      (snap) =>
        setRows({
          patientId,
          list: snap.docs.map((d) => ({ ...(d.data() as Omit<TimelineAppointment, "id">), id: d.id }) as TimelineAppointment),
        }),
      () => setRows({ patientId, list: [] }),
    );
  }, [patientId]);

  const loaded = !!patientId && rows?.patientId === patientId;
  const { upcoming, past } = useMemo(() => {
    const list = loaded ? rows!.list : [];
    const today = todayKey();
    const byTime = (a: TimelineAppointment, b: TimelineAppointment) =>
      String(a.date || "").localeCompare(String(b.date || "")) || parseApptTimeToMinutes(a.time) - parseApptTimeToMinutes(b.time);
    return {
      upcoming: list.filter((a) => String(a.date || "") >= today).sort(byTime),
      past: list.filter((a) => String(a.date || "") < today).sort((a, b) => byTime(b, a)),
    };
  }, [loaded, rows]);

  const card = (a: TimelineAppointment, isPast: boolean) => {
    const styles = getAppointmentStatusStyles(a.status);
    const active = a.id === activeId;
    return (
      <li key={a.id} className="relative">
        <span className={`absolute -start-[18px] top-4 h-3 w-3 rounded-full ring-[3px] ring-surface-subtle ${styles.dot}`} aria-hidden="true" />
        <button
          type="button"
          onClick={() => onPick(a)}
          aria-pressed={active}
          className={`w-full rounded-2xl border px-3 py-2.5 text-start transition-colors ${
            active
              ? "border-ink bg-surface ring-1 ring-ink"
              : isPast
                ? "border-line bg-transparent hover:border-line-strong"
                : "border-line bg-surface hover:border-line-strong"
          }`}
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-figure text-sm font-semibold text-ink">
              {a.date === todayKey() ? (isAr ? "النهارده" : "Today") : formatDayLabel(String(a.date || ""), isAr)}
            </span>
            <span className="font-figure text-xs tabular-nums text-ink-muted whitespace-nowrap">{formatTimeLabel(a.time, isAr)}</span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-body">{a.treatment || (isAr ? "زيارة" : "Visit")}</span>
          <span className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-ink-muted">{doctorCardLabel(a.doctor, language)}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink">
              <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} aria-hidden="true" />
              {getAppointmentStageLabel(a.status, isAr ? "ar" : "en")}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const groupLabel = "mt-5 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted";
  const listClass =
    "relative flex flex-col gap-2.5 ps-[18px] before:absolute before:start-[5px] before:top-3 before:bottom-3 before:w-px before:bg-line-strong";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-figure text-[15px] font-semibold text-ink">{isAr ? "سجل الزيارات" : "Timeline"}</h3>
        {loaded && (
          <span className="text-xs text-ink-muted">
            {upcoming.length + past.length} {isAr ? "زيارة" : upcoming.length + past.length === 1 ? "visit" : "visits"}
          </span>
        )}
      </div>

      {canBookAnother && (
        <button
          type="button"
          onClick={onNew}
          aria-pressed={activeId === null}
          className={`flex w-full items-center gap-2.5 rounded-2xl border-[1.5px] px-3.5 py-2.5 text-start text-sm font-semibold transition-colors ${
            activeId === null
              ? "border-solid border-ink bg-surface text-ink ring-1 ring-ink"
              : "border-dashed border-line-strong text-ink-body hover:border-ink hover:text-ink"
          }`}
        >
          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-ink-slab text-white">
            <Plus size={13} strokeWidth={3} />
          </span>
          <span>
            {isAr ? "زيارة جديدة" : "New visit"}
            <span className="block text-xs font-normal text-ink-muted">
              {activeId === null ? (isAr ? "بتتحجز دلوقتي" : "Being booked now") : isAr ? "احجز للمريض ده" : "Book for this patient"}
            </span>
          </span>
        </button>
      )}

      <div className="custom-scrollbar -me-2 min-h-0 flex-1 overflow-y-auto pe-2 pb-2">
        {!patientId ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line px-3 py-4 text-xs text-ink-muted">
            {isAr ? "اختار المريض عشان تشوف زياراته." : "Pick a patient to see their visits here."}
          </p>
        ) : !loaded ? (
          <div className="flex justify-center py-6">
            <Loader2 size={18} className="animate-spin text-ink-faint" />
          </div>
        ) : upcoming.length + past.length === 0 ? (
          <p className="mt-4 text-xs text-ink-muted">{isAr ? "مفيش زيارات قبل كده." : "No visits yet."}</p>
        ) : (
          <>
            {upcoming.length > 0 && (
              <>
                <div className={groupLabel}>{isAr ? "الجاية" : "Upcoming"}</div>
                <ol className={listClass}>{upcoming.map((a) => card(a, false))}</ol>
              </>
            )}
            {past.length > 0 && (
              <>
                <div className={groupLabel}>{isAr ? "اللي فاتت" : "Past"}</div>
                <ol className={listClass}>{past.map((a) => card(a, true))}</ol>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
