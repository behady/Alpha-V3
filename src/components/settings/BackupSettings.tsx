"use client";

import { useState } from "react";
import { DatabaseBackup, Download, Info, Loader2 } from "lucide-react";
import { useSettingsText } from "@/lib/useSettingsText";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { BackupError, downloadClinicBackup } from "@/lib/backupApi";
import type { SettingsPanelProps } from "@/components/settings/panels";

/**
 * Backup — the whole clinic in one Excel file.
 *
 * One button. The route builds the workbook on the server and the browser downloads it; nothing
 * is stored, scheduled or emailed. The panel's job is to say plainly what is in the file and what
 * is not (it cannot be imported back), so an owner never mistakes it for a restore point.
 *
 * Admin/Owner only, enforced by the registry (`view: ADMIN`) and again by the route.
 */
export default function BackupSettings({}: SettingsPanelProps) {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { clinicId } = useClinic();
  const t = useSettingsText("backup");
  const [busy, setBusy] = useState(false);

  const sheets = [
    t.sheet_1, t.sheet_2, t.sheet_3, t.sheet_4, t.sheet_5, t.sheet_6,
    t.sheet_7, t.sheet_8, t.sheet_9, t.sheet_10, t.sheet_11, t.sheet_12,
  ];

  const handleDownload = async () => {
    if (!clinicId || busy) return;
    setBusy(true);
    try {
      await downloadClinicBackup(clinicId, language === "ar" ? "ar" : "en");
      showToast(t.done, "success");
    } catch (err) {
      showToast(err instanceof BackupError ? err.message : t.failed, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
            <DatabaseBackup size={12} />
            {t.title}
          </p>
          <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
            {t.sub}
          </p>
          <p className="flex max-w-xl items-start gap-2 text-[11px] font-semibold leading-relaxed text-white/45">
            <Info size={12} className="mt-0.5 shrink-0" />
            {t.notRestore}
          </p>
        </div>
      </div>

      <div className="rounded-[1.75rem] border border-line bg-surface px-6 py-6 sm:px-8">
        <p className="mb-4 font-display text-[10px] font-black uppercase tracking-[0.22em] text-ink-muted">
          {t.includesTitle}
        </p>
        <ol className="grid gap-x-8 gap-y-2 text-sm font-semibold text-ink-body sm:grid-cols-2">
          {sheets.map((label, i) => (
            <li key={label} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 font-display text-xs font-black tabular-nums text-ink-muted">
                {i + 1}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col items-start gap-3">
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy || !clinicId}
          data-tour="backup-download"
          className="inline-flex items-center gap-2 rounded-2xl bg-ink-slab px-6 py-3 font-display text-sm font-black text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {t.button}
        </button>
        {busy && (
          <p className="text-xs font-semibold text-ink-muted" role="status">
            {t.preparing}
          </p>
        )}
      </div>
    </div>
  );
}
