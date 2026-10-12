"use client";

/**
 * Every Finance filter in one control, over one `FinanceFilter` value.
 *
 * The page holds the value and feeds it to `applyFinanceFilters()` once, so the list, the tiles
 * and the PDF all read the same rows. This component only edits it: the row kind, the patient
 * search and the dentist sit in the first line (the three people reach for), the rest open under
 * "More filters", and "Clear" restores the empty filter in one tap.
 *
 * `hide` drops fields a screen has no rows for — the Clinic tab lists cash, so "Only outstanding"
 * (which keeps unpaid treatments) lives on the insurer tabs instead.
 */

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { EMPTY_FINANCE_FILTER, type FinanceFilter } from "@/lib/financeFilters";
import { foldArabicDigits } from "@/lib/phoneNumber";

export type FilterOption = { id: string; label: string };

export type FinanceFilterOptions = {
  methods: FilterOption[];
  payers: FilterOption[];
  dentists: FilterOption[];
  categories: FilterOption[];
  receivedBy: FilterOption[];
};

// "Income" (everything that came in) first, so the list that adds up to the Cash in figure is one tap away.
const KINDS: FinanceFilter["kind"][] = ["all", "in", "payment", "income", "expense"];

const control =
  "bg-surface-subtle border border-line rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none cursor-pointer focus:border-accent-soft";

/** A typed amount: blank is no bound; Arabic digits and a comma decimal are read as typed. */
function parseAmount(raw: string): number | null {
  const v = foldArabicDigits(raw).replace(/[٫,]/g, ".").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function FinanceFilters({
  value,
  onChange,
  options,
  kindAllLabel,
  hide = [],
}: {
  value: FinanceFilter;
  onChange: (next: FinanceFilter) => void;
  options: FinanceFilterOptions;
  /** What "every kind" is called on this screen (the Clinic tab shows its summary there). */
  kindAllLabel?: { en: string; ar: string };
  hide?: (keyof FinanceFilter)[];
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const [moreOpen, setMoreOpen] = useState(false);
  // What was typed into the amount boxes, so "1." or "" survive a re-render.
  const [minText, setMinText] = useState(value.amountMin === null ? "" : String(value.amountMin));
  const [maxText, setMaxText] = useState(value.amountMax === null ? "" : String(value.amountMax));
  const shown = (k: keyof FinanceFilter) => !hide.includes(k);
  const set = <K extends keyof FinanceFilter>(k: K, v: FinanceFilter[K]) => onChange({ ...value, [k]: v });

  const kindLabel = (k: FinanceFilter["kind"]) => {
    if (k === "all") return kindAllLabel ? (ar ? kindAllLabel.ar : kindAllLabel.en) : ar ? "الكل" : "All";
    if (k === "in") return ar ? "إيرادات" : "Income";
    if (k === "payment") return ar ? "مدفوعات" : "Payments";
    if (k === "income") return ar ? "إيرادات أخرى" : "Other income";
    return ar ? "مصروفات" : "Expenses";
  };

  // Filters under "More", counted so a closed panel still says something is narrowing the list.
  const moreActive = [
    shown("method") && value.method !== "all",
    shown("payerId") && value.payerId !== "all",
    shown("category") && value.category !== "all",
    shown("receivedBy") && value.receivedBy !== "all",
    shown("receiptQuery") && value.receiptQuery.trim() !== "",
    shown("amountMin") && value.amountMin !== null,
    shown("amountMax") && value.amountMax !== null,
    shown("onlyOutstanding") && value.onlyOutstanding,
  ].filter(Boolean).length;
  const anyActive =
    moreActive > 0 ||
    (shown("kind") && value.kind !== "all") ||
    (shown("patientQuery") && value.patientQuery.trim() !== "") ||
    (shown("doctorId") && value.doctorId !== "all");

  const clear = () => {
    // Hidden fields keep whatever the screen set them to; only what this control shows is cleared.
    const next = { ...value };
    for (const k of Object.keys(EMPTY_FINANCE_FILTER) as (keyof FinanceFilter)[]) {
      if (shown(k)) (next as Record<string, unknown>)[k] = EMPTY_FINANCE_FILTER[k];
    }
    setMinText("");
    setMaxText("");
    onChange(next);
  };

  const select = (k: "method" | "payerId" | "doctorId" | "category" | "receivedBy", all: string, list: FilterOption[]) => (
    <select value={value[k]} onChange={(e) => set(k, e.target.value)} className={`${control} w-full`} aria-label={all}>
      <option value="all">{all}</option>
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
      {/* A value no longer offered (a dentist with no rows this period) stays visible rather than
          silently reading as "all" while still filtering. */}
      {value[k] !== "all" && !list.some((o) => o.id === value[k]) ? <option value={value[k]}>{value[k]}</option> : null}
    </select>
  );

  return (
    <div className="flex flex-col gap-3 min-w-0 flex-1">
      <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3 lg:items-center">
        {shown("kind") && (
          <div className="flex max-w-full min-w-0 bg-surface-muted p-1 rounded-xl border border-slate-200/60 shrink-0 overflow-x-auto no-scrollbar">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set("kind", k)}
                className={`shrink-0 px-3.5 py-2 max-lg:min-h-10 rounded-lg text-xs font-bold uppercase whitespace-nowrap transition-all ${
                  value.kind === k ? "bg-slate-900 text-white shadow-sm" : "text-slate-500"
                }`}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 flex-1 min-w-0 lg:justify-end">
          {shown("doctorId") && (
            <div className="w-full sm:max-w-[220px]">{select("doctorId", ar ? "كل الأطباء" : "All dentists", options.dentists)}</div>
          )}
          {shown("patientQuery") && (
            <div className="relative w-full sm:max-w-xs shadow-sm">
              <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={value.patientQuery}
                onChange={(e) => set("patientQuery", e.target.value)}
                placeholder={ar ? "اسم المريض أو تليفونه أو ملاحظة..." : "Patient name, phone or note..."}
                className="bg-surface-subtle border border-line rounded-xl ps-10 pe-4 py-2.5 text-sm font-semibold text-slate-800 outline-none w-full focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/15"
              />
            </div>
          )}
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs border transition-all ${
                moreOpen || moreActive > 0 ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              <SlidersHorizontal size={15} />
              {ar ? "فلاتر أكتر" : "More filters"}
              {moreActive > 0 ? <span className="font-figure rounded-full bg-accent text-ink-on-accent px-1.5 text-[11px]">{moreActive}</span> : null}
            </button>
            {anyActive && (
              <button
                type="button"
                onClick={clear}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-xs text-ink-muted hover:text-ink"
              >
                <X size={14} />
                {ar ? "مسح" : "Clear"}
              </button>
            )}
          </div>
        </div>
      </div>

      {moreOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 border-t border-slate-100 pt-3">
          {shown("method") && select("method", ar ? "كل طرق الدفع" : "Every method", options.methods)}
          {shown("payerId") && select("payerId", ar ? "كل الجهات" : "Every payer", options.payers)}
          {shown("category") && select("category", ar ? "كل التصنيفات" : "Every category", options.categories)}
          {shown("receivedBy") && select("receivedBy", ar ? "استلمها أي حد" : "Received by anyone", options.receivedBy)}
          {shown("receiptQuery") && (
            <input
              type="search"
              value={value.receiptQuery}
              onChange={(e) => set("receiptQuery", e.target.value)}
              placeholder={ar ? "رقم الإيصال" : "Receipt number"}
              className={`${control} cursor-text`}
            />
          )}
          {(shown("amountMin") || shown("amountMax")) && (
            <div className="flex items-center gap-2">
              {shown("amountMin") && (
                <input
                  type="text"
                  inputMode="decimal"
                  value={minText}
                  onChange={(e) => {
                    setMinText(e.target.value);
                    set("amountMin", parseAmount(e.target.value));
                  }}
                  placeholder={ar ? "من مبلغ" : "Min amount"}
                  className={`${control} cursor-text w-full min-w-0`}
                />
              )}
              <span className="text-slate-400 font-bold text-xs">–</span>
              {shown("amountMax") && (
                <input
                  type="text"
                  inputMode="decimal"
                  value={maxText}
                  onChange={(e) => {
                    setMaxText(e.target.value);
                    set("amountMax", parseAmount(e.target.value));
                  }}
                  placeholder={ar ? "لحد مبلغ" : "Max amount"}
                  className={`${control} cursor-text w-full min-w-0`}
                />
              )}
            </div>
          )}
          {shown("onlyOutstanding") && (
            <label className="flex items-center gap-2 text-xs font-bold text-ink-body px-1">
              <input
                type="checkbox"
                checked={value.onlyOutstanding}
                onChange={(e) => set("onlyOutstanding", e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              {ar ? "المتبقي بس" : "Only outstanding"}
            </label>
          )}
        </div>
      )}
    </div>
  );
}
