import { X, Calendar, ArrowRight } from "lucide-react";
import { Note, RelatedAppointment } from "./types";
import { useLanguage } from "@/context/LanguageContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (targetAppointmentId: string) => void;
  service: Note;
  appointments: RelatedAppointment[];
  actionType: "move" | "continue";
}

export default function TransferServiceModal({
  isOpen,
  onClose,
  onConfirm,
  service,
  appointments,
  actionType,
}: Props) {
  const { language } = useLanguage();

  if (!isOpen) return null;

  const txt = {
    moveTitle: language === "ar" ? "نقل الخدمة" : "Move Service",
    continueTitle: language === "ar" ? "استكمال الخدمة" : "Continue Service",
    moveDesc: language === "ar" ? "اختر الموعد الذي تريد نقل الخدمة إليه:" : "Select the appointment to move this service to:",
    continueDesc: language === "ar" ? "اختر الموعد الذي تريد استكمال هذه الخدمة فيه:" : "Select the appointment to continue this service in:",
    noAppointments: language === "ar" ? "لا توجد مواعيد أخرى لهذا المريض." : "No other appointments found for this patient.",
    cancel: language === "ar" ? "إلغاء" : "Cancel",
    confirm: language === "ar" ? "تأكيد" : "Confirm",
  };

  // Filter out the appointment this service is already linked to
  const availableAppointments = appointments.filter(a => a.id !== service.appointmentId);

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 pb-20">
      <div className="w-full max-w-md bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
          <h3 className="font-black text-slate-900">
            {actionType === "move" ? txt.moveTitle : txt.continueTitle}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-surface text-slate-400 hover:text-rose-500 border border-line transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto custom-scrollbar">
          <p className="text-sm font-bold text-ink-body mb-4">
            {actionType === "move" ? txt.moveDesc : txt.continueDesc}
            <br/>
            <span className="text-primary-600">{service.procedure}</span>
          </p>

          <div className="space-y-2">
            {availableAppointments.length === 0 ? (
              <p className="text-center text-ink-muted text-sm py-4">{txt.noAppointments}</p>
            ) : (
              availableAppointments.map((appt) => {
                let dateStr = appt.date;
                if (!dateStr && appt.createdAt?.toDate) {
                  dateStr = appt.createdAt.toDate().toISOString().split("T")[0];
                }
                return (
                  <button
                    key={appt.id}
                    onClick={() => onConfirm(appt.id)}
                    className="w-full text-left p-4 rounded-xl border border-line hover:border-primary-400 hover:bg-primary-50 transition-colors group flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-ink flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" />
                        {dateStr || "Unknown Date"}
                      </p>
                      <p className="text-xs font-bold text-ink-muted mt-1">
                        {appt.time || ""} • {appt.treatment || "Consultation"}
                      </p>
                    </div>
                    <ArrowRight size={16} className="text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })
            )}
          </div>
        </div>
        
        <div className="p-4 border-t border-slate-100 bg-slate-50/70 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-3 bg-surface text-slate-700 font-bold rounded-xl border border-line hover:bg-surface-subtle"
          >
            {txt.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
