"use client";

import { useState } from "react";
import { Save, Bell, MessageSquare, Mail, AppWindow, ChevronDown } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

const TELEGRAM_EVENT_KEYS = [
  "newBooking",
  "reschedule",
  "cancellation",
  "appointmentDeleted",
  "finance",
  "lowInventory",
  "hr",
  "lab",
] as const;

type TelegramEventKey = (typeof TELEGRAM_EVENT_KEYS)[number];

const ToggleSwitch = ({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) => (
  <div
    className={`flex items-center justify-between py-3 border-b border-slate-100 last:border-0 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
  >
    <span className="text-sm font-bold text-slate-700">{label}</span>
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${checked ? "bg-amber-500" : "bg-slate-300"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  </div>
);

export default function NotificationSettings({ clinicData, setClinicData, handleSaveClinic }: any) {
  const { language, isRTL } = useLanguage();
  const [openTemplate, setOpenTemplate] = useState<TelegramEventKey | null>(null);

  const txt = {
    title: language === "ar" ? "إعدادات التنبيهات" : "Alerts & Notifications",
    subtitle:
      language === "ar"
        ? "إدارة التوجيه الدقيق لتنبيهات النظام والمراسلات."
        : "Manage precise routing for system alerts and messaging.",
    save: language === "ar" ? "حفظ إعدادات التنبيهات" : "Save Alert Preferences",

    telegramTitle: language === "ar" ? "تكامل تيليجرام (Telegram)" : "Telegram Integration",
    telegramSub:
      language === "ar" ? "تنبيهات فورية للمجموعة الإدارية والقوالب." : "Instant alerts, routing, and message templates.",
    telegramId: language === "ar" ? "معرف مجموعة تيليجرام (Group ID)" : "Telegram Group ID",
    telegramMaster:
      language === "ar" ? "تفعيل إشعارات تيليجرام (الكل)" : "Enable Telegram notifications",
    telegramMasterHint:
      language === "ar"
        ? "عند الإيقاف لن تُرسل أي رسائل عبر البوت (يبقى التنبيه داخل النظام)."
        : "When off, the bot sends nothing (in-app alerts still work).",
    telegramEvents: language === "ar" ? "ما الذي يُرسل إلى تيليجرام؟" : "Which events go to Telegram?",
    telegramTemplates: language === "ar" ? "قوالب الرسائل (اختياري)" : "Message templates (optional)",
    tplHint:
      language === "ar"
        ? "اترك الحقل فارغًا لاستخدام النص الافتراضي. استخدم {{اسم المتغير}} كما في التلميح أسفل كل حدث."
        : "Leave blank to use the default text. Use placeholders like {{patientName}} as shown under each event.",
    tplTitle: language === "ar" ? "عنوان الرسالة" : "Title",
    tplBody: language === "ar" ? "نص الرسالة (يدعم HTML بسيط)" : "Body (simple HTML ok)",

    evNewBooking: language === "ar" ? "حجز جديد" : "New booking",
    evReschedule: language === "ar" ? "إعادة جدولة / تأخير" : "Reschedule / delayed",
    evCancellation: language === "ar" ? "إلغاء الموعد (حالة ملغاة)" : "Cancellation (status)",
    evDeleted: language === "ar" ? "حذف الموعد من السجل" : "Appointment deleted",
    evFinance: language === "ar" ? "مدفوعات ومصروفات" : "Payments & expenses",
    evLowStock: language === "ar" ? "نقص المخزون" : "Low stock",
    evHr: language === "ar" ? "حضور وانصراف" : "Clock in / out",
    evLab: language === "ar" ? "طلب معمل" : "Lab order",

    emailTitle: language === "ar" ? "تقارير البريد الإلكتروني" : "Email Reports",
    emailSub: language === "ar" ? "ملخصات يومية وأسبوعية للإدارة." : "Daily and weekly summaries for management.",
    adminEmail: language === "ar" ? "البريد الإلكتروني للإدارة" : "Admin/Management Email",

    inAppTitle: language === "ar" ? "تنبيهات النظام الداخلي (In-App)" : "In-App Clinical Alerts",
    inAppSub:
      language === "ar" ? "إشعارات تظهر للأطباء وموظفي الاستقبال." : "Push notifications visible to doctors and front desk.",

    eventDailyRevenue: language === "ar" ? "ملخص الإيرادات اليومية" : "Daily Revenue Summary",
    eventLowInventory: language === "ar" ? "تحذيرات نقص المخزون" : "Low Inventory Warnings",
    eventPatientArrival: language === "ar" ? "وصول المريض للعيادة" : "Patient Arrived (Waiting Area)",
    eventLabReady: language === "ar" ? "استلام حالات المعمل" : "Lab Cases Received"
  };

  const eventLabels: Record<TelegramEventKey, string> = {
    newBooking: txt.evNewBooking,
    reschedule: txt.evReschedule,
    cancellation: txt.evCancellation,
    appointmentDeleted: txt.evDeleted,
    finance: txt.evFinance,
    lowInventory: txt.evLowStock,
    hr: txt.evHr,
    lab: txt.evLab,
  };

  const eventPlaceholders: Record<TelegramEventKey, string> = {
    newBooking: "{{patientName}} {{phone}} {{doctor}} {{treatment}} {{date}} {{time}} {{by}} {{title}} {{body}}",
    reschedule: "{{patientName}} {{phone}} {{doctor}} {{treatment}} {{date}} {{time}} {{by}} {{title}} {{body}}",
    cancellation: "{{patientName}} {{phone}} {{doctor}} {{treatment}} {{date}} {{time}} {{by}} {{title}} {{body}}",
    appointmentDeleted: "{{patientName}} {{phone}} {{doctor}} {{treatment}} {{date}} {{time}} {{by}} {{title}} {{body}}",
    finance: "{{patientName}} {{amount}} {{method}} {{description}} {{by}} {{title}} {{body}}",
    lowInventory: "{{itemName}} {{stock}} {{unit}} {{threshold}} {{title}} {{body}}",
    hr: "{{staffName}} {{time}} {{status}} {{role}} {{title}} {{body}}",
    lab: "{{patientName}} {{doctorName}} {{serviceName}} {{labFee}} {{title}} {{body}}",
  };

  const prefs = clinicData.alertPreferences || {
    telegram: { newBooking: false, cancellations: false, dailyRevenue: false, lowInventory: false },
    email: { dailyRevenue: false, weeklyReport: false, lowInventory: false },
    inApp: { patientArrival: false, labReady: false, newBooking: false },
  };

  const telegramOn = clinicData.telegramNotificationsEnabled !== false;

  const eventEnabled = (key: TelegramEventKey) => clinicData.telegramEventToggles?.[key] !== false;

  const setTelegramMaster = (on: boolean) => {
    setClinicData((prev: any) => ({ ...prev, telegramNotificationsEnabled: on }));
  };

  const setTelegramEvent = (key: TelegramEventKey, on: boolean) => {
    setClinicData((prev: any) => ({
      ...prev,
      telegramEventToggles: {
        ...(prev.telegramEventToggles || {}),
        [key]: on,
      },
    }));
  };

  const setTelegramTemplateField = (key: TelegramEventKey, field: "title" | "body", value: string) => {
    setClinicData((prev: any) => ({
      ...prev,
      telegramTemplates: {
        ...(prev.telegramTemplates || {}),
        [key]: {
          ...(prev.telegramTemplates || {})[key],
          [field]: value,
        },
      },
    }));
  };

  const handleToggle = (channel: string, event: string) => {
    setClinicData((prev: any) => {
      const currentPrefs = prev.alertPreferences || {};
      const currentChannelPrefs = currentPrefs[channel] || {};

      return {
        ...prev,
        alertPreferences: {
          ...currentPrefs,
          [channel]: {
            ...currentChannelPrefs,
            [event]: !currentChannelPrefs[event],
          },
        },
      };
    });
  };


  return (
    <form
      onSubmit={handleSaveClinic}
      className="space-y-8 animate-in fade-in max-w-5xl mx-auto bg-white p-8 rounded-3xl shadow-sm border border-slate-200/50"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-100 pb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <Bell size={28} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">{txt.title}</h3>
            <p className="text-sm font-semibold text-slate-500 mt-1">{txt.subtitle}</p>
          </div>
        </div>
        <button
          type="submit"
          className="bg-slate-900 text-white px-8 py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg active:scale-95 shrink-0"
        >
          <Save size={18} /> {txt.save}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-50 rounded-[2rem] border border-slate-200/60 p-6 md:p-8 flex flex-col h-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-100 p-2 rounded-xl text-blue-600">
              <MessageSquare size={20} />
            </div>
            <div>
              <h4 className="font-black text-slate-900 text-lg">{txt.telegramTitle}</h4>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{txt.telegramSub}</p>
            </div>
          </div>

          <div className="space-y-4 flex-1">
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <ToggleSwitch label={txt.telegramMaster} checked={telegramOn} onChange={() => setTelegramMaster(!telegramOn)} />
              <p className="text-xs text-slate-500 font-medium mt-2 leading-relaxed">{txt.telegramMasterHint}</p>
            </div>

            <div>
              <label
                className={`text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 block ${isRTL ? "pr-1" : "pl-1"}`}
              >
                {txt.telegramId}
              </label>
              <input
                value={clinicData.telegramGroupId || ""}
                onChange={(e) => setClinicData({ ...clinicData, telegramGroupId: e.target.value })}
                placeholder="e.g. -100123456789"
                disabled={!telegramOn}
                className={`w-full px-5 py-3.5 bg-white border border-slate-200 rounded-xl focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 transition-all outline-none font-bold text-slate-900 disabled:opacity-50 ${isRTL ? "text-right" : "text-left"}`}
              />
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{txt.telegramEvents}</p>
              <div className={`bg-white rounded-2xl p-4 border border-slate-200 shadow-sm ${!telegramOn ? "opacity-50 pointer-events-none" : ""}`}>
                {TELEGRAM_EVENT_KEYS.map((key) => (
                  <ToggleSwitch
                    key={key}
                    label={eventLabels[key]}
                    checked={eventEnabled(key)}
                    onChange={() => setTelegramEvent(key, !eventEnabled(key))}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{txt.telegramTemplates}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{txt.tplHint}</p>
              <div className={`space-y-2 ${!telegramOn ? "opacity-50 pointer-events-none" : ""}`}>
                {TELEGRAM_EVENT_KEYS.map((key) => {
                  const open = openTemplate === key;
                  const tpl = clinicData.telegramTemplates?.[key] || {};
                  return (
                    <div key={key} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenTemplate(open ? null : key)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-sm font-bold text-slate-800">{eventLabels[key]}</span>
                        <ChevronDown size={18} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                      {open && (
                        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-slate-100">
                          <p className="text-[10px] text-slate-400 font-mono break-all leading-relaxed pt-3">
                            {eventPlaceholders[key]}
                          </p>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase">{txt.tplTitle}</label>
                            <input
                              value={tpl.title || ""}
                              onChange={(e) => setTelegramTemplateField(key, "title", e.target.value)}
                              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium"
                              placeholder={language === "ar" ? "افتراضي النظام" : "System default"}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase">{txt.tplBody}</label>
                            <textarea
                              value={tpl.body || ""}
                              onChange={(e) => setTelegramTemplateField(key, "body", e.target.value)}
                              rows={4}
                              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium resize-y"
                              placeholder={language === "ar" ? "افتراضي النظام" : "System default"}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8 flex flex-col">
          <div className="bg-slate-50 rounded-[2rem] border border-slate-200/60 p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-emerald-100 p-2 rounded-xl text-emerald-600">
                <AppWindow size={20} />
              </div>
              <div>
                <h4 className="font-black text-slate-900 text-lg">{txt.inAppTitle}</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{txt.inAppSub}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <ToggleSwitch
                label={txt.eventPatientArrival}
                checked={prefs.inApp?.patientArrival}
                onChange={() => handleToggle("inApp", "patientArrival")}
              />
              <ToggleSwitch label={txt.eventLabReady} checked={prefs.inApp?.labReady} onChange={() => handleToggle("inApp", "labReady")} />
            </div>
          </div>

          <div className="bg-slate-50 rounded-[2rem] border border-slate-200/60 p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-purple-100 p-2 rounded-xl text-purple-600">
                <Mail size={20} />
              </div>
              <div>
                <h4 className="font-black text-slate-900 text-lg">{txt.emailTitle}</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{txt.emailSub}</p>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              <div>
                <label
                  className={`text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 block ${isRTL ? "pr-1" : "pl-1"}`}
                >
                  {txt.adminEmail}
                </label>
                <input
                  type="email"
                  value={clinicData.adminNotificationEmail || ""}
                  onChange={(e) => setClinicData({ ...clinicData, adminNotificationEmail: e.target.value })}
                  placeholder="e.g. admin@alphadental.com"
                  className={`w-full px-5 py-3.5 bg-white border border-slate-200 rounded-xl focus:bg-white focus:ring-4 focus:ring-purple-500/10 focus:border-purple-400 transition-all outline-none font-bold text-slate-900 ${isRTL ? "text-right" : "text-left"}`}
                />
              </div>

              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mt-4">
                <ToggleSwitch
                  label={txt.eventDailyRevenue}
                  checked={prefs.email?.dailyRevenue}
                  onChange={() => handleToggle("email", "dailyRevenue")}
                />
                <ToggleSwitch
                  label={txt.eventLowInventory}
                  checked={prefs.email?.lowInventory}
                  onChange={() => handleToggle("email", "lowInventory")}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
