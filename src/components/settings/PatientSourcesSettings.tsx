"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Plus, Trash2, Save, Network, GripVertical } from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

const DEFAULT_SOURCES = [
  "Walk-in",
  "Social Media",
  "Friend / Family",
  "Other Doctor",
  "Google",
  "Instagram",
  "Online Booking",
];

export const PATIENT_SOURCES_DOC = "patient_sources";

export default function PatientSourcesSettings() {
  const { showToast } = useUI();
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [sources, setSources] = useState<string[]>(DEFAULT_SOURCES);
  const [newSource, setNewSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    getDoc(getClinicDoc("settings", PATIENT_SOURCES_DOC)).then((snap) => {
      if (snap.exists() && Array.isArray(snap.data().sources)) {
        setSources(snap.data().sources);
      }
      setFetched(true);
    });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      await setDoc(
        getClinicDoc("settings", PATIENT_SOURCES_DOC),
        { sources },
        { merge: true }
      );
      showToast(isAr ? "تم الحفظ!" : "Sources saved!", "success");
    } catch {
      showToast(isAr ? "فشل الحفظ" : "Save failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const addSource = () => {
    const trimmed = newSource.trim();
    if (!trimmed) return;
    if (sources.map((s) => s.toLowerCase()).includes(trimmed.toLowerCase())) {
      showToast(isAr ? "المصدر موجود بالفعل" : "Source already exists", "error");
      return;
    }
    setSources([...sources, trimmed]);
    setNewSource("");
  };

  const removeSource = (index: number) => {
    setSources(sources.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 max-w-xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary-50 flex items-center justify-center shrink-0">
            <Network size={20} className="text-primary-600" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight">
              {isAr ? "مصادر المرضى" : "Patient Sources"}
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {isAr
                ? "أدر قائمة المصادر التي يصل منها المرضى للعيادة."
                : "Manage how patients find your clinic. These appear in patient files and reports."}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={loading || !fetched}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wide shadow-md hover:bg-slate-700 disabled:opacity-50 transition-all shrink-0"
        >
          <Save size={14} />
          {isAr ? "حفظ" : "Save"}
        </button>
      </div>

      {/* Add new source */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSource()}
          placeholder={isAr ? "أضف مصدراً جديداً..." : "Add a new source..."}
          className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15 transition-all"
        />
        <button
          type="button"
          onClick={addSource}
          disabled={!newSource.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-xs font-black hover:bg-primary-700 disabled:opacity-40 transition-all shadow-sm"
        >
          <Plus size={15} />
          {isAr ? "إضافة" : "Add"}
        </button>
      </div>

      {/* Sources list */}
      <div className="space-y-2">
        {sources.length === 0 && (
          <p className="text-sm text-slate-400 font-medium text-center py-6">
            {isAr ? "لا توجد مصادر. أضف واحداً أعلاه." : "No sources yet. Add one above."}
          </p>
        )}
        {sources.map((source, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl group hover:border-slate-300 transition-all"
          >
            <GripVertical size={15} className="text-slate-300 shrink-0" />
            <div className="flex-1 flex items-center gap-2">
              <span className="inline-flex w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-[10px] font-black items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span className="text-sm font-bold text-slate-800">{source}</span>
            </div>
            <button
              type="button"
              onClick={() => removeSource(i)}
              className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {sources.length > 0 && (
        <p className="text-[11px] text-slate-400 font-medium">
          {isAr
            ? `${sources.length} مصدر مسجّل. لا يمكن حذف المصادر المرتبطة بمرضى حالياً.`
            : `${sources.length} source(s) registered. Deleting a source won't affect existing patient records.`}
        </p>
      )}
    </div>
  );
}
