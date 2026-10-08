"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ScanLine, X } from "lucide-react";
import ApprovalUploadPanel from "@/components/appointments/booking/ApprovalUploadPanel";
import { useLanguage } from "@/context/LanguageContext";
import { cairo } from "@/lib/fonts/arabic";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** The patient the approval was saved onto — found by code or name, or registered from the paper. */
  onPatient: (patient: { id: string; name: string }) => void;
};

/**
 * "Read an approval" from the dashboard: the paper first, the patient from it.
 *
 * Replaced Quick Pay in the dashboard header on the owner's word. The desk holds an insurance
 * approval, not a patient: the upload box matches the paper to a patient by insurance code, then
 * name (asking the desk to confirm by phone number), or registers one. The dashboard then opens
 * the booking popup on that patient so the visit can be booked in the same breath.
 *
 * Full screen on a phone, where the drop zone takes the camera; a window on the desk. Portalled
 * to <body>, so it sets its own direction and Arabic face, like the other popups.
 */
export default function ApprovalReadSheet({ isOpen, onClose, onPatient }: Props) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  // Portals need the document; render nothing on the server pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        dir={isAr ? "rtl" : "ltr"}
        role="dialog"
        aria-labelledby="approval-read-title"
        className={`${cairo.variable} ${isAr ? "arabic-ui" : ""} relative z-10 flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-[2rem]`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 bg-ink-slab px-5 py-3 text-white md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-ink-on-accent">
              <ScanLine size={20} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h2 id="approval-read-title" className="truncate text-lg font-black leading-tight text-[#FACC15]">
                {isAr ? "اقرأ موافقة" : "Read an approval"}
              </h2>
              <p className="truncate text-[13px] font-bold text-white/85">
                {isAr ? "ارفع الورقة أو صوّرها — هنلاقي المريض أو نسجّله" : "Upload or photograph the paper — the patient is found or registered"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isAr ? "إغلاق" : "Close"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/5 text-white transition-colors hover:bg-white/15"
          >
            <X size={18} />
          </button>
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1 md:px-6">
          <ApprovalUploadPanel patientId="" patientName="" language={language} onPatientSaved={onPatient} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
