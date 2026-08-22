"use client";

import React, { useState, useEffect } from "react";
import { collection, query, where, getDocs, doc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { Loader2, CalendarDays, Clock, CheckCircle2, AlertCircle, Star, FileText, Trash2 } from "lucide-react";
import { MoneyApiError, deleteAppointment, deleteProcedure } from "@/lib/moneyApi";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

interface StatusHistoryEntry {
  status: string;
  timestamp: any;
  modifiedBy: string;
}

interface VisitEntry {
  type: "appointment" | "note";
  id: string;
  dateObj: Date;
  status: string;
  rating?: number;
  noteDetails?: any;
  statusHistory?: StatusHistoryEntry[];
  checkInTime?: any;
  checkOutTime?: any;
  [key: string]: any;
}

export default function PatientTimelineTab({ patientId }: { patientId: string }) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const { showToast, confirm } = useUI();
  const [visits, setVisits] = useState<VisitEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTimeline = async () => {
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

        const mergedList: VisitEntry[] = [];
        
        // Match appointments with notes
        fetchedAppts.forEach((appt: any) => {
           const relatedNote = fetchedNotes.find((n: any) => n.id === appt.clinicalNoteId || n.appointmentId === appt.id);
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
        const apptNoteIds = fetchedAppts.map((a: any) => a.clinicalNoteId).filter(Boolean);
        fetchedNotes.forEach((note: any) => {
           if (!apptNoteIds.includes(note.id) && !fetchedAppts.some((a: any) => a.id === note.appointmentId)) {
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

        mergedList.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
        setVisits(mergedList);
      } catch (err) {
        console.error("Error fetching patient timeline:", err);
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    if (patientId) fetchTimeline();
  }, [patientId]);

  const handleDeleteVisit = async (visit: VisitEntry) => {
    const msg = language === "ar" ? "هل أنت متأكد من الحذف؟" : "Are you sure you want to delete?";
    const ok = await confirm(msg, {
      title: language === "ar" ? "حذف الزيارة" : "Delete visit",
      confirmLabel: language === "ar" ? "احذف" : "Delete",
      tone: "danger",
    });
    if (!ok) return;

    try {
      if (visit.type === "appointment") {
        // Treatments are kept: this timeline is the patient's history, and removing a visit from
        // it must not quietly take the record of what was done with it.
        await deleteAppointment(visit.id, "keep");
      } else {
        // Deleting a treatment takes its charge with it, and is refused when money has been
        // collected — the same rule every other screen now gets.
        // The charge goes with it — the route cascades both link directions, so the hand-rolled
        // ledger sweep that used to follow this line is gone.
        await deleteProcedure(visit.id);
      }
      
      setVisits(prev => prev.filter(v => v.id !== visit.id));
      showToast(language === "ar" ? "تم الحذف بنجاح" : "Deleted successfully", "success");
    } catch (error) {
      console.error(error);
      showToast(
        error instanceof MoneyApiError
          ? error.message
          : language === "ar" ? "حدث خطأ أثناء الحذف" : "Error deleting record",
        "error"
      );
    }
  };

  const noShows = visits.filter(v => v.type === "appointment" && (v.status.toLowerCase() === "cancelled" || v.status.toLowerCase() === "no show")).length;

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20 text-primary-500">
        <Loader2 className="animate-spin" size={40} />
      </div>
    );
  }

  if (visits.length === 0) {
    return (
      <div className="text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-sm">
        <CalendarDays size={64} className="mx-auto text-slate-200 mb-4" />
        <p className="text-slate-500 font-semibold text-lg">{language === "ar" ? "لا توجد زيارات سابقة" : "No visits found"}</p>
        <p className="text-slate-400 text-sm mt-1">{language === "ar" ? "سجل زيارات المريض سيظهر هنا" : "The patient's visit history will appear here"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {noShows > 0 && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 px-4 py-3 rounded-2xl flex items-center gap-3 shadow-sm">
          <AlertCircle size={24} className="shrink-0" />
          <p className="font-semibold text-sm">
            {language === "ar" 
              ? `تحذير: المريض لديه ${noShows} موعد ملغي أو لم يحضر` 
              : `Warning: This patient has ${noShows} cancelled/no-show appointment(s).`}
          </p>
        </div>
      )}

      <div className="relative pl-8 border-l-2 border-slate-100 space-y-10 before:absolute before:top-0 before:left-[-2px] before:w-[2px] before:h-8 before:bg-gradient-to-b before:from-slate-100 before:to-primary-500">
        {visits.map((visit, index) => {
          const isAppt = visit.type === "appointment";
          const title = isAppt ? visit.treatment || "Consultation" : visit.procedure || visit.title || "Clinical Note";
          const formattedDate = visit.dateObj.toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
          
          let latenessMsg = null;
          if (isAppt && visit.time && visit.checkInTime) {
             const [sh, sm] = visit.time.split(":").map(Number);
             const scheduledDate = new Date(visit.dateObj);
             scheduledDate.setHours(sh, sm, 0, 0);
             const checkInDate = visit.checkInTime.toDate ? visit.checkInTime.toDate() : new Date(visit.checkInTime);
             
             const diffMins = Math.floor((checkInDate.getTime() - scheduledDate.getTime()) / 60000);
             if (diffMins > 5) {
                latenessMsg = language === "ar" ? `تأخر ${diffMins} دقيقة` : `Late by ${diffMins} mins`;
             }
          }

          return (
            <div key={visit.id} className="relative group">
              {/* Timeline dot */}
              <div className="absolute -left-[41px] top-1 w-5 h-5 rounded-full border-4 border-white bg-primary-500 shadow-sm transition-transform group-hover:scale-125 z-10"></div>

              <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all group-hover:border-primary-200">
                
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">{title}</h3>
                    <p className="text-slate-500 text-sm flex items-center gap-2 mt-1 font-medium">
                      <CalendarDays size={14} className="text-primary-500" />
                      {formattedDate} {isAppt && visit.time && `• ${language === 'ar' ? visit.time.replace('AM', 'ص').replace('PM', 'م') : visit.time}`}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-3">
                      {isAppt && (
                        <span className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full border border-slate-200">
                          {visit.status}
                        </span>
                      )}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteVisit(visit);
                        }}
                        className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition-colors"
                        title={language === 'ar' ? 'حذف' : 'Delete'}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {visit.rating && visit.rating > 0 ? (
                      <div className="flex gap-1 bg-amber-50 px-2 py-1 rounded-full border border-amber-100">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} size={14} className={i < visit.rating! ? "text-amber-400 fill-amber-400" : "text-amber-100"} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Body Content */}
                {isAppt ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Left Column: Lifecycle / Status History */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                        <Clock size={12} className="text-slate-400" /> {language === "ar" ? "سجل الحالة" : "Status Lifecycle"}
                      </h4>
                      
                      {visit.statusHistory && visit.statusHistory.length > 0 ? (
                        <div className="space-y-3 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200">
                          {visit.statusHistory.map((h, i) => {
                            let timeStr = "—";
                            if (h.timestamp instanceof Date) {
                               timeStr = h.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            } else if (h.timestamp?.toDate) {
                               timeStr = h.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            } else if (typeof h.timestamp === "string" || typeof h.timestamp === "number") {
                               timeStr = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            }
                            return (
                              <div key={i} className="flex gap-3 relative z-10 text-sm">
                                <div className="w-4 h-4 rounded-full bg-white border-2 border-slate-300 shrink-0 mt-0.5"></div>
                                <div>
                                  <p className="font-semibold text-slate-700 leading-none">{h.status}</p>
                                  <p className="text-xs text-slate-400 mt-1.5 font-medium">{timeStr} • {h.modifiedBy}</p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 italic bg-white p-3 rounded-xl border border-slate-100">
                          {language === "ar" ? "لم يتم تسجيل تفاصيل دورة الحياة لهذا الموعد القديم." : "Detailed lifecycle not recorded for this older appointment."}
                        </div>
                      )}

                      {latenessMsg && (
                        <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs font-bold rounded-xl border border-amber-200">
                          <AlertCircle size={14} />
                          {latenessMsg}
                        </div>
                      )}
                    </div>

                    {/* Right Column: Procedures & Notes */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                       <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                        <FileText size={12} className="text-slate-400" /> {language === "ar" ? "الإجراءات الطبية" : "Procedures & Notes"}
                      </h4>
                      {visit.noteDetails ? (
                        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
                          <p className="font-semibold text-sm text-slate-800">{visit.noteDetails.procedure || visit.noteDetails.title || "Note"}</p>
                          <p className="text-xs font-bold text-slate-500 mt-2 flex items-center gap-1.5">
                            <CheckCircle2 size={14} className={visit.noteDetails.status === "Completed" ? "text-emerald-500" : "text-blue-500"} />
                            <span className={visit.noteDetails.status === "Completed" ? "text-emerald-600" : "text-blue-600"}>{visit.noteDetails.status || "Ongoing"}</span>
                          </p>
                          {visit.noteDetails.note && (
                            <div className="mt-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                               <p className="text-sm text-slate-600 italic">"{visit.noteDetails.note}"</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 italic bg-white p-3 rounded-xl border border-slate-100">
                          {language === "ar" ? "لا توجد تفاصيل طبية مرتبطة." : "No clinical notes linked to this appointment."}
                        </div>
                      )}
                    </div>

                  </div>
                ) : (
                  <div className="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100/60">
                    <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                      <FileText size={12} /> {language === "ar" ? "تفاصيل الإجراء العام" : "General Procedure Details"}
                    </h4>
                    <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-semibold text-sm text-slate-800">{visit.procedure || visit.title || "Procedure"}</p>
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-md">
                          {visit.status || "Completed"}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                        {visit.doctor && (
                          <div>
                            <p className="text-slate-400 text-xs font-bold uppercase mb-0.5">{language === "ar" ? "الطبيب" : "Doctor"}</p>
                            <p className="text-slate-700 font-medium">{visit.doctor}</p>
                          </div>
                        )}
                        {visit.tooth && visit.tooth !== "Gen" && (
                          <div>
                            <p className="text-slate-400 text-xs font-bold uppercase mb-0.5">{language === "ar" ? "السن" : "Tooth"}</p>
                            <p className="text-slate-700 font-medium">{visit.tooth}</p>
                          </div>
                        )}
                        {visit.cost !== undefined && (
                          <div>
                            <p className="text-slate-400 text-xs font-bold uppercase mb-0.5">{language === "ar" ? "التكلفة" : "Cost"}</p>
                            <p className="text-slate-700 font-bold">{visit.cost} EGP</p>
                          </div>
                        )}
                      </div>

                      {visit.note && (
                        <div className="mt-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                           <p className="text-sm text-slate-600 italic">"{visit.note}"</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
