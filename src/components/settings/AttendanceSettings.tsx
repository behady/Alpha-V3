"use client";

import { useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
import { Save, MapPin, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";

export default function AttendanceSettings({ clinicData, setClinicData, handleSaveClinic }: any) {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const [loading, setLoading] = useState(false);


  const txt = useSettingsText("attendance");
  const locationOn = clinicData.attendanceRequireLocation !== false && clinicData.attendanceRequireLocation !== "false";

  const handleGetLocation = () => {
    if (!navigator.geolocation) { showToast("Geolocation is not supported", "error"); return; }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setClinicData((prev: any) => ({ ...prev, attendanceLat: pos.coords.latitude.toString(), attendanceLng: pos.coords.longitude.toString() }));
        setLoading(false); showToast("Exact Location captured!", "success");
      },
      (error) => { setLoading(false); showToast("Failed to get location.", "error"); },
      { enableHighAccuracy: true } 
    );
  };

  return (
    <form onSubmit={handleSaveClinic} className="w-full space-y-8 animate-in fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 border-b border-line pb-6">
          <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-ok-tint text-ok rounded-2xl flex items-center justify-center"><MapPin size={28}/></div>
              <div>
                  <h3 className="text-xl font-bold text-ink">{txt.attendanceTitle}</h3>
                  <p className="text-sm font-medium text-ink-muted mt-1">{txt.attendanceSub}</p>
              </div>
          </div>
          <button type="button" onClick={handleGetLocation} disabled={loading} className="bg-ok-tint text-ok px-6 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-ok-tint/70 transition-all shadow-sm shrink-0">
              {loading ? <Loader2 size={20} className="animate-spin"/> : <MapPin size={20}/>} {txt.autoGPS}
          </button>
      </div>

      {/* The two clock-in checks. Each is on unless the clinic switches it off. */}
      <div className="rounded-2xl border border-line bg-surface-subtle p-6 space-y-5">
          <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.checksTitle}</p>
          {([
            ["attendanceRequireLocation", txt.requireLocation, txt.requireLocationHint],
            ["attendanceRequireDevice", txt.requireDevice, txt.requireDeviceHint],
          ] as const).map(([field, label, hint]) => {
            const on = clinicData[field] !== false && clinicData[field] !== "false";
            return (
              <div key={field} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold text-ink">{label}</p>
                  <p className="text-sm font-medium text-ink-muted mt-1 leading-relaxed">{hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label}
                  onClick={() => setClinicData((prev: any) => ({ ...prev, [field]: !on }))}
                  className={`relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full transition-colors focus:outline-none ${on ? "bg-accent" : "bg-surface-muted"}`}
                >
                  <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "start-[23px]" : "start-[3px]"}`} />
                </button>
              </div>
            );
          })}
          {!locationOn && clinicData.attendanceRequireDevice === false && (
            <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">{txt.bothOffWarning}</p>
          )}
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 rounded-2xl border border-line bg-surface-subtle p-6 transition-opacity ${locationOn ? "" : "opacity-50"}`}>
          <div className="space-y-2">
            <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.lat}</label>
            <input dir="ltr" value={clinicData.attendanceLat} onChange={e => setClinicData({...clinicData, attendanceLat: e.target.value})} placeholder="e.g. 30.0444" className="w-full px-5 py-4 bg-surface border border-line rounded-2xl focus:ring-2 focus:ring-accent transition-all outline-none font-bold text-ink"/>
          </div>
          <div className="space-y-2">
            <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.lng}</label>
            <input dir="ltr" value={clinicData.attendanceLng} onChange={e => setClinicData({...clinicData, attendanceLng: e.target.value})} placeholder="e.g. 31.2357" className="w-full px-5 py-4 bg-surface border border-line rounded-2xl focus:ring-2 focus:ring-accent transition-all outline-none font-bold text-ink"/>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.radius}</label>
            <input type="number" value={clinicData.attendanceRadius} onChange={e => setClinicData({...clinicData, attendanceRadius: e.target.value})} placeholder="e.g. 50" className="w-full px-5 py-4 bg-surface border border-line rounded-2xl focus:ring-2 focus:ring-accent transition-all outline-none font-bold text-ink"/>
          </div>
      </div>

      {/* Auto clock-out. One number; empty means off, so a clinic that never opens this is untouched. */}
      <div className="rounded-2xl border border-line bg-surface-subtle p-6 space-y-2">
          <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.autoCloseHours}</label>
          <input type="number" min="0" max="12" step="0.5" inputMode="decimal" value={clinicData.attendanceAutoCloseHours ?? ""} onChange={e => setClinicData({...clinicData, attendanceAutoCloseHours: e.target.value})} placeholder={txt.autoCloseOff} className="w-full md:w-1/2 px-5 py-4 bg-surface border border-line rounded-2xl focus:ring-2 focus:ring-accent transition-all outline-none font-bold text-ink"/>
          <p className={`text-sm font-medium text-ink-muted leading-relaxed ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.autoCloseHint}</p>
      </div>

      <div className={`flex ${isRTL ? 'justify-start' : 'justify-end'} pt-4`}>
          <button type="submit" className="bg-accent text-ink-on-accent px-10 py-4 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-accent-strong transition-all shadow-lg active:scale-95"><Save size={20}/> {txt.saveGeofence}</button>
      </div>
    </form>
  );
}