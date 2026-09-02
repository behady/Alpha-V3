"use client";
import { bookingHeroPath } from "@/lib/storagePaths";

import React, { useState, useEffect } from "react";
import { Save, Globe, Copy, Check, Loader2, RotateCcw, ImagePlus } from "lucide-react";
import { getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { getClinicDoc, getGlobalClinicId } from "@/lib/db-utils";
import { useSettingsDraft } from "@/lib/settingsDraft";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useSettingsText } from "@/lib/useSettingsText";

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

/**
 * A switch that moves the right way in both languages.
 *
 * The two toggles on this screen were different sizes, different colours, and one of them carried
 * an inline `style={{ transform: 'translateX(24px)' }}` that overrode its own classes — so in
 * Arabic, where the track's "on" end is the left one, the knob slid the wrong way. Positioned on
 * the logical inline-start edge instead, which flips with the writing direction by itself.
 */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-white/20"
      }`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-md transition-all ${
          checked ? "start-7" : "start-1"
        }`}
      />
    </button>
  );
}

/** The same switch on a light surface, where the off state needs a visible track. */
function SwitchLight({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-surface-muted"
      }`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full bg-surface shadow-md transition-all ${
          checked ? "start-7" : "start-1"
        }`}
      />
    </button>
  );
}

export default function OnlineBookingSettings() {
  const { isRTL } = useLanguage();
  const { showToast } = useUI();
  const txt = useSettingsText("onlineBooking");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [stored, setStored] = useState<BookingSettings | null>(null);

  // Edits sit on top of what is stored, so leaving mid-change asks first. See lib/settingsDraft.ts.
  const {
    value: settings,
    setValue: setSettings,
    isDirty,
    discard,
    markSaved,
  } = useSettingsDraft<BookingSettings>("online_booking", stored, EMPTY_BOOKING_SETTINGS);

  const clinicId = getGlobalClinicId();
  const bookingUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/book/${clinicId}`
      : `https://.../book/${clinicId}`;

  useEffect(() => {
    getDoc(getClinicDoc("settings", "onlineBooking")).then((snap) => {
      if (snap.exists()) {
        setStored({
          enabled: snap.data().enabled ?? false,
          enableDoctorSelection: snap.data().enableDoctorSelection ?? false,
          defaultDurationMinutes: snap.data().defaultDurationMinutes ?? "30",
          heroImage: snap.data().heroImage ?? "",
        });
      }
      setLoading(false);
    });
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
      const storageRef = ref(storage, bookingHeroPath(clinicId));
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        () => {},
        (error) => {
          console.error("Upload error:", error);
          showToast(txt.uploadFailed, "error");
          setUploadingImage(false);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          setSettings((s) => ({ ...s, heroImage: downloadURL }));
          setUploadingImage(false);
        }
      );
    } catch (error) {
      console.error(error);
      showToast(txt.uploadFailed, "error");
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
      showToast(txt.saved, "success");
    } catch (error) {
      console.error(error);
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Copy, and say so only if it worked.
   *
   * `navigator.clipboard` rejects on an insecure origin and inside several in-app browsers. Both
   * copy buttons here used to set "copied" and raise a success toast unconditionally, so the one
   * case where the clinic needed to know — the link is not on your clipboard, paste something else
   * and you will post the wrong address — was the case that claimed success.
   */
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? "" : current)), 2000);
      showToast(txt.copied, "success");
    } catch {
      showToast(txt.copyFailed, "error");
    }
  };

  /**
   * Tagged variants of the booking link, one per channel. Whoever books through a tagged link is
   * attributed to that channel automatically — the entire "which ad works" report rests on the
   * clinic pasting the right link in the right place, so each channel gets its own copy button.
   */
  const taggedLinks = [
    { tag: "meta", label: txt.chMeta },
    { tag: "instagram", label: txt.chInstagram },
    { tag: "google", label: txt.chGoogle },
    { tag: "tiktok", label: txt.chTiktok },
    { tag: "whatsapp", label: txt.chWhatsapp },
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-ink-muted" size={22} />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSave}
      className="mx-auto w-full max-w-3xl space-y-8 pb-4"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* The link is what this screen is for, so it is the first thing on it — and the switch that
          decides whether the link works sits beside it rather than three sections above. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <Globe size={12} />
              {txt.title}
            </p>
            <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
              {settings.enabled ? txt.onNote : txt.offNote}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <code className="min-w-0 break-all font-figure text-[13px] tracking-tight text-white/75" dir="ltr">
                {bookingUrl}
              </code>
              <button
                type="button"
                onClick={() => void copy(bookingUrl, "main")}
                title={txt.copy}
                aria-label={txt.copy}
                className="rounded-lg bg-white/10 p-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                {copied === "main" ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                settings.enabled ? "bg-white/12 text-white" : "bg-amber-400/20 text-amber-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${settings.enabled ? "bg-emerald-400" : "bg-amber-400"}`} />
              {settings.enabled ? txt.on : txt.off}
            </span>
            <Switch
              checked={settings.enabled}
              onChange={(next) => setSettings((s) => ({ ...s, enabled: next }))}
              label={txt.enableLabel}
            />
          </div>
        </div>
      </div>

      {settings.enabled && (
        <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Tagged links per channel — feeds the Leads source report automatically */}
          <section>
            <h3 className="mb-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
              {txt.taggedTitle}
            </h3>
            <p className="mb-3 text-xs font-medium leading-relaxed text-ink-muted">{txt.taggedHint}</p>
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {taggedLinks.map(({ tag, label }) => (
                <div key={tag} className="flex items-center justify-between gap-2 bg-surface px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink-body">{label}</div>
                    <div className="truncate font-figure text-[11px] text-ink-muted" dir="ltr">
                      …/book/{clinicId.slice(0, 6)}…?src={tag}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copy(`${bookingUrl}?src=${tag}`, tag)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs font-bold text-ink-body transition-colors hover:bg-surface-muted"
                  >
                    {copied === tag ? <Check size={14} /> : <Copy size={14} />}
                    {txt.copy}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Hero image */}
          <section>
            <h3 className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
              {txt.heroTitle}
            </h3>
            <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
              {settings.heroImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.heroImage}
                  alt=""
                  className="w-full max-w-sm rounded-xl border border-line shadow-sm"
                />
              )}
              <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex w-full max-w-sm flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-6 font-bold text-ink-body transition-colors hover:border-accent-soft hover:text-ink disabled:opacity-50"
              >
                {uploadingImage ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <ImagePlus size={18} />
                )}
                {uploadingImage ? txt.uploading : settings.heroImage ? txt.changeHero : txt.uploadHero}
              </button>
            </div>
          </section>

          {/* What the patient gets to choose */}
          <section>
            <h3 className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
              {txt.choicesTitle}
            </h3>
            <div className="space-y-5 rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <p className="text-sm font-black text-ink">{txt.doctorLabel}</p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-ink-muted">{txt.doctorHint}</p>
                </div>
                <SwitchLight
                  checked={settings.enableDoctorSelection}
                  onChange={(next) => setSettings((s) => ({ ...s, enableDoctorSelection: next }))}
                  label={txt.doctorLabel}
                />
              </div>

              <div className="border-t border-line pt-5">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-ink-muted">
                  {txt.durationLabel}
                </label>
                <select
                  value={settings.defaultDurationMinutes}
                  onChange={(e) => setSettings((s) => ({ ...s, defaultDurationMinutes: e.target.value }))}
                  className="w-full rounded-xl border border-line bg-surface-subtle px-4 py-3 font-bold text-ink outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
                >
                  <option value="15">15 {txt.minutes}</option>
                  <option value="30">30 {txt.minutes}</option>
                  <option value="45">45 {txt.minutes}</option>
                  <option value="60">{txt.oneHour}</option>
                </select>
                <p className="mt-2 text-[11px] font-medium leading-relaxed text-ink-muted">{txt.durationHint}</p>
              </div>
            </div>
          </section>
        </div>
      )}

      {isDirty && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
            >
              <RotateCcw size={14} /> {txt.discard}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.save}
            </button>
          </span>
        </div>
      )}
    </form>
  );
}
