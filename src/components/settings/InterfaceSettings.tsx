"use client";

import { Monitor, SquareTerminal, PanelRight, Calendar, AlertTriangle, PencilLine, Sparkles } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";

export default function InterfaceSettings() {
  const { language } = useLanguage();
  const { 
    clinicalEditorMode, setClinicalEditorMode, 
    appointmentEditorMode, setAppointmentEditorMode,
    appointmentPanelMode, setAppointmentPanelMode,
    appointmentsVisibility, setAppointmentsVisibility,
    latePatientTrackerEnabled, setLatePatientTrackerEnabled
  } = useUI();

  const txt = {
    title: language === 'ar' ? "واجهة الاستخدام" : "Interface Settings",
    clinicalEditorLabel: language === 'ar' ? "محرر الإجراءات السريرية" : "Clinical Editor Mode",
    clinicalEditorDesc: language === 'ar' ? "اختر كيف تريد عرض محرر الإجراءات (نافذة منبثقة أو شريط جانبي)." : "Choose how you want to display the procedure editor (Pop-up Modal or Side Drawer).",
    appointmentEditorLabel: language === 'ar' ? "محرر المواعيد" : "Appointment Booking Mode",
    appointmentEditorDesc: language === 'ar' ? "اختر كيف تريد عرض نموذج حجز وتعديل المواعيد." : "Choose how you want to display the appointment booking and editing form.",
    modal: language === 'ar' ? "نافذة منبثقة" : "Pop-up Modal",
    drawer: language === 'ar' ? "شريط جانبي" : "Side Drawer",
    panelModeLabel: language === 'ar' ? "لوحة الموعد المحدد" : "Selected Appointment Panel",
    panelModeDesc: language === 'ar'
      ? "عند اختيار موعد، اختر ما يظهر بجانب الجدول: نموذج التعديل أم مساعد الاستقبال الذكي. يمكنك التبديل بينهما في أي وقت من زر أعلى اللوحة."
      : "When you click an appointment, choose what appears beside the schedule: the edit form, or the AI reception assistant. You can flip between them at any time from a button at the top of the panel.",
    panelEditor: language === 'ar' ? "محرر التفاصيل" : "Details Editor",
    panelEditorHint: language === 'ar'
      ? "الحقول والسجل المالي وزر الدفع، كما هو."
      : "The fields, ledger and payment button, exactly as now.",
    panelAvatar: language === 'ar' ? "مساعد الاستقبال" : "Reception Assistant",
    panelAvatarHint: language === 'ar'
      ? "اسأله عن المريض، أو اطلب منه الحضور والتغيير والدفع — بتأكيدك دائماً."
      : "Ask about the patient, or have it check in, reschedule, take a payment or message them — always on your confirmation.",
  };

  return (
    <div className="space-y-8 animate-in fade-in max-w-5xl mx-auto">
      {/* CLINICAL EDITOR SETTINGS */}
      <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
            <Monitor className="text-primary-500" /> {txt.clinicalEditorLabel}
          </h3>
          <p className="text-sm font-medium text-slate-500 mt-2">{txt.clinicalEditorDesc}</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <button
            onClick={() => setClinicalEditorMode('modal')}
            className={`p-8 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              clinicalEditorMode === 'modal'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${clinicalEditorMode === 'modal' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <SquareTerminal size={32} />
            </div>
            <span className={`text-lg font-black ${clinicalEditorMode === 'modal' ? 'text-primary-700' : 'text-slate-600'}`}>
              {txt.modal}
            </span>
          </button>

          <button
            onClick={() => setClinicalEditorMode('drawer')}
            className={`p-8 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              clinicalEditorMode === 'drawer'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${clinicalEditorMode === 'drawer' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <PanelRight size={32} />
            </div>
            <span className={`text-lg font-black ${clinicalEditorMode === 'drawer' ? 'text-primary-700' : 'text-slate-600'}`}>
              {txt.drawer}
            </span>
          </button>
        </div>
      </div>

      {/* APPOINTMENT EDITOR SETTINGS */}
      <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
            <Calendar className="text-primary-500" /> {txt.appointmentEditorLabel}
          </h3>
          <p className="text-sm font-medium text-slate-500 mt-2">{txt.appointmentEditorDesc}</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <button
            onClick={() => setAppointmentEditorMode('modal')}
            className={`p-8 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              appointmentEditorMode === 'modal'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${appointmentEditorMode === 'modal' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <SquareTerminal size={32} />
            </div>
            <span className={`text-lg font-black ${appointmentEditorMode === 'modal' ? 'text-primary-700' : 'text-slate-600'}`}>
              {txt.modal}
            </span>
          </button>

          <button
            onClick={() => setAppointmentEditorMode('drawer')}
            className={`p-8 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              appointmentEditorMode === 'drawer'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${appointmentEditorMode === 'drawer' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <PanelRight size={32} />
            </div>
            <span className={`text-lg font-black ${appointmentEditorMode === 'drawer' ? 'text-primary-700' : 'text-slate-600'}`}>
              {txt.drawer}
            </span>
          </button>
        </div>
      </div>

      {/* SELECTED-APPOINTMENT PANEL: EDITOR OR AI RECEPTIONIST */}
      <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
            <PanelRight className="text-primary-500" /> {txt.panelModeLabel}
          </h3>
          <p className="text-sm font-medium text-slate-500 mt-2">{txt.panelModeDesc}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <button
            onClick={() => setAppointmentPanelMode('editor')}
            className={`p-8 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              appointmentPanelMode === 'editor'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${appointmentPanelMode === 'editor' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <PencilLine size={32} />
            </div>
            <span className={`text-lg font-black ${appointmentPanelMode === 'editor' ? 'text-primary-700' : 'text-slate-600'}`}>
              {txt.panelEditor}
            </span>
            <span className="text-xs font-bold text-slate-400 text-center leading-relaxed">{txt.panelEditorHint}</span>
          </button>

          <button
            onClick={() => setAppointmentPanelMode('avatar')}
            className={`p-8 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              appointmentPanelMode === 'avatar'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${appointmentPanelMode === 'avatar' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <Sparkles size={32} />
            </div>
            <span className={`text-lg font-black ${appointmentPanelMode === 'avatar' ? 'text-primary-700' : 'text-slate-600'}`}>
              {txt.panelAvatar}
            </span>
            <span className="text-xs font-bold text-slate-400 text-center leading-relaxed">{txt.panelAvatarHint}</span>
          </button>
        </div>
      </div>

      {/* APPOINTMENT NAVIGATION VISIBILITY SETTINGS */}
      <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
            <Calendar className="text-primary-500" /> {language === 'ar' ? 'ظهور صفحة المواعيد' : 'Appointments Page Visibility'}
          </h3>
          <p className="text-sm font-medium text-slate-500 mt-2">
            {language === 'ar' ? 'اختر أين تريد عرض صفحة المواعيد في القائمة.' : 'Choose where you want the Appointments page to be visible in the navigation.'}
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => setAppointmentsVisibility('all')}
            className={`p-6 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              appointmentsVisibility === 'all'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${appointmentsVisibility === 'all' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <Monitor size={24} />
            </div>
            <span className={`text-sm md:text-base font-black text-center ${appointmentsVisibility === 'all' ? 'text-primary-700' : 'text-slate-600'}`}>
              {language === 'ar' ? 'الجوال والكمبيوتر' : 'Mobile & Desktop'}
            </span>
          </button>

          <button
            onClick={() => setAppointmentsVisibility('desktop')}
            className={`p-6 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              appointmentsVisibility === 'desktop'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${appointmentsVisibility === 'desktop' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <Monitor size={24} className="opacity-50" />
            </div>
            <span className={`text-sm md:text-base font-black text-center ${appointmentsVisibility === 'desktop' ? 'text-primary-700' : 'text-slate-600'}`}>
              {language === 'ar' ? 'الكمبيوتر فقط' : 'Desktop Only'}
            </span>
          </button>

          <button
            onClick={() => setAppointmentsVisibility('hidden')}
            className={`p-6 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              appointmentsVisibility === 'hidden'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${appointmentsVisibility === 'hidden' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <Calendar size={24} className="opacity-30" />
            </div>
            <span className={`text-sm md:text-base font-black text-center ${appointmentsVisibility === 'hidden' ? 'text-primary-700' : 'text-slate-600'}`}>
              {language === 'ar' ? 'إخفاء تام' : 'Hide Everywhere'}
            </span>
          </button>
        </div>
      </div>

      {/* LATE PATIENT TRACKER SETTINGS */}
      <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
              <AlertTriangle className="text-primary-500" /> {language === 'ar' ? 'تنبيه المرضى المتأخرين' : 'Late Patient Alert'}
            </h3>
            <p className="text-sm font-medium text-slate-500 mt-2">
              {language === 'ar' ? 'إظهار بطاقة وامضة عندما يتأخر المريض عن موعده بـ 15 دقيقة، مع خيارات للتعامل مع التأخير.' : 'Show a flashing card when a patient is 15 minutes late, giving options to handle the delay.'}
            </p>
          </div>
          <button
            onClick={() => setLatePatientTrackerEnabled(!latePatientTrackerEnabled)}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${latePatientTrackerEnabled ? 'bg-primary-500' : 'bg-slate-200'}`}
          >
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${latePatientTrackerEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
