"use client";
import { bookingHeroPath } from "@/lib/storagePaths";

import React, { useState, useEffect } from "react";
import { Save, Globe, Copy, Check, Camera, Loader2 } from "lucide-react";
import { getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { getClinicDoc, getGlobalClinicId } from "@/lib/db-utils";
import { useSettingsDraft } from "@/lib/settingsDraft";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";

type BookingSettings = {
  enabled: boolean;
  enableDoctorSelection: boolean;
  defaultDurationMinutes: string;
  heroImage: string;
};

/** Module-level so the fallback keeps its identity between renders. */
const EMPTY_BOOKING_SETTINGS: BookingSettings = {
  enabled: false,
  enableDoctorSelection: false,
  defaultDurationMinutes: "30",
  heroImage: "",
};

export default function OnlineBookingSettings() {
  const { language } = useLanguage();
  const { showToast } = useUI();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  const [stored, setStored] = useState<BookingSettings | null>(null);

  // Edits sit on top of what is stored, so leaving mid-change asks first. See lib/settingsDraft.ts.
  const { value: settings, setValue: setSettings, markSaved } = useSettingsDraft<BookingSettings>(
    "online_booking",
    stored,
    EMPTY_BOOKING_SETTINGS
  );

  const clinicId = getGlobalClinicId();
  const bookingUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/book/${clinicId}` 
    : `https://.../book/${clinicId}`;

  useEffect(() => {
    getDoc(getClinicDoc("settings", "onlineBooking")).then(snap => {
      if (snap.exists()) {
        setStored({
          enabled: snap.data().enabled ?? false,
          enableDoctorSelection: snap.data().enableDoctorSelection ?? false,
          defaultDurationMinutes: snap.data().defaultDurationMinutes ?? "30",
          heroImage: snap.data().heroImage ?? ""
        });
      }
      setLoading(false);
    });
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast(language === 'ar' ? "يرجى تحميل ملف صورة." : "Please upload an image file.", "error");
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast(language === 'ar' ? "يجب أن تكون الصورة أقل من 5 ميغابايت." : "Image must be less than 5MB.", "error");
        return;
    }

    setUploadingImage(true);
    try {
      const storageRef = ref(storage, bookingHeroPath(clinicId));
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {}, 
        (error) => {
          console.error("Upload error:", error);
          showToast(language === 'ar' ? "فشل تحميل الصورة" : "Failed to upload image", "error");
          setUploadingImage(false);
        }, 
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          setSettings(s => ({ ...s, heroImage: downloadURL }));
          setUploadingImage(false);
        }
      );
    } catch (error) {
      console.error(error);
      showToast(language === 'ar' ? "فشل تحميل الصورة" : "Failed to upload image", "error");
      setUploadingImage(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", "onlineBooking"), settings, { merge: true });
      setStored(settings);
      markSaved();
      showToast(language === 'ar' ? "تم حفظ إعدادات الحجز الإلكتروني" : "Online Booking settings saved", "success");
    } catch (error) {
      console.error(error);
      showToast(language === 'ar' ? "فشل الحفظ" : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast(language === 'ar' ? "تم نسخ الرابط" : "Link copied to clipboard", "success");
  };

  /**
   * Tagged variants of the booking link, one per channel. Whoever books through a tagged link is
   * attributed to that channel automatically — the entire "which ad works" report rests on the
   * clinic pasting the right link in the right place, so each channel gets its own copy button.
   */
  const [copiedTag, setCopiedTag] = useState("");
  const taggedLinks = [
    { tag: "meta", label: language === 'ar' ? 'إعلانات فيسبوك/إنستجرام' : 'Facebook / Instagram ads' },
    { tag: "instagram", label: language === 'ar' ? 'البايو في إنستجرام' : 'Instagram bio' },
    { tag: "google", label: language === 'ar' ? 'جوجل / الخرائط' : 'Google / Maps profile' },
    { tag: "tiktok", label: language === 'ar' ? 'تيك توك' : 'TikTok' },
    { tag: "whatsapp", label: language === 'ar' ? 'رسائل واتساب' : 'WhatsApp messages' },
  ];
  const handleCopyTagged = (tag: string) => {
    navigator.clipboard.writeText(`${bookingUrl}?src=${tag}`);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(""), 2000);
    showToast(language === 'ar' ? "تم نسخ الرابط" : "Link copied to clipboard", "success");
  };

  if (loading) return <div className="p-8 text-center text-ink-muted animate-pulse">Loading...</div>;

  return (
    <div className="max-w-2xl bg-surface rounded-3xl border border-line overflow-hidden shadow-sm">
      <div className="bg-surface-subtle px-6 py-5 border-b border-line">
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
          <Globe className="text-indigo-500" size={24} />
          {language === 'ar' ? 'إعدادات الحجز الإلكتروني' : 'Online Booking Settings'}
        </h2>
        <p className="text-ink-muted text-sm mt-1">
          {language === 'ar' 
            ? 'قم بإدارة صفحة الحجز العامة الخاصة بك والسماح للمرضى بحجز المواعيد عبر الإنترنت.' 
            : 'Manage your public booking page and allow patients to book appointments online.'}
        </p>
      </div>

      <form onSubmit={handleSave} className="p-6 space-y-6">
        
        {/* Toggle Online Booking */}
        <div className="flex items-center justify-between p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
          <div>
            <div className="font-bold text-indigo-900 text-lg">
              {language === 'ar' ? 'تفعيل الحجز الإلكتروني' : 'Enable Online Booking'}
            </div>
            <div className="text-indigo-700 text-sm">
              {language === 'ar' ? 'السماح للمرضى الجدد والحاليين بالحجز.' : 'Allow new and existing patients to book.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
            className={`w-14 h-8 rounded-full relative transition-colors ${settings.enabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
          >
            <div className={`w-6 h-6 bg-surface rounded-full absolute top-1 shadow-md transition-transform ${settings.enabled ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>

        {settings.enabled && (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
            {/* Public Link */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                {language === 'ar' ? 'رابط الحجز الخاص بك (انسخه إلى إنستجرام/فيسبوك)' : 'Your Booking Link (Copy to Instagram/Facebook)'}
              </label>
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  readOnly 
                  value={bookingUrl} 
                  className="flex-1 bg-surface-subtle border border-line rounded-xl px-4 py-3 text-ink-body font-medium"
                />
                <button 
                  type="button"
                  onClick={handleCopyLink}
                  className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-3 rounded-xl font-bold flex items-center gap-2 transition-colors"
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                  {language === 'ar' ? 'نسخ' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Tagged links per channel — feeds the Leads source report automatically */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                {language === 'ar' ? 'روابط بعلامة المصدر (لتقرير المصادر)' : 'Tagged links (for the source report)'}
              </label>
              <p className="text-xs text-ink-muted">
                {language === 'ar'
                  ? 'كل قناة ليها رابط خاص. اللي يحجز من الرابط ده بيتسجل مصدره تلقائياً — من غير ما حد يكتب حاجة.'
                  : 'Each channel gets its own link. Anyone who books through it is attributed to that channel automatically — nobody types anything.'}
              </p>
              <div className="border border-line rounded-2xl divide-y divide-slate-100 overflow-hidden">
                {taggedLinks.map(({ tag, label }) => (
                  <div key={tag} className="flex items-center justify-between gap-2 px-4 py-2.5 bg-surface">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-700">{label}</div>
                      <div className="text-[11px] text-slate-400 font-medium truncate" dir="ltr">…/book/{clinicId.slice(0, 6)}…?src={tag}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyTagged(tag)}
                      className="shrink-0 bg-surface-muted hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      {copiedTag === tag ? <Check size={14} /> : <Copy size={14} />}
                      {language === 'ar' ? 'نسخ' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Hero Image Upload */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                {language === 'ar' ? 'صورة الغلاف (Hero Image)' : 'Hero Image (Cover)'}
              </label>
              <div className="flex flex-col gap-4">
                {settings.heroImage && (
                  <img src={settings.heroImage} alt="Hero" className="w-full max-w-sm rounded-xl border border-line shadow-sm" />
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  className="w-full max-w-sm bg-white border-2 border-dashed border-slate-300 hover:border-indigo-500 text-slate-600 rounded-xl px-4 py-6 font-bold flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {uploadingImage 
                    ? (language === 'ar' ? 'جاري التحميل...' : 'Uploading...') 
                    : (language === 'ar' ? 'تغيير صورة الغلاف' : 'Upload Hero Image')}
                </button>
              </div>
            </div>

            {/* Doctor Selection */}
            <div className="flex items-center justify-between p-4 border border-line rounded-2xl">
              <div>
                <div className="font-bold text-slate-800">
                  {language === 'ar' ? 'اختيار الطبيب' : 'Doctor Selection'}
                </div>
                <div className="text-ink-muted text-sm">
                  {language === 'ar' 
                    ? 'السماح للمرضى باختيار طبيب معين.' 
                    : 'Allow patients to pick a specific doctor.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSettings(s => ({ ...s, enableDoctorSelection: !s.enableDoctorSelection }))}
                className={`w-12 h-6 rounded-full relative transition-colors ${settings.enableDoctorSelection ? 'bg-emerald-500' : 'bg-slate-200'}`}
              >
                <div className={`w-5 h-5 bg-surface rounded-full absolute top-0.5 shadow transition-transform ${settings.enableDoctorSelection ? 'translate-x-6.5 rtl:-translate-x-6.5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} style={{ transform: settings.enableDoctorSelection ? 'translateX(24px)' : 'translateX(2px)' }} />
              </button>
            </div>

            {/* Default Duration */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                {language === 'ar' ? 'المدة الافتراضية للموعد الإلكتروني' : 'Default Online Appointment Duration'}
              </label>
              <select
                value={settings.defaultDurationMinutes}
                onChange={e => setSettings(s => ({ ...s, defaultDurationMinutes: e.target.value }))}
                className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-slate-700 font-bold focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all outline-none"
              >
                <option value="15">15 {language === 'ar' ? 'دقيقة' : 'Mins'}</option>
                <option value="30">30 {language === 'ar' ? 'دقيقة' : 'Mins'}</option>
                <option value="45">45 {language === 'ar' ? 'دقيقة' : 'Mins'}</option>
                <option value="60">1 {language === 'ar' ? 'ساعة' : 'Hour'}</option>
              </select>
            </div>
          </div>
        )}

        <div className="pt-4 flex justify-end">
          <button 
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-sm disabled:opacity-50"
          >
            {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={20} />}
            {language === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
