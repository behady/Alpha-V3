"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle, HelpCircle, PenLine } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { openWhatsAppWithText, registerWhatsAppManualHandler } from "@/lib/whatsappManual";
import {
  ClinicalNoteDensity,
  ClinicalNoteGrouping,
  ClinicalNoteSort,
  isClinicalNoteDensity,
  isClinicalNoteGrouping,
  isClinicalNoteSort,
} from "@/components/clinical-notes/ordering";

// --- TYPES ---
type ToastType = "success" | "error" | "info";
interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export interface ConfirmDialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * "danger" paints the confirm button red and shows a warning mark — for deletions and anything
   * that loses data. The default tone is for ordinary questions ("Book an appointment now?"),
   * which used to borrow the same alarming red triangle and read as though something had gone
   * wrong.
   */
  tone?: "default" | "danger";
}

export interface PromptDialogOptions {
  title?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** One-tap answers shown as chips above the field — the common replies, typed for you. */
  suggestions?: string[];
  multiline?: boolean;
  /** When true the confirm button stays disabled until something is typed. */
  required?: boolean;
}

interface ConfirmOptions extends ConfirmDialogOptions {
  isOpen: boolean;
  message: string;
}

interface PromptOptions extends PromptDialogOptions {
  isOpen: boolean;
  message: string;
}

/**
 * Where the clinical procedure editor appears.
 *
 * `modal`  — a pop-up over the page.
 * `drawer` — a sheet from the side.
 * `inline` — the chart-first workspace: chart above the form, on the page, no overlay.
 */
export type ClinicalEditorMode = 'modal' | 'drawer' | 'inline';

const CLINICAL_EDITOR_MODES: ClinicalEditorMode[] = ['modal', 'drawer', 'inline'];

function isClinicalEditorMode(value: unknown): value is ClinicalEditorMode {
  return typeof value === 'string' && (CLINICAL_EDITOR_MODES as string[]).includes(value);
}

interface UIContextType {
  showToast: (message: string, type?: ToastType) => void;
  confirm: (message: string, options?: ConfirmDialogOptions) => Promise<boolean>;
  /** Ask for one piece of text. Resolves to null when dismissed — never to an empty string. */
  prompt: (message: string, options?: PromptDialogOptions) => Promise<string | null>;
  /**
   * How the clinical procedure editor presents itself.
   *
   * `inline` is the desktop chart-first workspace — the chart above the form, on the page, no
   * overlay. It is a third value rather than a desktop special case because it was ALREADY the
   * behaviour and nobody could see or change it: the Clinical tab returned that layout for any
   * window wider than 1024px and never consulted this setting at all. Someone who picked
   * "Pop-up Modal" on a laptop watched nothing happen, twice, and reasonably concluded the app
   * had lost the feature.
   */
  clinicalEditorMode: ClinicalEditorMode;
  setClinicalEditorMode: (mode: ClinicalEditorMode) => void;
  /**
   * False until somebody actually chooses. The Clinical tab uses it to keep the layout every
   * desktop user already has, while still letting an explicit choice win at any width.
   */
  clinicalEditorModeChosen: boolean;
  appointmentEditorMode: 'modal' | 'drawer';
  setAppointmentEditorMode: (mode: 'modal' | 'drawer') => void;
  /** Which panel fills the column beside the schedule when an appointment is selected. */
  appointmentPanelMode: 'editor' | 'avatar';
  setAppointmentPanelMode: (mode: 'editor' | 'avatar') => void;
  /**
   * True while the reception assistant panel is on screen. The floating Gemini bubble is fixed to
   * the bottom corner and sat on top of that panel's composer; it reads this to move to the
   * opposite corner rather than being hidden, so both assistants stay reachable.
   */
  receptionPanelActive: boolean;
  setReceptionPanelActive: (active: boolean) => void;
  appointmentsVisibility: 'all' | 'desktop' | 'hidden';
  setAppointmentsVisibility: (visibility: 'all' | 'desktop' | 'hidden') => void;
  latePatientTrackerEnabled: boolean;
  setLatePatientTrackerEnabled: (enabled: boolean) => void;
  /** How services are arranged inside a patient's clinical note. See components/clinical-notes/ordering. */
  clinicalNoteSort: ClinicalNoteSort;
  setClinicalNoteSort: (sort: ClinicalNoteSort) => void;
  clinicalNoteGrouping: ClinicalNoteGrouping;
  setClinicalNoteGrouping: (grouping: ClinicalNoteGrouping) => void;
  clinicalNoteDensity: ClinicalNoteDensity;
  setClinicalNoteDensity: (density: ClinicalNoteDensity) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions>({ isOpen: false, message: "" });
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);

  const [promptState, setPromptState] = useState<PromptOptions>({ isOpen: false, message: "" });
  const [promptValue, setPromptValue] = useState("");
  const promptResolver = useRef<((value: string | null) => void) | null>(null);
  const promptInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const [clinicalEditorMode, setClinicalEditorModeState] = useState<ClinicalEditorMode>('modal');
  const [clinicalEditorModeChosen, setClinicalEditorModeChosen] = useState(false);
  const [appointmentEditorMode, setAppointmentEditorModeState] = useState<'modal' | 'drawer'>('modal');
  const [appointmentPanelMode, setAppointmentPanelModeState] = useState<'editor' | 'avatar'>('editor');
  const [receptionPanelActive, setReceptionPanelActive] = useState(false);
  const [appointmentsVisibility, setAppointmentsVisibilityState] = useState<'all' | 'desktop' | 'hidden'>('desktop');
  const [latePatientTrackerEnabledState, setLatePatientTrackerEnabledState] = useState<boolean>(true);
  const [clinicalNoteSort, setClinicalNoteSortState] = useState<ClinicalNoteSort>('newest');
  const [clinicalNoteGrouping, setClinicalNoteGroupingState] = useState<ClinicalNoteGrouping>('flat');
  const [clinicalNoteDensity, setClinicalNoteDensityState] = useState<ClinicalNoteDensity>('detailed');

  // Load editor mode from localStorage
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const savedMode = localStorage.getItem("alpha_clinical_editor_mode");
        if (isClinicalEditorMode(savedMode)) {
          setClinicalEditorModeState(savedMode);
          setClinicalEditorModeChosen(true);
        }
      }

      const savedClinicalMode = localStorage.getItem("clinicalEditorMode");
      if (isClinicalEditorMode(savedClinicalMode)) {
        setClinicalEditorModeState(savedClinicalMode);
        setClinicalEditorModeChosen(true);
      }
      
      const savedApptMode = localStorage.getItem("appointmentEditorMode") as 'modal' | 'drawer';
      if (savedApptMode) setAppointmentEditorModeState(savedApptMode);

      const savedPanelMode = localStorage.getItem("appointmentPanelMode");
      if (savedPanelMode === "avatar" || savedPanelMode === "editor") setAppointmentPanelModeState(savedPanelMode);

      const savedApptsVis = localStorage.getItem("appointmentsVisibility") as 'all' | 'desktop' | 'hidden';
      if (savedApptsVis) setAppointmentsVisibilityState(savedApptsVis);

      const savedTracker = localStorage.getItem("latePatientTrackerEnabled");
      if (savedTracker !== null) setLatePatientTrackerEnabledState(savedTracker === "true");

      // Validated on read rather than cast: these come from a store the user can edit, and an
      // unrecognised value would otherwise flow into the timeline and render nothing at all.
      const savedNoteSort = localStorage.getItem("clinicalNoteSort");
      if (isClinicalNoteSort(savedNoteSort)) setClinicalNoteSortState(savedNoteSort);

      const savedNoteGrouping = localStorage.getItem("clinicalNoteGrouping");
      if (isClinicalNoteGrouping(savedNoteGrouping)) setClinicalNoteGroupingState(savedNoteGrouping);

      const savedNoteDensity = localStorage.getItem("clinicalNoteDensity");
      if (isClinicalNoteDensity(savedNoteDensity)) setClinicalNoteDensityState(savedNoteDensity);
    } catch (e) {
      console.error("Could not load UI settings", e);
    }
  }, []);

  const setClinicalEditorMode = useCallback((mode: ClinicalEditorMode) => {
    setClinicalEditorModeState(mode);
    setClinicalEditorModeChosen(true);
    try {
      localStorage.setItem("clinicalEditorMode", mode);
    } catch (e) {}
  }, []);

  const setAppointmentEditorMode = useCallback((mode: 'modal' | 'drawer') => {
    setAppointmentEditorModeState(mode);
    try {
      localStorage.setItem("appointmentEditorMode", mode);
    } catch (e) {}
  }, []);

  const setAppointmentPanelMode = useCallback((mode: 'editor' | 'avatar') => {
    setAppointmentPanelModeState(mode);
    try {
      localStorage.setItem("appointmentPanelMode", mode);
    } catch (e) {}
  }, []);

  const setAppointmentsVisibility = useCallback((visibility: 'all' | 'desktop' | 'hidden') => {
    setAppointmentsVisibilityState(visibility);
    try {
      localStorage.setItem("appointmentsVisibility", visibility);
    } catch (e) {}
  }, []);

  const setLatePatientTrackerEnabled = useCallback((enabled: boolean) => {
    setLatePatientTrackerEnabledState(enabled);
    try {
      localStorage.setItem("latePatientTrackerEnabled", String(enabled));
    } catch (e) {}
  }, []);

  const setClinicalNoteSort = useCallback((sort: ClinicalNoteSort) => {
    setClinicalNoteSortState(sort);
    try {
      localStorage.setItem("clinicalNoteSort", sort);
    } catch (e) {}
  }, []);

  const setClinicalNoteGrouping = useCallback((grouping: ClinicalNoteGrouping) => {
    setClinicalNoteGroupingState(grouping);
    try {
      localStorage.setItem("clinicalNoteGrouping", grouping);
    } catch (e) {}
  }, []);

  const setClinicalNoteDensity = useCallback((density: ClinicalNoteDensity) => {
    setClinicalNoteDensityState(density);
    try {
      localStorage.setItem("clinicalNoteDensity", density);
    } catch (e) {}
  }, []);

  // --- TOAST LOGIC ---
  const showToast = useCallback((message: string, type: ToastType = "success") => {
    // FIX: Generate a cryptographically unique ID, falling back to a random string + timestamp
    const id = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15) + Date.now().toString();

    setToasts((prev) => [...prev, { id, message, type }]);
    
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000); // Disappear after 4 seconds
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // --- CONFIRM LOGIC ---
  const confirm = useCallback((message: string, options?: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        message,
        title: options?.title,
        confirmLabel: options?.confirmLabel,
        cancelLabel: options?.cancelLabel,
        tone: options?.tone,
      });
      confirmResolver.current = resolve;
    });
  }, []);

  // --- PROMPT LOGIC ---
  const prompt = useCallback((message: string, options?: PromptDialogOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptValue(options?.defaultValue ?? "");
      setPromptState({ isOpen: true, message, ...options });
      promptResolver.current = resolve;
    });
  }, []);

  const closePrompt = useCallback((value: string | null) => {
    setPromptState({ isOpen: false, message: "" });
    setPromptValue("");
    if (promptResolver.current) {
      promptResolver.current(value);
      promptResolver.current = null;
    }
  }, []);

  /**
   * Click-to-send WhatsApp.
   *
   * When a clinic has no gateway configured — which is most of them at first, and permanently for
   * any clinic without the commercial papers the official WhatsApp API demands — the server hands
   * the finished message back instead of failing. This turns it into a prompt, and the button in
   * that prompt is what opens WhatsApp: browsers only allow a new window during a real click, and
   * by this point the click that started the save is long gone.
   *
   * One dialog at a time, so two messages produced by the same action would show the second only.
   * In practice a save produces one message; if that stops being true this needs a queue.
   */
  useEffect(() => {
    registerWhatsAppManualHandler((message) => {
      const who = message.patientName ? ` — ${message.patientName}` : "";
      void confirm(`الرسالة جاهزة${who}. تفتح واتساب عشان تبعتها؟`, {
        title: "إرسال على واتساب",
        confirmLabel: "افتح واتساب",
        cancelLabel: "مش دلوقتي",
      }).then((ok) => {
        if (ok) openWhatsAppWithText(message.phone, message.text);
      });
    });
    return () => registerWhatsAppManualHandler(null);
  }, [confirm]);

  const handleConfirm = useCallback((result: boolean) => {
    setConfirmState({ isOpen: false, message: "" });
    if (confirmResolver.current) {
      confirmResolver.current(result);
      confirmResolver.current = null;
    }
  }, []);

  /**
   * Escape closes whichever dialog is open, and the prompt's field takes focus when it appears.
   * A browser's own prompt does both; a hand-built one that does neither feels broken to anyone
   * who works by keyboard.
   */
  useEffect(() => {
    if (!confirmState.isOpen && !promptState.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (promptState.isOpen) closePrompt(null);
      else handleConfirm(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmState.isOpen, promptState.isOpen, closePrompt, handleConfirm]);

  useEffect(() => {
    if (!promptState.isOpen) return;
    const id = window.setTimeout(() => promptInputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [promptState.isOpen]);

  const promptCanSubmit = !promptState.required || promptValue.trim().length > 0;

  return (
    <UIContext.Provider value={{ showToast, confirm, prompt, clinicalEditorMode, setClinicalEditorMode, clinicalEditorModeChosen, appointmentEditorMode, setAppointmentEditorMode, appointmentPanelMode, setAppointmentPanelMode, receptionPanelActive, setReceptionPanelActive, appointmentsVisibility, setAppointmentsVisibility, latePatientTrackerEnabled: latePatientTrackerEnabledState, setLatePatientTrackerEnabled, clinicalNoteSort, setClinicalNoteSort, clinicalNoteGrouping, setClinicalNoteGrouping, clinicalNoteDensity, setClinicalNoteDensity }}>
      {children}

      {/* --- TOAST CONTAINER (Smartphone Style) --- */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl min-w-[300px] max-w-[400px] animate-in slide-in-from-right-10 fade-in duration-300 border-l-4 ${
              /*
                 Success and error used to share a background AND a text colour, differing only by
                 a four-pixel border stripe -- so "Saved" and "Failed to save" looked the same at a
                 glance, which in a clinic is the difference between a payment recorded and a
                 payment lost. They are now the status tokens, which are distinct by hue and follow
                 the clinic's theme.
              */
              toast.type === "success" ? "bg-ok-tint border-ok text-ok" :
              toast.type === "error" ? "bg-danger-tint border-danger text-danger" :
              "bg-info-tint border-info text-info"
            }`}
          >
            {toast.type === "success" && <CheckCircle2 className="text-ok shrink-0" size={20} />}
            {toast.type === "error" && <AlertCircle className="text-danger shrink-0" size={20} />}
            {toast.type === "info" && <Info className="text-info shrink-0" size={20} />}
            <p className="text-sm font-bold flex-1">{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} className="opacity-50 hover:opacity-100"><X size={16}/></button>
          </div>
        ))}
      </div>

      {/* --- CONFIRM DIALOG --- */}
      {confirmState.isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
          dir={isRTL ? "rtl" : "ltr"}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => handleConfirm(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-t-[1.75rem] sm:rounded-3xl shadow-2xl border border-slate-200/70 overflow-hidden animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200">
            <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mt-3 sm:hidden" />
            <div className="px-6 pt-6 pb-5 text-center">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                  confirmState.tone === "danger" ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-600"
                }`}
              >
                {confirmState.tone === "danger" ? <AlertTriangle size={26} /> : <HelpCircle size={26} />}
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-1.5 tracking-tight">
                {confirmState.title ?? (isAr ? "متأكد؟" : "Are you sure?")}
              </h3>
              <p className="text-slate-500 text-sm font-medium whitespace-pre-line leading-relaxed">
                {confirmState.message}
              </p>
            </div>
            <div className="flex gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
              <button
                type="button"
                onClick={() => handleConfirm(false)}
                className="flex-1 py-3 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50 transition-colors"
              >
                {confirmState.cancelLabel ?? (isAr ? "إلغاء" : "Cancel")}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => handleConfirm(true)}
                className={`flex-[1.4] py-3 rounded-xl text-xs font-black uppercase tracking-widest text-white shadow-md transition-colors ${
                  confirmState.tone === "danger"
                    ? "bg-rose-600 hover:bg-rose-700 shadow-rose-600/20"
                    : "bg-teal-600 hover:bg-teal-700 shadow-teal-600/20"
                }`}
              >
                {confirmState.confirmLabel ?? (isAr ? "تأكيد" : "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- PROMPT DIALOG (replaces the browser's own window.prompt) --- */}
      {promptState.isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
          dir={isRTL ? "rtl" : "ltr"}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => closePrompt(null)}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (promptCanSubmit) closePrompt(promptValue.trim());
            }}
            className="relative w-full max-w-md bg-white rounded-t-[1.75rem] sm:rounded-3xl shadow-2xl border border-slate-200/70 overflow-hidden animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
          >
            <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mt-3 sm:hidden" />

            <div className="flex items-start gap-3 px-5 sm:px-6 pt-5 pb-4">
              <div className="w-11 h-11 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <PenLine size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-black text-slate-900 tracking-tight leading-snug">
                  {promptState.title ?? (isAr ? "من فضلك اكتب" : "Quick question")}
                </h3>
                <p className="text-slate-500 text-sm font-medium mt-0.5 leading-relaxed">
                  {promptState.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => closePrompt(null)}
                className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors shrink-0"
                aria-label={isAr ? "إغلاق" : "Close"}
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 sm:px-6 pb-5 space-y-3">
              {promptState.suggestions && promptState.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {promptState.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setPromptValue(s);
                        promptInputRef.current?.focus();
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                        promptValue.trim() === s
                          ? "bg-teal-600 text-white border-teal-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-teal-400 hover:text-teal-700"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {promptState.multiline ? (
                <textarea
                  ref={(el) => { promptInputRef.current = el; }}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={promptState.placeholder}
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10 transition-all resize-none placeholder:font-medium placeholder:text-slate-400"
                />
              ) : (
                <input
                  ref={(el) => { promptInputRef.current = el; }}
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={promptState.placeholder}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10 transition-all placeholder:font-medium placeholder:text-slate-400"
                />
              )}
            </div>

            <div className="flex gap-2 px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
              <button
                type="button"
                onClick={() => closePrompt(null)}
                className="flex-1 py-3 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50 transition-colors"
              >
                {promptState.cancelLabel ?? (isAr ? "إلغاء" : "Cancel")}
              </button>
              <button
                type="submit"
                disabled={!promptCanSubmit}
                className="flex-[1.4] py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-black uppercase tracking-widest shadow-md shadow-teal-600/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {promptState.confirmLabel ?? (isAr ? "حفظ" : "Save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </UIContext.Provider>
  );
}

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error("useUI must be used within UIProvider");
  return context;
};