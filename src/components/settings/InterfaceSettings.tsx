"use client";

import {
  Monitor, SquareTerminal, PanelRight, Calendar, AlertTriangle, PencilLine, Sparkles,
  ListOrdered, ArrowDownWideNarrow, ArrowUpNarrowWide, MoveVertical, Rows3, CalendarDays, AlignJustify, LayoutList,
  UserCircle,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";

export default function InterfaceSettings() {
  const { language } = useLanguage();
  const {
    clinicalEditorMode, setClinicalEditorMode,
    appointmentEditorMode, setAppointmentEditorMode,
    appointmentPanelMode, setAppointmentPanelMode,
    appointmentsVisibility, setAppointmentsVisibility,
    latePatientTrackerEnabled, setLatePatientTrackerEnabled,
    clinicalNoteSort, setClinicalNoteSort,
    clinicalNoteGrouping, setClinicalNoteGrouping,
    clinicalNoteDensity, setClinicalNoteDensity,
  } = useUI();

  const isAr = language === 'ar';

  /** One option tile. Same shape as the cards above, at a size that fits three or four across. */
  const OptionTile = ({
    active, onClick, icon: Icon, label, hint,
  }: {
    active: boolean;
    onClick: () => void;
    icon: typeof Monitor;
    label: string;
    hint: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`p-5 rounded-3xl border-2 flex flex-col items-center justify-start gap-3 text-center transition-all ${
        active
          ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
          : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
      }`}
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm shrink-0 ${active ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
        <Icon size={24} />
      </div>
      <span className={`text-sm font-black ${active ? 'text-primary-700' : 'text-slate-600'}`}>{label}</span>
      <span className="text-xs font-bold text-slate-400 leading-relaxed">{hint}</span>
    </button>
  );

  const txt = {
    title: language === 'ar' ? "واجهة الاستخدام" : "Interface Settings",
    followsYou: language === 'ar'
      ? "هذه الاختيارات محفوظة على حسابك، فتنتقل معك لأي جهاز تسجّل الدخول منه — الكمبيوتر، التابلت، أو الموبايل."
      : "These choices are saved to your account, so they follow you to any device you sign in on — desktop, tablet or phone.",
    clinicalEditorLabel: language === 'ar' ? "محرر الإجراءات السريرية" : "Clinical Editor Mode",
    // The third option is the layout desktop has been using all along. It was not on this screen,
    // and the Clinical tab ignored this setting entirely above 1024px — so choosing a mode on a
    // laptop did nothing at all and looked like a bug in the feature rather than in the setting.
    clinicalEditorDesc: language === 'ar'
      ? "اختر شكل محرر الإجراءات. اختيارك بينطبق على كل الأجهزة. «داخل الصفحة» بيحتاج شاشة عريضة، وعلى الموبايل بيرجع تلقائياً لنافذة منبثقة."
      : "Choose how the procedure editor opens. Your choice applies on every device. \"On the page\" needs a wide screen — on a phone it falls back to the pop-up.",
    inline: language === 'ar' ? "داخل الصفحة" : "On the page",
    inlineHint: language === 'ar'
      ? "المخطط فوق والنموذج تحته، من غير نافذة. يحتاج شاشة عريضة."
      : "Chart on top, form beneath it, no overlay. Needs a wide screen.",
    modalHint: language === 'ar'
      ? "نافذة فوق الصفحة، وبداخلها مخطط الأسنان."
      : "A window over the page, with the teeth chart inside it.",
    drawerHint: language === 'ar'
      ? "لوح بينزلق من الجانب."
      : "A panel that slides in from the side.",
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
      {/* Worth stating plainly, because it was not true until these moved off the browser: every
          choice below used to live in localStorage and nowhere else, so setting the app up on the
          desk computer got you the defaults on a tablet with nothing explaining why. */}
      <p className="flex items-start gap-3 rounded-2xl border border-line bg-surface-subtle px-5 py-4 text-sm font-semibold text-ink-body">
        <UserCircle size={16} className="mt-0.5 shrink-0 text-slate-400" />
        {txt.followsYou}
      </p>

      {/* CLINICAL EDITOR SETTINGS */}
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-ink flex items-center gap-3">
            <Monitor className="text-primary-500" /> {txt.clinicalEditorLabel}
          </h3>
          <p className="text-sm font-medium text-ink-muted mt-2">{txt.clinicalEditorDesc}</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
            <span className="text-xs font-bold text-slate-400 leading-relaxed text-center">{txt.modalHint}</span>
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
            <span className="text-xs font-bold text-slate-400 leading-relaxed text-center">{txt.drawerHint}</span>
          </button>

          <button
            onClick={() => setClinicalEditorMode('inline')}
            className={`p-8 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${
              clinicalEditorMode === 'inline'
                ? 'border-primary-500 bg-primary-50 shadow-md scale-[1.02]'
                : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${clinicalEditorMode === 'inline' ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <LayoutList size={32} />
            </div>
            <span className={`text-lg font-black ${clinicalEditorMode === 'inline' ? 'text-primary-700' : 'text-slate-600'}`}>
              {txt.inline}
            </span>
            <span className="text-xs font-bold text-slate-400 leading-relaxed text-center">{txt.inlineHint}</span>
          </button>
        </div>
      </div>

      {/* CLINICAL NOTE — HOW SERVICES ARE ARRANGED */}
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-ink flex items-center gap-3">
            <ListOrdered className="text-primary-500" /> {isAr ? 'ترتيب الإجراءات في الملف السريري' : 'Services in the Clinical Note'}
          </h3>
          <p className="text-sm font-medium text-ink-muted mt-2">
            {isAr
              ? 'اختر كيف تُعرض الإجراءات داخل ملف المريض: ترتيبها، وتجميعها حسب الزيارة، وحجم عرضها.'
              : 'Choose how procedures are laid out inside a patient file: their order, whether they cluster by visit, and how much detail each one shows.'}
          </p>
        </div>

        <div className="space-y-8">
          {/* Order */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">
              {isAr ? 'الترتيب' : 'Order'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <OptionTile
                active={clinicalNoteSort === 'newest'}
                onClick={() => setClinicalNoteSort('newest')}
                icon={ArrowDownWideNarrow}
                label={isAr ? 'الأحدث أولاً' : 'Newest first'}
                hint={isAr ? 'آخر إجراء في الأعلى. الوضع الافتراضي.' : 'The most recent procedure sits on top. The default.'}
              />
              <OptionTile
                active={clinicalNoteSort === 'oldest'}
                onClick={() => setClinicalNoteSort('oldest')}
                icon={ArrowUpNarrowWide}
                label={isAr ? 'الأقدم أولاً' : 'Oldest first'}
                hint={isAr ? 'يُقرأ كقصة علاج من البداية.' : 'Reads as a treatment story from the beginning.'}
              />
              <OptionTile
                active={clinicalNoteSort === 'manual'}
                onClick={() => setClinicalNoteSort('manual')}
                icon={MoveVertical}
                label={isAr ? 'ترتيب يدوي' : 'Manual order'}
                hint={isAr ? 'رتّبها بنفسك بالسحب أو بالأسهم. الترتيب يراه كل الفريق.' : 'Arrange them yourself by dragging or with arrows. The whole team sees that order.'}
              />
            </div>
            {clinicalNoteSort === 'manual' && (
              <p className="mt-3 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 leading-relaxed">
                {isAr
                  ? 'ملاحظة: الترتيب اليدوي محفوظ على ملف المريض نفسه، لذلك يظهر لكل من يفتحه — وليس لك وحدك. الإجراءات الجديدة تُضاف في نهاية القائمة حتى ترتّبها.'
                  : 'Note: manual order is saved onto the patient file, so everyone who opens it sees the same arrangement — not just you. New procedures land at the end of the list until you place them.'}
              </p>
            )}
          </div>

          {/* Grouping */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">
              {isAr ? 'التجميع' : 'Grouping'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <OptionTile
                active={clinicalNoteGrouping === 'flat'}
                onClick={() => setClinicalNoteGrouping('flat')}
                icon={Rows3}
                label={isAr ? 'قائمة زمنية واحدة' : 'One flat timeline'}
                hint={isAr ? 'كل الإجراءات في خط زمني واحد متصل.' : 'Every procedure on a single continuous timeline.'}
              />
              <OptionTile
                active={clinicalNoteGrouping === 'visit'}
                onClick={() => setClinicalNoteGrouping('visit')}
                icon={CalendarDays}
                label={isAr ? 'مجمّعة حسب الزيارة' : 'Grouped by visit'}
                hint={isAr ? 'كل زيارة في صندوق بتاريخها وطبيبها.' : 'Each visit in its own box, with its date and doctor.'}
              />
            </div>
          </div>

          {/* Density */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">
              {isAr ? 'حجم العرض' : 'Detail shown'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <OptionTile
                active={clinicalNoteDensity === 'detailed'}
                onClick={() => setClinicalNoteDensity('detailed')}
                icon={LayoutList}
                label={isAr ? 'تفصيلي' : 'Detailed'}
                hint={isAr ? 'بطاقة كاملة: الحالة، السن، الطبيب، الملاحظات، التكلفة.' : 'The full card: status, tooth, doctor, notes and cost.'}
              />
              <OptionTile
                active={clinicalNoteDensity === 'compact'}
                onClick={() => setClinicalNoteDensity('compact')}
                icon={AlignJustify}
                label={isAr ? 'مختصر' : 'Compact'}
                hint={isAr ? 'سطر واحد لكل إجراء — مفيد للملفات الطويلة.' : 'One line per procedure — useful on long files.'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* APPOINTMENT EDITOR SETTINGS */}
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-ink flex items-center gap-3">
            <Calendar className="text-primary-500" /> {txt.appointmentEditorLabel}
          </h3>
          <p className="text-sm font-medium text-ink-muted mt-2">{txt.appointmentEditorDesc}</p>
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
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-ink flex items-center gap-3">
            <PanelRight className="text-primary-500" /> {txt.panelModeLabel}
          </h3>
          <p className="text-sm font-medium text-ink-muted mt-2">{txt.panelModeDesc}</p>
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
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-8">
          <h3 className="text-xl font-black text-ink flex items-center gap-3">
            <Calendar className="text-primary-500" /> {language === 'ar' ? 'ظهور صفحة المواعيد' : 'Appointments Page Visibility'}
          </h3>
          <p className="text-sm font-medium text-ink-muted mt-2">
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
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-black text-ink flex items-center gap-3">
              <AlertTriangle className="text-primary-500" /> {language === 'ar' ? 'تنبيه المرضى المتأخرين' : 'Late Patient Alert'}
            </h3>
            <p className="text-sm font-medium text-ink-muted mt-2">
              {language === 'ar' ? 'إظهار بطاقة وامضة عندما يتأخر المريض عن موعده بـ 15 دقيقة، مع خيارات للتعامل مع التأخير.' : 'Show a flashing card when a patient is 15 minutes late, giving options to handle the delay.'}
            </p>
          </div>
          <button
            onClick={() => setLatePatientTrackerEnabled(!latePatientTrackerEnabled)}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${latePatientTrackerEnabled ? 'bg-primary-500' : 'bg-slate-200'}`}
          >
            <span className={`inline-block h-6 w-6 transform rounded-full bg-surface transition-transform ${latePatientTrackerEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
