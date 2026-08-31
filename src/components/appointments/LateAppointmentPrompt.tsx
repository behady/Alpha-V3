"use client";

import React, { useState, useEffect } from "react";
import { UserCheck, Clock, XCircle, CalendarClock, Loader2, AlertCircle, Calendar } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { parseApptTimeToMinutes } from "@/lib/bookingService";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

interface LateAppointmentPromptProps {
  isOpen: boolean;
  appointment: any;
  onClose: () => void;
  onAction: (action: "check_in" | "wait" | "cancel" | "delay", newDate?: string, newTime?: string) => Promise<void>;
  config?: ClinicScheduleConfig;
}

export default function LateAppointmentPrompt({ isOpen, appointment, onClose, onAction, config }: LateAppointmentPromptProps) {
  const { language } = useLanguage();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const [isDelaying, setIsDelaying] = useState(false);
  const [delayDate, setDelayDate] = useState("");
  const [delayTime, setDelayTime] = useState("");
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [bookedSlots, setBookedSlots] = useState<{ start: number, end: number }[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsDelaying(false);
      setDelayDate("");
      setDelayTime("");
    }
  }, [isOpen]);

  // Generate available times based on config
  useEffect(() => {
    if (!config) return;
    const slots: string[] = [];
    const { start, end } = clinicDayBoundsMinutes(config);
    const duration = config.slotDuration || 30;
    for (let m = start; m < end; m += duration) {
      const minsMod = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
      const h24 = Math.floor(minsMod / 60);
      const mins = minsMod % 60;
      const hour12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
      const ampmStandard = h24 < 12 ? "AM" : "PM";
      const pad = (n: number) => n.toString().padStart(2, "0");
      slots.push(`${pad(hour12)}:${pad(mins)} ${ampmStandard}`);
    }
    setAvailableTimes(slots);
  }, [config]);

  // Fetch booked slots when delayDate changes
  useEffect(() => {
    if (!isDelaying || !delayDate || !appointment) return;
    
    const fetchBooked = async () => {
      setIsLoadingSlots(true);
      try {
        const q = query(
          getClinicCollection("appointments"),
          where("date", "==", delayDate),
          where("doctor", "==", appointment.doctor)
        );
        const snapshot = await getDocs(q);
        const booked = snapshot.docs.map(doc => {
          const data = doc.data();
          const start = parseApptTimeToMinutes(data.time);
          return {
            start,
            end: start + (data.duration || 30)
          };
        }).filter((_, i) => {
           // Exclude current appointment ID if same date so they can keep time if they want
           const d = snapshot.docs[i].data();
           const status = String(d.status || "").toLowerCase();
           return snapshot.docs[i].id !== appointment.id && status !== "cancelled" && status !== "canceled";
        });
        setBookedSlots(booked);
      } catch (e) {
        console.error("Error fetching slots", e);
      } finally {
        setIsLoadingSlots(false);
      }
    };
    fetchBooked();
  }, [isDelaying, delayDate, appointment]);

  if (!isOpen || !appointment) return null;

  const handleAction = async (action: "check_in" | "wait" | "cancel" | "delay") => {
    if (action === "delay" && !isDelaying) {
      setIsDelaying(true);
      
      const todayStr = new Date().toLocaleDateString("en-CA");
      setDelayDate(todayStr);
      setDelayTime(appointment.time);
      return;
    }

    setLoadingAction(action);
    try {
      if (action === "delay" && isDelaying) {
        if (!delayDate || !delayTime) return;
        await onAction(action, delayDate, delayTime);
      } else {
        await onAction(action);
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const getLocalDate = () => new Date().toLocaleDateString("en-CA");
  const getMaxDate = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toLocaleDateString("en-CA");
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border-4 border-rose-100 animate-in zoom-in-95 fade-in duration-200">
        
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mb-4 relative animate-pulse">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-black text-slate-800">
             {isDelaying 
                ? (language === 'ar' ? 'تأجيل الموعد' : 'Delay Appointment')
                : (language === 'ar' ? 'تأخر المريض عن الموعد!' : 'Patient is Late!')}
          </h2>
          <p className="text-ink-muted font-medium text-sm mt-2">
            {!isDelaying && (language === 'ar' 
              ? `لقد تأخر ${appointment.patientName} عن موعده المقرر في ${appointment.time?.replace('AM', 'ص').replace('PM', 'م')}. هل وصل المريض أم تود اتخاذ إجراء آخر؟` 
              : `${appointment.patientName} is late for their appointment at ${appointment.time}. Did the patient arrive, or would you like to take another action?`)}
            {isDelaying && (language === 'ar'
              ? 'اختر الموعد الجديد الذي تود تأجيل الزيارة إليه'
              : 'Select the new date and time for this appointment')}
          </p>
        </div>

        {!isDelaying ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleAction("check_in")}
              disabled={loadingAction !== null}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors font-bold disabled:opacity-50"
            >
              {loadingAction === "check_in" ? <Loader2 className="animate-spin" size={24}/> : <UserCheck size={24} />}
              <span className="text-sm">{language === 'ar' ? 'حضر (تأكيد وصول)' : 'Yes, Checked In'}</span>
            </button>
            
            <button
              onClick={() => handleAction("wait")}
              disabled={loadingAction !== null}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors font-bold disabled:opacity-50"
            >
              {loadingAction === "wait" ? <Loader2 className="animate-spin" size={24}/> : <Clock size={24} />}
              <span className="text-sm">{language === 'ar' ? 'انتظار 15 دقيقة' : 'Wait 15 Mins'}</span>
            </button>

            <button
              onClick={() => handleAction("delay")}
              disabled={loadingAction !== null}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors font-bold disabled:opacity-50"
            >
              {loadingAction === "delay" ? <Loader2 className="animate-spin" size={24}/> : <CalendarClock size={24} />}
              <span className="text-sm">{language === 'ar' ? 'تأجيل الموعد' : 'Delay'}</span>
            </button>
            
            <button
              onClick={() => handleAction("cancel")}
              disabled={loadingAction !== null}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors font-bold disabled:opacity-50"
            >
              {loadingAction === "cancel" ? <Loader2 className="animate-spin" size={24}/> : <XCircle size={24} />}
              <span className="text-sm">{language === 'ar' ? 'إلغاء الموعد' : 'Cancel'}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
               <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
                 <Calendar size={11} /> {language === 'ar' ? 'التاريخ' : 'Date'}
               </label>
               <input
                 type="date"
                 min={getLocalDate()}
                 max={getMaxDate()}
                 value={delayDate}
                 onChange={(e) => setDelayDate(e.target.value)}
                 className="w-full rounded-xl border-2 border-slate-100 px-3 py-2.5 text-sm font-bold text-ink outline-none focus:border-indigo-500"
               />
            </div>
            <div>
               <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
                 <Clock size={11} /> {language === 'ar' ? 'الوقت' : 'Time'}
                 {isLoadingSlots && <Loader2 size={10} className="animate-spin ml-2"/>}
               </label>
               <select
                 value={delayTime}
                 onChange={(e) => setDelayTime(e.target.value)}
                 disabled={isLoadingSlots || availableTimes.length === 0}
                 className="w-full rounded-xl border-2 border-slate-100 bg-surface px-3 py-2.5 text-sm font-bold text-ink outline-none focus:border-indigo-500 disabled:opacity-50"
               >
                 <option value="" disabled>{language === 'ar' ? 'اختر الوقت' : 'Select Time'}</option>
                 {availableTimes.length === 0 && <option value="" disabled>No times available</option>}
                 {availableTimes.map((t) => {
                    const startMins = parseApptTimeToMinutes(t);
                    const duration = appointment.duration || 30;
                    const endMins = startMins + duration;
                    const isConflict = bookedSlots.some(b => startMins < b.end && endMins > b.start);
                    
                    return (
                      <option key={t} value={t} disabled={isConflict} className={isConflict ? "text-slate-300 bg-surface-subtle" : ""}>
                        {t} {isConflict ? (language === 'ar' ? '(محجوز)' : '(Booked)') : ''}
                      </option>
                    );
                 })}
               </select>
            </div>
            <div className="flex gap-2 mt-4 pt-2 border-t border-slate-100">
               <button
                 onClick={() => setIsDelaying(false)}
                 disabled={loadingAction !== null}
                 className="flex-1 py-3 rounded-xl font-bold text-ink-muted hover:bg-surface-muted transition-colors disabled:opacity-50"
               >
                 {language === 'ar' ? 'رجوع' : 'Back'}
               </button>
               <button
                 onClick={() => handleAction("delay")}
                 disabled={loadingAction !== null || !delayDate || !delayTime}
                 className="flex-1 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
               >
                 {loadingAction === "delay" ? <Loader2 className="animate-spin mx-auto" size={20}/> : (language === 'ar' ? 'تأكيد التأجيل' : 'Confirm Delay')}
               </button>
            </div>
          </div>
        )}

        {!isDelaying && (
          <button 
            onClick={onClose}
            disabled={loadingAction !== null}
            className="mt-4 w-full py-3 rounded-xl font-bold text-ink-muted hover:bg-surface-muted transition-colors disabled:opacity-50"
          >
            {language === 'ar' ? 'تجاهل الآن' : 'Dismiss for now'}
          </button>
        )}

      </div>
    </div>
  );
}
