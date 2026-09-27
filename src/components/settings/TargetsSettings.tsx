"use client";

import { useEffect, useState } from "react";
import { onSnapshot, setDoc } from "firebase/firestore";
import { Loader2, RotateCcw, Save, Target } from "lucide-react";
import { getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useSettingsText } from "@/lib/useSettingsText";
import { useSettingsDraft } from "@/lib/settingsDraft";
import { TARGETS_DOC, parseTargets, type ClinicTargets } from "@/lib/clinicTargets";

const NONE: ClinicTargets = { monthlyRevenue: 0, monthlyNewPatients: 0 };

/**
 * Two numbers, nothing else. The owner's home turns each into a progress bar with the expected
 * pace for the day of the month drawn on it, so "62% of the month's target on the 20th" reads as
 * behind without any arithmetic. A target left at 0 hides its bar rather than showing 0%.
 */
export default function TargetsSettings({ canEdit }: { canEdit: boolean }) {
  const { isRTL } = useLanguage();
  const { showToast } = useUI();
  const txt = useSettingsText("targets");
  const [stored, setStored] = useState<ClinicTargets | null>(null);
  const [saving, setSaving] = useState(false);
  const { value, setValue, isDirty, discard, markSaved } = useSettingsDraft<ClinicTargets>("targets", stored, NONE);

  useEffect(() => {
    const unsub = onSnapshot(getClinicDoc("settings", TARGETS_DOC), (snap) => {
      setStored(parseTargets(snap.exists() ? (snap.data() as Record<string, unknown>) : null));
    });
    return () => unsub();
  }, []);

  const save = async (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.();
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", TARGETS_DOC), { ...parseTargets(value), updatedAt: Date.now() }, { merge: true });
      markSaved();
      showToast(txt.saved, "success");
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full px-5 py-4 bg-surface border border-line rounded-2xl focus:ring-2 focus:ring-accent transition-all outline-none font-figure font-bold text-ink disabled:opacity-60";
  const label = `text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? "pr-1" : "pl-1"}`;
  const show = (n: number) => (n > 0 ? String(n) : "");

  return (
    <form onSubmit={save} className="w-full space-y-8 animate-in fade-in">
      <div className="flex items-center gap-4 border-b border-line pb-6">
        <div className="w-14 h-14 bg-ink-slab text-white rounded-2xl flex items-center justify-center"><Target size={26} /></div>
        <div>
          <h3 className="text-xl font-bold text-ink">{txt.title}</h3>
          <p className="text-sm font-medium text-ink-muted mt-1">{txt.intro}</p>
        </div>
      </div>

      {stored === null ? (
        <div className="h-32 rounded-2xl bg-surface-muted animate-pulse" aria-hidden="true" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 rounded-2xl border border-line bg-surface-subtle p-6">
          <div className="space-y-2">
            <label className={label} htmlFor="targets-revenue">{txt.revenue}</label>
            <input
              id="targets-revenue"
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              dir="ltr"
              value={show(value.monthlyRevenue)}
              onChange={(e) => setValue((cur) => ({ ...cur, monthlyRevenue: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
              disabled={!canEdit}
              placeholder="0"
              className={field}
            />
          </div>
          <div className="space-y-2">
            <label className={label} htmlFor="targets-patients">{txt.newPatients}</label>
            <input
              id="targets-patients"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              dir="ltr"
              value={show(value.monthlyNewPatients)}
              onChange={(e) => setValue((cur) => ({ ...cur, monthlyNewPatients: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
              disabled={!canEdit}
              placeholder="0"
              className={field}
            />
          </div>
        </div>
      )}

      {canEdit ? (
        <div className={`flex items-center gap-3 ${isRTL ? "justify-start" : "justify-end"} pt-2`}>
          {isDirty && (
            <button type="button" onClick={discard} className="inline-flex items-center gap-2 px-5 py-4 rounded-2xl border border-line bg-surface text-sm font-bold text-ink-muted hover:text-ink transition-colors">
              <RotateCcw size={16} /> {txt.discard}
            </button>
          )}
          <button type="submit" disabled={saving || stored === null || !isDirty} className="bg-accent text-ink-on-accent px-10 py-4 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-accent-strong transition-all shadow-lg active:scale-95 disabled:opacity-60">
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} {txt.save}
          </button>
        </div>
      ) : (
        <p className="text-sm font-semibold text-ink-muted">{txt.readOnly}</p>
      )}
    </form>
  );
}
