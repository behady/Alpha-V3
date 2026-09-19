"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  X, Trash2, Wallet, Clock, FileText, Loader2, Check,
  Stethoscope, Calendar, Hourglass, ClipboardList, ChevronDown, Sparkles, CloudOff
} from "lucide-react";
import { getDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { saveBooking } from "@/lib/bookingService";
import { getClinicDoc } from "@/lib/db-utils";
import { autosaveVerdict } from "@/lib/appointmentAutosave";
import AppointmentStagePicker from "@/components/appointments/AppointmentStagePicker";
import AppointmentMoneyTab from "@/components/appointments/AppointmentMoneyTab";

/**
 * Exactly the fields this panel puts on screen — nothing more.
 *
 * Comparing anything else against the saved record is how autosave gets stuck in a loop: the form
 * only holds these keys, so a field it never shows (a room, a discount) reads as "" against a
 * stored value, counts as a change every render, and saves forever.
 */
const EDITED_FIELDS = ["date", "time", "doctor", "treatment", "duration", "notes", "status"] as const;

/**
 * Two tabs: the booking, and the money.
 *
 * It was three — services and ledger sat apart — and they are the same fact. A receptionist read a
 * price on one tab, switched to the other, found the same treatment again among charges and
 * payments mixed into one list, and did the subtraction in her head with a patient waiting. Money
 * now belongs to the treatment it is for, which is one tab.
 *
 * Each tab keeps its own colour. The icon is the thing you aim at when you have done this four
 * hundred times this week and are not reading any more.
 */
type PanelTab = "appointment" | "money";

const PANEL_TABS: { id: PanelTab; en: string; ar: string; icon: typeof Calendar; tint: string; tintActive: string }[] = [
  { id: "appointment", en: "Visit", ar: "الموعد", icon: Calendar, tint: "text-sky-500", tintActive: "text-sky-300" },
  { id: "money", en: "Money", ar: "الحساب", icon: Wallet, tint: "text-emerald-500", tintActive: "text-emerald-300" },
];

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
  const [visitReasonsOptions, setVisitReasonsOptions] = useState<string[]>(["كشف"]);

  useEffect(() => {
    getDoc(getClinicDoc("settings", "visit_reasons")).then((snap) => {
      if (snap.exists() && Array.isArray(snap.data().reasons) && snap.data().reasons.length > 0) {
        setVisitReasonsOptions(snap.data().reasons);
      }
    });
  }, []);

  const [activeTab, setActiveTab] = useState<PanelTab>("appointment");

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
    }
  }, [selectedAppointment?.id, selectedAppointment]);

  /**
   * A different visit starts on the visit tab again.
   *
   * Keyed on the id alone, not the appointment object: the effect above re-runs on every snapshot
   * of the same visit, and tying the tab to that would throw someone out of the ledger they were
   * reading the moment anything on the record changed.
   */
  useEffect(() => {
    setActiveTab("appointment");
  }, [selectedAppointment?.id]);

  /**
   * Autosave.
   *
   * There is no Save button any more: an edit writes itself once the person stops making it. How
   * long it waits depends on who hears about it — a note or a status settles in well under a
   * second, while moving the visit or changing its dentist waits longer, because bookingService
   * messages the patient about those and a person still choosing a time should cost one message,
   * not one per keystroke. `lib/appointmentAutosave` holds those rules and the tests that pin them.
   *
   * The timer is keyed on the appointment: switching to another one flushes nothing and starts
   * clean, so an edit can never land on the wrong patient's record.
   */
  const [autosaveState, setAutosaveState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const savingRef = useRef(false);
  const latestRef = useRef<{ appointment: Record<string, unknown>; fields: Record<string, unknown> } | null>(null);
  latestRef.current = { appointment: selectedAppointment, fields: inlineEdit };

  const runAutosave = useCallback(async () => {
    const latest = latestRef.current;
    if (!latest?.appointment || savingRef.current) return;
    const verdict = autosaveVerdict(latest.appointment, latest.fields, { fields: EDITED_FIELDS });
    if (!verdict.save) return;
    savingRef.current = true;
    setAutosaveState("saving");
    const save = saveInlineEditRef.current;
    const ok = save ? await save() : false;
    savingRef.current = false;
    setAutosaveState(ok ? "saved" : "error");
  }, []);

  useEffect(() => {
    if (!selectedAppointment) return;
    const verdict = autosaveVerdict(selectedAppointment, inlineEdit, { fields: EDITED_FIELDS });
    if (!verdict.save) {
      // Nothing to write, or a field still being typed. Clear "pending" so the chip stops
      // promising a save that is not coming; leave "saved" alone so it can fade on its own.
      setAutosaveState((s) => (s === "pending" ? "idle" : s));
      return;
    }
    setAutosaveState("pending");
    const id = setTimeout(() => void runAutosave(), verdict.delayMs);
    return () => clearTimeout(id);
  }, [selectedAppointment, inlineEdit, runAutosave]);

  // "Saved" is a receipt, not a state. It fades rather than sitting there claiming credit.
  useEffect(() => {
    if (autosaveState !== "saved") return;
    const id = setTimeout(() => setAutosaveState("idle"), 2200);
    return () => clearTimeout(id);
  }, [autosaveState]);

  const saveInlineEdit = async (): Promise<boolean> => {
    if (!selectedAppointment) return false;
    // Note: Delay prompt logic is simplified here; it assumes the parent page handles deep delays via BookingModal
    // For simplicity, we just save the status directly.
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

      // No toast. A toast per edit is a toast every few seconds once saving is automatic; the
      // chip beside the heading is the whole receipt. Failures still shout — see the catch.
      return true;
    } catch (e) {
      console.error(e);
      showToast(language === 'ar' ? 'مقدرناش نحفظ التعديل' : 'Could not save your change', 'error');
      return false;
    }
  };

  // Read through a ref so the debounce above always calls the current closure without having to
  // list every piece of state it touches as a dependency. Written after the render rather than
  // during it: a ref handed to useRef may not be reassigned mid-render, and the autosave that
  // reads it only ever fires from a timer, long after this has committed.
  const saveInlineEditRef = useRef<(() => Promise<boolean>) | null>(null);
  useEffect(() => {
    // The compiler's immutability rule sees a ref that a useCallback closed over and refuses the
    // assignment on principle. Refreshing a latest-closure ref from an effect is the sanctioned
    // way to do exactly this, and the alternative — rebuilding the callback every render — would
    // restart the autosave timer on every keystroke and mean nothing ever saved.
    // eslint-disable-next-line react-hooks/immutability
    saveInlineEditRef.current = saveInlineEdit;
  });

  /**
   * Closing flushes whatever is still waiting, rather than asking.
   *
   * The old prompt ("you have unsaved changes — save them?") was the right question while a Save
   * button existed. With autosave the answer is always yes, and asking would only ever catch the
   * second or two between the last keystroke and the timer — so it stops being a safeguard and
   * becomes a dialog between the person and their own typing.
   *
   * A change that cannot be written — a half-typed time — is the one case worth speaking up about,
   * because that one really would be lost.
   */
  const handleClose = async () => {
    const verdict = autosaveVerdict(selectedAppointment, inlineEdit, { fields: EDITED_FIELDS });
    if (verdict.save) {
      await runAutosave();
    } else if (verdict.reason === "unusable_time" || verdict.reason === "unusable_date") {
      const leave = await confirm(
        language === "ar"
          ? "الوقت أو التاريخ اللي مكتوب مش مفهوم، فمش هيتحفظ. تقفل برضه؟"
          : "The time or date as typed cannot be saved. Close anyway?",
        { confirmLabel: language === "ar" ? "اقفل" : "Close", cancelLabel: language === "ar" ? "ارجع" : "Go back" }
      );
      if (!leave) return;
    }
    onClose();
  };

  if (!selectedAppointment) {
    return (
      <div className="w-full shrink-0 flex flex-col gap-4 z-20">
        <div className="bg-white/60 border border-white/60 shadow-sm rounded-2xl flex flex-col h-full min-h-[400px] items-center justify-center text-slate-400 transition-all">
          <Clock size={40} className="mb-4 opacity-50"/>
          <p className="text-lg font-black text-ink-body">{language === 'ar' ? 'اختر موعداً' : 'Select an appointment'}</p>
          <p className="text-sm font-bold mt-2 max-w-[240px] text-center">{language === 'ar' ? 'انقر على أي موعد لعرض التفاصيل والتعديل المباشر.' : 'Click on any appointment to view details and edit inline.'}</p>
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
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-teal-700 bg-teal-50 text-base shadow-sm border border-teal-100 group-hover:bg-teal-100 group-hover:scale-105 transition-all`}>
                        {(selectedAppointment.patientName || "").substring(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="font-extrabold text-slate-800 text-lg leading-tight group-hover:text-teal-700 transition-colors">{selectedAppointment.patientName}</h2>
                        <p className="text-sm font-medium text-ink-muted mt-1">{language === 'ar' ? selectedAppointment.time?.replace('AM', 'ص').replace('PM', 'م') : selectedAppointment.time} • {selectedAppointment.date}</p>
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
                    <button onClick={handleClose} className="p-2 text-slate-400 hover:text-ink-body hover:bg-surface-muted rounded-full transition-colors"><X size={18}/></button>
                  </div>
                </div>

                {/* Three faces of one panel: the visit, its services, the money. */}
                <div className="shrink-0 px-4 pt-3 pb-3 flex items-center gap-1.5 border-b border-slate-200/60">
                  {PANEL_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                          active ? 'bg-ink-slab text-white shadow-sm' : 'text-ink-muted hover:bg-surface-muted'
                        }`}
                      >
                        <Icon size={15} className={active ? tab.tintActive : tab.tint} />
                        {language === 'ar' ? tab.ar : tab.en}
                      </button>
                    );
                  })}
                </div>

                {/* Inline Edit Form */}
                {activeTab === "appointment" && (
                <div className="px-5 py-5 space-y-5">
                  <div className="flex items-center justify-between">
                      <h3 className="font-light text-slate-800 text-base uppercase tracking-widest">{language === 'ar' ? 'تعديل التفاصيل' : 'Edit Details'}</h3>
                      <AutosaveChip state={autosaveState} language={language} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                      {/* Doctor */}
                      <div>
                        <label className="text-xs font-black text-ink-muted uppercase tracking-widest block mb-2">{language === 'ar' ? 'الطبيب' : 'Doctor'}</label>
                        <div className="relative group">
                          <Stethoscope size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <select value={inlineEdit.doctor || ''} onChange={e => setInlineEdit(p => ({...p, doctor: e.target.value}))} className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-9 pr-8 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 appearance-none shadow-sm">
                              <option value="">--</option>
                              {doctorsList.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Status */}
                      <div>
                        <label className="text-xs font-black text-ink-muted uppercase tracking-widest block mb-2">{language === 'ar' ? 'الحالة' : 'Status'}</label>
                        <AppointmentStagePicker
                          value={inlineEdit.status || 'Scheduled'}
                          onChange={val => setInlineEdit(p => ({...p, status: val}))}
                          language={language as "en" | "ar"}
                          fullWidth
                        />
                      </div>
                  </div>

                  {/* Date — full width, so the native date field is never clipped */}
                  <div>
                      <label className="text-xs font-black text-ink-muted uppercase tracking-widest block mb-2">{language === 'ar' ? 'التاريخ' : 'Date'}</label>
                      <div className="relative group">
                        <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                        <input type="date" value={inlineEdit.date || ''} onChange={e => setInlineEdit(p => ({...p, date: e.target.value}))} className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-9 pr-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 shadow-sm appearance-none"/>
                      </div>
                  </div>

                  {/* Time & Duration — a row of their own; sharing half a column truncated both */}
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-black text-ink-muted uppercase tracking-widest block mb-2">{language === 'ar' ? 'الوقت' : 'Time'}</label>
                        <div className="relative group">
                          <Clock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                          <input type="text" value={inlineEdit.time || ''} onChange={e => setInlineEdit(p => ({...p, time: e.target.value}))} className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-9 pr-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 shadow-sm" placeholder="02:00 PM"/>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-black text-ink-muted uppercase tracking-widest block mb-2">{language === 'ar' ? 'المدة' : 'Duration'}</label>
                        <div className="relative group">
                          <Hourglass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <select value={inlineEdit.duration || 30} onChange={e => setInlineEdit(p => ({...p, duration: Number(e.target.value)}))} className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-9 pr-8 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 appearance-none shadow-sm">
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

                  {/* Reason for Visit */}
                  <div>
                      <label className="text-xs font-black text-ink-muted uppercase tracking-widest block mb-2">{language === 'ar' ? 'سبب الزيارة' : 'Reason for Visit'}</label>
                      <div className="relative group">
                        <ClipboardList size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <select value={inlineEdit.treatment || ''} onChange={e => setInlineEdit(p => ({...p, treatment: e.target.value}))} className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-9 pr-8 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 appearance-none shadow-sm">
                            <option value="" disabled>{language === 'ar' ? 'اختر سبب الزيارة' : 'Select Reason for Visit'}</option>
                            {visitReasonsOptions.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                  </div>

                  {/* Notes */}
                  <div>
                      <label className="text-xs font-black text-ink-muted uppercase tracking-widest block mb-2">{language === 'ar' ? 'ملاحظات' : 'Notes'}</label>
                      <div className="relative group">
                        <FileText size={16} className="absolute left-3 top-3 text-slate-400 transition-colors group-focus-within:text-emerald-500 pointer-events-none" />
                        <textarea value={inlineEdit.notes || ''} onChange={e => setInlineEdit(p => ({...p, notes: e.target.value}))} rows={2} className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-9 pr-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 resize-none shadow-sm"/>
                      </div>
                  </div>
                  
                  {/* Quick Actions */}
                  <div className="grid grid-cols-2 gap-2 mt-2">


                      {onQuickPay && (
                        <button onClick={(e) => { e.stopPropagation(); onQuickPay(selectedAppointment.patientId!, selectedAppointment.patientName!); }} className="w-full text-sm font-bold text-white bg-ink-slab border border-ink-slab hover:bg-slate-800 rounded-xl py-3 flex items-center justify-center gap-1.5 transition-colors shadow-md">
                          <Wallet size={16}/> {language === 'ar' ? 'دفع سريع' : 'Quick Pay'}
                        </button>
                      )}
                      <button data-tour="appointment-delete" onClick={() => onDelete(selectedAppointment.id)} className="w-full text-sm font-bold text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 rounded-xl py-3 flex items-center justify-center gap-1.5 transition-colors shadow-sm">
                        <Trash2 size={16}/> {language === 'ar' ? 'حذف' : 'Delete'}
                      </button>
                  </div>



                </div>
                )}

                {/* Money — every treatment with what it cost, what is paid and what is left */}
                {activeTab === "money" && (
                <div className="px-4 py-4 flex-1">
                  <AppointmentMoneyTab
                    appointment={selectedAppointment}
                    doctorsList={doctorsList}
                    servicesList={servicesList}
                    onQuickPay={onQuickPay}
                  />
                </div>
                )}


            </div>
        </div>
    </div>
  );
}

/**
 * The whole receipt for autosave: a quiet line where the Save button used to be.
 *
 * It says the least it can get away with. "Saving" and "Saved" are reassurance a person glances
 * at once and then stops seeing; only a failure is worth colour, because that is the only state
 * where they have to do something.
 */
function AutosaveChip({ state, language }: { state: "idle" | "pending" | "saving" | "saved" | "error"; language: string }) {
  const isAr = language === "ar";
  if (state === "idle") return null;

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-danger">
        <CloudOff size={13} />
        {isAr ? "مش متحفظ" : "Not saved"}
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ok animate-in fade-in duration-200">
        <Check size={13} />
        {isAr ? "اتحفظ" : "Saved"}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-faint">
      <Loader2 size={13} className={state === "saving" ? "animate-spin" : "opacity-60"} />
      {isAr ? "بيتحفظ…" : "Saving…"}
    </span>
  );
}
