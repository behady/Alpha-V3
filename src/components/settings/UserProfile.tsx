"use client";
import { staffProfilePath } from "@/lib/storagePaths";

import { useState, useEffect, useRef } from "react";
import { User, Mail, Phone, Camera, Loader2, Shield, Hash, Smile, FileText, Save, RotateCcw } from "lucide-react";
import { storage, auth } from "@/lib/firebase";
import { getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { updateProfile } from "firebase/auth";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { useSettingsText } from "@/lib/useSettingsText";
import { getClinicDoc } from "@/lib/db-utils";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import {
  DEFAULT_COUNTRY_CODE,
  COUNTRY_CODE_OPTIONS,
  buildE164FromCountryCode,
  splitE164ToCountryAndLocal,
} from "@/lib/phoneNumber";

type Profile = {
  name: string;
  nickname: string;
  phone: string;
  email: string;
  role: string;
  bio: string;
  photoURL: string;
};

const EMPTY: Profile = { name: "", nickname: "", phone: "", email: "", role: "", bio: "", photoURL: "" };

const INPUT =
  "w-full rounded-xl border border-line bg-surface-subtle text-sm font-bold text-ink outline-none " +
  "transition-all placeholder:text-ink-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10";

/**
 * A person's own record — the six fields firestore.rules lets them change on themselves.
 *
 * Every label on this screen was written in English only, in a product that ships in Arabic and
 * defaults to it for most of its clinics. "Full Legal Name", "Preferred Nickname", "System Role",
 * "Contact admin to change email" — an Arabic-speaking assistant opened their own profile and read
 * none of it. That is the whole reason this file was rewritten; the colours and the layout came
 * along because they were in the way.
 */
export default function UserProfile() {
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useUI();
  const txt = useSettingsText("profile");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [profileData, setProfileData] = useState<Profile>(EMPTY);
  /** What is stored, so a half-edited name or bio can be told apart from a saved one. */
  const [storedProfile, setStoredProfile] = useState<Profile | null>(null);

  // The photo saves on upload; everything else waits for the Save button, so leaving with a
  // rewritten bio used to discard it without a word.
  const isDirty =
    storedProfile !== null && JSON.stringify(profileData) !== JSON.stringify(storedProfile);
  useDirtyFlag("general", isDirty);

  useEffect(() => {
    const fetchProfile = async () => {
      const uid = auth.currentUser?.uid || user?.uid;
      if (!uid) {
        setLoading(false);
        return;
      }
      try {
        const docSnap = await getDoc(getClinicDoc("staff", uid));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const split = splitE164ToCountryAndLocal(String(data.phone || ""));
          const loaded: Profile = {
            name: data.name || "",
            nickname: data.nickname || "",
            phone: split.localNumber,
            email: data.email || auth.currentUser?.email || "",
            role: data.role || "Staff",
            bio: data.bio || "",
            photoURL: data.photoURL || auth.currentUser?.photoURL || "",
          };
          if (split.countryCode) setCountryCode(split.countryCode);
          setProfileData(loaded);
          setStoredProfile(loaded);
        }
      } catch (error) {
        console.error("Profile load error:", error);
      } finally {
        setLoading(false);
      }
    };
    void fetchProfile();
  }, [user?.uid]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;

    if (!file.type.startsWith("image/")) {
      showToast(txt.imagesOnly, "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast(txt.imageTooBig, "error");
      return;
    }

    setUploadingImage(true);
    try {
      const storageRef = ref(storage, staffProfilePath(auth.currentUser.uid));
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        () => {},
        () => {
          showToast(txt.uploadFailed, "error");
          setUploadingImage(false);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          await setDoc(getClinicDoc("staff", auth.currentUser!.uid), { photoURL: downloadURL }, { merge: true });
          if (auth.currentUser) await updateProfile(auth.currentUser, { photoURL: downloadURL });
          setProfileData((prev) => ({ ...prev, photoURL: downloadURL }));
          setStoredProfile((prev) => (prev ? { ...prev, photoURL: downloadURL } : prev));
          showToast(txt.photoUpdated, "success");
          setUploadingImage(false);
        }
      );
    } catch (error) {
      console.error("Upload error:", error);
      showToast(txt.uploadFailed, "error");
      setUploadingImage(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!auth.currentUser) return;
    const normalizedPhone = buildE164FromCountryCode(countryCode, profileData.phone);
    if (!normalizedPhone) {
      showToast(txt.phoneInvalid, "error");
      return;
    }
    setSaving(true);
    try {
      await setDoc(
        getClinicDoc("staff", auth.currentUser.uid),
        {
          name: profileData.name,
          nickname: profileData.nickname,
          phone: normalizedPhone,
          bio: profileData.bio,
        },
        { merge: true }
      );
      await updateProfile(auth.currentUser, { displayName: profileData.name });
      setStoredProfile(profileData);
      showToast(txt.saved, "success");
    } catch (error) {
      console.error("Save error:", error);
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const staffId = auth.currentUser?.uid
    ? `EMP-${auth.currentUser.uid.substring(0, 6).toUpperCase()}`
    : "—";

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-ink-muted" size={28} />
      </div>
    );
  }

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* The person, as the rest of the clinic sees them. The banner this replaces pulled a
          decorative cube texture from transparenttextures.com on every load — a third-party
          request, on a medical record screen, for a pattern behind an avatar. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/10 text-white/50"
              aria-label={txt.changePhoto}
            >
              {profileData.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profileData.photoURL} alt="" className="h-full w-full object-cover" />
              ) : (
                <User size={32} strokeWidth={1.5} />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-ink/60 text-white opacity-0 transition-opacity group-hover:opacity-100">
                {uploadingImage ? <Loader2 className="animate-spin" size={20} /> : <Camera size={20} />}
              </span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/png, image/jpeg, image/webp"
              onChange={handleImageUpload}
            />

            <div className="min-w-0 space-y-1">
              <p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">{txt.title}</p>
              <p className="truncate text-xl font-bold text-white">{profileData.name || txt.unnamed}</p>
              <p className="truncate text-[13px] text-white/60">
                {[profileData.nickname && `"${profileData.nickname}"`, profileData.role]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-start rounded-xl bg-white/10 px-3 py-2">
            <Hash size={14} className="text-white/45" />
            <div>
              <p className="text-[9px] font-black uppercase leading-none tracking-widest text-white/45">
                {txt.staffId}
              </p>
              <p className="mt-0.5 font-figure text-sm font-bold leading-none text-white/80" dir="ltr">
                {staffId}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section>
        <h3 className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">{txt.groupYou}</h3>
        <div className="grid grid-cols-1 gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-6 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="block text-[10px] font-black uppercase tracking-widest text-ink-muted">{txt.name}</span>
            <span className="relative block">
              <User size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={profileData.name}
                onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                className={`${INPUT} py-3 pe-4 ps-12`}
              />
            </span>
          </label>

          <label className="block space-y-2">
            <span className="block text-[10px] font-black uppercase tracking-widest text-ink-muted">{txt.nickname}</span>
            <span className="relative block">
              <Smile size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                placeholder={txt.nicknamePlaceholder}
                value={profileData.nickname}
                onChange={(e) => setProfileData({ ...profileData, nickname: e.target.value })}
                className={`${INPUT} py-3 pe-4 ps-12`}
              />
            </span>
          </label>

          <label className="block space-y-2 md:col-span-2">
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-ink-muted">
              <FileText size={12} /> {txt.bio}
            </span>
            <textarea
              rows={3}
              placeholder={txt.bioPlaceholder}
              value={profileData.bio}
              onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
              className={`${INPUT} custom-scrollbar resize-none p-4`}
            />
          </label>
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">{txt.groupReach}</h3>
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <label className="block space-y-2">
            <span className="block text-[10px] font-black uppercase tracking-widest text-ink-muted">{txt.phone}</span>
            <span className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className={`${INPUT} w-[45%] px-3 py-3`}
              >
                {COUNTRY_CODE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="relative block w-[55%]">
                <Phone size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  type="tel"
                  dir="ltr"
                  value={profileData.phone}
                  onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                  placeholder="1001234567"
                  className={`${INPUT} py-3 pe-4 ps-12`}
                />
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* The two fields that are not yours to change, said once rather than implied by a grey box. */}
      <section>
        <h3 className="mb-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">{txt.groupClinic}</h3>
        <p className="mb-3 text-xs font-medium leading-relaxed text-ink-muted">{txt.groupClinicHint}</p>
        <div className="grid grid-cols-1 gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-6 md:grid-cols-2">
          <div className="space-y-2">
            <span className="block text-[10px] font-black uppercase tracking-widest text-ink-muted">{txt.email}</span>
            <span className="relative block">
              <Mail size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="email"
                disabled
                value={profileData.email}
                className="w-full cursor-not-allowed rounded-xl border border-line bg-surface-muted py-3 pe-4 ps-12 text-sm font-bold text-ink-body outline-none"
              />
            </span>
          </div>

          <div className="space-y-2">
            <span className="block text-[10px] font-black uppercase tracking-widest text-ink-muted">{txt.role}</span>
            <span className="relative block">
              <Shield size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                disabled
                value={profileData.role}
                className="w-full cursor-not-allowed rounded-xl border border-line bg-surface-muted py-3 pe-4 ps-12 text-sm font-bold text-ink-body outline-none"
              />
            </span>
          </div>
        </div>
      </section>

      {isDirty && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => storedProfile && setProfileData(storedProfile)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
            >
              <RotateCcw size={14} /> {txt.discard}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveProfile()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.save}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
