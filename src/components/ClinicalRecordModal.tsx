"use client";

import { useEffect, useState, useMemo } from "react";
import { X, User, Phone, MapPin, Activity, Info, Calendar, Clock, CreditCard, ChevronDown } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import TeethChart from "@/components/TeethChart";
import { normalizeToothData, ToothData } from "@/lib/diagnosisCatalog";
import { APPOINTMENT_STAGES, getAppointmentStatusStyles, getAppointmentStageLabel } from "@/lib/appointmentStages";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

interface Props {
  patientId: string;
  appointmentId?: string;
  onClose: () => void;
}

export default function ClinicalRecordModal({ patientId, appointmentId, onClose }: Props) {
  const { language, isRTL } = useLanguage();
  const [patient, setPatient] = useState<any>(null);
  const [appointment, setAppointment] = useState<any>(null);

  // Fetch Patient
  useEffect(() => {
    if (!patientId) return;
    const unsub = onSnapshot(getClinicDoc("patients", patientId), (snap) => {
      if (snap.exists()) {
        setPatient({ id: snap.id, ...snap.data() });
      }
    });
    return () => unsub();
  }, [patientId]);

  // Fetch Appointment if provided
  useEffect(() => {
    if (!appointmentId) return;
    const unsub = onSnapshot(getClinicDoc("appointments", appointmentId), (snap) => {
      if (snap.exists()) setAppointment({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [appointmentId]);

  const teethData: Record<string, ToothData> = useMemo(() => {
    const raw = patient?.teethData || {};
    const cleaned: Record<string, ToothData> = {};
    Object.keys(raw).forEach(k => {
      cleaned[k] = normalizeToothData(raw[k]);
    });
    return cleaned;
  }, [patient?.teethData]);

  if (!patientId) return null;

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 ${isRTL ? "text-right" : "text-left"}`} dir={isRTL ? "rtl" : "ltr"}>
      <div className="absolute inset-0" onClick={onClose} />
      
      <div className="relative w-full max-w-[1200px] h-[90vh] bg-slate-50 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
                <Activity size={20} />
             </div>
             <div>
               <h2 className="text-lg font-black text-slate-800">
                 {appointmentId ? (language === "ar" ? `رقم الحجز #${appointmentId.slice(-6).toUpperCase()}` : `Reservation ID #${appointmentId.slice(-6).toUpperCase()}`) : (language === "ar" ? "السجل الطبي" : "Medical Record")}
               </h2>
               <p className="text-xs font-semibold text-slate-500">
                 {patient?.name || "Loading..."}
               </p>
             </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-slate-100 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Split */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          
          {/* Left Column: Odontogram */}
          <div className="w-full lg:w-[55%] xl:w-[60%] flex flex-col bg-slate-50 border-r border-slate-200">
            <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-sm tracking-wide uppercase">
                {language === "ar" ? "مخطط الأسنان" : "Medical Record"}
              </h3>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button className="px-4 py-1.5 rounded-lg bg-white shadow-sm text-xs font-bold text-slate-800">Medical</button>
                <button className="px-4 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 text-xs font-bold">Cosmetic</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 flex flex-col">
               <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex-1 flex flex-col justify-center">
                  <TeethChart data={teethData} />
               </div>
            </div>
          </div>

          {/* Right Column: Details */}
          <div className="w-full lg:w-[45%] xl:w-[40%] flex flex-col bg-white">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Patient Info Card */}
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-teal-500/30">
                  {patient?.name?.[0]?.toUpperCase() || "P"}
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-slate-800 text-xl">{patient?.name}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-bold">
                      {patient?.age ? `${patient.age} ${language === "ar" ? "سنة" : "Years"}` : "Adult"}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 text-[10px] font-bold">
                      {language === "ar" ? "مريض جديد" : "New Patient"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status & Appointment Details */}
              {appointment && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      {language === "ar" ? "حالة الحجز" : "Reservation Status"}
                    </label>
                    <div className="flex items-center gap-2">
                      {APPOINTMENT_STAGES.map((stage) => {
                        const isSelected = appointment.status === stage.value;
                        const styles = getAppointmentStatusStyles(stage.value);
                        if (!isSelected) return null;
                        return (
                          <div key={stage.value} className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 ${styles.pill} border-current ring-offset-2 ring-2`}>
                             <span className="font-bold">{getAppointmentStageLabel(stage.value, language as any)}</span>
                             <ChevronDown size={16} />
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                       <div className="flex items-center gap-2 text-slate-500 mb-1">
                         <Calendar size={14} />
                         <span className="text-[10px] font-bold uppercase tracking-widest">{language === "ar" ? "التاريخ" : "Date"}</span>
                       </div>
                       <div className="font-bold text-slate-800 text-sm">{appointment.date}</div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                       <div className="flex items-center gap-2 text-slate-500 mb-1">
                         <Clock size={14} />
                         <span className="text-[10px] font-bold uppercase tracking-widest">{language === "ar" ? "الوقت" : "Time"}</span>
                       </div>
                       <div className="font-bold text-slate-800 text-sm">{appointment.time}</div>
                    </div>
                  </div>
                </>
              )}

              {/* Treatments / Services */}
              <div className="space-y-3">
                 <div className="flex items-center justify-between">
                   <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide">
                     {language === "ar" ? "العلاجات" : "Treatments"}
                   </h4>
                   <button className="text-[11px] font-bold text-teal-600 bg-teal-50 px-3 py-1 rounded-lg hover:bg-teal-100">
                     + {language === "ar" ? "إضافة إجراء" : "Add Service"}
                   </button>
                 </div>
                 
                 {/* Dummy Treatment List - will connect to DB soon */}
                 <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-teal-300 bg-white shadow-sm transition-all cursor-pointer">
                       <div>
                         <div className="font-bold text-slate-800 text-sm">Extraction</div>
                         <div className="text-[11px] font-semibold text-slate-400">Tooth 18 • Completed</div>
                       </div>
                       <div className="font-black text-slate-800">500 EGP</div>
                    </div>
                    {appointment?.treatment && (
                      <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-teal-300 bg-white shadow-sm transition-all cursor-pointer">
                         <div>
                           <div className="font-bold text-slate-800 text-sm">{appointment.treatment}</div>
                           <div className="text-[11px] font-semibold text-slate-400">Planned</div>
                         </div>
                      </div>
                    )}
                 </div>
              </div>

              {/* Financials */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white shadow-xl shadow-slate-900/20">
                 <div className="flex items-center gap-2 mb-4 text-slate-400">
                   <CreditCard size={16} />
                   <span className="text-[11px] font-bold uppercase tracking-widest">{language === "ar" ? "المالية" : "Billing"}</span>
                 </div>
                 <div className="flex items-end justify-between border-b border-slate-700 pb-4 mb-4">
                   <div>
                     <div className="text-slate-400 text-xs font-semibold mb-1">{language === "ar" ? "الإجمالي" : "Total Bill"}</div>
                     <div className="text-2xl font-black">1,500 <span className="text-sm text-slate-400 font-bold">EGP</span></div>
                   </div>
                   <div className="text-right">
                     <div className="text-slate-400 text-xs font-semibold mb-1">{language === "ar" ? "المدفوع" : "Paid"}</div>
                     <div className="text-lg font-black text-emerald-400">1,000</div>
                   </div>
                 </div>
                 <div className="flex justify-between items-center text-sm">
                   <span className="font-semibold text-slate-400">{language === "ar" ? "المتبقي" : "Remaining"}</span>
                   <span className="font-black text-rose-400">500 EGP</span>
                 </div>
              </div>

              {/* General Info */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                 <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <Info size={14} /> {language === "ar" ? "معلومات عامة" : "General Info"}
                 </h4>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   {patient?.phone && (
                     <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                       <Phone size={16} className="text-slate-400" />
                       <span className="text-sm font-semibold text-slate-700">{patient.phone}</span>
                     </div>
                   )}
                   {patient?.address && (
                     <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                       <MapPin size={16} className="text-slate-400" />
                       <span className="text-sm font-semibold text-slate-700 truncate">{patient.address}</span>
                     </div>
                   )}
                 </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
