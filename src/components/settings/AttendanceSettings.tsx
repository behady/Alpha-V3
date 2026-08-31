"use client";

import { useState } from "react";
import { Save, MapPin, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";

export default function AttendanceSettings({ clinicData, setClinicData, handleSaveClinic }: any) {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const [loading, setLoading] = useState(false);

  const txt = {
    attendanceTitle: language === 'ar' ? "نطاق الحضور الجغرافي" : "Attendance Geofencing",
    attendanceSub: language === 'ar' ? "تقييد تسجيل الدخول عبر الهاتف بهذا الموقع الفعلي." : "Restrict mobile clock-ins to this exact physical location.",
    autoGPS: language === 'ar' ? "التقاط GPS تلقائياً" : "Auto-Capture GPS",
    lat: language === 'ar' ? "خط العرض (Latitude)" : "Latitude",
    lng: language === 'ar' ? "خط الطول (Longitude)" : "Longitude",
    radius: language === 'ar' ? "النطاق المسموح (بالمتر)" : "Allowed Radius (Meters)",
    saveGeofence: language === 'ar' ? "حفظ النطاق الجغرافي" : "Save Geofence",
  };

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
    <form onSubmit={handleSaveClinic} className="space-y-8 animate-in fade-in max-w-5xl mx-auto bg-surface p-8 rounded-3xl shadow-sm border border-slate-200/50">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 border-b border-slate-100 pb-6">
          <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center"><MapPin size={28}/></div>
              <div>
                  <h3 className="text-xl font-bold text-ink">{txt.attendanceTitle}</h3>
                  <p className="text-sm font-medium text-ink-muted mt-1">{txt.attendanceSub}</p>
              </div>
          </div>
          <button type="button" onClick={handleGetLocation} disabled={loading} className="bg-emerald-100 text-emerald-700 px-6 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-200 transition-all shadow-sm shrink-0">
              {loading ? <Loader2 size={20} className="animate-spin"/> : <MapPin size={20}/>} {txt.autoGPS}
          </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-surface-subtle p-6 rounded-3xl border border-slate-100">
          <div className="space-y-2">
            <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.lat}</label>
            <input value={clinicData.attendanceLat} onChange={e => setClinicData({...clinicData, attendanceLat: e.target.value})} placeholder="e.g. 30.0444" className="w-full px-5 py-4 bg-surface border border-slate-200/60 rounded-2xl focus:ring-2 focus:ring-primary-500 transition-all outline-none font-bold text-ink"/>
          </div>
          <div className="space-y-2">
            <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.lng}</label>
            <input value={clinicData.attendanceLng} onChange={e => setClinicData({...clinicData, attendanceLng: e.target.value})} placeholder="e.g. 31.2357" className="w-full px-5 py-4 bg-surface border border-slate-200/60 rounded-2xl focus:ring-2 focus:ring-primary-500 transition-all outline-none font-bold text-ink"/>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.radius}</label>
            <input type="number" value={clinicData.attendanceRadius} onChange={e => setClinicData({...clinicData, attendanceRadius: e.target.value})} placeholder="e.g. 50" className="w-full px-5 py-4 bg-surface border border-slate-200/60 rounded-2xl focus:ring-2 focus:ring-primary-500 transition-all outline-none font-bold text-ink"/>
          </div>
      </div>
      
      <div className={`flex ${isRTL ? 'justify-start' : 'justify-end'} pt-4`}>
          <button type="submit" className="bg-slate-900 text-white px-10 py-4 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg active:scale-95"><Save size={20}/> {txt.saveGeofence}</button>
      </div>
    </form>
  );
}