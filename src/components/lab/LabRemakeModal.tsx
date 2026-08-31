"use client";

/**
 * Raising a remake, and recording whose it was.
 *
 * The original case is never rewritten — it is the record of something that physically happened,
 * and losing the fact that the first attempt failed is exactly what makes "which lab causes us the
 * most rework" unanswerable. The replacement gets its own number with an `-R2` suffix and points
 * back at what it replaces.
 *
 * Fault is asked as a plain question rather than assumed, because it decides the money: a remake
 * the lab owns costs nothing, and one caused by a re-prep in the chair is a new case at full price.
 * Nobody will fill this in later, so it is asked now, while the reason is still obvious.
 */

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import type { LabCase } from "@/lib/labCases";

const FAULTS: Array<{ id: NonNullable<LabCase["remakeFault"]>; en: string; ar: string; hintEn: string; hintAr: string }> = [
  { id: "lab", en: "The lab", ar: "المعمل", hintEn: "Their mistake — normally no charge.", hintAr: "غلطتهم — عادةً من غير فلوس." },
  { id: "clinic", en: "The clinic", ar: "العيادة", hintEn: "A re-prep or a new impression. Chargeable.", hintAr: "تحضير أو طبعة جديدة. بتتحاسب." },
  { id: "patient", en: "The patient", ar: "المريض", hintEn: "Changed their mind, or broke it. Chargeable.", hintAr: "غيّر رأيه أو كسرها. بتتحاسب." },
  { id: "unknown", en: "Not sure", ar: "مش متأكد", hintEn: "Decide later.", hintAr: "نقرر بعدين." },
];

const REASONS_EN = ["Shade too dark", "Shade too light", "Does not seat", "Open contact", "High bite", "Poor fit", "Broken in transit"];
const REASONS_AR = ["اللون غامق", "اللون فاتح", "مش راكبة", "تلامس مفتوح", "الضغط عالي", "مش مظبوطة", "اتكسرت في الطريق"];

export default function LabRemakeModal({
  open,
  labCase,
  onClose,
  onConfirm,
}: {
  open: boolean;
  labCase: LabCase | null;
  onClose: () => void;
  onConfirm: (args: { reason: string; fault: NonNullable<LabCase["remakeFault"]>; agreedPrice: number }) => Promise<void>;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [reason, setReason] = useState("");
  const [fault, setFault] = useState<NonNullable<LabCase["remakeFault"]>>("lab");
  const [price, setPrice] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setFault("lab");
    setPrice("0");
  }, [open]);

  /**
   * The price follows the fault, because that is the rule the money actually obeys — and leaving
   * it at zero after "the patient broke it" is a charge the clinic silently absorbs.
   */
  useEffect(() => {
    if (!open || !labCase) return;
    setPrice(fault === "lab" ? "0" : String(Math.round(labCase.agreedPrice || 0)));
  }, [fault, open, labCase]);

  if (!open || !labCase) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in">
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="flex items-center justify-between gap-3 px-5 sm:px-7 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center shrink-0">
              <RotateCcw size={19} className="text-rose-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                {isAr ? "إعادة عمل" : "Raise a remake"}
              </h2>
              <p className="text-[11px] font-bold text-slate-400 mt-0.5" dir="ltr">
                {labCase.code} · {labCase.labName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 space-y-5 custom-scrollbar">
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">
              {isAr ? "إيه اللي حصل؟" : "What went wrong?"}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(isAr ? REASONS_AR : REASONS_EN).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                    reason === r
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isAr ? "أو اكتبها بنفسك…" : "…or type it yourself"}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10 transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">
              {isAr ? "على مين؟" : "Whose was it?"}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {FAULTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFault(f.id)}
                  className={`text-start px-3 py-2.5 rounded-xl border transition-all ${
                    fault === f.id
                      ? "bg-rose-50 border-rose-400 ring-4 ring-rose-500/10"
                      : "bg-slate-50/60 border-slate-200 hover:bg-white"
                  }`}
                >
                  <span className={`block text-sm font-black ${fault === f.id ? "text-rose-800" : "text-slate-700"}`}>
                    {isAr ? f.ar : f.en}
                  </span>
                  <span className="block text-[10px] font-semibold text-slate-500 mt-0.5 leading-relaxed">
                    {isAr ? f.hintAr : f.hintEn}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              {isAr ? "سعر الإعادة" : "Price for the remake"}
            </label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-rose-400 transition-all"
            />
            <p className="text-[10px] font-semibold text-slate-400 mt-1 leading-relaxed">
              {fault === "lab"
                ? isAr
                  ? "صفر — المعمل بيعيدها على حسابه. غيّره لو اتفقتوا على غير كده."
                  : "Zero — the lab redoes it at its own cost. Change it if you agreed otherwise."
                : isAr
                  ? "بيتحسب من سعر الحالة الأصلية. عدّله لو الاتفاق مختلف."
                  : "Taken from the original case. Adjust it if the agreement differs."}
            </p>
          </div>

          <p className="text-[11px] font-semibold text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
            {isAr
              ? `الحالة الأصلية ${labCase.code} هتفضل في السجل زي ما هي. الإعادة هتاخد رقم جديد بعلامة R وهتتبعت للمعمل.`
              : `The original ${labCase.code} stays on the record exactly as it is. The remake gets its own number with an R suffix and goes out to the lab.`}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 sm:px-7 py-4 border-t border-slate-100 bg-slate-50/60 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide text-slate-500 hover:bg-slate-200/60 transition-colors"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm({ reason: reason.trim(), fault, agreedPrice: Number(price) || 0 });
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black uppercase tracking-wide shadow-md hover:bg-rose-700 disabled:opacity-40 transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {isAr ? "اعمل الإعادة" : "Raise remake"}
          </button>
        </div>
      </div>
    </div>
  );
}
