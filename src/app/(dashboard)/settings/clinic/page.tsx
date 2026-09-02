"use client";

/**
 * The clinic's own details — the one settings document the rest of the product reads from.
 *
 * The form used to be a single card of seven identical fields with the Save button below the last
 * one, so the only way to know what any of it was for was to change something and go looking. The
 * fields are grouped by what reads them now, and the rail at the top is the letterhead itself:
 * logo, name and the line under it, drawn as they will print, updating as you type. Nothing on
 * this page is guessed at any more.
 *
 * Saving stays deliberate — this is a document thirty-odd readers depend on, not a preference —
 * but the button no longer lives at the bottom of the scroll. It arrives in a bar the moment
 * anything is unsaved, and says what it will do.
 */

import { clinicLogoPath } from "@/lib/storagePaths";
import { useSettingsText } from "@/lib/useSettingsText";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Coins,
  FileText,
  Phone,
  MapPin,
  Link2,
  Star,
  Loader2,
  Save,
  ImagePlus,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, storage } from "@/lib/firebase";
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
  clinicProfileWritePayload,
  getClinicProfile,
  sanitizeClinicProfile,
} from "@/lib/clinicProfile";
import { clearClinicLogoCache } from "@/lib/clinicLogo";
import type { ClinicProfile } from "@/types/clinicProfile";
import { getClinicDoc } from "@/lib/db-utils";

const FIELD_CLASS =
  "w-full rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-sm font-medium text-ink " +
  "outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** One labelled field. The seven on this page were seven copies of the same forty classes. */
function Field({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
        {Icon && <Icon size={12} className="opacity-70" />}
        {label}
      </span>
      {children}
      {hint && <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">{title}</h3>
      <div className="space-y-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">{children}</div>
    </section>
  );
}

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

  const dirty = !loading && (logoFile !== null || JSON.stringify(form) !== JSON.stringify(saved));
  // Unsaved logo counts too: the file is picked here and only uploaded on save.
  useDirtyFlag("clinic_profile", dirty);

  const txt = useSettingsText("clinicProfile");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getClinicProfile();
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

  /**
   * The picked file's preview URL, made once and released when it changes.
   *
   * This was `URL.createObjectURL(logoFile)` inside the markup, which mints a new blob URL on
   * every render and revokes none of them — the browser holds the image alive for each one.
   */
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const shownLogo = logoPreview || form.logoUrl || "";

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
  }, [form.logoUrl, logoFile, clinicId, txt.uploadFail]);

  const discard = () => {
    setForm(saved);
    setLogoFile(null);
  };

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

      // One document, one write. This used to save the profile document and then hand-copy three
      // fields into clinic_info, which is how the two drifted apart in the first place.
      await setDoc(
        getClinicDoc(CLINIC_PROFILE_DOC.collection, CLINIC_PROFILE_DOC.docId),
        clinicProfileWritePayload({ ...form, logoUrl }),
        { merge: true }
      );

      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Clinic profile updated",
        "settings/clinic_info"
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
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ink-muted" />
      </div>
    );
  }

  if (!view.allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
        <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-surface-muted text-ink-muted">
          <Building2 size={34} strokeWidth={1.5} />
        </span>
        <h2 className="mb-2 text-2xl font-black tracking-tight text-ink">
          {language === "ar" ? "هذا القسم مقفل" : "This section is locked"}
        </h2>
        <p className="max-w-md text-sm font-semibold text-ink-muted">{denialMessage(view, language)}</p>
      </div>
    );
  }

  const busy = saving || uploadingLogo;
  const readOnly = !edit.allowed;

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mx-auto w-full max-w-3xl space-y-8 pb-4 animate-in fade-in duration-300"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* The letterhead, as it will print — the fields below it stop being abstract. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 p-2">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownLogo} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <Building2 size={26} className="text-ink-muted" strokeWidth={1.5} />
              )}
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                {txt.title}
              </p>
              <p className="truncate font-display text-xl font-bold text-white">
                {form.clinicName?.trim() || txt.unnamed}
              </p>
              {form.rxHeader?.trim() && (
                <p className="truncate text-[13px] text-white/60">{form.rxHeader}</p>
              )}
              {(form.phone?.trim() || form.currency?.trim()) && (
                <p className="truncate font-figure text-[12px] tracking-tight text-white/45" dir="ltr">
                  {[form.phone?.trim(), form.currency?.trim()].filter(Boolean).join("  ·  ")}
                </p>
              )}
            </div>
          </div>

          <p className="max-w-[15rem] shrink-0 text-[11px] font-semibold leading-relaxed text-white/45">
            {txt.railNote}
          </p>
        </div>
      </div>

      {readOnly && (
        <p className="rounded-2xl border border-line bg-surface-subtle px-5 py-4 text-sm font-semibold text-ink-body">
          {denialMessage(edit, language)}
        </p>
      )}

      <Group title={txt.groupIdentity}>
        <Field label={txt.name}>
          <input
            required
            disabled={readOnly}
            value={form.clinicName ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, clinicName: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="Alpha Dental"
          />
        </Field>

        <Field icon={ImagePlus} label={txt.logo} hint={txt.logoHint}>
          <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-line bg-surface-subtle px-5 py-5 sm:flex-row sm:items-center">
            {shownLogo && (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shownLogo} alt="" className="max-h-full max-w-full object-contain" />
              </span>
            )}
            <input
              type="file"
              accept="image/*"
              disabled={readOnly}
              onChange={handleLogoChange}
              className="block w-full min-w-0 text-xs font-medium text-ink-body file:me-3 file:rounded-xl file:border-0 file:bg-accent file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ink-on-accent hover:file:bg-accent-strong disabled:opacity-60"
            />
          </div>
        </Field>
      </Group>

      <Group title={txt.groupContact}>
        <Field icon={Phone} label={txt.phone}>
          <input
            type="tel"
            disabled={readOnly}
            value={form.phone ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="+20 …"
          />
        </Field>

        <Field icon={MapPin} label={txt.address}>
          <textarea
            rows={3}
            disabled={readOnly}
            value={form.address ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className={`${FIELD_CLASS} resize-none`}
          />
        </Field>

        <Field icon={Link2} label={txt.maps} hint={txt.mapsHint}>
          <input
            type="url"
            disabled={readOnly}
            value={form.googleMapsUrl ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, googleMapsUrl: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="https://maps.google.com/…"
          />
        </Field>

        <Field icon={Star} label={txt.review} hint={txt.reviewHint}>
          <input
            type="url"
            disabled={readOnly}
            value={form.googleReviewUrl ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, googleReviewUrl: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="https://g.page/r/…"
          />
        </Field>
      </Group>

      {/* Printed on every prescription, shown on every price. Read from this document since the
          beginning, and until Phase 2 editable nowhere in the app. */}
      <Group title={txt.groupPrint}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field icon={Coins} label={txt.currency} hint={txt.currencyHint}>
            <input
              maxLength={8}
              disabled={readOnly}
              value={form.currency ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className={FIELD_CLASS}
              placeholder="EGP"
            />
          </Field>

          <Field icon={FileText} label={txt.rxHeader} hint={txt.rxHeaderHint}>
            <textarea
              rows={2}
              disabled={readOnly}
              value={form.rxHeader ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, rxHeader: e.target.value }))}
              className={`${FIELD_CLASS} resize-none`}
              placeholder={txt.rxHeaderPlaceholder}
            />
          </Field>
        </div>
      </Group>

      {/* The save button used to sit under the last field, so on this form it was always a scroll
          away from whatever you had just changed. It comes to you instead. */}
      {dirty && !readOnly && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
            >
              <RotateCcw size={14} /> {txt.discard}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.save}
            </button>
          </span>
        </div>
      )}
    </form>
  );
}
