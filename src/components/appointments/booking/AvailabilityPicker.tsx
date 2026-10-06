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

  const row = "grid grid-cols-1 gap-2 border-t border-line py-4 first:border-t-0 xl:grid-cols-[132px_minmax(0,1fr)] xl:gap-4";
  const label = "pt-2 text-[13px] font-semibold text-ink-muted";

  return (
    <div>
      {/* Dentist */}
      <div className={row}>
        <div className={label}>{isAr ? "الدكتور" : "Dentist"}</div>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-slab font-figure text-xs font-semibold text-white" aria-hidden="true">
            {(isGeneralDoctorValue(doctor) ? "GC" : doctor.replace(/^dr\.?\s*/i, "").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2)).toUpperCase()}
          </span>
          <select
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            data-tour="booking-doctor"
            aria-label={isAr ? "الدكتور" : "Dentist"}
            className="w-full max-w-sm rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-ink"
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
          <div className="flex max-w-xl flex-wrap gap-2">
            {branches.length > 1 && (
              <select
                value={branchId}
                onChange={(e) => setBranchId?.(e.target.value)}
                aria-label={isAr ? "الفرع" : "Branch"}
                className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-ink"
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
              className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-ink disabled:bg-surface-subtle disabled:text-ink-faint"
            >
              <option value="">
                {!selectedBranch
                  ? isAr ? "اختار الفرع الأول" : "Pick a branch first"
                  : rooms.length === 0
                    ? isAr ? "مفيش غرف للفرع ده" : "No rooms in this branch"
                    : isAr ? "أي غرفة" : "Any room"}
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
          <div className="inline-flex flex-wrap gap-0.5 rounded-xl bg-surface-muted p-[3px]" role="group" aria-label={isAr ? "مدة الجلسة" : "Session length"}>
            {durationOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setDuration(o.value)}
                aria-pressed={duration === o.value}
                data-tour={o.value === durationOptions[0].value ? "booking-duration" : undefined}
                className={`rounded-[9px] px-3 py-1.5 font-figure text-[13px] font-semibold transition-colors ${
                  duration === o.value ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-ink-body hover:text-ink"
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
          <label className="mt-1.5 block text-[11px] font-normal text-ink-faint">
            {isAr ? "يوم تاني:" : "Other day:"}
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              data-tour="booking-date"
              className="mt-1 block w-full max-w-[150px] rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink outline-none focus:border-ink"
            />
          </label>
        </div>
        <div className="custom-scrollbar flex gap-1.5 overflow-x-auto pb-1">
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
                className={`grid w-16 shrink-0 justify-items-center gap-px rounded-2xl border py-2 transition-colors ${
                  selected
                    ? "border-ink-slab bg-ink-slab text-white"
                    : closed
                      ? "border-dashed border-line bg-transparent text-ink-faint hover:border-line-strong"
                      : "border-line bg-surface text-ink hover:border-line-strong"
                }`}
              >
                <span className={`text-[10.5px] font-semibold uppercase tracking-wider ${selected ? "text-white/70" : "text-ink-muted"}`}>
                  {k === today ? (isAr ? "النهارده" : "Today") : new Date(y, m - 1, d).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "short" })}
                </span>
                <span className="font-figure text-xl font-semibold leading-tight">{d}</span>
                <span className={`text-[11px] ${selected ? "text-white/70" : n === 0 ? "text-danger" : "text-ink-muted"}`}>
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
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-surface-subtle px-4 py-3">
            <span className="font-figure font-semibold text-ink">{formatDayLabel(date, isAr)}</span>
            <span className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              <span>
                {doctorOptions.find((o) => o.value === doctor)?.label || doctor}
                {roomId && rooms.some((r) => r.id === roomId) ? " · " + rooms.find((r) => r.id === roomId)!.name : ""}
                {" · "}
                {durationOptions.find((o) => o.value === duration)?.label || String(duration)}
              </span>
              {loaded && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-2.5 w-2.5 rounded-[3px] border border-line-strong bg-surface" aria-hidden="true" />
                    {freeToday} {isAr ? "فاضي" : "free"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-2.5 w-2.5 rounded-[3px] border border-danger/30 bg-danger-tint" aria-hidden="true" />
                    {grid.length - freeToday} {isAr ? "محجوز" : "booked"}
                  </span>
                </>
              )}
            </span>
          </div>

          {offDay && (
            <p className="border-b border-line bg-surface-muted px-4 py-2.5 text-xs font-semibold text-ink-body">
              {isAr ? "العيادة قافلة اليوم ده — لو حجزت هيسألك الأول." : "The clinic is closed this day — booking it will ask you first."}
            </p>
          )}

          {!loaded ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-ink-muted">
              <Loader2 size={16} className="animate-spin" /> {isAr ? "بنشوف المواعيد…" : "Checking the diary…"}
            </div>
          ) : (
            <div className="grid gap-1 px-4 pt-1.5 pb-4" data-tour="booking-time">
              {groups.map((cells, gi) => (
                <div key={gi} className="grid grid-cols-1 gap-1.5 pt-2.5 xl:grid-cols-[84px_minmax(0,1fr)] xl:gap-3">
                  <span className="pt-2 text-xs font-semibold text-ink-muted">{groupNames[gi]}</span>
                  {cells.length === 0 ? (
                    <span className="pt-2 text-xs text-ink-faint">{isAr ? "مفيش مواعيد" : "No times"}</span>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-[7px]">
                      {cells.map((s) => {
                        const selected = s.current;
                        return (
                          <button
                            key={s.time}
                            type="button"
                            onClick={() => setTime(s.time)}
                            aria-pressed={selected}
                            title={s.busy ? (isAr ? "محجوز — لو اخترته هيسألك قبل الحفظ" : "Booked — saving will ask before double-booking") : undefined}
                            className={`rounded-[10px] border py-2 font-figure text-[13.5px] tabular-nums transition-colors ${
                              selected
                                ? `border-accent bg-accent font-semibold text-ink-on-accent ${s.busy ? "ring-2 ring-danger ring-offset-1" : ""}`
                                : s.busy
                                  ? "border-danger/30 bg-danger-tint text-danger hover:border-danger/60"
                                  : "border-line bg-surface text-ink hover:border-ink"
                            }`}
                          >
                            {formatTimeLabel(s.time, isAr)}
                            {s.busy && (
                              <span className="block font-sans text-[10px] font-semibold leading-tight">
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
