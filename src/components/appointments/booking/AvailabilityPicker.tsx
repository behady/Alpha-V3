"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { getClinicCollection } from "@/lib/db-utils";
import type { ConflictCandidate } from "@/lib/appointmentConflicts";
import { parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { buildDaySlots, dateKeysFrom, isClinicOffDay, slotGrid, stripStartFor, type SlotCell } from "@/lib/bookingSlots";
import type { ClinicBranch } from "@/lib/clinicLocations";
import { doctorFieldFromPicker, GENERAL_DOCTOR_VALUE, generalDoctorLabel, isGeneralDoctorValue } from "@/lib/generalDentist";
import { formatDayLabel, formatTimeLabel, todayKey } from "./PatientTimeline";

const STRIP_DAYS = 14;

type Props = {
  language: string;
  sched: ClinicScheduleConfig;
  date: string;
  setDate: (v: string) => void;
  time: string;
  setTime: (v: string) => void;
  duration: number;
  setDuration: (v: number) => void;
  durationOptions: { label: string; value: number }[];
  /** The picker value: a dentist's name, or the General sentinel. */
  doctor: string;
  setDoctor: (v: string) => void;
  doctors: { id: string; name: string }[];
  /** The appointment being edited, which never counts as taking its own time. */
  excludeAppointmentId?: string | null;
  /** Branches and their rooms; the room picker shows only when the chosen branch has rooms. */
  branches?: ClinicBranch[];
  branchId?: string;
  setBranchId?: (v: string) => void;
  roomId?: string;
  setRoomId?: (v: string) => void;
};

/** Staff id for a picker value — the same resolution BookingModal saves with. */
function doctorIdFor(value: string, doctors: { id: string; name: string }[]): string | null {
  if (isGeneralDoctorValue(value)) return null;
  return doctors.find((d) => d.name === value)?.id || null;
}

/**
 * Dentist, session length, day and time — the booking popup's Appointment tab.
 *
 * Every time of the chosen day is shown. Taken ones are red but still clickable: a clinic sometimes
 * double-books on purpose, and the save-time warning ("Slot already taken — proceed anyway?")
 * still asks first, exactly as it did when the time was a plain dropdown.
 */
export default function AvailabilityPicker({
  language,
  sched,
  date,
  setDate,
  time,
  setTime,
  duration,
  setDuration,
  durationOptions,
  doctor,
  setDoctor,
  doctors,
  excludeAppointmentId = null,
  branches = [],
  branchId = "",
  setBranchId,
  roomId = "",
  setRoomId,
}: Props) {
  const isAr = language === "ar";
  const today = todayKey();
  const stripStart = stripStartFor(today, date, STRIP_DAYS);
  const days = useMemo(() => dateKeysFrom(stripStart, STRIP_DAYS), [stripStart]);
  const rangeKey = `${days[0]}|${days[days.length - 1]}`;

  // The whole fortnight in one listener: every day's "free" count needs its appointments, and a
  // date-range query on one field needs no extra index.
  const [range, setRange] = useState<{ key: string; byDate: Record<string, ConflictCandidate[]> } | null>(null);
  useEffect(() => {
    const [from, to] = rangeKey.split("|");
    return onSnapshot(
      query(getClinicCollection("appointments"), where("date", ">=", from), where("date", "<=", to)),
      (snap) => {
        const byDate: Record<string, ConflictCandidate[]> = {};
        snap.docs.forEach((d) => {
          const row = { id: d.id, ...(d.data() as Omit<ConflictCandidate, "id"> & { date?: string }) };
          const key = String(row.date || "");
          (byDate[key] ||= []).push(row);
        });
        setRange({ key: rangeKey, byDate });
      },
      () => setRange({ key: rangeKey, byDate: {} }),
    );
  }, [rangeKey]);
  const loaded = range?.key === rangeKey;

  const slots = useMemo(() => buildDaySlots(sched), [sched.startHour, sched.startMinute, sched.endHour, sched.endMinute, sched.slotDuration]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayStartMinutes = clinicDayBoundsMinutes(sched).start;

  const gridFor = (dayKey: string, pickerValue: string, current: string | null, room: string = roomId): SlotCell[] =>
    slotGrid(slots, loaded ? range!.byDate[dayKey] || [] : [], {
      duration,
      doctorId: doctorIdFor(pickerValue, doctors),
      doctorName: doctorFieldFromPicker(pickerValue),
      excludeAppointmentId,
      roomId: room || null,
      current,
      dayStartMinutes,
    });
  const freeCount = (dayKey: string, pickerValue: string, room: string = roomId) =>
    gridFor(dayKey, pickerValue, null, room).filter((s) => !s.busy).length;
  // A room's own free times that day, whoever the dentist: "is the room free" is its own question.
  const roomFreeCount = (room: string) =>
    slotGrid(slots, loaded ? range!.byDate[date] || [] : [], { duration, roomId: room, excludeAppointmentId, dayStartMinutes }).filter((s) => !s.busyRoom)
      .length;
  const selectedBranch = branches.find((b) => b.id === branchId) || null;
  const rooms = selectedBranch?.rooms ?? [];

  const grid = gridFor(date, doctor, time || null);
  const freeToday = grid.filter((s) => !s.busy).length;
  const offDay = isClinicOffDay(date, sched.offDays);

  const groups = useMemo(() => {
    const noon = 12 * 60;
    const evening = 17 * 60;
    const bucket = (t: string) => {
      const m = parseApptTimeToMinutes(t);
      if (m < dayStartMinutes) return 2; // after midnight: the tail of the evening
      return m < noon ? 0 : m < evening ? 1 : 2;
    };
    const out: SlotCell[][] = [[], [], []];
    grid.forEach((s) => out[bucket(s.time)].push(s));
    return out;
  }, [grid, dayStartMinutes]);
  const groupNames = isAr ? ["الصبح", "الضهر", "بالليل"] : ["Morning", "Afternoon", "Evening"];

  const doctorOptions = [{ value: GENERAL_DOCTOR_VALUE, label: generalDoctorLabel(language) }, ...doctors.map((d) => ({ value: d.name, label: d.name }))];
  const countLabel = (n: number) => (n === 0 ? (isAr ? "مليان" : "fully booked") : isAr ? `${n} فاضي` : `${n} free`);

  // Same label and control columns as the rest of the popup, so every row lines up.
  const row = "grid grid-cols-1 items-start gap-2 border-t border-line py-5 first:border-t-0 xl:grid-cols-[168px_minmax(0,1fr)] xl:gap-6";
  const label = "pt-3 text-sm font-semibold text-ink-body";
  const selectClass =
    "h-12 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] font-semibold text-ink outline-none transition-colors focus:border-ink focus:ring-2 focus:ring-ink/10";

  return (
    <div>
      {/* Dentist */}
      <div className={row}>
        <div className={label}>{isAr ? "الدكتور" : "Dentist"}</div>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink-slab font-figure text-sm font-semibold text-white" aria-hidden="true">
            {(isGeneralDoctorValue(doctor) ? "GC" : doctor.replace(/^dr\.?\s*/i, "").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2)).toUpperCase()}
          </span>
          <select
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            data-tour="booking-doctor"
            aria-label={isAr ? "الدكتور" : "Dentist"}
            className={`${selectClass} max-w-md`}
          >
            {doctorOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {loaded ? ` — ${offDay ? (isAr ? "العيادة قافلة" : "closed") : countLabel(freeCount(date, o.value))}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Branch and room */}
      {branches.length > 0 && (
        <div className={row}>
          <div className={label}>{isAr ? "الفرع والغرفة" : "Branch & room"}</div>
          <div className="flex max-w-2xl flex-wrap gap-3">
            {branches.length > 1 && (
              <select
                value={branchId}
                onChange={(e) => setBranchId?.(e.target.value)}
                aria-label={isAr ? "الفرع" : "Branch"}
                className={`${selectClass} min-w-0 flex-1`}
              >
                <option value="">{isAr ? "اختار الفرع الأول" : "Pick a branch first"}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={roomId}
              onChange={(e) => setRoomId?.(e.target.value)}
              disabled={!selectedBranch || rooms.length === 0}
              aria-label={isAr ? "الغرفة" : "Room"}
              className={`${selectClass} min-w-0 flex-1 disabled:bg-surface-subtle disabled:text-ink-faint`}
            >
              {/* A visit always has a room: the blank entry is only a placeholder, never a choice. */}
              <option value="" disabled={rooms.length > 0}>
                {!selectedBranch
                  ? isAr ? "اختار الفرع الأول" : "Pick a branch first"
                  : rooms.length === 0
                    ? isAr ? "مفيش غرف للفرع ده" : "No rooms in this branch"
                    : isAr ? "اختار الغرفة" : "Pick a room"}
              </option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {loaded && !offDay ? " — " + countLabel(roomFreeCount(r.id)) : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Session time */}
      <div className={row}>
        <div className={label}>{isAr ? "مدة الجلسة" : "Session time"}</div>
        <div>
          <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-muted p-1" role="group" aria-label={isAr ? "مدة الجلسة" : "Session length"}>
            {durationOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setDuration(o.value)}
                aria-pressed={duration === o.value}
                data-tour={o.value === durationOptions[0].value ? "booking-duration" : undefined}
                className={`h-10 rounded-lg px-4 font-figure text-sm font-semibold transition-colors ${
                  duration === o.value ? "bg-ink-slab text-white shadow-sm" : "text-ink-body hover:bg-surface hover:text-ink"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Date */}
      <div className={row}>
        <div className={label}>
          {isAr ? "اليوم" : "Date"}
          <label className="mt-2 block text-xs font-normal text-ink-muted">
            {isAr ? "يوم تاني:" : "Other day:"}
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              data-tour="booking-date"
              className="mt-1.5 block h-9 w-full max-w-[160px] rounded-lg border border-line-strong bg-surface px-2 text-[13px] font-semibold text-ink outline-none focus:border-ink"
            />
          </label>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {days.map((k) => {
            const [y, m, d] = k.split("-").map(Number);
            const closed = isClinicOffDay(k, sched.offDays);
            const n = loaded && !closed ? freeCount(k, doctor) : null;
            const selected = k === date;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setDate(k)}
                aria-pressed={selected}
                aria-label={`${formatDayLabel(k, isAr)}${closed ? (isAr ? "، العيادة قافلة" : ", clinic closed") : n !== null ? `, ${countLabel(n)}` : ""}`}
                className={`grid min-w-0 justify-items-center gap-0.5 rounded-xl border py-2.5 transition-colors ${
                  selected
                    ? "border-ink-slab bg-ink-slab text-white"
                    : closed
                      ? "border-dashed border-line bg-transparent text-ink-faint hover:border-line-strong"
                      : "border-line-strong bg-surface text-ink hover:border-ink"
                }`}
              >
                <span className={`text-xs font-semibold uppercase tracking-wide ${selected ? "text-white/75" : "text-ink-body"}`}>
                  {k === today ? (isAr ? "النهارده" : "Today") : new Date(y, m - 1, d).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "short" })}
                </span>
                <span className="font-figure text-2xl font-semibold leading-tight">{d}</span>
                <span className={`text-xs font-medium ${selected ? "text-white/75" : n === 0 ? "text-danger" : "text-ink-body"}`}>
                  {closed ? (isAr ? "قافلة" : "Closed") : n === null ? "·" : n === 0 ? (isAr ? "مليان" : "Full") : isAr ? `${n} فاضي` : `${n} free`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Times */}
      <div className={row}>
        <div className={label}>{isAr ? "المواعيد" : "Available slot"}</div>
        <div className="overflow-hidden rounded-2xl border border-line-strong">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-surface-subtle px-5 py-3.5">
            <span className="font-figure text-lg font-semibold text-ink">{formatDayLabel(date, isAr)}</span>
            <span className="flex flex-wrap items-center gap-4 text-[13px] text-ink-body">
              <span>
                {doctorOptions.find((o) => o.value === doctor)?.label || doctor}
                {roomId && rooms.some((r) => r.id === roomId) ? " · " + rooms.find((r) => r.id === roomId)!.name : ""}
                {" · "}
                {durationOptions.find((o) => o.value === duration)?.label || String(duration)}
              </span>
              {loaded && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-3 w-3 rounded-[4px] border border-line-strong bg-surface" aria-hidden="true" />
                    {freeToday} {isAr ? "فاضي" : "free"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-3 w-3 rounded-[4px] border border-danger/40 bg-danger-tint" aria-hidden="true" />
                    {grid.length - freeToday} {isAr ? "محجوز" : "booked"}
                  </span>
                </>
              )}
            </span>
          </div>

          {offDay && (
            <p className="border-b border-line bg-surface-muted px-5 py-3 text-[13px] font-semibold text-ink-body">
              {isAr ? "العيادة قافلة اليوم ده — لو حجزت هيسألك الأول." : "The clinic is closed this day — booking it will ask you first."}
            </p>
          )}

          {!loaded ? (
            <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-ink-body">
              <Loader2 size={16} className="animate-spin" /> {isAr ? "بنشوف المواعيد…" : "Checking the diary…"}
            </div>
          ) : (
            <div className="grid gap-2 px-5 pt-2 pb-5" data-tour="booking-time">
              {groups.map((cells, gi) => (
                <div key={gi} className="grid grid-cols-1 gap-2 pt-3 xl:grid-cols-[96px_minmax(0,1fr)] xl:gap-4">
                  <span className="pt-3 text-sm font-semibold text-ink-body">{groupNames[gi]}</span>
                  {cells.length === 0 ? (
                    <span className="pt-3 text-sm text-ink-muted">{isAr ? "مفيش مواعيد" : "No times"}</span>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
                      {cells.map((s) => {
                        const selected = s.current;
                        return (
                          <button
                            key={s.time}
                            type="button"
                            onClick={() => setTime(s.time)}
                            aria-pressed={selected}
                            title={s.busy ? (isAr ? "محجوز — لو اخترته هيسألك قبل الحفظ" : "Booked — saving will ask before double-booking") : undefined}
                            className={`flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-1.5 font-figure text-[15px] font-medium tabular-nums transition-colors ${
                              selected
                                ? `border-accent bg-accent font-bold text-ink-on-accent shadow-sm ${s.busy ? "ring-2 ring-danger ring-offset-1" : ""}`
                                : s.busy
                                  ? "border-danger/40 bg-danger-tint text-danger hover:border-danger"
                                  : "border-line-strong bg-surface text-ink hover:border-ink hover:bg-surface-subtle"
                            }`}
                          >
                            {formatTimeLabel(s.time, isAr)}
                            {s.busy && (
                              <span className="block text-[11px] font-semibold leading-tight">
                                {s.busyRoom && !s.busyDentist
                                  ? isAr ? "الغرفة مشغولة" : "Room busy"
                                  : s.busyDentist && !s.busyRoom && roomId
                                    ? isAr ? "الدكتور مشغول" : "Dentist busy"
                                    : isAr ? "محجوز" : "Booked"}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
