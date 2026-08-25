"use client";
import { useClinic } from "@/context/ClinicContext";
import { clinicLogoPath } from "@/lib/storagePaths";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Phone,
  MapPin,
  Link2,
  Star,
  Loader2,
  Save,
  ImagePlus,
} from "lucide-react";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";
import { logActivity } from "@/lib/logger";
import {
  CLINIC_PROFILE_DOC,
  EMPTY_CLINIC_PROFILE,
  getClinicProfile,
  sanitizeClinicProfile,
} from "@/lib/clinicProfile";
import { clearClinicLogoCache } from "@/lib/clinicLogo";
import type { ClinicProfile } from "@/types/clinicProfile";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export default function ClinicProfileSettingsPage() {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useUI();
  const { clinicId } = useClinic();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState<ClinicProfile>(() => EMPTY_CLINIC_PROFILE);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const txt = {
    back: language === "ar" ? "الإعدادات" : "Settings",
    title: language === "ar" ? "العيادة" : "Clinic profile",
    subtitle:
      language === "ar"
        ? "الاسم، الشعار، التواصل، رابط الخرائط، ورابط التقييم على جوجل."
        : "Name, logo, contact details, Maps location, and a direct Google review link.",
    name: language === "ar" ? "اسم العيادة" : "Clinic name",
    phone: language === "ar" ? "هاتف العيادة" : "Clinic phone",
    address: language === "ar" ? "العنوان" : "Address",
    maps: language === "ar" ? "رابط خرائط جوجل (الموقع)" : "Google Maps URL (location)",
    mapsHint:
      language === "ar"
        ? "للمريض للوصول للعيادة — ليس بالضرورة رابط كتابة التقييم."
        : "For directions to the clinic — not necessarily the write-a-review URL.",
    review: language === "ar" ? "رابط تقييم جوجل (مباشر)" : "Google review link (direct)",
    reviewHint:
      language === "ar"
        ? "رابط يفتح صفحة ترك تقييم (مثلاً من ملف النشاط التجاري أو g.page). يُستخدم في واتساب {{google_link}}."
        : "URL that opens Google’s review form for your clinic (Business Profile or short link). Used for WhatsApp {{google_link}}.",
    logo: language === "ar" ? "الشعار" : "Logo",
    logoHint:
      language === "ar" ? "PNG أو JPG — يُرفع إلى التخزين السحابي." : "PNG or JPG — stored in Firebase Storage.",
    save: language === "ar" ? "حفظ" : "Save",
    saved: language === "ar" ? "تم الحفظ" : "Saved",
    failed: language === "ar" ? "فشل الحفظ" : "Save failed",
    uploadFail: language === "ar" ? "فشل رفع الصورة" : "Upload failed",
    needAuth: language === "ar" ? "سجّل الدخول" : "Sign in required",
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getClinicProfile(db);
        if (!cancelled && data) setForm(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      showToast(language === "ar" ? "صورة فقط" : "Images only", "error");
      return;
    }
    setLogoFile(f);
  };

  const persistLogoIfNeeded = useCallback(async (): Promise<string> => {
    if (!logoFile) return form.logoUrl ?? "";
    setUploadingLogo(true);
    try {
      const safe = logoFile.name.replace(/\s+/g, "_");
      const path = clinicLogoPath(clinicId, safe);
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, logoFile, { contentType: logoFile.type || "image/jpeg" });
      const url = await getDownloadURL(storageRef);
      return url;
    } catch (e) {
      console.error(e);
      throw new Error(txt.uploadFail);
    } finally {
      setUploadingLogo(false);
    }
  }, [form.logoUrl, logoFile, txt.uploadFail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = auth.currentUser;
    if (!u) {
      showToast(txt.needAuth, "error");
      return;
    }
    setSaving(true);
    try {
      let logoUrl = form.logoUrl;
      try {
        logoUrl = await persistLogoIfNeeded();
      } catch (err) {
        showToast(err instanceof Error ? err.message : txt.uploadFail, "error");
        setSaving(false);
        return;
      }

      const payload: ClinicProfile & { updatedAt: string } = {
        ...form,
        logoUrl,
        updatedAt: new Date().toISOString(),
      };

      await setDoc(getClinicDoc(CLINIC_PROFILE_DOC.collection, CLINIC_PROFILE_DOC.docId), payload, {
        merge: true,
      });

      await setDoc(
        getClinicDoc("settings", "clinic_info"),
        {
          clinicName: form.clinicName,
          name: form.clinicName,
          phone: form.phone,
          address: form.address,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Clinic profile updated",
        "settings/clinicProfile"
      );

      // The logo is cached per clinic for the session so receipts/prescriptions don't refetch it
      // on every print — drop it here so a replaced logo shows up without a page reload.
      clearClinicLogoCache();

      setForm((prev) => sanitizeClinicProfile({ ...prev, logoUrl }));
      setLogoFile(null);
      showToast(txt.saved, "success");
    } catch (err) {
      console.error(err);
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <PermissionGuard permission="access.settings">
      <div
        className="max-w-3xl mx-auto px-4 md:px-8 py-10 animate-in fade-in duration-300"
        dir={isRTL ? "rtl" : "ltr"}
      >
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900 mb-8 transition-colors"
        >
          <ArrowLeft size={14} className={isRTL ? "rotate-180" : ""} />
          {txt.back}
        </Link>

        <header className="mb-10 space-y-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/10">
              <Building2 size={22} strokeWidth={1.5} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{txt.title}</h1>
              <p className="text-sm text-slate-500 mt-1 font-medium leading-relaxed">{txt.subtitle}</p>
            </div>
          </div>
        </header>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-8">
          <div className="rounded-3xl border border-slate-200/80 bg-white p-8 shadow-[0_2px_40px_-12px_rgba(15,23,42,0.08)] space-y-6">
            <label className="block space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                {txt.name}
              </span>
              <input
                required
                value={form.clinicName ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, clinicName: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3.5 text-sm font-medium text-slate-900 outline-none transition-all focus:border-slate-900 focus:bg-white focus:ring-4 focus:ring-slate-900/5"
                placeholder="Alpha Dental"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <Phone size={12} className="opacity-60" /> {txt.phone}
              </span>
              <input
                type="tel"
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3.5 text-sm font-medium text-slate-900 outline-none transition-all focus:border-slate-900 focus:bg-white focus:ring-4 focus:ring-slate-900/5"
                placeholder="+20 …"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <MapPin size={12} className="opacity-60" /> {txt.address}
              </span>
              <textarea
                value={form.address ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                rows={3}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3.5 text-sm font-medium text-slate-900 outline-none transition-all focus:border-slate-900 focus:bg-white focus:ring-4 focus:ring-slate-900/5"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <Link2 size={12} className="opacity-60" /> {txt.maps}
              </span>
              <input
                type="url"
                value={form.googleMapsUrl ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, googleMapsUrl: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3.5 text-sm font-medium text-slate-900 outline-none transition-all focus:border-slate-900 focus:bg-white focus:ring-4 focus:ring-slate-900/5"
                placeholder="https://maps.google.com/…"
              />
              <p className="text-xs text-slate-400 leading-relaxed">{txt.mapsHint}</p>
            </label>

            <label className="block space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <Star size={12} className="opacity-60" /> {txt.review}
              </span>
              <input
                type="url"
                value={form.googleReviewUrl ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, googleReviewUrl: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3.5 text-sm font-medium text-slate-900 outline-none transition-all focus:border-slate-900 focus:bg-white focus:ring-4 focus:ring-slate-900/5"
                placeholder="https://g.page/r/… or Google review URL"
              />
              <p className="text-xs text-slate-400 leading-relaxed">{txt.reviewHint}</p>
            </label>

            <div className="space-y-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <ImagePlus size={12} className="opacity-60" /> {txt.logo}
              </span>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 px-5 py-6">
                {(logoFile || form.logoUrl) && (
                  <div className="h-20 w-20 rounded-2xl border border-slate-100 bg-white overflow-hidden shrink-0 shadow-inner flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoFile ? URL.createObjectURL(logoFile) : form.logoUrl}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="block w-full text-xs font-medium text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
                  />
                  <p className="text-xs text-slate-400 mt-2">{txt.logoHint}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || uploadingLogo}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-8 py-3.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/15 transition hover:bg-black disabled:opacity-50"
            >
              {saving || uploadingLogo ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {txt.save}
            </button>
          </div>
        </form>
      </div>
    </PermissionGuard>
  );
}
