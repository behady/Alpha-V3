"use client";

import { Globe, Palette, Check, Loader2, Lock } from "lucide-react";
import { useSettingsText } from "@/lib/useSettingsText";
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


  const txt = useSettingsText("appearance");

  const lockReason =
    readOnlyReason === "expired" ? txt.expired
      : readOnlyReason === "suspended" ? txt.suspended
        : !canEdit ? txt.adminOnly
          : null;

  return (
    <div className="w-full space-y-8 pb-4">
      {/* Interface opens by saying its choices are yours and follow you. This screen is the
          other half of that sentence, and it was the half nobody was told. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <Palette size={12} />
              {txt.title}
            </p>
            <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
              {txt.everyoneSees}
            </p>
            <p className="text-[11px] font-semibold text-white/45">{txt.yoursIsInterface}</p>
          </div>

          {lockReason && (
            <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-amber-400/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
              <Lock size={11} /> {txt.locked}
            </span>
          )}
        </div>
      </div>

      {/* LANGUAGE */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          <Globe size={13} /> {txt.langSettings}
        </h3>
        <button
          onClick={toggleLanguage}
          className="w-full sm:w-auto bg-surface-subtle border border-line px-10 py-5 rounded-2xl font-bold text-base flex items-center justify-center gap-3 hover:bg-surface hover:border-accent-soft transition-all shadow-sm active:scale-95"
        >
          <Globe size={24} className="text-accent-strong" /> {txt.switchLang}
        </button>
      </section>

      {/* THEME */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          <Palette size={13} /> {txt.themeSettings}
        </h3>

        {lockReason && (
          <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-warn/25 bg-warn-tint px-4 py-3 text-sm font-bold text-warn">
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
      </section>
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
          : "border-line hover:border-line-strong hover:shadow-sm"
      }`}
    >
      {selected && (
        <span className="absolute top-4 end-4 flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-ink-on-accent">
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
