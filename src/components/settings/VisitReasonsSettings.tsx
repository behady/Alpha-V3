"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Plus, Trash2, Save, Stethoscope, GripVertical } from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

const DEFAULT_REASONS = [
  "كشف"
];

export const VISIT_REASONS_DOC = "visit_reasons";

export default function VisitReasonsSettings() {
  const { showToast } = useUI();
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [reasons, setReasons] = useState<string[]>(DEFAULT_REASONS);
  const [newReason, setNewReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    getDoc(getClinicDoc("settings", VISIT_REASONS_DOC)).then((snap) => {
      if (snap.exists() && Array.isArray(snap.data().reasons)) {
        setReasons(snap.data().reasons);
      }
      setFetched(true);
    });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      await setDoc(
        getClinicDoc("settings", VISIT_REASONS_DOC),
        { reasons },
        { merge: true }
      );
      showToast(isAr ? "تم الحفظ!" : "Reasons saved!", "success");
    } catch {
      showToast(isAr ? "فشل الحفظ" : "Save failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const addReason = () => {
    const trimmed = newReason.trim();
    if (!trimmed) return;
    if (reasons.map((r) => r.toLowerCase()).includes(trimmed.toLowerCase())) {
      showToast(isAr ? "السبب موجود بالفعل" : "Reason already exists", "error");
      return;
    }
    setReasons([...reasons, trimmed]);
    setNewReason("");
  };

  const removeReason = (index: number) => {
    setReasons(reasons.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 max-w-xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
            <Stethoscope size={20} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight">
              {isAr ? "أسباب الزيارة" : "Reasons for Visit"}
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {isAr
                ? "أدر قائمة أسباب الزيارة التي تظهر أثناء حجز موعد."
                : "Manage the list of reasons for visit that appear when booking an appointment."}
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

      {/* Add new reason */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newReason}
          onChange={(e) => setNewReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addReason();
            }
          }}
          placeholder={isAr ? "إضافة سبب جديد..." : "Add new reason..."}
          className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
        />
        <button
          onClick={addReason}
          disabled={!newReason.trim()}
          className="px-4 py-3 bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 disabled:opacity-50 transition-colors"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {reasons.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm font-medium">
            {isAr ? "لم يتم إضافة أسباب بعد" : "No reasons added yet"}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reasons.map((reason, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors group"
              >
                <div className="text-slate-300 cursor-grab active:cursor-grabbing">
                  <GripVertical size={16} />
                </div>
                <div className="flex-1 text-sm font-bold text-slate-700">
                  {reason}
                </div>
                <button
                  onClick={() => removeReason(idx)}
                  className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label="Remove reason"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
