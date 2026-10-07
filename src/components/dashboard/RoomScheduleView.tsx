"use client";

/**
 * The dashboard's room calendar: one day, one column per room.
 *
 * Same grid language as the week view (time down the side, visits as cards packed side by side
 * when they overlap), but the columns are rooms, so the desk sees which chair is free when. A click
 * on an empty row books that room at that time; dragging a card moves it in time and, dropped in
 * another room's column, to that room.
 */

import { useMemo } from "react";
import { updateDoc, serverTimestamp } from "firebase/firestore";
import { getClinicDoc } from "@/lib/db-utils";
import { parseApptTimeToMinutes, updateBookingTime } from "@/lib/bookingService";
import { dayBoundsCovering, visitStartInDay, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { getAppointmentStageLabel, getAppointmentStatusStyles } from "@/lib/appointmentStages";
import { doctorCardLabel } from "@/lib/generalDentist";
import { timeRange } from "@/lib/scheduleCard";
import { WEEK_MIN_CARD_PX, WEEK_ROW_PX, minutesToClock, packOverlaps, weekCardTier } from "@/lib/weekSchedule";
import { NO_ROOM, roomColumns } from "@/lib/roomSchedule";
import type { ClinicBranch } from "@/lib/clinicLocations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Appt = any;

type Props = {
  appointments: Appt[];
  date: string;
  language: "en" | "ar";
  config: ClinicScheduleConfig;
  branches: ClinicBranch[];
  /** "" = every branch. */
  scopeBranchId: string;
  currentTime: Date;
  todayKey: string;
  onOpenAppointment: (apt: Appt) => void;
  /** An empty row was clicked: book this room at this time ("hh:mm AM"). */
  onBookSlot: (time: string, roomId: string, branchId: string) => void;
};

const COL_MIN_PX = 180;

export default function RoomScheduleView({
  appointments,
  date,
  language,
  config,
  branches,
  scopeBranchId,
  currentTime,
  todayKey,
  onOpenAppointment,
  onBookSlot,
}: Props) {
  const isAr = language === "ar";

  const { columns, columnOf } = useMemo(() => roomColumns(branches, scopeBranchId, appointments), [branches, scopeBranchId, appointments]);

  const bounds = useMemo(
    () =>
      dayBoundsCovering(
        config,
        appointments.map((apt) => {
          const startMin = parseApptTimeToMinutes(apt.time);
          return { startMin, endMin: startMin + (apt.duration || 30) };
        }),
      ),
    [config, appointments],
  );
  const slotDuration = config.slotDuration || 30;
  const pixelsPerMinute = WEEK_ROW_PX / slotDuration;
  const containerHeight = (bounds.end - bounds.start) * pixelsPerMinute;

  const timeSlots = useMemo(() => {
    const out: { minutes: number; label: string; value: string; outside: boolean }[] = [];
    for (let m = bounds.start; m < bounds.end; m += slotDuration) {
      const h = Math.floor(m / 60) % 24;
      const mins = m % 60;
      const h12 = h % 12 || 12;
      const std = `${String(h12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
      const label = isAr ? `${h12}:${String(mins).padStart(2, "0")} ${h >= 12 ? "م" : "ص"}` : `${h12}:${String(mins).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
      out.push({ minutes: m, label, value: std, outside: m < bounds.clinicStart || m >= bounds.clinicEnd });
    }
    return out;
  }, [bounds, slotDuration, isAr]);

  // Each room's visits, packed into lanes where they overlap.
  const layouts = useMemo(() => {
    const byCol = new Map<string, ReturnType<typeof packOverlaps<Appt & { startMin: number; endMin: number; dur: number }>>>();
    for (const col of columns) {
      const visits = appointments
        .filter((a) => columnOf.get(a.id) === col.id)
        .map((apt) => {
          const startMin = visitStartInDay(parseApptTimeToMinutes(apt.time), bounds);
          const dur = Math.min(apt.duration || 30, bounds.end - startMin);
          return { ...apt, startMin, endMin: startMin + dur, dur };
        });
      byCol.set(col.id, packOverlaps(visits));
    }
    return byCol;
  }, [columns, columnOf, appointments, bounds]);

  /** Free rows in a room's day: clinic-hours rows nothing in that room overlaps. */
  const freeRows = (colId: string) => {
    const placed = layouts.get(colId) ?? [];
    return timeSlots.filter((s) => !s.outside && !placed.some((a) => s.minutes < a.endMin && s.minutes + slotDuration > a.startMin)).length;
  };

  const nowTop = useMemo(() => {
    if (date !== todayKey) return null;
    const nowMin = visitStartInDay(currentTime.getHours() * 60 + currentTime.getMinutes(), bounds);
    if (nowMin < bounds.start || nowMin >= bounds.end) return null;
    return (nowMin - bounds.start) * pixelsPerMinute;
  }, [date, todayKey, currentTime, bounds, pixelsPerMinute]);

  if (columns.length === 0) {
    return (
      <div className="m-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">
        {isAr
          ? "مفيش غرف متسجلة للفرع ده. ضيف الغرف من الإعدادات ← الفروع والغرف."
          : "No rooms are set up for this branch. Add them under Settings → Branches & rooms."}
      </div>
    );
  }

  const colStyle = { flex: "1 1 0%", minWidth: `${COL_MIN_PX}px` };
  const minWidth = 100 + columns.length * COL_MIN_PX;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface" style={{ minWidth: `${minWidth}px` }}>
      {/* Header: each room, how many visits and free rows it has */}
      <div className="sticky top-0 z-20 flex shrink-0 border-b border-line bg-surface">
        <div className="w-[84px] shrink-0 border-e border-line md:w-[100px]" />
        {columns.map((col) => {
          const count = (layouts.get(col.id) ?? []).length;
          const free = col.id === NO_ROOM ? null : freeRows(col.id);
          return (
            <div key={col.id} style={colStyle} className="min-w-0 border-e border-line px-3 py-2.5 text-center last:border-e-0">
              <p className="truncate font-figure text-sm font-semibold text-ink" title={col.label}>
                {col.id === NO_ROOM ? (isAr ? "من غير غرفة" : "No room") : col.label}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-ink-muted">
                {isAr ? `${count} زيارة` : `${count} ${count === 1 ? "visit" : "visits"}`}
                {free !== null && (isAr ? ` · ${free} فاضي` : ` · ${free} free`)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="custom-scrollbar relative flex-1 overflow-y-auto">
        <div className="relative" style={{ height: `${containerHeight}px` }}>
          {/* Time column */}
          <div className="pointer-events-none absolute inset-y-0 start-0 z-10 flex w-[84px] flex-col border-e border-line bg-surface-subtle md:w-[100px]">
            {timeSlots.map((slot, idx) => (
              <div key={idx} className="relative flex-1" style={{ height: `${WEEK_ROW_PX}px` }}>
                <div className={`absolute end-2 font-figure text-[11px] font-semibold text-ink-muted md:end-3 ${idx === 0 ? "top-3" : "top-0 -translate-y-1/2"}`}>
                  {slot.label}
                </div>
              </div>
            ))}
          </div>

          {/* Room columns */}
          <div className="absolute inset-y-0 start-[84px] end-0 flex md:start-[100px]">
            {columns.map((col) => (
              <div
                key={col.id}
                style={colStyle}
                className="relative min-w-0 border-e border-line/60 last:border-e-0"
                onDragEnter={(e) => e.preventDefault()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const raw = e.dataTransfer.getData("text/plain");
                  if (!raw) return;
                  try {
                    const { id } = JSON.parse(raw) as { id: string };
                    const rect = e.currentTarget.getBoundingClientRect();
                    const minsFromStart = Math.round((e.clientY - rect.top) / pixelsPerMinute / 5) * 5;
                    void updateBookingTime(id, date, minutesToClock(bounds.start + minsFromStart));
                    const apt = appointments.find((a) => a.id === id);
                    if (apt && col.id !== NO_ROOM && apt.roomId !== col.id) {
                      void updateDoc(getClinicDoc("appointments", id), {
                        roomId: col.id,
                        roomName: col.roomName,
                        branchId: col.branchId || apt.branchId || null,
                        updatedAt: serverTimestamp(),
                      }).catch((err) => console.error("Room move failed", err));
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }}
              >
                {/* Rows: a click on an empty one books this room then */}
                <div className="absolute inset-0 flex flex-col">
                  {timeSlots.map((slot, idx) => (
                    <div
                      key={idx}
                      className={`flex-1 cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-subtle ${slot.outside ? "bg-surface-muted" : ""}`}
                      onClick={() => onBookSlot(slot.value, col.id === NO_ROOM ? "" : col.id, col.branchId)}
                    />
                  ))}
                </div>

                {nowTop !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: `${nowTop}px` }} aria-hidden>
                    <div className="h-0.5 bg-ink-slab" />
                  </div>
                )}

                <div className="pointer-events-none absolute inset-0">
                  {(layouts.get(col.id) ?? []).map((apt) => {
                    const top = (apt.startMin - bounds.start) * pixelsPerMinute;
                    const h = Math.max(apt.dur * pixelsPerMinute - 2, WEEK_MIN_CARD_PX);
                    const tier = weekCardTier(h);
                    const styles = getAppointmentStatusStyles(apt.status);
                    const width = 100 / apt.totalCols;
                    return (
                      <div
                        key={apt.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ id: apt.id }))}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenAppointment(apt);
                        }}
                        className={`pointer-events-auto absolute flex cursor-pointer flex-col overflow-hidden rounded-lg border transition-shadow hover:!z-[60] hover:shadow-md bg-accent-tint border-accent-soft/80 shadow-sm text-slate-800`}
                        style={{
                          top: `${top}px`,
                          height: `${h}px`,
                          insetInlineStart: `calc(${apt.colIndex * width}% + 2px)`,
                          width: `calc(${width}% - 4px)`,
                          zIndex: 10 + apt.colIndex,
                        }}
                      >
                        <div className={`absolute inset-y-1 start-0 w-1 rounded-e-full ${styles.accent}`} />
                        <div className="relative z-10 flex h-full min-w-0 flex-col gap-0.5 overflow-hidden py-1 ps-2.5 pe-1.5">
                          <span className="truncate text-sm font-bold leading-tight text-ink">{apt.patientName}</span>
                          {tier !== "name" && (
                            <span className="truncate font-figure text-[11px] font-semibold text-ink-muted">{timeRange(minutesToClock(apt.startMin), apt.dur)}</span>
                          )}
                          {(tier === "time" || tier === "full") && (
                            <span className="truncate text-[11px] text-ink-body">
                              {apt.treatment || (isAr ? "كشف" : "Consultation")} · {doctorCardLabel(apt.doctor, language)}
                            </span>
                          )}
                          {tier === "full" && (
                            <span className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12.5px] font-semibold text-ink">
                              <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                              {getAppointmentStageLabel(apt.status, language)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
