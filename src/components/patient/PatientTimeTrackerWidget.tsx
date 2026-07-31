"use client";

import { useState, useEffect } from "react";
import { Clock, Pause } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export default function PatientTimeTrackerWidget({ appointments }: { appointments: any[] }) {
  const { language } = useLanguage();
  const [duration, setDuration] = useState("");
  const [activeAppt, setActiveAppt] = useState<any>(null);

  useEffect(() => {
    // Find today's appointment that is active (Checked In or In Chair)
    const today = new Date().toISOString().split("T")[0];
    const active = appointments.find(
      (a) => a.date === today && (a.status === "In Chair" || a.status === "Checked In")
    );
    setActiveAppt(active || null);
  }, [appointments]);

  useEffect(() => {
    if (!activeAppt?.updatedAt) {
      setDuration("");
      return;
    }
    
    // Timer ticks if they are "In Chair" or "Checked In"
    const interval = setInterval(() => {
      const now = new Date();
      let start: Date;
      if (activeAppt.updatedAt?.toDate) {
         start = activeAppt.updatedAt.toDate();
      } else if (typeof activeAppt.updatedAt === 'string') {
         start = new Date(activeAppt.updatedAt);
      } else if (typeof activeAppt.updatedAt === 'number') {
         start = new Date(activeAppt.updatedAt);
      } else {
         start = now;
      }

      const diffMs = Math.max(0, now.getTime() - start.getTime());
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      const s = Math.floor((diffMs % 60000) / 1000);
      
      if (h > 0) {
        setDuration(`${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
      } else {
        setDuration(`${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeAppt]);

  if (!activeAppt) {
    return (
      <div className="bg-white/60 backdrop-blur-xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-3xl p-4 flex items-center justify-center gap-4 min-h-[100px] hover:scale-[1.01] transition-transform relative overflow-hidden group">
         <div className="text-slate-400 group-hover:scale-110 transition-transform"><Clock size={24} strokeWidth={1.5} /></div>
         <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{language === 'ar' ? 'غير متواجد بالعيادة' : 'Not in clinic'}</span>
      </div>
    );
  }

  const isChair = activeAppt.status === "In Chair";

  return (
    <div className="bg-white/60 backdrop-blur-xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-3xl p-4 flex items-center justify-between min-h-[100px] hover:scale-[1.01] transition-transform relative overflow-hidden group px-6">
       <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{language === 'ar' ? 'الوقت المنقضي' : 'Session Duration'}</span>
          {isChair ? (
             <span className="flex items-center gap-1.5 bg-cyan-50 text-cyan-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest w-fit">
               <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
               {language === 'ar' ? 'بالعيادة' : 'In Chair'}
             </span>
          ) : (
             <span className="flex items-center gap-1.5 bg-amber-50 text-amber-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest w-fit">
               <Pause size={10} />
               {language === 'ar' ? 'بالإنتظار' : 'Waiting'}
             </span>
          )}
       </div>
       
       <div className="relative flex items-center justify-center">
         <svg className="w-14 h-14 transform -rotate-90">
           <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-slate-100" />
           <circle 
             cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="3" fill="transparent" 
             strokeDasharray="151" strokeDashoffset={isChair ? "50" : "80"} 
             className={`transition-all duration-1000 ${isChair ? 'text-cyan-400' : 'text-amber-400'}`} 
             strokeLinecap="round" 
           />
         </svg>
         <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold tracking-tight text-slate-800 tabular-nums">
              {duration || "00:00"}
            </span>
         </div>
       </div>
    </div>
  );
}
