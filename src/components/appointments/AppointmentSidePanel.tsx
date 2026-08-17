"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  X, Save, Trash2, Wallet, User, Edit, Clock, FileText, Loader2, DollarSign, Check, Plus, CheckCircle2,
  Stethoscope, Activity, Calendar, Hourglass, ClipboardList, ChevronDown, Sparkles
} from "lucide-react";
import { db } from "@/lib/firebase";
import { 
  doc, updateDoc, collection, query, where, onSnapshot, serverTimestamp, 
  getDocs, addDoc, getDoc, deleteDoc
} from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { getAppointmentStatusStyles, APPOINTMENT_STAGES, getAppointmentStageLabel } from "@/lib/appointmentStages";
import { saveBooking } from "@/lib/bookingService";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import ServiceCombobox from "@/components/shared/ServiceCombobox";

interface AppointmentSidePanelProps {
  selectedAppointment: any | null;
  onClose: () => void;
  onEditFull: (appt: any) => void;
  onDelete: (id: string) => void;
  onSaveBooking?: (data: any) => Promise<void>;
  onQuickPay?: (patientId: string, patientName: string) => void;
  doctorsList: any[];
  servicesList?: any[];
  /**
   * Flips to the AI reception assistant. The mirror of the assistant's own flip-to-editor button —
   * without it, switching to this panel was a one-way door that also rewrote the saved preference,
   * so the only way back was Settings.
   */
  onSwitchToAvatar?: () => void;
}

export default function AppointmentSidePanel({
  selectedAppointment,
  onClose,
  onEditFull,
  onDelete,
  onSaveBooking,
  onQuickPay,
  doctorsList,
  servicesList = [],
  onSwitchToAvatar
}: AppointmentSidePanelProps) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const { showToast, confirm } = useUI();
  const router = useRouter();

  const [inlineEdit, setInlineEdit] = useState<Record<string, any>>({});
  const [inlineSaving, setInlineSaving] = useState(false);
  const [patientLedger, setPatientLedger] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [visitReasonsOptions, setVisitReasonsOptions] = useState<string[]>(["كشف"]);

  useEffect(() => {
    getDoc(getClinicDoc("settings", "visit_reasons")).then((snap) => {
      if (snap.exists() && Array.isArray(snap.data().reasons) && snap.data().reasons.length > 0) {
        setVisitReasonsOptions(snap.data().reasons);
      }
    });
  }, []);

  // Inline payment state
  const [showInlinePayment, setShowInlinePayment] = useState(false);
  const [unpaidProcedures, setUnpaidProcedures] = useState<any[]>([]);
  const [selectedProcedure, setSelectedProcedure] = useState<any>(null);
  const [inlinePayAmount, setInlinePayAmount] = useState<number | "">("");
  const [inlinePayLoading, setInlinePayLoading] = useState(false);
  const [unpaidLoading, setUnpaidLoading] = useState(false);

  // Add procedure state
  const [showAddProcedure, setShowAddProcedure] = useState(false);
  const [procServiceId, setProcServiceId] = useState("");
  const [procCost, setProcCost] = useState<number | "">("");
  const [addProcToLedger, setAddProcToLedger] = useState(true);
  const [addingProcedure, setAddingProcedure] = useState(false);
  const [sessionProcedures, setSessionProcedures] = useState<{name: string, cost: number, clinicalNoteId: string, ledgerId: string | null}[]>([]);

  // Initialize inline edit form when appointment is selected
  useEffect(() => {
    if (selectedAppointment) {
      setInlineEdit({
        patientName: selectedAppointment.patientName || '',
        treatment: selectedAppointment.treatment || '',
        doctor: selectedAppointment.doctor || '',
        date: selectedAppointment.date || '',
        time: selectedAppointment.time || '',
        duration: selectedAppointment.duration || 30,
        status: selectedAppointment.status || 'Scheduled',
        notes: selectedAppointment.notes || '',
        discountAmount: selectedAppointment.discountAmount || 0,
        services: selectedAppointment.services ? JSON.parse(JSON.stringify(selectedAppointment.services)) : [],
      });
      setShowInlinePayment(false); // Reset payment view when switching appts
      setShowAddProcedure(false);
      setProcServiceId("");
      setProcCost("");
      setAddProcToLedger(true);
      setSessionProcedures([]);
    }
  }, [selectedAppointment?.id, selectedAppointment]);

  // Fetch ledger entries when selected appointment changes
  useEffect(() => {
    if (!selectedAppointment?.patientId) {
      setPatientLedger([]);
      return;
    }
    setLedgerLoading(true);
    const q = query(
      getClinicCollection("ledger"),
      where("patientId", "==", selectedAppointment.patientId)
    );
    const unsub = onSnapshot(q, (snap) => {
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      records.sort((a: any, b: any) => {
        const tA = a.createdAt?.toMillis?.() || 0;
        const tB = b.createdAt?.toMillis?.() || 0;
        return tB - tA;
      });
      setPatientLedger(records);
      setLedgerLoading(false);
    }, (error) => {
      console.error("Ledger query error:", error);
      setLedgerLoading(false);
    });
    return () => unsub();
  }, [selectedAppointment?.patientId]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedAppointment) return false;
    const fields = ['patientName', 'treatment', 'doctor', 'date', 'time', 'duration', 'status', 'notes', 'discountAmount'];
    for (const key of fields) {
      if (String((selectedAppointment as any)[key] || '') !== String(inlineEdit[key] || '')) return true;
    }
    // Deep compare services
    const oldSvc = selectedAppointment.services || [];
    const newSvc = inlineEdit.services || [];
    if (oldSvc.length !== newSvc.length) return true;
    for(let i=0; i<oldSvc.length; i++) {
       if (oldSvc[i].serviceId !== newSvc[i].serviceId || oldSvc[i].status !== newSvc[i].status) return true;
    }
    return false;
  }, [selectedAppointment, inlineEdit]);

  const saveInlineEdit = async (): Promise<boolean> => {
    if (!selectedAppointment) return false;
    // Note: Delay prompt logic is simplified here; it assumes the parent page handles deep delays via BookingModal
    // For simplicity, we just save the status directly.
    setInlineSaving(true);
    try {
      const dataToSave = {
        existingAppointmentId: selectedAppointment.id,
        patientId: selectedAppointment.patientId,
        patientName: inlineEdit.patientName,
        treatment: inlineEdit.treatment,
        doctor: inlineEdit.doctor,
        date: inlineEdit.date,
        time: inlineEdit.time,
        duration: Number(inlineEdit.duration) || 30,
        type: selectedAppointment.type || 'consult',
        notes: inlineEdit.notes,
        discountAmount: 0,
        discountMode: "none",
        cost: 0,
        status: inlineEdit.status,
      };

      if (onSaveBooking) {
        await onSaveBooking(dataToSave);
      } else {
        await saveBooking(
           dataToSave,
           { uid: user?.uid || 'system', name: user?.name || 'System', role: user?.role || 'staff', language: (language as "en" | "ar") || 'en' },
           async () => {} // Dummy whatsapp sender, could be passed if needed
        );
      }

      showToast(language === 'ar' ? 'تم الحفظ' : 'Saved!', 'success');
      return true;
    } catch (e) {
      console.error(e);
      showToast(language === 'ar' ? 'خطأ' : 'Error saving', 'error');
      return false;
    } finally {
      setInlineSaving(false);
    }
  };

  const handleInlinePayment = async () => {
    if (!selectedProcedure || !inlinePayAmount || isNaN(Number(inlinePayAmount)) || Number(inlinePayAmount) <= 0) {
      showToast(language === 'ar' ? "يرجى تحديد إجراء وإدخال مبلغ صحيح" : "Please select a procedure and enter a valid amount", "error");
      return;
    }
    
    if (Number(inlinePayAmount) > selectedProcedure.remaining) {
      if (!(await confirm(language === 'ar' ? "المبلغ أكبر من المتبقي. متابعة؟" : "Amount is greater than remaining. Continue?"))) {
        return;
      }
    }

    setInlinePayLoading(true);
    try {
      const today = new Date();
      const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      
      let ledgerDesc = `Payment`;
      if (selectedProcedure.id !== 'general_payment') {
         ledgerDesc = `Payment for ${selectedProcedure.description}`;
      }

      await addDoc(getClinicCollection("ledger"), {
        patientId: selectedAppointment.patientId,
        patientName: selectedAppointment.patientName,
        type: "payment",
        date: localDate,
        amount: 0,
        paid: Number(inlinePayAmount),
        description: ledgerDesc,
        procedureId: selectedProcedure.id === 'general_payment' ? null : selectedProcedure.id,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "system",
        addedBy: user?.name || user?.email || "Staff",
        receivedBy: user?.name || user?.email || "Staff",
      });

      showToast(language === 'ar' ? "تم تسجيل الدفعة بنجاح" : "Payment recorded successfully", "success");
      setInlinePayAmount("");
      setShowInlinePayment(false);
      setSelectedProcedure(null);
    } catch (e) {
      console.error("Error inline payment:", e);
      showToast(language === 'ar' ? "خطأ في تسجيل الدفعة" : "Error recording payment", "error");
    } finally {
      setInlinePayLoading(false);
    }
  };

  const handleClose = async () => {
    if (hasUnsavedChanges) {
      const wantToSave = await confirm(
        language === "ar" 
          ? "لديك تغييرات غير محفوظة. هل تريد حفظها قبل الإغلاق؟" 
          : "You have unsaved changes. Do you want to save them before closing?",
        { confirmLabel: language === "ar" ? "حفظ" : "Save", cancelLabel: language === "ar" ? "تجاهل" : "Discard" }
      );
      if (wantToSave) {
        const success = await saveInlineEdit();
        if (!success) return; 
      }
    }
    onClose();
  };

  if (!selectedAppointment) {
    return (
      <div className="w-full shrink-0 flex flex-col gap-4 z-20">
        <div className="bg-white/60 border border-white/60 shadow-sm rounded-2xl flex flex-col h-full min-h-[400px] items-center justify-center text-slate-400 transition-all">
          <Clock size={40} className="mb-4 opacity-50"/>
          <p className="text-base font-black text-slate-600">{language === 'ar' ? 'اختر موعداً' : 'Select an appointment'}</p>
          <p className="text-xs font-bold mt-2 max-w-[200px] text-center">{language === 'ar' ? 'انقر على أي موعد لعرض التفاصيل والتعديل المباشر.' : 'Click on any appointment to view details and edit inline.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full shrink-0 flex flex-col gap-4 z-20">
        <div className="bg-white/80 backdrop-blur-3xl border border-white/60 shadow-[0_8px_40px_rgba(0,0,0,0.04)] rounded-[2rem] flex flex-col h-full min-h-0 overflow-hidden lg:text-slate-800 transition-all duration-300">
            <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
                
                {/* Header with close */}
                <div className="shrink-0 px-5 py-4 flex items-center justify-between border-b border-white/40 bg-transparent">
                  <div 
                    className="flex items-center gap-3 cursor-pointer group"
                    onClick={() => {
                        if (selectedAppointment.patientId) {
                            router.push(`/patients/${selectedAppointment.patientId}`);
                        }
                    }}
                    title={language === 'ar' ? 'عرض الملف الشخصي' : 'View Profile'}
                  >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-teal-700 bg-teal-50 text-sm shadow-sm border border-teal-100 group-hover:bg-teal-100 group-hover:scale-105 transition-all`}>
                        {(selectedAppointment.patientName || "").substring(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="font-extrabold text-slate-800 text-base leading-tight group-hover:text-teal-700 transition-colors">{selectedAppointment.patientName}</h2>
                        <p className="text-xs font-medium text-slate-500 mt-0.5">{language === 'ar' ? selectedAppointment.time?.replace('AM', 'ص').replace('PM', 'م') : selectedAppointment.time} • {selectedAppointment.date}</p>
                      </div>
                  </div>
                  <div className="flex items-center shrink-0">
                    {onSwitchToAvatar && (
                      <button
                        onClick={onSwitchToAvatar}
                        title={language === 'ar' ? 'التبديل إلى مساعد الاستقبال' : 'Switch to the reception assistant'}
                        className="p-2 text-slate-400 hover:text-teal-700 hover:bg-teal-50 rounded-full transition-colors"
                      >
                        <Sparkles size={17}/>
                      </button>
                    )}
                    <button onClick={handleClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
                  </div>
                </div>

                {/* Inline Edit Form */}
                <div className="px-6 py-5 space-y-5 border-b border-slate-200/60">
                  <div className="flex items-center justify-between">
                      <h3 className="font-light text-slate-800 text-sm uppercase tracking-widest">{language === 'ar' ? 'تعديل التفاصيل' : 'Edit Details'}</h3>
                      {hasUnsavedChanges && (
                        <div className="flex gap-1.5">
                            <button
                              disabled={inlineSaving}
                              onClick={saveInlineEdit}
                              className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                              <Save size={12}/> {inlineSaving ? '...' : language === 'ar' ? 'حفظ' : 'Save'}
                            </button>
                            <button onClick={() => {
                              setInlineEdit({
                                patientName: selectedAppointment.patientName || '',
                                treatment: selectedAppointment.treatment || '',
                                doctor: selectedAppointment.doctor || '',
                                date: selectedAppointment.date || '',
                                time: selectedAppointment.time || '',
                                duration: selectedAppointment.duration || 30,
                                status: selectedAppointment.status || 'Scheduled',
                                notes: selectedAppointment.notes || '',
                                cost: selectedAppointment.cost || 0,
                                listPrice: selectedAppointment.listPrice || selectedAppointment.cost || 0,
                                discountMode: selectedAppointment.discountMode || 'none',
                                discountPercent: selectedAppointment.discountPercent || 0,
                                discountFixed: selectedAppointment.discountFixed || 0,
                                discountAmount: selectedAppointment.discountAmount || 0,
                                serviceId: selectedAppointment.serviceId || '',
                                serviceName: selectedAppointment.serviceName || '',
                              });
                            }} className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl hover:bg-slate-200 transition-colors">
                              {language === 'ar' ? 'إلغاء' : 'Cancel'}
                            </button>
                        </div>
                      )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                      {/* Doctor */}
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{language === 'ar' ? 'الطبيب' : 'Doctor'}</label>
                        <div className="relative group">
                          <Stethoscope size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                          <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <select value={inlineEdit.doctor || ''} onChange={e => setInlineEdit(p => ({...p, doctor: e.target.value}))} className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-10 text-xs font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 appearance-none shadow-sm">
                              <option value="">--</option>
                              {doctorsList.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Status */}
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{language === 'ar' ? 'الحالة' : 'Status'}</label>
                        <div className="relative group">
                          <Activity size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                          <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <select value={inlineEdit.status || 'Scheduled'} onChange={e => setInlineEdit(p => ({...p, status: e.target.value}))} className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-10 text-xs font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 appearance-none shadow-sm">
                              {/* Not a normal workflow stage — it is a marker the reception assistant leaves on a
                                  moved appointment's original slot, so it is shown only when that is what this
                                  record already is, never offered as something to switch a live appointment to. */}
                              {inlineEdit.status === 'Rescheduled' && (
                                <option value="Rescheduled">{getAppointmentStageLabel('Rescheduled', language)}</option>
                              )}
                              {APPOINTMENT_STAGES.map(s => <option key={s.value} value={s.value}>{getAppointmentStageLabel(s.value, language)}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Date */}
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{language === 'ar' ? 'التاريخ' : 'Date'}</label>
                        <div className="relative group">
                          <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                          <input type="date" value={inlineEdit.date || ''} onChange={e => setInlineEdit(p => ({...p, date: e.target.value}))} className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-4 text-xs font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 shadow-sm appearance-none"/>
                        </div>
                      </div>
                      {/* Time & Duration */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{language === 'ar' ? 'الوقت' : 'Time'}</label>
                          <div className="relative group">
                            <Clock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                            <input type="text" value={inlineEdit.time || ''} onChange={e => setInlineEdit(p => ({...p, time: e.target.value}))} className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 shadow-sm" placeholder="02:00 PM"/>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{language === 'ar' ? 'المدة' : 'Duration'}</label>
                          <div className="relative group">
                            <Hourglass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <select value={inlineEdit.duration || 30} onChange={e => setInlineEdit(p => ({...p, duration: Number(e.target.value)}))} className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-7 text-xs font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 appearance-none shadow-sm">
                                <option value={15}>{language === 'ar' ? '15 د' : '15 min'}</option>
                                <option value={30}>{language === 'ar' ? '30 د' : '30 min'}</option>
                                <option value={45}>{language === 'ar' ? '45 د' : '45 min'}</option>
                                <option value={60}>{language === 'ar' ? 'ساعة' : '1 hr'}</option>
                                <option value={90}>{language === 'ar' ? '1.5 س' : '1.5 hr'}</option>
                                <option value={120}>{language === 'ar' ? 'ساعتان' : '2 hr'}</option>
                            </select>
                          </div>
                        </div>
                      </div>
                  </div>

                  {/* Reason for Visit */}
                  <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{language === 'ar' ? 'سبب الزيارة' : 'Reason for Visit'}</label>
                      <div className="relative group">
                        <ClipboardList size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                        <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <select value={inlineEdit.treatment || ''} onChange={e => setInlineEdit(p => ({...p, treatment: e.target.value}))} className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-10 text-xs font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 appearance-none shadow-sm">
                            <option value="" disabled>{language === 'ar' ? 'اختر سبب الزيارة' : 'Select Reason for Visit'}</option>
                            {visitReasonsOptions.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                  </div>

                  {/* Add Procedure Section (Moved directly under Reason for Visit) */}
                  {servicesList.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowAddProcedure(prev => !prev)}
                        className={`w-full text-xs font-bold rounded-xl py-2.5 flex items-center justify-center gap-1.5 transition-colors shadow-sm ${
                          showAddProcedure
                            ? 'text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200'
                            : 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        <Plus size={14}/> {showAddProcedure ? (language === 'ar' ? 'إلغاء' : 'Cancel') : (language === 'ar' ? 'إضافة إجراء' : 'Add Procedure')}
                      </button>

                      {showAddProcedure && (
                        <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100 mt-2 animate-in slide-in-from-top-2 duration-200">
                          <div className="flex flex-col gap-3">
                            {/* Service selector */}
                            <div>
                              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">
                                {language === 'ar' ? 'الخدمة' : 'Service'}
                              </label>
                              <ServiceCombobox
                                services={servicesList}
                                value={procServiceId}
                                onChange={(val, svc) => {
                                  setProcServiceId(val);
                                  if (svc?.price) setProcCost(Number(svc.price));
                                }}
                                valueKey="id"
                                placeholder={language === 'ar' ? 'اختر الخدمة...' : 'Select service...'}
                                language={language}
                                className="w-full text-xs py-1 font-bold border border-slate-200 rounded-lg bg-white"
                              />
                            </div>
                            {/* Cost */}
                            <div>
                              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">
                                {language === 'ar' ? 'التكلفة' : 'Cost'}
                              </label>
                              <div className="relative">
                                <div className="absolute inset-y-0 start-0 ps-2.5 flex items-center pointer-events-none text-slate-400">
                                  <DollarSign size={14}/>
                                </div>
                                <input
                                  type="number"
                                  value={procCost}
                                  onChange={e => setProcCost(e.target.value ? Number(e.target.value) : "")}
                                  className="w-full ps-8 pe-3 py-1.5 text-xs font-black text-slate-800 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                                  placeholder="0"
                                />
                              </div>
                            </div>
                            {/* Add to ledger toggle */}
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={addProcToLedger}
                                onChange={e => setAddProcToLedger(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span className="text-xs font-bold text-slate-600">
                                {language === 'ar' ? 'إضافة للسجل المالي' : 'Add to Ledger'}
                              </span>
                            </label>
                            {/* Confirm */}
                            <button
                              disabled={addingProcedure || !procServiceId || (!procCost && procCost !== 0)}
                              onClick={async () => {
                                const svc = servicesList.find(s => String(s.id) === String(procServiceId));
                                if (!svc) { showToast(language === 'ar' ? 'اختر خدمة' : 'Select a service', 'error'); return; }
                                const numCost = Number(procCost) || 0;

                                setAddingProcedure(true);
                                try {
                                  const today = new Date();
                                  const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                                  
                                  let newLedgerId = null;

                                  if (addProcToLedger && numCost > 0) {
                                    const ref = await addDoc(getClinicCollection("ledger"), {
                                      patientId: selectedAppointment.patientId,
                                      patientName: selectedAppointment.patientName,
                                      type: "procedure",
                                      category: "Treatment",
                                      amount: numCost,
                                      cost: numCost,
                                      description: svc.name,
                                      date: localDate,
                                      appointmentId: null,
                                      paid: 0,
                                      createdAt: serverTimestamp(),
                                      createdBy: user?.uid || "system",
                                    });
                                    newLedgerId = ref.id;
                                  }

                                  // Create clinical note so it shows in the patient profile
                                  const noteRef = await addDoc(getClinicCollection("clinical_notes"), {
                                    patientId: selectedAppointment.patientId,
                                    createdAt: serverTimestamp(),
                                    appointmentId: null,
                                    tooth: "Gen",
                                    procedure: svc.name,
                                    procedures: [svc.name],
                                    cost: numCost,
                                    unitCost: numCost,
                                    unitsCount: 1,
                                    pricingFormula: `${numCost}*1`,
                                    note: "",
                                    // Appointments store the display name on `doctor`, not
                                    // `doctorName` — reading the wrong field meant this fell through
                                    // to the editing user's raw uid, so notes surfaced under a
                                    // "doctor" named like x7Kd9.... Attribution belongs to the
                                    // treating dentist on the appointment, never to whoever is
                                    // clicking, so there is no user fallback.
                                    doctor: selectedAppointment.doctor || "Unassigned",
                                    doctorId: selectedAppointment.doctorId || null,
                                    // Separate from `doctor` on purpose: this is who recorded it.
                                    createdByUid: user?.uid || null,
                                    createdByName: user?.name || user?.email || "",
                                    createdByRole: user?.role || "",
                                    date: localDate,
                                    status: "Completed",
                                    ledgerId: newLedgerId,
                                  });

                                  // If ledger was created, link back the clinicalNoteId to the ledger
                                  if (newLedgerId) {
                                    await updateDoc(getClinicDoc("ledger", newLedgerId), { clinicalNoteId: noteRef.id });
                                  }

                                  showToast(
                                    addProcToLedger
                                      ? (language === 'ar' ? 'تمت إضافة الإجراء للسجل المالي والملاحظات' : 'Procedure added to ledger & notes')
                                      : (language === 'ar' ? 'تمت إضافة الإجراء للملاحظات السريرية' : 'Procedure added to clinical notes'),
                                    'success'
                                  );
                                  // Reset form but keep add procedure open
                                  setProcServiceId("");
                                  setProcCost("");
                                  setAddProcToLedger(true);
                                  setSessionProcedures(prev => [...prev, { name: svc.name, cost: numCost, clinicalNoteId: noteRef.id, ledgerId: newLedgerId }]);
                                } catch (err) {
                                  console.error('Error adding procedure:', err);
                                  showToast(language === 'ar' ? 'خطأ في إضافة الإجراء' : 'Error adding procedure', 'error');
                                } finally {
                                  setAddingProcedure(false);
                                }
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-[38px] px-4 rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 w-full"
                            >
                              {addingProcedure ? <Loader2 size={16} className="animate-spin"/> : <Check size={16}/>}
                              {language === 'ar' ? 'تأكيد الإجراء' : 'Confirm Procedure'}
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Added Session Procedures Review List */}
                      {sessionProcedures.length > 0 && (
                        <div className="mt-3 flex flex-col gap-2">
                          <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">
                            {language === 'ar' ? 'الإجراءات المضافة' : 'Added Procedures'}
                          </label>
                          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-sm">
                            {sessionProcedures.map((sp, idx) => (
                              <div key={idx} className="flex items-center justify-between p-3 text-sm">
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                                  <span className="font-bold text-slate-700">{sp.name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-black text-slate-900">{sp.cost} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                                  <button 
                                    type="button"
                                    onClick={async () => {
                                      if (await confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا الإجراء؟' : 'Are you sure you want to delete this procedure?')) {
                                        try {
                                          await deleteDoc(getClinicDoc("clinical_notes", sp.clinicalNoteId));
                                          if (sp.ledgerId) {
                                            await deleteDoc(getClinicDoc("ledger", sp.ledgerId));
                                          }
                                          setSessionProcedures(prev => prev.filter(p => p.clinicalNoteId !== sp.clinicalNoteId));
                                          showToast(language === 'ar' ? 'تم الحذف بنجاح' : 'Deleted successfully', 'success');
                                        } catch (e) {
                                          console.error(e);
                                          showToast(language === 'ar' ? 'خطأ في الحذف' : 'Error deleting', 'error');
                                        }
                                      }
                                    }}
                                    className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{language === 'ar' ? 'ملاحظات' : 'Notes'}</label>
                      <div className="relative group">
                        <FileText size={16} className="absolute left-4 top-3 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                        <textarea value={inlineEdit.notes || ''} onChange={e => setInlineEdit(p => ({...p, notes: e.target.value}))} rows={2} className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-4 text-xs font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 resize-none shadow-sm"/>
                      </div>
                  </div>
                  
                  {/* Quick Actions */}
                  <div className="grid grid-cols-2 gap-2 mt-2">


                      {onQuickPay && (
                        <button onClick={(e) => { e.stopPropagation(); onQuickPay(selectedAppointment.patientId!, selectedAppointment.patientName!); }} className="w-full text-xs font-bold text-white bg-[#1A2130] border border-[#1A2130] hover:bg-slate-800 rounded-xl py-2.5 flex items-center justify-center gap-1.5 transition-colors shadow-md">
                          <Wallet size={14}/> {language === 'ar' ? 'دفع سريع' : 'Quick Pay'}
                        </button>
                      )}
                      <button onClick={() => onDelete(selectedAppointment.id)} className="w-full text-xs font-bold text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 rounded-xl py-2.5 flex items-center justify-center gap-1.5 transition-colors shadow-sm">
                        <Trash2 size={14}/> {language === 'ar' ? 'حذف' : 'Delete'}
                      </button>
                  </div>



                </div>

                {/* Ledger & Inline Payment */}
                <div className="px-4 py-3 flex-1">
                  <div className="flex items-center justify-between mb-3">
                      <h3 className="font-light text-slate-800 text-sm uppercase tracking-widest flex items-center gap-1.5">
                        <FileText size={16} className="text-slate-400"/> {language === 'ar' ? 'سجل المريض المالي' : 'Patient Ledger'}
                      </h3>
                      <button
                        onClick={async () => {
                            if (showInlinePayment) { setShowInlinePayment(false); return; }
                            setShowInlinePayment(true);
                            setUnpaidLoading(true);
                            setSelectedProcedure(null);
                            setInlinePayAmount("");
                            try {
                              const q = query(getClinicCollection("ledger"), where("patientId", "==", selectedAppointment.patientId));
                              const snap = await getDocs(q);
                              const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
                              const rawProcs = all.filter(r => r.type === "procedure");
                              const payments = all.filter(r => r.type === "payment");
                              const procs: any[] = [];
                              rawProcs.forEach(proc => {
                                  const cost = Number(proc.cost) || 0;
                                  const paidForProc = payments.filter(p => p.procedureId === proc.id).reduce((sum, p) => sum + (Number(p.paid) || 0), 0);
                                  const remaining = cost - paidForProc;
                                  if (remaining > 0) procs.push({ ...proc, paid: paidForProc, remaining });
                              });
                              procs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                              setUnpaidProcedures(procs);
                              if (procs.length === 0) setSelectedProcedure({ id: 'general_payment', description: 'General Payment', remaining: Infinity });
                            } catch (e) { console.error(e); }
                            finally { setUnpaidLoading(false); }
                        }}
                        className={`text-xs font-bold px-4 py-1.5 rounded-full transition-all flex items-center gap-1 shadow-sm ${showInlinePayment ? 'text-slate-600 bg-white border border-slate-200 hover:bg-slate-50' : 'text-white bg-[#1A2130] hover:bg-slate-800'}`}
                      >
                        <Wallet size={12}/> {showInlinePayment ? (language === 'ar' ? 'إلغاء' : 'Cancel') : (language === 'ar' ? 'دفع' : 'Pay')}
                      </button>
                  </div>

                  {/* Financial Summary */}
                  {(() => {
                      const procedures = patientLedger.filter(e => e.type === 'procedure');
                      const payments = patientLedger.filter(e => e.type === 'payment');
                      const totalCost = procedures.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
                      const totalPaid = payments.reduce((sum, e) => sum + (Number(e.paid) || 0), 0);
                      const totalRemaining = totalCost - totalPaid;

                      return (
                        <div className="flex gap-2 mb-4">
                            <div className="flex-1 bg-white border border-slate-200 rounded-xl p-2.5 text-center shadow-sm">
                              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-0.5">{language === 'ar' ? 'الإجمالي' : 'Total Cost'}</p>
                              <p className="text-sm font-black text-slate-800">{totalCost.toLocaleString()} <span className="text-[9px] text-slate-400">EGP</span></p>
                            </div>
                            <div className="flex-1 bg-white border border-slate-200 rounded-xl p-2.5 text-center shadow-sm">
                              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-0.5">{language === 'ar' ? 'المدفوع' : 'Paid'}</p>
                              <p className="text-sm font-black text-emerald-600">{totalPaid.toLocaleString()} <span className="text-[9px] text-emerald-600/50">EGP</span></p>
                            </div>
                            <div className="flex-1 bg-[#1A2130] border border-[#1A2130] rounded-xl p-2.5 text-center shadow-md">
                              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-0.5">{language === 'ar' ? 'المتبقي' : 'Remaining'}</p>
                              <p className={`text-sm font-black ${totalRemaining > 0 ? 'text-white' : 'text-slate-400'}`}>{totalRemaining.toLocaleString()} <span className="text-[9px] opacity-50">EGP</span></p>
                            </div>
                        </div>
                      );
                  })()}

                  {/* Inline Payment Form */}
                  {showInlinePayment && (
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 mb-4 animate-in slide-in-from-top-2 duration-200">
                        {unpaidLoading ? (
                            <div className="flex justify-center p-4"><Loader2 className="animate-spin text-slate-400" size={20}/></div>
                        ) : (
                            <div className="flex flex-col gap-3">
                              <div>
                                  <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">
                                    {language === 'ar' ? 'اختر الإجراء لدفع حسابه' : 'Select Procedure to Pay'}
                                  </label>
                                  <select 
                                    className="w-full text-xs font-bold border border-slate-200 rounded-lg px-2 py-2 bg-white"
                                    value={selectedProcedure?.id || ""}
                                    onChange={(e) => {
                                        if (e.target.value === 'general_payment') setSelectedProcedure({ id: 'general_payment', description: 'General Payment', remaining: Infinity });
                                        else setSelectedProcedure(unpaidProcedures.find(p => p.id === e.target.value));
                                    }}
                                  >
                                    <option value="" disabled>-- {language === 'ar' ? 'اختر' : 'Select'} --</option>
                                    {unpaidProcedures.map(p => (
                                        <option key={p.id} value={p.id}>
                                          {p.description} ({language === 'ar' ? 'المتبقي:' : 'Remaining:'} {p.remaining} EGP)
                                        </option>
                                    ))}
                                    <option value="general_payment">{language === 'ar' ? 'دفعة عامة (بدون إجراء محدد)' : 'General Payment'}</option>
                                  </select>
                              </div>
                              <div className="flex gap-2 items-end">
                                  <div className="flex-1">
                                    <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">
                                        {language === 'ar' ? 'المبلغ' : 'Amount'}
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 start-0 ps-2.5 flex items-center pointer-events-none text-slate-400">
                                          <DollarSign size={14}/>
                                        </div>
                                        <input 
                                          type="number" 
                                          value={inlinePayAmount} 
                                          onChange={e => setInlinePayAmount(Number(e.target.value))}
                                          className="w-full ps-8 pe-3 py-2 text-sm font-black text-slate-800 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400"
                                          placeholder="0.00"
                                        />
                                    </div>
                                  </div>
                                    <button
                                      disabled={inlinePayLoading || !selectedProcedure || !inlinePayAmount}
                                      onClick={handleInlinePayment}
                                      className="bg-[#1A2130] hover:bg-slate-800 text-white font-bold h-[38px] px-4 rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                                    >
                                    {inlinePayLoading ? <Loader2 size={16} className="animate-spin"/> : <Check size={16}/>}
                                    {language === 'ar' ? 'تأكيد' : 'Confirm'}
                                  </button>
                              </div>
                            </div>
                        )}
                      </div>
                  )}

                  {/* Ledger List */}
                  <div className="space-y-2 mt-2 max-h-[300px] overflow-y-auto pr-1">
                      {ledgerLoading ? (
                        <div className="flex justify-center p-4"><Loader2 className="animate-spin text-slate-300" size={24}/></div>
                      ) : patientLedger.length === 0 ? (
                        <p className="text-xs text-center text-slate-400 italic py-4">{language === 'ar' ? 'لا توجد حركات مالية' : 'No financial records'}</p>
                      ) : (
                        patientLedger.map(entry => (
                            <div key={entry.id} className="flex items-center justify-between py-3 border-b border-slate-100 last:border-b-0">
                              <div>
                                  <p className="text-xs font-bold text-slate-800">{entry.description || entry.type}</p>
                                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{entry.date}</p>
                              </div>
                              <div className="text-end">
                                  {entry.type === 'payment' ? (
                                    <p className="text-xs font-black text-emerald-500">+{Number(entry.paid).toLocaleString()} <span className="text-[9px]">EGP</span></p>
                                  ) : (
                                    <p className="text-xs font-black text-slate-800">-{Number(entry.cost).toLocaleString()} <span className="text-[9px] text-slate-400">EGP</span></p>
                                  )}
                              </div>
                            </div>
                        ))
                      )}
                  </div>
                </div>

            </div>
        </div>
    </div>
  );
}
