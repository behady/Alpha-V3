"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
import { Trash2, RotateCcw, Loader2, Search, ShieldAlert, ImageIcon, Info } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { countedNoun } from "@/lib/arabicCount";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import {
  listBin,
  purgeRecord,
  restoreRecord,
  RecycleBinError,
  type BinEntry,
} from "@/lib/recycleBinApi";

/**
 * Recently Deleted — the everyday undo.
 *
 * Backups and the 7-day time machine live in the Google Cloud console and belong to whoever runs
 * the platform; a clinic admin has no access to them and should not need any. The common
 * emergency is not a disaster, it is "I deleted the wrong patient", and this is the screen that
 * answers it in thirty seconds instead of a phone call.
 *
 * Read through /api/records/bin rather than Firestore, because the bin is a root collection denied
 * to every client — the entries are complete patient records, and a clinic subcollection would
 * have been readable by the whole clinic. The list carries labels only; no medical data crosses
 * the wire until somebody restores.
 */

const RELATIVE = (iso: string | null, ar: boolean): string => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return ar ? "اليوم" : "Today";
  if (days === 1) return ar ? "أمس" : "Yesterday";
  return ar ? `منذ ${days} يوم` : `${days} days ago`;
};

export default function RecentlyDeleted() {
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const { clinicId, isAdmin } = useClinic();
  const ar = language === "ar";

  const [entries, setEntries] = useState<BinEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");


  const t = useSettingsText("recentlyDeleted");

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const data = await listBin(clinicId);
      setEntries(data.entries);
    } catch (err) {
      showToast(err instanceof RecycleBinError ? err.message : t.loadFailed, "error");
    } finally {
      setLoading(false);
    }
  }, [clinicId, t.loadFailed, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const collections = useMemo(
    () => [...new Set(entries.map((e) => e.collection))].sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (collectionFilter !== "all" && e.collection !== collectionFilter) return false;
      if (!needle) return true;
      return (
        e.label.toLowerCase().includes(needle) ||
        e.collection.toLowerCase().includes(needle) ||
        e.deletedByName.toLowerCase().includes(needle)
      );
    });
  }, [entries, search, collectionFilter]);

  const handleRestore = async (entry: BinEntry) => {
    if (!clinicId) return;
    setBusyId(entry.id);
    try {
      await restoreRecord(clinicId, entry.id);
      showToast(`${t.restored}: ${entry.label}`, "success");
      await load();
    } catch (err) {
      // The refusals carry a reason worth reading — a place already occupied, a patient that no
      // longer exists — so the server's own sentence is shown rather than a generic failure.
      showToast(err instanceof RecycleBinError ? err.message : t.restoreFailed, "error");
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (entry: BinEntry) => {
    if (!clinicId) return;
    if (!(await confirm(t.purgeConfirm, { confirmLabel: t.purge, tone: "danger" }))) return;
    setBusyId(entry.id);
    try {
      await purgeRecord(clinicId, entry.id);
      showToast(`${t.purged}: ${entry.label}`, "success");
      await load();
    } catch (err) {
      showToast(err instanceof RecycleBinError ? err.message : t.purgeFailed, "error");
    } finally {
      setBusyId(null);
    }
  };

  const prettyCollection = (name: string) => {
    const labels: Record<string, [string, string]> = {
      patients: ["المرضى", "Patient"],
      patient_media: ["الصور", "Image"],
      prescriptions: ["الروشتات", "Prescription"],
      treatment_plans: ["خطط العلاج", "Treatment plan"],
      diagnosis_chats: ["مناقشات التشخيص", "Diagnosis chat"],
      services: ["الأسعار", "Service"],
      drugs: ["الأدوية", "Drug"],
      inventory: ["المخزون", "Inventory"],
      leads: ["العملاء المحتملون", "Lead"],
      marketing_content: ["التسويق", "Marketing"],
      attendance: ["الحضور", "Attendance"],
    };
    const pair = labels[name];
    return pair ? (ar ? pair[0] : pair[1]) : name;
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* How much is recoverable, and for how long — which on a bin is the whole question. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
            <Trash2 size={12} />
            {t.title}
          </p>
          <p className="max-w-xl text-[15px] font-bold leading-relaxed text-white sm:text-base">
            {entries.length === 0
              ? t.empty
              : `${countedNoun(entries.length, ar, {
                  one: t.itemOne, two: t.itemTwo, few: t.itemFew, many: t.itemMany,
                })}. ${t.keptUntil}`}
          </p>
          <p className="flex max-w-xl items-start gap-2 text-[11px] font-semibold leading-relaxed text-white/45">
            <Info size={12} className="mt-0.5 shrink-0" />
            {t.filesNote}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.search}
              className="w-full rounded-2xl border border-line bg-surface-subtle py-3 pe-4 ps-11 text-sm font-semibold text-ink outline-none transition-colors focus:border-accent focus:bg-surface"
            />
          </div>
          <select
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            className="rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-sm font-bold text-ink outline-none transition-colors focus:border-accent"
          >
            <option value="all">{t.all}</option>
            {collections.map((c) => (
              <option key={c} value={c}>
                {prettyCollection(c)}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="animate-spin text-ink-muted" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface-subtle py-16 text-center text-sm font-bold text-ink-muted">
            {entries.length === 0 ? t.empty : t.noAccess}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-subtle p-4 transition-colors hover:border-line-strong sm:flex-row sm:items-center"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-ink truncate">{entry.label}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg bg-surface-muted text-ink-muted">
                      {prettyCollection(entry.collection)}
                    </span>
                    {entry.hasFiles && (
                      <span className="flex items-center gap-1 rounded-lg border border-warn/25 bg-warn-tint px-2 py-0.5 text-[10px] font-bold text-warn">
                        <ImageIcon size={10} /> {t.hasFiles}
                      </span>
                    )}
                    {entry.actionSize > 1 && (
                      <span className="rounded-lg border border-line bg-surface px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                        {entry.actionSize}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-ink-muted mt-1">
                    {t.deletedBy} {entry.deletedByName} · {RELATIVE(entry.deletedAt, ar)}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === entry.id}
                    onClick={() => void handleRestore(entry)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-ink-on-accent transition-all hover:bg-accent-strong disabled:opacity-50"
                  >
                    {busyId === entry.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    {t.restore}
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busyId === entry.id}
                      onClick={() => void handlePurge(entry)}
                      title={t.purge}
                      aria-label={t.purge}
                      className="rounded-xl border border-danger/30 px-3 py-2.5 text-xs font-bold text-danger transition-all hover:bg-danger-tint disabled:opacity-50"
                    >
                      <ShieldAlert size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
