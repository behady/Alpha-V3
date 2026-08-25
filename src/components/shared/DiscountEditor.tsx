"use client";

/**
 * Picking a price list and taking money off a line, in one place.
 *
 * Every screen that prices a treatment gets this same control, so the discount a dentist gives at
 * the chair and the one a receptionist gives at the desk are the same kind of object. Before, each
 * screen did its own arithmetic and wrote the result into the description as a sentence.
 *
 * Three things it deliberately shows rather than hides:
 *
 *   - the before / minus / after line, because a discount that only appears as a smaller number is
 *     indistinguishable from a mistyped price;
 *   - the list's blanket percentage as a filled-in, editable line discount, not as a quietly
 *     cheaper price — that is what makes it reportable;
 *   - the ceiling, when the person is not an Admin, before they type something that gets refused.
 *
 * The server recomputes all of this and enforces the ceiling and the reason. What happens here is
 * a preview and a courtesy.
 */

import { useEffect, useMemo } from "react";
import { Tag, Percent, Info } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { applyDiscount, effectiveDiscountPercent, type DiscountMode } from "@/lib/discountMath";
import { listsForBranch, resolveActiveListId, type PriceList } from "@/lib/priceLists";

export type DiscountState = {
  priceListId: string;
  mode: DiscountMode;
  /** The percentage or the fixed amount, as typed. Empty string while the field is being cleared. */
  value: number | "";
  reason: string;
};

type Props = {
  /** Line total at list price, before any discount. */
  listTotal: number;
  priceLists: PriceList[];
  /**
   * The branch this treatment is being recorded at. Narrows the offered lists to the ones that
   * branch charges; omitted (or a clinic with no branches) offers everything, as before.
   */
  branchId?: string | null;
  reasons: string[];
  /** null = no ceiling (an Admin). */
  maxPercent: number | null;
  value: DiscountState;
  onChange: (next: DiscountState) => void;
  currency?: string;
  disabled?: boolean;
};

export default function DiscountEditor({
  listTotal,
  priceLists,
  branchId = null,
  reasons,
  maxPercent,
  value,
  onChange,
  currency,
  disabled = false,
}: Props) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const money = currency || (ar ? "ج.م" : "EGP");

  const activeLists = useMemo(
    () => listsForBranch(priceLists, branchId).filter((l) => l.active),
    [priceLists, branchId]
  );
  const selectedList = activeLists.find((l) => l.id === value.priceListId) || null;

  /**
   * Make the selected list real before anything reads it.
   *
   * `priceListId` starts as "", and a <select> whose value matches no option renders its FIRST
   * option — so the control said "Standard" while the state held nothing at all. Two things broke
   * quietly on the back of that: the blanket-discount prefill below is keyed on `selectedList`, so
   * a list running at 20% off filled in nothing unless you re-picked it by hand; and the note
   * saved without naming its list, leaving the server to guess a default that need not match what
   * the screen was showing. Resolving it here means what is displayed, what is stored and what the
   * price is read from are the same list.
   */
  useEffect(() => {
    if (activeLists.length === 0) return;
    if (activeLists.some((l) => l.id === value.priceListId)) return;
    onChange({ ...value, priceListId: resolveActiveListId(activeLists, value.priceListId, null, branchId) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLists, value.priceListId]);

  /**
   * Prefill the list's blanket discount when the list changes.
   *
   * Only when nothing has been entered by hand: a percentage someone typed is a decision, and
   * having it overwritten by switching lists to check a price would be its own small betrayal.
   */
  useEffect(() => {
    if (!selectedList) return;
    const blanket = selectedList.generalDiscountPercent;
    if (blanket > 0 && value.mode === "none" && value.value === "") {
      onChange({ ...value, mode: "percent", value: blanket });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedList?.id]);

  const applied = applyDiscount(listTotal, value.mode, value.value === "" ? 0 : Number(value.value));
  const percent = effectiveDiscountPercent(listTotal, applied.discountAmount);
  const overCeiling = maxPercent !== null && percent > maxPercent + 0.001;
  const needsReason = applied.discountAmount > 0 && !value.reason.trim();

  const txt = {
    priceList: ar ? "قائمة الأسعار" : "Price list",
    discount: ar ? "الخصم" : "Discount",
    none: ar ? "بدون" : "None",
    percent: ar ? "نسبة %" : "Percent %",
    fixed: ar ? "مبلغ" : "Amount",
    reason: ar ? "سبب الخصم" : "Discount reason",
    pickReason: ar ? "اختار السبب…" : "Choose a reason…",
    before: ar ? "قبل" : "Before",
    off: ar ? "الخصم" : "Discount",
    after: ar ? "بعد" : "After",
    blanket: (n: number) => (ar ? `القائمة دي عليها خصم ${n}%` : `This list runs at ${n}% off`),
    ceiling: (n: number) => (ar ? `أقصى خصم مسموح ليك ${n}% — أكتر من كده محتاج مدير` : `You can discount up to ${n}%. More than that needs an Admin.`),
    overCeiling: (n: string) =>
      ar ? `${n}% أكبر من المسموح ليك — المدير بس اللي يقدر` : `${n}% is above your limit. A Clinic Admin has to approve this.`,
    needsReason: ar ? "لازم تختار سبب للخصم" : "Choose a reason for this discount",
  };

  const set = (patch: Partial<DiscountState>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      {/* Always shown, even with one list. Which prices a treatment was charged at is part of
          the record, and a clinic with a single list still benefits from seeing it named rather
          than having to remember that "no list shown" meant the standard one. */}
      {activeLists.length > 0 && (
        <div>
          <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-400">
            <Tag size={11} className="mr-1 inline" />
            {txt.priceList}
          </label>
          {activeLists.length > 1 ? (
            <select
              value={selectedList?.id ?? ""}
              disabled={disabled}
              onChange={(e) => set({ priceListId: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-primary-500 focus:bg-white disabled:opacity-60"
            >
              {activeLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {ar && list.nameAr ? list.nameAr : list.name}
                  {list.generalDiscountPercent > 0 ? ` — ${list.generalDiscountPercent}%` : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-bold text-slate-600">
              {ar && activeLists[0].nameAr ? activeLists[0].nameAr : activeLists[0].name}
            </p>
          )}
          {selectedList && selectedList.generalDiscountPercent > 0 && (
            <p className="mt-1 text-[11px] font-semibold text-primary-600">
              {txt.blanket(selectedList.generalDiscountPercent)}
            </p>
          )}
        </div>
      )}

      <div>
        <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-400">
          <Percent size={11} className="mr-1 inline" />
          {txt.discount}
        </label>
        <div className="flex gap-2">
          <select
            value={value.mode}
            disabled={disabled}
            onChange={(e) => {
              const mode = e.target.value as DiscountMode;
              set({ mode, value: mode === "none" ? "" : value.value, reason: mode === "none" ? "" : value.reason });
            }}
            className="w-32 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-primary-500 focus:bg-white disabled:opacity-60"
          >
            <option value="none">{txt.none}</option>
            <option value="percent">{txt.percent}</option>
            <option value="fixed">{txt.fixed}</option>
          </select>
          {value.mode !== "none" && (
            <input
              type="number"
              min={0}
              max={value.mode === "percent" ? 100 : undefined}
              step="any"
              inputMode="decimal"
              disabled={disabled}
              value={value.value}
              onChange={(e) => set({ value: e.target.value === "" ? "" : Number(e.target.value) })}
              placeholder={value.mode === "percent" ? "10" : "100"}
              className={`flex-1 rounded-xl border bg-slate-50/50 px-3 py-2.5 text-sm font-bold tabular-nums text-slate-700 outline-none transition focus:bg-white disabled:opacity-60 ${
                overCeiling ? "border-rose-300 focus:border-rose-500" : "border-slate-200 focus:border-primary-500"
              }`}
            />
          )}
        </div>

        {maxPercent !== null && applied.discountAmount === 0 && (
          <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-slate-400">
            <Info size={11} className="mt-0.5 shrink-0" />
            {txt.ceiling(maxPercent)}
          </p>
        )}
        {overCeiling && (
          <p className="mt-1 text-[11px] font-bold text-rose-600">{txt.overCeiling(percent.toFixed(1))}</p>
        )}
      </div>

      {applied.discountAmount > 0 && (
        <div>
          <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-400">
            {txt.reason}
          </label>
          <select
            value={value.reason}
            disabled={disabled}
            onChange={(e) => set({ reason: e.target.value })}
            className={`w-full rounded-xl border bg-slate-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:bg-white disabled:opacity-60 ${
              needsReason ? "border-amber-300 focus:border-amber-500" : "border-slate-200 focus:border-primary-500"
            }`}
          >
            <option value="">{txt.pickReason}</option>
            {reasons.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
          {needsReason && <p className="mt-1 text-[11px] font-bold text-amber-600">{txt.needsReason}</p>}
        </div>
      )}

      {/* The whole point: what came off is visible, not folded into a smaller number. */}
      {applied.discountAmount > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-primary-50/70 px-3 py-2.5 text-sm">
          <span className="font-medium text-slate-500 line-through tabular-nums">
            {applied.listPrice.toLocaleString()}
          </span>
          <span className="font-bold text-rose-600 tabular-nums">
            −{applied.discountAmount.toLocaleString()}
          </span>
          <span className="font-black text-primary-700 tabular-nums">
            {applied.net.toLocaleString()} <span className="text-[10px] font-bold">{money}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** Everything a caller needs to send to the API, from the editor's state. */
export function discountPayload(state: DiscountState) {
  return {
    priceListId: state.priceListId || null,
    discountMode: state.mode,
    discountValue: state.value === "" ? null : Number(state.value),
    discountReason: state.reason.trim() || null,
  };
}

export const EMPTY_DISCOUNT: DiscountState = {
  priceListId: "",
  mode: "none",
  value: "",
  reason: "",
};
