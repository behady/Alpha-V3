"use client";

import React, { useEffect, useState } from "react";
import { X, Clock, Stethoscope, FileText, Loader2, CalendarDays, ChevronDown, ChevronUp } from "lucide-react";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import StarRating from "@/components/StarRating";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

interface PatientHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
}

export default function PatientHistoryDrawer({
  isOpen,
  onClose,
  patientId,
  patientName,
}: PatientHistoryDrawerProps) {
  const { language } = useLanguage();
  const [visits, setVisits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const idVariants = [String(patientId)];
      if (!isNaN(Number(patientId))) {
        idVariants.push(Number(patientId) as any);
      }
      
      const qNotes = query(getClinicCollection("clinical_notes"), where("patientId", "in", idVariants));
      const qAppts = query(getClinicCollection("appointments"), where("patientId", "in", idVariants));
      
      const [snapNotes, snapAppts] = await Promise.all([getDocs(qNotes), getDocs(qAppts)]);
      
      const fetchedNotes = snapNotes.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const fetchedAppts = snapAppts.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

      const mergedList: any[] = [];
      
      // Match appointments with notes
      fetchedAppts.forEach((appt: any) => {
         const relatedNote = fetchedNotes.find(n => n.id === appt.clinicalNoteId || n.appointmentId === appt.id);
         let dateObj = new Date();
         if (appt.date) {
           dateObj = new Date(appt.date);
         } else if (appt.createdAt?.toDate) {
           dateObj = appt.createdAt.toDate();
         }
         
         mergedList.push({
            ...appt,
            type: "appointment",
            id: appt.id,
            dateObj,
            status: appt.status || "Scheduled",
            rating: appt.rating || 0,
            noteDetails: relatedNote
         });
      });

      // Include standalone notes
      const apptNoteIds = fetchedAppts.map(a => a.clinicalNoteId).filter(Boolean);
      fetchedNotes.forEach((note: any) => {
         if (!apptNoteIds.includes(note.id) && !fetchedAppts.some(a => a.id === note.appointmentId)) {
            let dateObj = new Date();
            if (note.createdAt?.toDate) dateObj = note.createdAt.toDate();
            
            mergedList.push({
               type: "note",
               id: note.id,
               dateObj,
               ...note
            });
         }
      });

      // Sort by date descending
      mergedList.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
      
      setVisits(mergedList);
    } catch (err) {
      console.error("Error fetching patient history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !patientId) return;
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, patientId]);

  const handleRatingChange = async (appointmentId: string, newRating: number) => {
    try {
      setVisits(prev => prev.map(v => v.id === appointmentId ? { ...v, rating: newRating } : v));
      await updateDoc(getClinicDoc("appointments", appointmentId), { rating: newRating });
    } catch (e) {
      console.error("Error updating rating:", e);
    }
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes("complete")) return "bg-emerald-100 text-emerald-700";
    if (s.includes("checked")) return "bg-blue-100 text-blue-700";
    if (s.includes("cancel")) return "bg-rose-100 text-rose-700";
    if (s.includes("delay")) return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-700";
  };

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] transition-opacity"
          onClick={onClose}
        />
      )}

      <div 
        className={`fixed top-0 end-0 h-full w-full sm:w-[450px] bg-white shadow-2xl z-[101] transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full rtl:-translate-x-full"
        }`}
      >
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-white shrink-0">
          <div>
            <h2 className="text-xl font-black text-slate-800">{patientName}</h2>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1 flex items-center gap-1">
              <Clock size={12} /> {language === "ar" ? "سجل الزيارات" : "Visit History"}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-slate-50">
          {loading ? (
            <div className="flex justify-center items-center h-40 text-primary-500">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : visits.length === 0 ? (
            <div className="text-center py-10">
              <CalendarDays size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-semibold">{language === "ar" ? "لا توجد زيارات سابقة" : "No past visits found"}</p>
            </div>
          ) : (
            <div className="space-y-8 pb-10">
              {Object.entries(
                visits.reduce((acc, visit) => {
                  const dateStr = visit.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  if (!acc[dateStr]) acc[dateStr] = [];
                  acc[dateStr].push(visit);
                  return acc;
                }, {} as Record<string, any[]>)
              ).map(([dateStr, dayVisits]: [string, any], dateIndex) => (
                <div key={dateStr} className="relative">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="h-px bg-slate-200 flex-1"></div>
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full uppercase tracking-wider">
                      {dateStr}
                    </span>
                    <div className="h-px bg-slate-200 flex-1"></div>
                  </div>

                  <div className="relative border-s-2 border-slate-200 ms-3 ps-5 space-y-4">
                    {dayVisits.map((visit: any, index: number) => {
                      const isLatest = dateIndex === 0 && index === 0;
                      const isExpanded = expandedIds[visit.id];
                      
                      let checkInStr = "";
                      if (visit.checkInTime) {
                        const d = typeof visit.checkInTime.toDate === "function" ? visit.checkInTime.toDate() : new Date(visit.checkInTime);
                        checkInStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                      }
                      
                      let checkOutStr = "";
                      if (visit.checkOutTime) {
                        const d = typeof visit.checkOutTime.toDate === "function" ? visit.checkOutTime.toDate() : new Date(visit.checkOutTime);
                        checkOutStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                      }

                      return (
                        <div key={visit.id} className="relative">
                          <div className={`absolute -start-[27px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm ${
                            isLatest ? "bg-primary-500" : "bg-slate-300"
                          }`} />
                          
                          <div className={`bg-white rounded-xl p-4 shadow-sm border transition-all ${
                            isLatest ? "border-primary-100 shadow-md ring-1 ring-primary-50" : "border-slate-100"
                          }`}>
                            <div className="flex justify-between items-start mb-2 cursor-pointer" onClick={() => toggleExpand(visit.id)}>
                              <div className="flex items-center gap-2">
                                 <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1.5">
                                   <Clock size={12} className="text-primary-500" />
                                   {visit.lastScheduledTime || visit.time || visit.dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                 </span>
                                 {visit.type === "appointment" ? (
                                   <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${getStatusColor(visit.status)}`}>
                                     {visit.status}
                                   </span>
                                 ) : (
                                   <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-100 text-purple-700">
                                     {language === 'ar' ? 'سجل طبي' : 'Clinical Note'}
                                   </span>
                                 )}
                              </div>
                              <button className="text-slate-400 hover:text-primary-500 transition-colors bg-slate-50 hover:bg-primary-50 p-1 rounded-md">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </div>
                            
                            <div className="flex flex-col gap-1 mb-1 mt-2">
                               <div className="flex justify-between items-center">
                                 <h4 className="font-bold text-slate-800 text-sm">
                                    {visit.type === "appointment" ? (visit.treatment || "Visit") : (visit.procedure || "Consultation")}
                                 </h4>
                                 {visit.doctor && (
                                   <div className="flex items-center gap-1 text-[10px] font-bold text-slate-600">
                                     <Stethoscope size={12} className="text-indigo-400" />
                                     Dr. {visit.doctor.split(" ")[1] || visit.doctor}
                                   </div>
                                 )}
                               </div>
                               
                               {(visit.type === "appointment" ? visit.noteDetails?.tooth : visit.tooth) && (
                                 <div className="flex items-center gap-1.5 mt-0.5 mb-1">
                                   <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded border border-primary-100">
                                     {language === 'ar' ? 'السن:' : 'Tooth:'} {visit.type === "appointment" ? visit.noteDetails?.tooth : visit.tooth}
                                   </span>
                                 </div>
                               )}
                            </div>

                            {isExpanded && (
                              <div className="mt-4 pt-3 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                                {visit.type === "appointment" && (checkInStr || checkOutStr) && (
                                  <div className="flex flex-wrap gap-2 mb-3">
                                    {checkInStr && (
                                      <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded flex items-center gap-1">
                                        <Clock size={10} className="text-blue-500" />
                                        {language === 'ar' ? 'حضور:' : 'Checked In:'} {checkInStr}
                                      </span>
                                    )}
                                    {checkOutStr && (
                                      <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded flex items-center gap-1">
                                        <Clock size={10} className="text-emerald-500" />
                                        {language === 'ar' ? 'انصراف:' : 'Checked Out:'} {checkOutStr}
                                      </span>
                                    )}
                                  </div>
                                )}
                                
                                {visit.type === "appointment" && (
                                   <div className="mb-3 flex items-center justify-between bg-slate-50/50 p-2 rounded-lg border border-slate-100/50">
                                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                                         {language === 'ar' ? 'تقييم الزيارة' : 'Visit Rating'}
                                      </span>
                                      <StarRating 
                                         rating={visit.rating} 
                                         onRatingChange={(r) => handleRatingChange(visit.id, r)} 
                                      />
                                   </div>
                                )}

                                {(visit.noteDetails?.note || visit.note) ? (
                                  <div className="flex items-start gap-1.5 bg-slate-50/80 p-3 rounded-lg border border-slate-100">
                                    <FileText size={14} className="text-slate-400 shrink-0 mt-0.5" />
                                    <p className="text-xs text-slate-600 whitespace-pre-wrap">{visit.noteDetails?.note || visit.note}</p>
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-400 italic bg-slate-50/50 p-2 rounded-lg text-center border border-slate-100/50">
                                    {language === 'ar' ? 'لا توجد ملاحظات لهذه الزيارة' : 'No notes recorded for this visit'}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
