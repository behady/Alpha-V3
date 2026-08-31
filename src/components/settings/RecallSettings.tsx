"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { AlertCircle, CalendarClock, Loader2, Save } from "lucide-react";
import { getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import { useSettingsDraft } from "@/lib/settingsDraft";

/**
 * Recall and reactivation intervals.
 *
 * These exist because nothing in the system expressed "this patient is due for a check-up" — the
 * concept had no home. Any feature that flags overdue patients has to read a number the clinic
 * actually stated, otherwise it is presenting a developer's guess as the practice's own policy.
 * Both features refuse to invent a number when this is unset; they say it is unconfigured instead.
 */

const RECALL_DOC = { collection: "settings", docId: "recall" };
const REACTIVATION_DOC = { collection: "settings", docId: "reactivation" };

/** Both intervals are edited together and saved together, so they share one draft. */
type RecallDraft = { recallMonths: string; reactivationMonths: string };

/** Module-level so the fallback keeps its identity between renders. */
const EMPTY_RECALL_DRAFT: RecallDraft = { recallMonths: "", reactivationMonths: "" };

export default function RecallSettings() {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const { user } = useAuth();
  const isAr = language === "ar";

  const [stored, setStored] = useState<RecallDraft | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Two documents, one screen, one Save — so one draft. Both listeners are live, and without this
  // an update to either would overwrite a half-typed interval. See lib/settingsDraft.ts.
  const { value: draft, setValue: setDraft, markSaved } = useSettingsDraft<RecallDraft>(
    "recall",
    stored,
    EMPTY_RECALL_DRAFT
  );
  const { recallMonths, reactivationMonths } = draft;
  const setRecallMonths = (value: string) => setDraft((current) => ({ ...current, recallMonths: value }));
  const setReactivationMonths = (value: string) =>
    setDraft((current) => ({ ...current, reactivationMonths: value }));

  useEffect(() => {
    const unsubRecall = onSnapshot(getClinicDoc(RECALL_DOC.collection, RECALL_DOC.docId), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (d?.intervalMonths) {
        setStored((current) => ({
          ...(current ?? EMPTY_RECALL_DRAFT),
          recallMonths: String(d.intervalMonths),
        }));
        setConfigured(true);
      } else {
        setStored((current) => current ?? EMPTY_RECALL_DRAFT);
      }
      setLoading(false);
    });
    const unsubReact = onSnapshot(getClinicDoc(REACTIVATION_DOC.collection, REACTIVATION_DOC.docId), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (d?.thresholdDays) {
        setStored((current) => ({
          ...(current ?? EMPTY_RECALL_DRAFT),
          reactivationMonths: String(Math.round(Number(d.thresholdDays) / 30)),
        }));
      }
    });
    return () => {
      unsubRecall();
      unsubReact();
    };
  }, []);

  const save = async () => {
    const recall = Number(recallMonths);
    const reactivation = Number(reactivationMonths);

    if (!Number.isFinite(recall) || recall <= 0) {
      showToast(isAr ? "أدخل عدد شهور صالح للمتابعة" : "Enter a valid recall interval in months", "error");
      return;
    }
    if (!Number.isFinite(reactivation) || reactivation <= 0) {
      showToast(isAr ? "أدخل عدد شهور صالح لإعادة التفعيل" : "Enter a valid reactivation threshold in months", "error");
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        getClinicDoc(RECALL_DOC.collection, RECALL_DOC.docId),
        { intervalMonths: recall, configuredAt: new Date().toISOString() },
        { merge: true }
      );
      // Stored in days because that is the unit the dormancy scan reasons in; months is only the
      // friendlier way to ask for it.
      await setDoc(
        getClinicDoc(REACTIVATION_DOC.collection, REACTIVATION_DOC.docId),
        { thresholdDays: Math.round(reactivation * 30), configuredAt: new Date().toISOString() },
        { merge: true }
      );
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Settings Updated",
        `Recall interval set to ${recall} months; reactivation threshold ${reactivation} months.`
      );
      setConfigured(true);
      markSaved();
      showToast(isAr ? "تم الحفظ" : "Saved", "success");
    } catch {
      showToast(isAr ? "فشل الحفظ" : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="animate-spin text-slate-300" size={22} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-surface p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 bg-violet-50 text-violet-600 rounded-2xl flex items-center justify-center">
            <CalendarClock size={28} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-ink">
              {isAr ? "المتابعة وإعادة التفعيل" : "Recall & Reactivation"}
            </h3>
            <p className="text-sm font-medium text-ink-muted">
              {isAr
                ? "متى يُعتبر المريض متأخراً عن الكشف الدوري، ومتى يُعتبر منقطعاً."
                : "When a patient is due for a check-up, and when they count as lapsed."}
            </p>
          </div>
        </div>

        {!configured && (
          <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[12px] font-medium text-amber-900 leading-relaxed">
              {isAr
                ? "لم يتم ضبط هذه القيم بعد. لن تعمل تذكيرات المتابعة حتى تحدد سياسة عيادتك — لن نفترض رقماً نيابةً عنك."
                : "These are not set yet. Recall reminders stay switched off until you state your clinic's policy — we will not assume a number on your behalf."}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
              {isAr ? "فترة المتابعة (بالشهور)" : "Recall interval (months)"}
            </label>
            <input
              type="number"
              min={1}
              value={recallMonths}
              onChange={(e) => setRecallMonths(e.target.value)}
              placeholder={isAr ? "مثال: 6" : "e.g. 6"}
              className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-primary-500 transition-all"
            />
            <p className="text-[11px] font-medium text-slate-400 mt-2 leading-relaxed">
              {isAr
                ? "بعد هذه المدة من آخر زيارة، يظهر المريض في قائمة المتابعة."
                : "After this long since their last visit, a patient appears on the recall list."}
            </p>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
              {isAr ? "حد الانقطاع (بالشهور)" : "Lapsed after (months)"}
            </label>
            <input
              type="number"
              min={1}
              value={reactivationMonths}
              onChange={(e) => setReactivationMonths(e.target.value)}
              placeholder={isAr ? "مثال: 12" : "e.g. 12"}
              className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-primary-500 transition-all"
            />
            <p className="text-[11px] font-medium text-slate-400 mt-2 leading-relaxed">
              {isAr
                ? "يستخدمه فحص إعادة التفعيل لتحديد المرضى المنقطعين."
                : "Used by the reactivation scan to decide who counts as lapsed."}
            </p>
          </div>
        </div>

        <button
          onClick={() => void save()}
          disabled={saving}
          className="mt-6 inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-md active:scale-[0.98] transition-all"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {isAr ? "حفظ" : "Save"}
        </button>
      </div>
    </div>
  );
}
