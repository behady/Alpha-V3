"use client";

/**
 * The dashboard's week: seven day columns on one hour grid, each with its numbers on top.
 *
 * A week is read for different things than a day. Nobody scans it card by card; they want to know
 * how full Tuesday is, where there is a gap to offer on the phone, who has still not confirmed,
 * and what is coming for the doctor. So every column carries a summary strip — visits,
 * unconfirmed, free slots, and the day's quoted money for those allowed to see it — and each card
 * says what the visit is for and with whom, which is the one line the owner asked for after the
 * name. The counts come from src/lib/weekSchedule.ts, which is pure and tested.
 *
 * The chrome is monochrome on purpose. The status bar on each card is the only colour here, so a
 * yellow bar can mean "unconfirmed" without competing with decoration. Today is the black slab,
 * the now-line is ink, and nothing is amber any more.
 */

import React, { useMemo } from "react";
import { CircleDashed, UserX, Wallet } from "lucide-react";
import { parseApptTimeToMinutes, updateBookingTime } from "@/lib/bookingService";
import { dayBoundsCovering, visitStartInDay, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { getAppointmentStageLabel, getAppointmentStatusStyles, normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { medicalAlert, timeRange, type PatientHistory } from "@/lib/scheduleCard";
import { doctorCardLabel } from "@/lib/generalDentist";
import { AlertBadge } from "@/components/dashboard/ScheduleCardDetails";
import {
    WEEK_MIN_CARD_PX,
    WEEK_ROW_PX,
    daySummary,
    isUnconfirmed,
    minutesToClock,
    weekCardTier,
    weekDaysFrom,
} from "@/lib/weekSchedule";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DashboardAppointment = any;

interface WeeklyScheduleViewProps {
    appointments: DashboardAppointment[];
    /** Any day of the week to show, YYYY-MM-DD. */
    currentDate: string;
    language: 'en' | 'ar';
    config: ClinicScheduleConfig;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patientsList: any[];
    onSelectAppointment: (apt: DashboardAppointment | null, time?: string, date?: string) => void;
    /** The dashboard's minute tick — draws the now-line on today's column. */
    currentTime: Date;
    /** Today as a LOCAL date key, from the parent, so "today" is never decided in UTC here. */
    todayKey: string;
    /** Whether this viewer may read money: the strip's pounds and the "owes" mark obey it. */
    canSeeMoney: boolean;
    /** What each patient owes from before the week, keyed by patient id. */
    patientHistory: Map<string, PatientHistory>;
}

export default function WeeklyScheduleView({
    appointments,
    currentDate,
    language,
    config,
    patientsList,
    onSelectAppointment,
    currentTime,
    todayKey,
    canSeeMoney,
    patientHistory,
}: WeeklyScheduleViewProps) {
    const isAr = language === 'ar';
    const locale = isAr ? 'ar-EG' : 'en-US';
    const num = (n: number) => n.toLocaleString(locale);

    // The same seven days the parent queried, from the same function.
    const weekDays = useMemo(() => weekDaysFrom(currentDate), [currentDate]);

    // Widened to cover every visit in the week — a booking outside the clinic's hours is still a
    // booking, and used to be drawn above the top edge where nobody could see it.
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
        const slots = [];
        for (let m = bounds.start; m < bounds.end; m += slotDuration) {
            const h = Math.floor(m / 60) % 24;
            const mins = m % 60;
            const ampm = h >= 12 ? (isAr ? 'م' : 'PM') : (isAr ? 'ص' : 'AM');
            const h12 = h % 12 || 12;
            const h12Str = isAr ? h12.toLocaleString('ar-EG', { minimumIntegerDigits: 2 }) : h12.toString().padStart(2, '0');
            const minsStr = isAr ? mins.toLocaleString('ar-EG', { minimumIntegerDigits: 2 }) : mins.toString().padStart(2, '0');
            const label = isAr ? `${ampm} ${h12Str}:${minsStr}` : `${h12Str}:${minsStr} ${ampm}`;

            const stdAmpm = h >= 12 ? 'PM' : 'AM';
            const stdValue = `${h12.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${stdAmpm}`;

            // Shaded when the clinic is closed at that hour.
            const outside = m < bounds.clinicStart || m >= bounds.clinicEnd;
            slots.push({ minutes: m, label, value: stdValue, outside });
        }
        return slots;
    }, [bounds, slotDuration, isAr]);

    // Per-day numbers for the strip, computed once per render of the week.
    const summaries = useMemo(() => {
        const byDay = new Map<string, ReturnType<typeof daySummary>>();
        for (const key of weekDays) {
            byDay.set(key, daySummary(appointments.filter((a) => a.date === key), config, key));
        }
        return byDay;
    }, [weekDays, appointments, config]);

    // Where the now-line sits on today's column, or null when the clock is outside the drawn day.
    const nowTop = useMemo(() => {
        const nowMin = visitStartInDay(currentTime.getHours() * 60 + currentTime.getMinutes(), bounds);
        if (nowMin < bounds.start || nowMin >= bounds.end) return null;
        return (nowMin - bounds.start) * pixelsPerMinute;
    }, [currentTime, bounds, pixelsPerMinute]);

    const dayLabel = (key: string) => {
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return { weekday: date.toLocaleDateString(locale, { weekday: 'short' }), dayNum: num(date.getDate()) };
    };

    const stripText = (key: string): string => {
        const s = summaries.get(key);
        if (!s || s.isOffDay) return '';
        if (s.isEmpty) return isAr ? 'لا مواعيد' : 'No visits';
        const parts = [isAr ? `${num(s.visits)} زيارة` : `${num(s.visits)} ${s.visits === 1 ? 'visit' : 'visits'}`];
        if (s.unconfirmed > 0) parts.push(isAr ? `${num(s.unconfirmed)} غير مؤكد` : `${num(s.unconfirmed)} unconfirmed`);
        if (s.totalSlots > 0) parts.push(isAr ? `${num(s.freeSlots)} فاضي` : `${num(s.freeSlots)} free`);
        if (canSeeMoney && s.expectedMoney > 0) parts.push(isAr ? `${num(s.expectedMoney)} ج` : `${num(s.expectedMoney)} EGP`);
        return parts.join(' · ');
    };

    return (
        <div className="flex flex-col min-w-[800px] h-full bg-surface rounded-2xl border border-line overflow-hidden">
            {/* Header row: the day, and its numbers */}
            <div className="flex border-b border-line shrink-0 bg-surface sticky top-0 z-20">
                <div className="w-[84px] md:w-[100px] shrink-0 border-e border-line"></div>
                {weekDays.map((key) => {
                    const isToday = key === todayKey;
                    const s = summaries.get(key);
                    const off = Boolean(s?.isOffDay);
                    const { weekday, dayNum } = dayLabel(key);
                    return (
                        <div
                            key={key}
                            className={`flex-1 min-w-0 border-e border-line last:border-e-0 px-2 py-2.5 text-center flex flex-col items-center justify-start ${
                                isToday ? 'bg-ink-slab text-white' : off ? 'bg-surface-muted text-ink-faint' : 'text-ink'
                            }`}
                        >
                            <span className={`text-[11px] font-bold uppercase tracking-widest ${isToday ? 'text-white/70' : off ? 'text-ink-faint' : 'text-ink-muted'}`}>
                                {weekday}
                            </span>
                            <span className={`font-figure text-2xl font-semibold leading-none mt-1 ${isToday ? 'text-white' : off ? 'text-ink-faint' : 'text-ink'}`}>
                                {dayNum}
                            </span>
                            {off ? (
                                <span className="mt-1.5 text-[11px] font-semibold text-ink-faint">{isAr ? 'مغلق' : 'Closed'}</span>
                            ) : (
                                <span
                                    dir="auto"
                                    /* Wraps to a second line rather than cutting off: beside the assistant panel a
                                       column is narrow, and "2 visits · 2 unconf…" answers nothing. */
                                    className={`mt-1.5 max-w-full line-clamp-2 font-figure text-[11px] font-semibold leading-tight ${isToday ? 'text-white/70' : 'text-ink-muted'}`}
                                    title={stripText(key)}
                                >
                                    {stripText(key)}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* The grid */}
            <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                <div className="relative" style={{ height: `${containerHeight}px` }}>
                    {/* Time column */}
                    <div className="absolute inset-y-0 start-0 w-[84px] md:w-[100px] border-e border-line flex flex-col pointer-events-none z-10 bg-surface-subtle">
                        {timeSlots.map((slot, idx) => (
                            <div key={idx} className="relative flex-1" style={{ height: `${WEEK_ROW_PX}px` }}>
                                <div className={`absolute end-2 md:end-3 font-figure text-[11px] font-semibold text-ink-muted ${idx === 0 ? 'top-3' : 'top-0 -translate-y-1/2'}`}>
                                    {slot.label}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Day columns */}
                    <div className="absolute inset-y-0 start-[84px] md:start-[100px] end-0 flex">
                        {weekDays.map((dateStr, i) => {
                            const dayAppts = appointments.filter(a => a.date === dateStr);
                            const isToday = dateStr === todayKey;
                            const off = Boolean(summaries.get(dateStr)?.isOffDay);

                            return (
                                <div key={dateStr} className={`flex-1 relative border-e border-line/60 last:border-e-0 ${off ? 'bg-surface-muted' : ''}`}
                                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const dataStr = e.dataTransfer.getData("text/plain");
                                        if (!dataStr) return;
                                        try {
                                            const data = JSON.parse(dataStr);
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const y = e.clientY - rect.top;

                                            const minsFromStart = Math.round((y / pixelsPerMinute) / 5) * 5;
                                            const newTime = minutesToClock(bounds.start + minsFromStart);

                                            void updateBookingTime(data.id, dateStr, newTime);
                                        } catch(err) { console.error(err); }
                                    }}>
                                    {/* Rows: a click on an empty one books there */}
                                    <div className="absolute inset-0 flex flex-col">
                                        {timeSlots.map((slot, idx) => (
                                            <div
                                                key={idx}
                                                className={`flex-1 border-b border-line/60 cursor-pointer hover:bg-surface-subtle transition-colors ${slot.outside ? 'bg-surface-muted' : ''}`}
                                                onClick={() => onSelectAppointment(null, slot.value, dateStr)}
                                            ></div>
                                        ))}
                                    </div>

                                    {/* The now-line, on today only */}
                                    {isToday && nowTop !== null && (
                                        <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: `${nowTop}px` }} aria-hidden>
                                            <div className="h-0.5 bg-ink-slab" />
                                            <div className="absolute start-0 top-1/2 -translate-y-1/2 size-2 rounded-full bg-ink-slab" />
                                        </div>
                                    )}

                                    {/* The day's visits */}
                                    <div className="absolute inset-0 pointer-events-none">
                                        {(() => {
                                            const processedAppts = dayAppts.map(apt => {
                                                const aptMins = visitStartInDay(parseApptTimeToMinutes(apt.time), bounds);
                                                let dur = apt.duration || 30;
                                                const maxDur = bounds.end - aptMins;
                                                if (dur > maxDur) dur = maxDur;
                                                return { ...apt, startMin: aptMins, endMin: aptMins + dur, dur };
                                            });

                                            processedAppts.sort((a, b) => {
                                                if (a.startMin === b.startMin) return b.dur - a.dur;
                                                return a.startMin - b.startMin;
                                            });

                                            // Visits that overlap share the column's width, each as its own
                                            // strip — the same packing the day view uses. They used to be
                                            // staggered 15% apart, which hid most of every card but the first,
                                            // on the one view whose job is to show how full a day is.
                                            const blocks: (typeof processedAppts)[] = [];
                                            let currentBlock: typeof processedAppts = [];
                                            let currentBlockEnd = 0;

                                            processedAppts.forEach(apt => {
                                                if (currentBlock.length > 0 && apt.startMin >= currentBlockEnd) {
                                                    blocks.push(currentBlock);
                                                    currentBlock = [];
                                                    currentBlockEnd = 0;
                                                }
                                                currentBlock.push(apt);
                                                currentBlockEnd = Math.max(currentBlockEnd, apt.endMin);
                                            });
                                            if (currentBlock.length > 0) blocks.push(currentBlock);

                                            const positionedAppts: (typeof processedAppts[0] & { colIndex: number, totalCols: number })[] = [];
                                            blocks.forEach(block => {
                                                const columns: typeof processedAppts[] = [];
                                                block.forEach(apt => {
                                                    let placed = false;
                                                    for (let c = 0; c < columns.length; c++) {
                                                        const lastInCol = columns[c][columns[c].length - 1];
                                                        if (lastInCol.endMin <= apt.startMin) {
                                                            columns[c].push(apt);
                                                            positionedAppts.push({ ...apt, colIndex: c, totalCols: 0 });
                                                            placed = true;
                                                            break;
                                                        }
                                                    }
                                                    if (!placed) {
                                                        columns.push([apt]);
                                                        positionedAppts.push({ ...apt, colIndex: columns.length - 1, totalCols: 0 });
                                                    }
                                                });
                                                const numCols = columns.length;
                                                block.forEach(apt => {
                                                    const pApt = positionedAppts.find(p => p.id === apt.id);
                                                    if (pApt) pApt.totalCols = numCols;
                                                });
                                            });

                                            return positionedAppts.map(apt => {
                                                const top = (apt.startMin - bounds.start) * pixelsPerMinute;
                                                const h = Math.max(apt.dur * pixelsPerMinute - 2, WEEK_MIN_CARD_PX);
                                                const tier = weekCardTier(h);
                                                const styles = getAppointmentStatusStyles(apt.status);
                                                const patient = patientsList?.find(p => p.id === apt.patientId);
                                                const phone = patient?.phone || '';
                                                const alert = medicalAlert(patient);
                                                const status = normalizeAppointmentStatus(apt.status);
                                                const unconfirmed = isUnconfirmed(apt.status);
                                                const noShow = status === "No Show";
                                                const owed = canSeeMoney ? (patientHistory.get(String(apt.patientId))?.owedBefore ?? 0) : 0;
                                                const what = `${apt.treatment || (isAr ? 'كشف' : 'Consultation')} · ${doctorCardLabel(apt.doctor, language)}`;
                                                const when = timeRange(minutesToClock(apt.startMin), apt.dur);

                                                const leftPercent = (apt.colIndex / apt.totalCols) * 100;
                                                const widthPercent = 100 / apt.totalCols;

                                                return (
                                                    <div
                                                        key={apt.id}
                                                        onClick={(e) => { e.stopPropagation(); onSelectAppointment(apt); }}
                                                        className={`absolute rounded-lg border pointer-events-auto cursor-grab active:cursor-grabbing group hover:!z-[60] hover:shadow-md transition-shadow flex flex-col ${styles.card.replace(/opacity-\d+/g, '')}`}
                                                        draggable={true}
                                                        onDragStart={(e) => {
                                                            e.dataTransfer.setData("text/plain", JSON.stringify({ id: apt.id }));
                                                            setTimeout(() => { if (e.target instanceof HTMLElement) e.target.style.opacity = '0.5'; }, 0);
                                                        }}
                                                        onDragEnd={(e) => {
                                                            if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1';
                                                        }}
                                                        style={{
                                                            top: `${top}px`,
                                                            height: `${h}px`,
                                                            insetInlineStart: `calc(${leftPercent}% + 2px)`,
                                                            width: `calc(${widthPercent}% - 4px)`,
                                                            zIndex: 10 + apt.colIndex
                                                        }}
                                                    >
                                                        <div className={`absolute start-0 inset-y-1 w-1 rounded-e-full ${styles.accent}`}></div>
                                                        <div className="flex flex-col min-w-0 h-full overflow-hidden ps-2.5 pe-1.5 py-1 relative z-10 gap-0.5">
                                                            <span className="flex items-center gap-1 min-w-0">
                                                                <span className="text-sm font-bold text-ink truncate leading-tight">{apt.patientName}</span>
                                                                <AlertBadge alert={alert} isAr={isAr} />
                                                                {unconfirmed && (
                                                                    <CircleDashed size={12} className="shrink-0 text-ink-muted" aria-label={isAr ? 'لسه مأكدش' : 'Not confirmed'}>
                                                                        <title>{isAr ? 'لسه مأكدش' : 'Not confirmed'}</title>
                                                                    </CircleDashed>
                                                                )}
                                                                {noShow && (
                                                                    <UserX size={12} className="shrink-0 text-ink" aria-label={isAr ? 'لم يحضر' : 'No show'}>
                                                                        <title>{isAr ? 'لم يحضر' : 'No show'}</title>
                                                                    </UserX>
                                                                )}
                                                                {owed > 0 && (
                                                                    <Wallet size={12} className="shrink-0 text-ink" aria-label={isAr ? `عليه ${num(owed)} ج من قبل` : `Owes ${num(owed)} EGP from before`}>
                                                                        <title>{isAr ? `عليه ${num(owed)} ج من قبل` : `Owes ${num(owed)} EGP from before`}</title>
                                                                    </Wallet>
                                                                )}
                                                            </span>
                                                            {tier !== 'name' && (
                                                                <span className="text-xs text-ink-body truncate leading-tight">{what}</span>
                                                            )}
                                                            {(tier === 'time' || tier === 'full') && (
                                                                <span className="font-figure text-[11px] text-ink-muted truncate leading-tight" dir="ltr">{when}</span>
                                                            )}
                                                            {tier === 'full' && phone && (
                                                                <span className="text-[11px] text-ink-muted truncate leading-tight" dir="ltr">{phone}</span>
                                                            )}
                                                        </div>

                                                        {/* The whole card, on hover — a 15-minute card in a three-way
                                                            overlap has room for a name and nothing else. */}
                                                        <div className={`absolute hidden group-hover:flex flex-col gap-1 z-[100] bg-ink-slab text-white shadow-xl rounded-lg p-3 w-60 top-0 ${i >= 4 ? 'end-full me-2' : 'start-full ms-2'}`}>
                                                            <div className="text-[15px] font-bold leading-tight">{apt.patientName}</div>
                                                            <div className="text-xs text-white/80">{what}</div>
                                                            <div className="font-figure text-xs text-white/80" dir="ltr">{when}</div>
                                                            {phone && <div className="text-xs text-white/60" dir="ltr">{phone}</div>}
                                                            <div className="mt-1 text-[11px] font-semibold text-white/60">
                                                                {getAppointmentStageLabel(apt.status, language)}
                                                                {owed > 0 ? (isAr ? ` · عليه ${num(owed)} ج من قبل` : ` · owes ${num(owed)} EGP from before`) : ''}
                                                            </div>
                                                            {alert && <div className="text-[11px] font-semibold text-white">⚠ {alert}</div>}
                                                        </div>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
