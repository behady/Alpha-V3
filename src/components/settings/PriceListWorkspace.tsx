"use client";

/**
 * One price list, every treatment on it, on a single screen.
 *
 * Before this, a list's prices could only be set from inside each treatment's own edit dialog:
 * open a treatment, scroll past its category, icon, duration and lab fee, type one number, save,
 * close, repeat. Pricing sixty treatments on a new insurance list meant sixty dialogs, and there
 * was nowhere at all to SEE a list — no way to answer "what does this insurer actually pay us?"
 * without opening every treatment one at a time.
 *
 * So the list becomes the thing you open, and the treatments become rows in it. Three rules make
 * that safe:
 *
 *   - A blank cell means "charge the standard price", never zero. A clinic fills in only the
 *     treatments it genuinely charges differently, and the rest follow the standard list for free.
 *     Storing a 0 instead would silently make treatments free — see [[ledger-money-field-per-row-type]]
 *     for what placeholder zeros cost the last time they were treated as real money.
 *   - Nothing is written until Save. Every cell is a draft, the count of pending changes is on the
 *     button, and leaving with unsaved work asks first. Live-saving each keystroke would write a
 *     price of "1" on the way to typing "150".
 *   - The blanket discount is shown per row but never folded into the stored number. It is a
 *     prefilled line discount, not a second price, and the day it changes every row has to move
 *     with it. The "patient pays" column is therefore derived, never saved.
 */

import { useEffect, useMemo, useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
import {
  ArrowLeft,
  Check,
  Loader2,
  Percent,
  RotateCcw,
  Search,
  Wand2,
  X,
} from "lucide-react";
import { onSnapshot, writeBatch, deleteField, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection } from "@/lib/db-utils";
import { getGlobalClinicId } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import { matchesTokenizedSubstring } from "@/lib/flexibleSearch";
import { STANDARD_LIST_ID, type PriceList } from "@/lib/priceLists";
import { DENTAL_CATEGORIES, DentalIcon, iconForService, suggestCategory } from "@/lib/dentalIcons";

type ServiceRow = {
  id: string;
  name: string;
  price: number;
  category?: string;
  icon?: string;
  prices?: Record<string, number>;
};

/** Firestore caps a batch at 500 operations; stay under it with room to spare. */
const BATCH_LIMIT = 400;

function money(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}

export default function PriceListWorkspace({
  list,
  currency,
  onBack,
}: {
  list: PriceList;
  currency: string;
  onBack: () => void;
}) {
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();
  const ar = language === "ar";

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  /** serviceId → what is typed in the cell. "" means "charge the standard price". */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [bulkPercent, setBulkPercent] = useState("");

  const isStandard = list.id === STANDARD_LIST_ID;

  useEffect(() => {
    const unsub = onSnapshot(getClinicCollection("services"), (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ServiceRow, "id">) }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setServices(rows);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  /** What is stored right now for this list, as text — the baseline every draft is compared to. */
  const stored = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of services) {
      if (isStandard) {
        out[s.id] = Number.isFinite(Number(s.price)) ? String(s.price ?? "") : "";
      } else {
        const v = s.prices?.[list.id];
        out[s.id] = typeof v === "number" ? String(v) : "";
      }
    }
    return out;
  }, [services, list.id, isStandard]);

  const valueFor = (id: string) => (id in drafts ? drafts[id] : (stored[id] ?? ""));

  const changed = useMemo(
    () => Object.keys(drafts).filter((id) => (drafts[id] ?? "") !== (stored[id] ?? "")),
    [drafts, stored]
  );


  const txt = {

    ...useSettingsText("priceListWorkspace"),

    sub: isStandard
      ? ar
        ? "دي الأسعار الأساسية. أي قائمة تانية بتاخد السعر ده لو مالهاش سعر خاص."
        : "These are the standard prices. Every other list falls back to them where it has no price of its own."
      : ar
        ? "سيب الخانة فاضية عشان تتحاسب بالسعر الأساسي. املا بس العلاجات اللي بتتسعّر مختلف."
        : "Leave a cell blank to charge the standard price. Fill in only the treatments this list charges differently.",

    saveCount: (n: number) => (ar ? `حفظ ${n} تغيير` : `Save ${n} change${n === 1 ? "" : "s"}`),

    // Says "shown below" and means it: the search box and the category chips scope this, which is
    // how you price one category at a rate different from the rest. It overwrites cells that
    // already have a number, so the wording must not imply it only touches blank ones.
    bulkBody: ar
      ? "بيحسب سعر كل علاج ظاهر تحت كنسبة خصم من السعر الأساسي، وبيستبدل اللي مكتوب. البحث والفئات بيحددوا اللي هيتغير. مش هيتحفظ غير لما تدوس حفظ."
      : "Prices every treatment shown below at a percentage off its standard price, replacing anything already typed. The search box and category chips narrow what it touches. Nothing is written until you press Save.",

    blanketNote: (pct: number) =>
      ar
        ? `كل خدمة من القائمة دي بتيجي وعليها خصم ${pct}% ظاهر وقابل للتعديل، فوق السعر ده.`
        : `Services picked from this list arrive with a visible, editable ${pct}% discount on top of this price.`,

  };

  const filtered = useMemo(
    () =>
      services.filter(
        (s) =>
          matchesTokenizedSubstring(s.name, search) &&
          (categoryFilter === "all" || (s.category || suggestCategory(s.name)) === categoryFilter)
      ),
    [services, search, categoryFilter]
  );

  const grouped = useMemo(() => {
    const byCat = new Map<string, ServiceRow[]>();
    for (const s of filtered) {
      const key = s.category || suggestCategory(s.name);
      byCat.set(key, [...(byCat.get(key) || []), s]);
    }
    return DENTAL_CATEGORIES.filter((c) => byCat.has(c.key)).map((c) => ({
      category: c,
      items: byCat.get(c.key)!,
    }));
  }, [filtered]);

  const usedCategories = useMemo(() => {
    const used = new Set(services.map((s) => s.category || suggestCategory(s.name)));
    return DENTAL_CATEGORIES.filter((c) => used.has(c.key));
  }, [services]);

  /** Fill blanks from the standard price, so a new list is priced in one gesture, not sixty. */
  const applyBulk = () => {
    const pct = Math.min(100, Math.max(0, Number(bulkPercent)));
    if (!Number.isFinite(pct)) return;
    const next = { ...drafts };
    for (const s of filtered) {
      const base = Number(s.price) || 0;
      next[s.id] = String(money(base * (1 - pct / 100)));
    }
    setDrafts(next);
  };

  const clearAll = () => {
    const next = { ...drafts };
    for (const s of filtered) next[s.id] = "";
    setDrafts(next);
  };

  const handleBack = async () => {
    if (changed.length > 0) {
      const ok = await confirm(txt.leaveBody, { title: txt.leaveTitle, confirmLabel: txt.leaveConfirm, tone: "danger" });
      if (!ok) return;
    }
    onBack();
  };

  const save = async () => {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      const clinicId = getGlobalClinicId();
      for (let i = 0; i < changed.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        for (const id of changed.slice(i, i + BATCH_LIMIT)) {
          const ref = doc(db, `clinics/${clinicId}/services`, id);
          const raw = (drafts[id] ?? "").trim();
          if (isStandard) {
            // The standard list IS the `price` field — that is why adding lists needed no migration.
            batch.update(ref, { price: raw === "" ? 0 : money(Math.max(0, Number(raw))) });
          } else if (raw === "") {
            // Removed, not zeroed. An absent entry falls back to the standard price; a stored 0
            // would mean the treatment is genuinely free on this list.
            batch.update(ref, { [`prices.${list.id}`]: deleteField() });
          } else {
            batch.update(ref, { [`prices.${list.id}`]: money(Math.max(0, Number(raw))) });
          }
        }
        await batch.commit();
      }
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Price Lists Updated",
        `Repriced ${changed.length} treatment${changed.length === 1 ? "" : "s"} on "${list.name}"`
      );
      setDrafts({});
      showToast(txt.saved, "success");
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" dir={ar ? "rtl" : "ltr"}>
      {/* --- header --- */}
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm">
        <button
          type="button"
          onClick={handleBack}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-ink-muted transition hover:text-slate-800"
        >
          <ArrowLeft size={14} className={isRTL ? "rotate-180" : ""} /> {txt.back}
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-serif text-2xl font-bold tracking-tight text-ink">
              {ar && list.nameAr ? list.nameAr : list.name}
            </h3>
            <p className="mt-1 max-w-prose text-xs font-medium text-ink-muted">{txt.sub}</p>
            {list.generalDiscountPercent > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                <Percent size={11} /> {txt.blanketNote(list.generalDiscountPercent)}
              </p>
            )}
            {isStandard && (
              <p className="mt-2 text-[11px] font-bold text-ink-muted">{txt.standardWarning}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {changed.length > 0 && (
              <button
                type="button"
                onClick={() => setDrafts({})}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-xs font-bold text-ink-body transition hover:bg-surface-subtle disabled:opacity-50"
              >
                <RotateCcw size={14} /> {txt.discard}
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || changed.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent shadow-md transition hover:bg-accent-strong disabled:opacity-40"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {changed.length > 0 ? txt.saveCount(changed.length) : txt.noChanges}
            </button>
          </div>
        </div>
      </div>

      {/* --- quick fill --- */}
      {!isStandard && (
        <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm">
          <h4 className="flex items-center gap-2 text-sm font-black text-slate-800">
            <Wand2 size={15} className="text-primary-600" /> {txt.bulkTitle}
          </h4>
          <p className="mt-1 max-w-prose text-xs font-medium text-ink-muted">{txt.bulkBody}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="relative">
              <input
                type="number"
                min={0}
                max={100}
                value={bulkPercent}
                onChange={(e) => setBulkPercent(e.target.value)}
                placeholder="10"
                disabled={saving}
                className="w-24 rounded-xl border border-line bg-slate-50/50 py-2 pl-3 pr-7 text-sm font-bold tabular-nums text-slate-700 outline-none focus:border-primary-500 focus:bg-surface disabled:opacity-50"
              />
              <Percent size={12} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "left-2.5" : "right-2.5"}`} />
            </span>
            <button
              type="button"
              onClick={applyBulk}
              disabled={saving || bulkPercent === ""}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-primary-700 disabled:opacity-40"
            >
              {txt.bulkApply}
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={saving}
              className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-ink-body transition hover:bg-surface-subtle disabled:opacity-50"
            >
              {txt.bulkClear}
            </button>
          </div>
        </div>
      )}

      {/* --- the list itself --- */}
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm">
        <div className="relative">
          <Search size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={txt.search}
            className={`w-full rounded-2xl border border-slate-200/60 bg-surface-subtle py-3 text-sm font-semibold text-ink outline-none transition-all focus:border-primary-500 focus:bg-surface ${isRTL ? "pr-12 pl-4" : "pl-12 pr-4"}`}
          />
        </div>

        <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all ${
              categoryFilter === "all" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {txt.all} · {services.length}
          </button>
          {usedCategories.map((c) => (
            <button
              type="button"
              key={c.key}
              onClick={() => setCategoryFilter(categoryFilter === c.key ? "all" : c.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                categoryFilter === c.key ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <DentalIcon id={c.icon} size={15} mono={categoryFilter === c.key} />
              {ar ? c.ar : c.en}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="mt-4 rounded-3xl border border-dashed border-line bg-surface-subtle py-16 text-center text-base font-bold text-slate-400">
            {txt.none}
          </div>
        ) : (
          <div className="mt-5 space-y-7">
            {grouped.map(({ category, items }) => (
              <section key={category.key}>
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <DentalIcon id={category.icon} size={16} />
                  </span>
                  <h4 className="text-sm font-black tracking-tight text-slate-800">{ar ? category.ar : category.en}</h4>
                  <span className="text-xs font-bold text-slate-400">{items.length}</span>
                  <div className="h-px flex-1 bg-surface-muted" />
                </div>

                {/* Column headings, shown once per group so the numbers never lose their labels. */}
                <div className="hidden px-3 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400 sm:grid sm:grid-cols-[1fr_7rem_9rem_7rem] sm:gap-3">
                  <span>{txt.treatment}</span>
                  <span className="text-end">{txt.standard}</span>
                  <span className="text-end">{txt.onThisList}</span>
                  <span className="text-end">{list.generalDiscountPercent > 0 ? txt.patientPays : ""}</span>
                </div>

                <ul className="space-y-1.5">
                  {items.map((s) => {
                    const base = Number(s.price) || 0;
                    const raw = valueFor(s.id).trim();
                    const effective = raw === "" ? base : Math.max(0, Number(raw) || 0);
                    const afterBlanket = money(effective * (1 - list.generalDiscountPercent / 100));
                    const isDirty = (drafts[s.id] ?? stored[s.id] ?? "") !== (stored[s.id] ?? "");

                    return (
                      <li
                        key={s.id}
                        className={`grid grid-cols-1 items-center gap-2 rounded-2xl border px-3 py-2.5 transition-colors sm:grid-cols-[1fr_7rem_9rem_7rem] sm:gap-3 ${
                          isDirty ? "border-primary-300 bg-primary-50/40" : "border-slate-200/60 bg-slate-50/50"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/70 bg-surface text-ink-muted">
                            <DentalIcon id={iconForService(s)} size={18} />
                          </span>
                          <span className="truncate text-sm font-bold text-slate-800">{s.name}</span>
                        </div>

                        <span className="text-end font-serif text-sm font-semibold tabular-nums text-slate-400">
                          {base.toLocaleString()}
                        </span>

                        <span className="relative">
                          <input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            value={valueFor(s.id)}
                            disabled={saving}
                            onChange={(e) => setDrafts({ ...drafts, [s.id]: e.target.value })}
                            placeholder={isStandard ? "0" : `${base} · ${txt.sameAsStandard}`}
                            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-end font-serif text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-primary-500 disabled:opacity-60"
                          />
                        </span>

                        <span className="text-end font-serif text-sm font-bold tabular-nums text-slate-700">
                          {list.generalDiscountPercent > 0 ? (
                            <>
                              {afterBlanket.toLocaleString()}{" "}
                              <span className="text-[10px] font-bold uppercase text-slate-400">{currency}</span>
                            </>
                          ) : (
                            ""
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Sticky save bar — the list is long, and the Save button must never be a scroll away. */}
      {changed.length > 0 && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-slate-300">{txt.saveCount(changed.length)}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrafts({})}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-xs font-bold text-slate-400 transition hover:text-white disabled:opacity-50"
            >
              <X size={14} />
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-surface px-5 py-2 text-sm font-bold text-ink transition hover:bg-surface-muted disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {txt.save}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
