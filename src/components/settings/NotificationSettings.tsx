"use client";

import { Save, Bell, Mail, AppWindow } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

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

  const txt = {
    title: language === "ar" ? "إعدادات التنبيهات" : "Alerts & Notifications",
    subtitle:
      language === "ar"
        ? "إدارة التوجيه الدقيق لتنبيهات النظام والمراسلات."
        : "Manage precise routing for system alerts and messaging.",
    save: language === "ar" ? "حفظ إعدادات التنبيهات" : "Save Alert Preferences",

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

  const prefs = clinicData.alertPreferences || {
    email: { dailyRevenue: false, weeklyReport: false, lowInventory: false },
    inApp: { patientArrival: false, labReady: false, newBooking: false },
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
      className="space-y-8 animate-in fade-in max-w-3xl mx-auto bg-white p-8 rounded-3xl shadow-sm border border-slate-200/50"
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

      <div className="space-y-8">
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
    </form>
  );
}
