"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, RotateCcw, Loader2, Search, ShieldAlert, ImageIcon, Info } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
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

  const t = {
    title: ar ? "المحذوفات مؤخراً" : "Recently Deleted",
    sub: ar
      ? "السجلات المحذوفة تُحفظ هنا حتى تستعيدها أو تحذفها نهائياً."
      : "Deleted records are kept here until you restore them or remove them for good.",
    empty: ar ? "لا يوجد شيء محذوف." : "Nothing has been deleted.",
    noAccess: ar
      ? "ليس لديك صلاحية حذف أي نوع من السجلات، فلا يوجد ما تراه هنا."
      : "You have no delete permissions, so there is nothing here for you to see.",
    search: ar ? "بحث..." : "Search…",
    all: ar ? "كل الأنواع" : "All types",
    restore: ar ? "استعادة" : "Restore",
    purge: ar ? "حذف نهائي" : "Delete permanently",
    deletedBy: ar ? "حذفها" : "Deleted by",
    restored: ar ? "تمت الاستعادة" : "Restored",
    purged: ar ? "تم الحذف نهائياً" : "Permanently deleted",
    filesNote: ar
      ? "حذف السجل ليس محواً: ملفات الصور يُحتفظ بها. للمحو النهائي استخدم الحذف النهائي."
      : "Deleting a record is not erasure — image files are retained. For a true erasure request, use Delete permanently.",
    hasFiles: ar ? "يحتوي على ملفات" : "has files",
    purgeConfirm: ar
      ? "سيُحذف هذا السجل نهائياً ولا يمكن استعادته بعدها. متأكد؟"
      : "This removes the record for good and it cannot be restored afterwards. Are you sure?",
  };

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const data = await listBin(clinicId);
      setEntries(data.entries);
    } catch (err) {
      showToast(err instanceof RecycleBinError ? err.message : ar ? "تعذر التحميل" : "Could not load", "error");
    } finally {
      setLoading(false);
    }
  }, [clinicId, ar, showToast]);

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
      showToast(err instanceof RecycleBinError ? err.message : ar ? "تعذرت الاستعادة" : "Could not restore", "error");
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
      showToast(err instanceof RecycleBinError ? err.message : ar ? "تعذر الحذف" : "Could not delete", "error");
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
    <div className="space-y-6 animate-in fade-in" dir={isRTL ? "rtl" : "ltr"}>
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center">
            <Trash2 size={28} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">{t.title}</h3>
            <p className="text-sm font-semibold text-slate-500 mt-1">{t.sub}</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-slate-50 border border-slate-200/60 p-3">
          <Info size={16} className="text-slate-400 mt-0.5 shrink-0" />
          <p className="text-xs font-semibold text-slate-500 leading-relaxed">{t.filesNote}</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={16} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.search}
              className={`w-full py-3 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-semibold outline-none focus:border-slate-400 ${isRTL ? "pr-11 pl-4" : "pl-11 pr-4"}`}
            />
          </div>
          <select
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            className="py-3 px-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-bold outline-none"
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
            <Loader2 className="animate-spin text-slate-400" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm font-bold text-slate-400">
            {entries.length === 0 ? t.empty : t.noAccess}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-slate-200/60 hover:border-slate-300 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-900 truncate">{entry.label}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500">
                      {prettyCollection(entry.collection)}
                    </span>
                    {entry.hasFiles && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 flex items-center gap-1">
                        <ImageIcon size={10} /> {t.hasFiles}
                      </span>
                    )}
                    {entry.actionSize > 1 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-50 text-slate-400">
                        {entry.actionSize}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-slate-500 mt-1">
                    {t.deletedBy} {entry.deletedByName} · {RELATIVE(entry.deletedAt, ar)}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === entry.id}
                    onClick={() => void handleRestore(entry)}
                    className="px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5 transition-all"
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
                      className="px-3 py-2.5 rounded-xl font-bold text-xs border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-all"
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
