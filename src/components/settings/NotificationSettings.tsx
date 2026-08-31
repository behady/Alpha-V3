"use client";

import { Save, Bell, AppWindow } from "lucide-react";
import { useSettingsText } from "@/lib/useSettingsText";
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
        className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  </div>
);

export default function NotificationSettings({ clinicData, setClinicData, handleSaveClinic }: any) {
  const { language } = useLanguage();


  const txt = useSettingsText("alerts");

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
      className="space-y-8 animate-in fade-in max-w-3xl"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-100 pb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <Bell size={28} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-ink tracking-tight">{txt.title}</h3>
            <p className="text-sm font-semibold text-ink-muted mt-1">{txt.subtitle}</p>
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
        <div className="bg-surface-subtle rounded-[2rem] border border-slate-200/60 p-6 md:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-emerald-100 p-2 rounded-xl text-emerald-600">
              <AppWindow size={20} />
            </div>
            <div>
              <h4 className="font-black text-ink text-lg">{txt.inAppTitle}</h4>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{txt.inAppSub}</p>
            </div>
          </div>

          <div className="bg-surface rounded-2xl p-4 border border-line shadow-sm">
            <ToggleSwitch
              label={txt.eventPatientArrival}
              // On unless deliberately switched off: the arrival push works out of the
              // box, and this is the switch that turns it off (read by onPatientCheckedIn).
              checked={prefs.inApp?.patientArrival !== false}
              onChange={() =>
                setClinicData((prev: any) => {
                  const current = prev.alertPreferences?.inApp?.patientArrival !== false;
                  return {
                    ...prev,
                    alertPreferences: {
                      ...(prev.alertPreferences || {}),
                      inApp: { ...(prev.alertPreferences?.inApp || {}), patientArrival: !current },
                    },
                  };
                })
              }
            />
            <ToggleSwitch label={txt.eventLabReady} checked={prefs.inApp?.labReady} onChange={() => handleToggle("inApp", "labReady")} />
          </div>
        </div>

        {/*
          The "Email Reports" section that used to sit here — an admin email address plus toggles
          for a daily revenue summary and low-stock warnings — has been removed.

          Nothing in this project can send an email. There is no mail library in package.json and
          no sending code anywhere in src/. The section collected an address, saved it, and then
          silently did nothing, so a clinic would configure it and wait indefinitely for reports
          that were never coming. A setting that lies costs trust twice: once for not delivering,
          and again for having claimed it would.

          Restoring this means adding a real sender (Resend or SES), a scheduled job to build the
          summary, and a way for the clinic to see that the last send actually succeeded. Until
          all three exist, the honest interface is no interface. The saved preference keys under
          alertPreferences.email are left untouched so nothing breaks for clinics that already
          set them.
        */}
      </div>
    </form>
  );
}
