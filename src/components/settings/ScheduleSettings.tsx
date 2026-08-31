"use client";

import { Save, Clock } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export default function ScheduleSettings({ schedule, setSchedule, handleSaveClinic }: any) {
  const { language, isRTL } = useLanguage();
  const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const txt = {
    scheduleTitle: language === 'ar' ? "جدول العيادة" : "Clinic Schedule",
    scheduleSub: language === 'ar' ? "تعيين ساعات العمل للتقويم." : "Set operating hours for the calendar.",
    openTime: language === 'ar' ? "وقت الفتح" : "Opening Time",
    closeTime: language === 'ar' ? "وقت الإغلاق" : "Closing Time",
    slotDuration: language === 'ar' ? "مدة الموعد" : "Slot Duration",
    weekend: language === 'ar' ? "أيام العطلة (نهاية الأسبوع)" : "Days Off (Weekend)",
    saveSchedule: language === 'ar' ? "حفظ الجدول" : "Save Schedule",
  };

  const toggleOffDay = (day: string) => {
    setSchedule((prev: any) => {
        const isOff = prev.offDays.includes(day);
        return { ...prev, offDays: isOff ? prev.offDays.filter((d: string) => d !== day) : [...prev.offDays, day] };
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in max-w-5xl mx-auto bg-surface p-8 rounded-3xl shadow-sm border border-slate-200/50">
        <div className="flex items-center gap-4 mb-6 border-b border-slate-100 pb-6">
            <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><Clock size={28}/></div>
            <div>
                <h3 className="text-xl font-bold text-ink">{txt.scheduleTitle}</h3>
                <p className="text-sm font-semibold text-ink-muted mt-1">{txt.scheduleSub}</p>
            </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-surface-subtle p-6 rounded-3xl border border-slate-100">
            <div className="space-y-2">
                <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.openTime}</label>
                <input data-tour="schedule-open-time" type="time" value={schedule.start} onChange={e => setSchedule({...schedule, start: e.target.value})} className="w-full px-5 py-4 rounded-2xl border border-slate-200/60 font-bold text-base bg-surface outline-none focus:ring-2 focus:ring-primary-500 transition-all"/>
            </div>
            <div className="space-y-2">
                <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.closeTime}</label>
                <input type="time" value={schedule.end} onChange={e => setSchedule({...schedule, end: e.target.value})} className="w-full px-5 py-4 rounded-2xl border border-slate-200/60 font-bold text-base bg-surface outline-none focus:ring-2 focus:ring-primary-500 transition-all"/>
            </div>
            <div className="space-y-2">
                <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.slotDuration}</label>
                <select data-tour="schedule-slot-duration" value={schedule.slotDuration} onChange={e => setSchedule({...schedule, slotDuration: e.target.value})} className="w-full px-5 py-4 rounded-2xl border border-slate-200/60 font-bold text-base bg-surface outline-none focus:ring-2 focus:ring-primary-500 transition-all cursor-pointer">
                    <option value="15">15 Minutes</option><option value="30">30 Minutes</option><option value="45">45 Minutes</option><option value="60">1 Hour</option>
                </select>
            </div>
            
            <div className="space-y-3 md:col-span-3 pt-6 border-t border-slate-200/60">
                <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.weekend}</label>
                <div data-tour="schedule-days-off" className="flex flex-wrap gap-3">
                    {DAYS_OF_WEEK.map(day => {
                        const isOff = schedule.offDays.includes(day);
                        return (
                            <button key={day} onClick={(e) => { e.preventDefault(); toggleOffDay(day); }} className={`px-6 py-3 rounded-2xl text-sm font-bold transition-all border shadow-sm ${isOff ? 'bg-red-50 border-red-200 text-red-600 scale-105' : 'bg-surface border-line text-ink-muted hover:border-line-strong'}`}>
                                {day}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
        <div className={`flex ${isRTL ? 'justify-start' : 'justify-end'} pt-4`}>
            <button data-tour="schedule-save" onClick={(e) => { e.preventDefault(); handleSaveClinic(e); }} className="bg-slate-900 text-white px-10 py-4 rounded-2xl font-bold text-sm active:scale-95 transition-all shadow-lg"><Save size={20} className={`inline ${isRTL ? 'ml-2' : 'mr-2'}`}/> {txt.saveSchedule}</button>
        </div>
    </div>
  );
}