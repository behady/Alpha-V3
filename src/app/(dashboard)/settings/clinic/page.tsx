"use client";
import { clinicLogoPath } from "@/lib/storagePaths";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
import { useClinic } from "@/context/ClinicContext";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import { getSection } from "@/config/settingsRegistry";
import { canEditSection, canViewSection, denialMessage } from "@/lib/settingsAccess";
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
  const { clinicId, isAdmin, isReadOnly } = useClinic();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState<ClinicProfile>(() => EMPTY_CLINIC_PROFILE);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  /** What is currently stored. Anything that differs from it is unsaved work. */
  const [saved, setSaved] = useState<ClinicProfile>(() => EMPTY_CLINIC_PROFILE);

  /**
   * The same access decision the sidebar and every other section use.
   *
   * This page used to guard on `access.settings`, which firestore.rules accepts for nothing it
   * writes — `settings/clinicProfile` and `settings/clinic_info` are both settings documents, and
   * those are Admin-only. So a non-admin granted that permission could open this form, fill it
   * in, upload a logo, and have the save rejected. It reads and saves as an admin decision now,
   * which is what the database has enforced all along.
   */
  const section = getSection("clinic_profile")!;
  const viewer = useMemo(
    () => ({ isAdmin, isReadOnly, role: user?.role, permissions: user?.permissions }),
    [isAdmin, isReadOnly, user?.role, user?.permissions]
  );
  const view = canViewSection(section, viewer);
  const edit = canEditSection(section, viewer);

  // Unsaved logo counts too: the file is picked here and only uploaded on save.
  useDirtyFlag(
    "clinic_profile",
    !loading && (logoFile !== null || JSON.stringify(form) !== JSON.stringify(saved))
  );

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
        if (!cancelled && data) {
          setForm(data);
          setSaved(data);
        }
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

      const stored = sanitizeClinicProfile({ ...form, logoUrl });
      setForm(stored);
      setSaved(stored);
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

  if (!view.allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
        <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-slate-100 text-slate-400">
          <Building2 size={34} strokeWidth={1.5} />
        </span>
        <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-900">
          {language === "ar" ? "هذا القسم مقفل" : "This section is locked"}
        </h2>
        <p className="max-w-md text-sm font-semibold text-slate-500">
          {denialMessage(view, language)}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-3xl animate-in fade-in duration-300" dir={isRTL ? "rtl" : "ltr"}>
        <p className="mb-8 max-w-xl text-sm font-medium leading-relaxed text-slate-500">
          {txt.subtitle}
        </p>

        {!edit.allowed && (
          <p className="mb-8 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-semibold text-slate-600">
            {denialMessage(edit, language)}
          </p>
        )}

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
    </>
  );
}
