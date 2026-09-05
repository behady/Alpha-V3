"use client";

import { Armchair, Loader2, RotateCcw, Save } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSettingsText } from "@/lib/useSettingsText";

/**
 * What a dentist's home screen is allowed to show.
 *
 * One switch today: whether each dentist sees their own share of what their patients paid. It is
 * on by default — a person's share is their own pay — but some clinics keep commission private
 * until it is settled, and for them this is the switch. The figure the dentist sees is the same
 * `doctorCommissionAmount` the attendance worksheet and payroll already use; this only decides
 * whether it is on their home screen.
 */
export default function DentistHomeSettings({
  clinicData,
  setClinicData,
  handleSaveClinic,
  isDirty,
  discard,
  saving,
}: {
  clinicData: Record<string, unknown>;
  setClinicData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  handleSaveClinic: (e?: { preventDefault?: () => void }) => void | Promise<void>;
  isDirty?: boolean;
  discard?: () => void;
  saving?: boolean;
}) {
  const { isRTL } = useLanguage();
  const txt = useSettingsText("dentists");

  type Home = { showShare?: boolean };
  const home = (clinicData.dentistHome as Home) || {};
  const showShare = home.showShare !== false;

  const setShowShare = (next: boolean) =>
    setClinicData((prev) => ({
      ...prev,
      dentistHome: { ...((prev.dentistHome as Home) || {}), showShare: next },
    }));

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
            <Armchair size={12} />
            {txt.title}
          </p>
          <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
            {txt.railNote}
          </p>
        </div>
      </div>

      <section>
        <h3 className="mb-3 px-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          {txt.homeTitle}
        </h3>
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-ink">{txt.showShare}</p>
              <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-ink-muted">{txt.showShareHint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showShare}
              aria-label={txt.showShare}
              onClick={() => setShowShare(!showShare)}
              className={`relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                showShare ? "bg-accent" : "bg-surface-muted"
              }`}
            >
              <span
                className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${
                  showShare ? "start-[23px]" : "start-[3px]"
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {isDirty && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            {discard && (
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
              >
                <RotateCcw size={14} /> {txt.discard}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => void handleSaveClinic(e)}
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
