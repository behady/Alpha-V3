"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { openWhatsAppWithText, registerWhatsAppManualHandler } from "@/lib/whatsappManual";

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
}

interface ConfirmOptions {
  isOpen: boolean;
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface UIContextType {
  showToast: (message: string, type?: ToastType) => void;
  confirm: (message: string, options?: ConfirmDialogOptions) => Promise<boolean>;
  clinicalEditorMode: 'modal' | 'drawer';
  setClinicalEditorMode: (mode: 'modal' | 'drawer') => void;
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
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions>({ isOpen: false, message: "" });
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  
  const [clinicalEditorMode, setClinicalEditorModeState] = useState<'modal' | 'drawer'>('modal');
  const [appointmentEditorMode, setAppointmentEditorModeState] = useState<'modal' | 'drawer'>('modal');
  const [appointmentPanelMode, setAppointmentPanelModeState] = useState<'editor' | 'avatar'>('editor');
  const [receptionPanelActive, setReceptionPanelActive] = useState(false);
  const [appointmentsVisibility, setAppointmentsVisibilityState] = useState<'all' | 'desktop' | 'hidden'>('desktop');
  const [latePatientTrackerEnabledState, setLatePatientTrackerEnabledState] = useState<boolean>(true);

  // Load editor mode from localStorage
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const savedMode = localStorage.getItem("alpha_clinical_editor_mode");
        if (savedMode === "drawer" || savedMode === "modal") {
          setClinicalEditorModeState(savedMode);
        }
      }
      
      const savedClinicalMode = localStorage.getItem("clinicalEditorMode") as 'modal' | 'drawer';
      if (savedClinicalMode) setClinicalEditorModeState(savedClinicalMode);
      
      const savedApptMode = localStorage.getItem("appointmentEditorMode") as 'modal' | 'drawer';
      if (savedApptMode) setAppointmentEditorModeState(savedApptMode);

      const savedPanelMode = localStorage.getItem("appointmentPanelMode");
      if (savedPanelMode === "avatar" || savedPanelMode === "editor") setAppointmentPanelModeState(savedPanelMode);

      const savedApptsVis = localStorage.getItem("appointmentsVisibility") as 'all' | 'desktop' | 'hidden';
      if (savedApptsVis) setAppointmentsVisibilityState(savedApptsVis);

      const savedTracker = localStorage.getItem("latePatientTrackerEnabled");
      if (savedTracker !== null) setLatePatientTrackerEnabledState(savedTracker === "true");
    } catch (e) {
      console.error("Could not load UI settings", e);
    }
  }, []);

  const setClinicalEditorMode = useCallback((mode: 'modal' | 'drawer') => {
    setClinicalEditorModeState(mode);
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
      });
      confirmResolver.current = resolve;
    });
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

  const handleConfirm = (result: boolean) => {
    setConfirmState({
      isOpen: false,
      message: "",
      title: undefined,
      confirmLabel: undefined,
      cancelLabel: undefined,
    });
    if (confirmResolver.current) {
      confirmResolver.current(result);
      confirmResolver.current = null;
    }
  };

  return (
    <UIContext.Provider value={{ showToast, confirm, clinicalEditorMode, setClinicalEditorMode, appointmentEditorMode, setAppointmentEditorMode, appointmentPanelMode, setAppointmentPanelMode, receptionPanelActive, setReceptionPanelActive, appointmentsVisibility, setAppointmentsVisibility, latePatientTrackerEnabled: latePatientTrackerEnabledState, setLatePatientTrackerEnabled }}>
      {children}

      {/* --- TOAST CONTAINER (Smartphone Style) --- */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl min-w-[300px] max-w-[400px] animate-in slide-in-from-right-10 fade-in duration-300 border-l-4 ${
              toast.type === "success" ? "bg-[#AFDDE5] border-[#0FA4AF] text-[#003135]" :
              toast.type === "error" ? "bg-[#AFDDE5] border-[#964734] text-[#003135]" :
              "bg-[#003135] border-[#003135] text-[#AFDDE5]"
            }`}
          >
            {toast.type === "success" && <CheckCircle2 className="text-[#0FA4AF] shrink-0" size={20} />}
            {toast.type === "error" && <AlertCircle className="text-[#964734] shrink-0" size={20} />}
            {toast.type === "info" && <Info className="text-[#0FA4AF] shrink-0" size={20} />}
            <p className="text-sm font-bold flex-1">{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} className="opacity-50 hover:opacity-100"><X size={16}/></button>
          </div>
        ))}
      </div>

      {/* --- CONFIRM MODAL (Professional Blur) --- */}
      {confirmState.isOpen && (
        <div className="fixed inset-0 z-[9999] bg-[#003135]/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#AFDDE5] rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden scale-100 animate-in zoom-in-95 duration-200 border border-[#003135]/10">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-[#964734]/10 rounded-full flex items-center justify-center mx-auto mb-4 text-[#964734]">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-black text-[#003135] mb-2">
                {confirmState.title ?? "Are you sure?"}
              </h3>
              <p className="text-[#003135]/70 text-sm font-medium whitespace-pre-line">
                {confirmState.message}
              </p>
            </div>
            <div className="flex border-t border-[#003135]/10">
              <button 
                type="button"
                onClick={() => handleConfirm(false)} 
                className="flex-1 py-4 text-sm font-bold text-[#003135]/70 hover:bg-[#003135]/5 transition-colors"
              >
                {confirmState.cancelLabel ?? "Cancel"}
              </button>
              <div className="w-px bg-[#003135]/10"></div>
              <button 
                type="button"
                onClick={() => handleConfirm(true)} 
                className="flex-1 py-4 text-sm font-bold text-[#964734] hover:bg-[#964734]/10 transition-colors"
              >
                {confirmState.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
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