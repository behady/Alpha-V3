"use client";

import { Globe, Palette, Check, Loader2, Lock } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { useTheme } from "@/context/ThemeContext";
import { availablePresets, type ThemePreset } from "@/lib/theme/presets";

/**
 * The clinic's appearance.
 *
 * Replaces a grid of twelve saturated colour swatches that wrote to localStorage and changed
 * nothing on screen. Two things are different beyond it now working: the choice belongs to the
 * clinic rather than to the browser, so every member sees it; and it is a short menu of finished
 * looks rather than a colour picker, because a clinic mixing its own palette against a fixed shell
 * produces combinations no one designed.
 */
export default function AppearanceSettings() {
  const { language, toggleLanguage } = useLanguage();
  const { readOnlyReason } = useClinic();
  const { presetId, resolved, saving, canEdit, setPreset } = useTheme();
  const isAr = language === "ar";

  const txt = {
    langSettings: isAr ? "إعدادات اللغة" : "Language Settings",
    switchLang: isAr ? "Switch System to English" : "تغيير النظام إلى العربية",
    themeSettings: isAr ? "مظهر العيادة" : "Clinic Appearance",
    themeHint: isAr
      ? "يظهر هذا المظهر لكل من يعمل في العيادة، على كل جهاز."
      : "This applies to everyone in the clinic, on every device.",
    adminOnly: isAr
      ? "المدير أو المالك فقط يمكنه تغيير المظهر."
      : "Only an owner or admin can change the appearance.",
    expired: isAr
      ? "اشتراك العيادة منتهي — لا يمكن حفظ التغييرات."
      : "This clinic's subscription has expired, so changes cannot be saved.",
    suspended: isAr
      ? "العيادة موقوفة — لا يمكن حفظ التغييرات."
      : "This clinic is suspended, so changes cannot be saved.",
    current: isAr ? "الحالي" : "Current",
  };

  const lockReason =
    readOnlyReason === "expired" ? txt.expired
      : readOnlyReason === "suspended" ? txt.suspended
        : !canEdit ? txt.adminOnly
          : null;

  return (
    <div className="space-y-8 animate-in fade-in max-w-5xl mx-auto">
      {/* LANGUAGE */}
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <h3 className="text-xl font-black text-ink mb-8 flex items-center gap-3">
          <Globe className="text-accent" /> {txt.langSettings}
        </h3>
        <button
          onClick={toggleLanguage}
          className="w-full sm:w-auto bg-surface-subtle border border-line px-10 py-5 rounded-2xl font-bold text-base flex items-center justify-center gap-3 hover:bg-surface hover:border-accent-soft transition-all shadow-sm active:scale-95"
        >
          <Globe size={24} className="text-accent-strong" /> {txt.switchLang}
        </button>
      </div>

      {/* THEME */}
      <div className="bg-surface p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
        <div className="mb-2 flex items-center gap-3">
          <Palette className="text-accent" />
          <h3 className="text-xl font-black text-ink">{txt.themeSettings}</h3>
        </div>
        <p className="text-sm font-medium text-ink-muted mb-6">{txt.themeHint}</p>

        {lockReason && (
          <div className="mb-6 flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <Lock size={16} className="shrink-0" /> {lockReason}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {availablePresets().map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              isAr={isAr}
              selected={resolved && presetId === p.id}
              disabled={!canEdit || saving}
              busy={saving}
              currentLabel={txt.current}
              onPick={() => setPreset(p.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PresetCard({
  preset, isAr, selected, disabled, busy, currentLabel, onPick,
}: {
  preset: ThemePreset;
  isAr: boolean;
  selected: boolean;
  disabled: boolean;
  busy: boolean;
  currentLabel: string;
  onPick: () => void;
}) {
  const [page, surface, accent, ink] = preset.swatch;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      className={`group relative text-start rounded-3xl border-2 p-5 transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-accent shadow-md"
          : "border-slate-100 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      {selected && (
        <span className="absolute top-4 end-4 flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} {currentLabel}
        </span>
      )}

      {/* A miniature of the theme rather than a dot of its accent: a page, a card on it, the
          accent as a control, and a line of ink. What the room looks like, not the paint tin. */}
      <div
        className="mb-4 h-24 w-full overflow-hidden rounded-2xl border border-black/5 p-3"
        style={{ background: page }}
      >
        <div
          className="flex h-full w-full flex-col justify-between rounded-xl p-2.5 shadow-sm"
          style={{ background: surface }}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
            <span className="h-1.5 w-14 rounded-full" style={{ background: ink, opacity: 0.75 }} />
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="rounded-md px-2 py-1 text-[8px] font-black"
              style={{ background: accent, color: surface }}
            >
              {isAr ? "حفظ" : "Save"}
            </span>
            <span className="h-1.5 w-10 rounded-full" style={{ background: ink, opacity: 0.25 }} />
          </div>
        </div>
      </div>

      <p className="text-base font-black text-ink">{isAr ? preset.nameAr : preset.nameEn}</p>
      <p className="mt-1 text-xs font-semibold leading-relaxed text-ink-muted">
        {isAr ? preset.descAr : preset.descEn}
      </p>
    </button>
  );
}
