"use client";

import React, { useMemo } from "react";
import { parseApptTimeToMinutes, updateBookingTime } from "@/lib/bookingService";
import { clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { getAppointmentStatusStyles } from "@/lib/appointmentStages";

type DashboardAppointment = any;

interface WeeklyScheduleViewProps {
    appointments: DashboardAppointment[];
    currentDate: string; // Used to determine which week to show
    language: 'en' | 'ar';
    config: ClinicScheduleConfig;
    patientsList: any[];
    onSelectAppointment: (apt: DashboardAppointment | null, time?: string, date?: string) => void;
}

export default function WeeklyScheduleView({ appointments, currentDate, language, config, patientsList, onSelectAppointment }: WeeklyScheduleViewProps) {
    const isRTL = language === 'ar';
    
    // Calculate week dates (Saturday to Friday)
    const weekDates = useMemo(() => {
        const d = new Date(currentDate || new Date());
        const diffToSat = (d.getDay() + 1) % 7; 
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - diffToSat);
        
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const cur = new Date(startOfWeek);
            cur.setDate(startOfWeek.getDate() + i);
            dates.push(cur);
        }
        return dates;
    }, [currentDate]);

    const bounds = clinicDayBoundsMinutes(config);


    const slotDuration = config.slotDuration || 30;
    // The compact dashboard header freed ~260px, so rows can breathe. A 30-minute
    // slot is now tall enough to show name, phone and treatment without hovering.
    const rowHeight = 88;
    const pixelsPerMinute = rowHeight / slotDuration;
    const totalMinutes = bounds.end - bounds.start;
    const containerHeight = totalMinutes * pixelsPerMinute;

    const timeSlots = useMemo(() => {
        const slots = [];
        for (let m = bounds.start; m < bounds.end; m += slotDuration) {
            const h = Math.floor(m / 60);
            const mins = m % 60;
            const ampm = h >= 12 ? (language === 'ar' ? 'م' : 'PM') : (language === 'ar' ? 'ص' : 'AM');
            const h12 = h % 12 || 12;
            const h12Str = language === 'ar' ? h12.toLocaleString('ar-EG', {minimumIntegerDigits: 2}) : h12.toString().padStart(2, '0');
            const minsStr = language === 'ar' ? mins.toLocaleString('ar-EG', {minimumIntegerDigits: 2}) : mins.toString().padStart(2, '0');
            const label = language === 'ar' ? `${ampm} ${h12Str}:${minsStr}` : `${h12Str}:${minsStr} ${ampm}`;
            
            const stdAmpm = h >= 12 ? 'PM' : 'AM';
            const stdH12 = h % 12 || 12;
            const stdValue = `${stdH12.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${stdAmpm}`;

            slots.push({ minutes: m, label, value: stdValue });
        }
        return slots;
    }, [bounds, slotDuration, language]);

    return (
        <div className="flex flex-col min-w-[800px] h-full bg-gradient-to-br from-amber-50/40 via-white/40 to-white/60 backdrop-blur-2xl rounded-[2.5rem] border border-amber-100/50 shadow-[0_12px_40px_rgba(245,158,11,0.05)] overflow-hidden ring-1 ring-white/60">
            {/* Header Row (Days of Week) */}
            <div className="flex border-b border-amber-100/50 shadow-sm shrink-0 bg-white/40 backdrop-blur-xl sticky top-0 z-20">
                <div className="w-[84px] md:w-[100px] shrink-0 border-e border-amber-100/50"></div>
                {weekDates.map((d, i) => {
                    const isToday = new Date().toISOString().split('T')[0] === d.toISOString().split('T')[0];
                    return (
                        <div key={i} className={`flex-1 min-w-0 border-e border-amber-100/40 last:border-e-0 p-2 md:p-3 text-center flex flex-col items-center justify-center transition-all duration-300 ${isToday ? 'bg-gradient-to-b from-amber-100/60 to-amber-50/90 shadow-[inset_0_-3px_0_rgba(245,158,11,0.6)]' : 'hover:bg-white/50'}`}>
                            <span className={`text-xs md:text-sm font-bold uppercase tracking-widest ${isToday ? 'text-amber-700' : 'text-slate-400'}`}>
                                {d.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short' })}
                            </span>
                            <span className={`text-xl md:text-2xl font-black mt-0.5 ${isToday ? 'text-amber-600 drop-shadow-sm' : 'text-slate-700'}`}>
                                {d.getDate()}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Grid Container */}
            <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                <div className="relative" style={{ height: `${containerHeight}px` }}>
                    {/* Time Labels Column */}
                    <div className="absolute inset-y-0 start-0 w-[84px] md:w-[100px] border-e border-amber-100/50 flex flex-col pointer-events-none z-10 bg-gradient-to-r from-amber-50/30 to-white/20 backdrop-blur-md">
                        {timeSlots.map((slot, idx) => (
                            <div key={idx} className="relative flex-1" style={{ height: `${rowHeight}px` }}>
                                <div className={`absolute end-2 md:end-3 text-[10px] md:text-xs font-black uppercase tracking-widest text-slate-400 ${idx === 0 ? 'top-4' : 'top-0 -translate-y-1/2'}`}>
                                    {slot.label}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Day Columns */}
                    <div className="absolute inset-y-0 start-[84px] md:start-[100px] end-0 flex">
                        {weekDates.map((d, i) => {
                            const dateStr = d.toISOString().split('T')[0];
                            const dayAppts = appointments.filter(a => a.date === dateStr);
                            
                            return (
                                <div key={i} className="flex-1 relative border-e border-slate-300/40 last:border-e-0 group/col"
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
                                            const m = bounds.start + minsFromStart;
                                            const h = Math.floor(m / 60);
                                            const mins = m % 60;
                                            const newTime = `${h.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
                                            
                                            updateBookingTime(data.id, dateStr, newTime);
                                        } catch(err) { console.error(err); }
                                    }}>
                                    {/* Grid Lines & Empty Slots Click Handler */}
                                    <div className="absolute inset-0 flex flex-col">
                                        {timeSlots.map((slot, idx) => (
                                            <div 
                                                key={idx} 
                                                className="flex-1 border-b border-dashed border-amber-200/40 cursor-pointer hover:bg-amber-50/50 transition-colors"
                                                onClick={() => onSelectAppointment(null, slot.value, dateStr)}
                                            ></div>
                                        ))}
                                    </div>
                                    
                                    {/* Appointments for this day */}
                                    <div className="absolute inset-0 pointer-events-none">
                                        {(() => {
                                            const processedAppts = dayAppts.map(apt => {
                                                const aptMins = parseApptTimeToMinutes(apt.time);
                                                let dur = apt.duration || 30;
                                                const maxDur = bounds.end - aptMins;
                                                if (dur > maxDur) dur = maxDur;
                                                return { ...apt, startMin: aptMins, endMin: aptMins + dur, dur };
                                            });

                                            processedAppts.sort((a, b) => {
                                                if (a.startMin === b.startMin) return b.dur - a.dur;
                                                return a.startMin - b.startMin;
                                            });

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
                                                    for (let i = 0; i < columns.length; i++) {
                                                        const lastInCol = columns[i][columns[i].length - 1];
                                                        if (lastInCol.endMin <= apt.startMin) {
                                                            columns[i].push(apt);
                                                            positionedAppts.push({ ...apt, colIndex: i, totalCols: 0 });
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
                                                const h = apt.dur * pixelsPerMinute;
                                                const styles = getAppointmentStatusStyles(apt.status);
                                                const phone = patientsList?.find(p => p.id === apt.patientId)?.phone || '';
                                                
                                                const staggerPercent = 15;
                                                const maxStagger = 75; // Cap stagger so cards always have at least 25% width
                                                const leftPercent = apt.totalCols > 1 ? Math.min(apt.colIndex * staggerPercent, maxStagger) : 0;
                                                const widthPercent = 100 - leftPercent;
                                                // Judge by rendered pixels, not minutes: how much fits depends on
                                                // rowHeight and the clinic's slot duration, not on the duration alone.
                                                const cardHeight = h - 2;
                                                const isVeryShort = cardHeight < 58;  // name only
                                                const isShort = cardHeight < 80;      // name + phone, no treatment

                                                return (
                                                    <div 
                                                        key={apt.id}
                                                        onClick={(e) => { e.stopPropagation(); onSelectAppointment(apt); }}
                                                        className={`absolute p-1.5 md:p-2 rounded-xl border pointer-events-auto cursor-pointer group hover:!z-[60] hover:scale-105 hover:shadow-2xl transition-all duration-300 flex flex-col ${styles.card.replace('opacity-80', '')} cursor-grab active:cursor-grabbing hover:-translate-y-1`}
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
                                                            height: `${h - 2}px`,
                                                            insetInlineStart: `calc(${leftPercent}% + 2px)`,
                                                            width: `calc(${widthPercent}% - 4px)`,
                                                            zIndex: 10 + apt.colIndex
                                                        }}
                                                    >
                                                        <div className={`absolute start-0 top-1 bottom-1 w-1 rounded-r-full ${styles.accent}`}></div>
                                                        <div className="flex flex-col min-w-0 h-full overflow-hidden ms-1.5 relative z-10">
                                                            <span className="text-sm md:text-base font-bold text-ink truncate leading-tight group-hover:text-lg transition-all">{apt.patientName}</span>
                                                            {!isVeryShort && phone && <span className="text-xs text-ink-body truncate flex items-center gap-1.5 mt-1 group-hover:text-sm transition-all"><svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>{phone}</span>}
                                                            {!isShort && <span className="text-xs md:text-sm text-slate-700 truncate mt-1 group-hover:whitespace-normal group-hover:line-clamp-2 transition-all">{apt.treatment}</span>}
                                                        </div>
                                                        {/* Enhanced Tooltip for Hover */}
                                                        <div className={`absolute hidden group-hover:flex flex-col z-[100] bg-surface shadow-[0_20px_50px_rgba(0,0,0,0.2)] rounded-2xl p-4 border border-line w-64 top-0 ${i >= 4 ? 'end-full me-2' : 'start-full ms-2'} scale-100 transform`}>
                                                            <div className="font-black text-lg text-ink">{apt.patientName}</div>
                                                            {phone && <div className="text-sm font-bold text-ink-body mb-2">{phone}</div>}
                                                            <div className="text-sm font-bold text-slate-800 bg-surface-subtle p-2 rounded-lg my-1">{apt.treatment}</div>
                                                            {apt.doctor && <div className="text-xs font-bold text-ink-muted mt-1">{apt.doctor}</div>}
                                                            <div className="text-sm text-primary-600 font-black mt-2 bg-primary-50 px-2 py-1 rounded-md self-start">{apt.time} - {apt.dur} min</div>
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
