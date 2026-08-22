"use client";

/**
 * Managing the clinic's price lists, its discount reasons, and how far staff may discount.
 *
 * A list is a way of charging, not a discount coupon: it holds per-service prices AND a blanket
 * percentage that gets PREFILLED as a visible line discount whenever a service is picked from it.
 * The confirm dialog on that percentage spells out both halves of what it does, because "10% off
 * this list" could plausibly mean "reprice everything already recorded" and it does not.
 *
 * Two rules the UI enforces so the data can never contradict itself:
 *   - the default list cannot be deactivated (something has to price a new patient's treatment);
 *   - a list is deactivated rather than deleted once anything has been priced on it, because
 *     deleting it would leave recorded treatments pointing at a list nobody can look up.
 */

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, setDoc } from "firebase/firestore";
import { Check, Loader2, Plus, Star, Tag, Trash2, X, Percent } from "lucide-react";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { logActivity } from "@/lib/logger";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_DISCOUNT_REASONS,
  DISCOUNTS_DOC,
  PRICE_LISTS_DOC,
  parseDiscountSettings,
  parsePriceLists,
  type DiscountSettings,
  type PriceList,
} from "@/lib/priceLists";

/** A slug that is stable, readable in the database, and safe as a map key on a service. */
function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `list_${Date.now()}`;
}

export default function PriceListSettings({ currency }: { currency: string }) {
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();
  const ar = language === "ar";

  const [lists, setLists] = useState<PriceList[]>(() => parsePriceLists(null));
  const [settings, setSettings] = useState<DiscountSettings>(() => parseDiscountSettings(null));
  const [usedListIds, setUsedListIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newReason, setNewReason] = useState("");

  useEffect(() => {
    const unsubLists = onSnapshot(getClinicDoc("settings", PRICE_LISTS_DOC), (snap) => {
      setLists(parsePriceLists(snap.exists() ? snap.data() : null));
    });
    const unsubDiscounts = onSnapshot(getClinicDoc("settings", DISCOUNTS_DOC), (snap) => {
      setSettings(parseDiscountSettings(snap.exists() ? snap.data() : null));
    });
    // Which lists actually carry a price. A list nothing is priced on can be deleted outright;
    // one that does must only ever be deactivated, or recorded treatments would point at a list
    // nobody can look up.
    const unsubServices = onSnapshot(getClinicCollection("services"), (snap) => {
      const used = new Set<string>();
      for (const doc of snap.docs) {
        const prices = doc.data()?.prices;
        if (prices && typeof prices === "object") {
          for (const key of Object.keys(prices)) used.add(key);
        }
      }
      setUsedListIds(used);
    });
    return () => {
      unsubLists();
      unsubDiscounts();
      unsubServices();
    };
  }, []);

  const txt = {
    title: ar ? "قوائم الأسعار" : "Price lists",
    subtitle: ar
      ? "طرق مختلفة لتسعير نفس العلاج — تأمين، عرض، سعر عائلة. الخصم العام بيتحط تلقائي وبيفضل ظاهر."
      : "Different ways of charging for the same treatment. A list's blanket discount is prefilled on each line and stays visible.",
    addList: ar ? "قائمة جديدة" : "New list",
    listName: ar ? "اسم القائمة" : "List name",
    blanket: ar ? "خصم عام" : "Blanket discount",
    makeDefault: ar ? "اجعلها الافتراضية" : "Make default",
    isDefault: ar ? "الافتراضية" : "Default",
    active: ar ? "شغالة" : "Active",
    inactive: ar ? "موقوفة" : "Inactive",
    deactivate: ar ? "أوقف" : "Deactivate",
    activate: ar ? "شغّل" : "Activate",
    remove: ar ? "احذف" : "Delete",
    cannotDeactivateDefault: ar
      ? "مينفعش توقف القائمة الافتراضية. خلي قائمة تانية افتراضية الأول."
      : "The default list cannot be deactivated. Make another list the default first.",
    inUse: ar
      ? "فيه خدمات مسعّرة على القائمة دي، فمينفعش تتحذف. أوقفها بدل الحذف."
      : "Services are priced on this list, so it cannot be deleted. Deactivate it instead.",
    confirmBlanketTitle: ar ? "تغيير الخصم العام" : "Change the blanket discount",
    confirmBlanket: (name: string, pct: number) =>
      ar
        ? `أي خدمة تتاخد من "${name}" من دلوقتي هتيجي وعليها خصم ${pct}% ظاهر وقابل للتعديل. العلاج المسجل قبل كده مش هيتغير.`
        : `Services picked from "${name}" will arrive with a visible, editable ${pct}% discount from now on. Treatments already recorded are not changed.`,
    confirmDeleteTitle: ar ? "حذف القائمة" : "Delete price list",
    confirmDelete: (name: string) =>
      ar ? `تحذف قائمة "${name}" نهائياً؟` : `Permanently delete the price list "${name}"?`,
    reasonsTitle: ar ? "أسباب الخصم" : "Discount reasons",
    reasonsSub: ar
      ? "لازم سبب مع أي خصم — عشان آخر الشهر تعرف الفلوس راحت فين، مش بس إنها راحت."
      : "A reason is required with every discount, so at month end you can see where the money went, not just that it went.",
    addReason: ar ? "سبب جديد" : "New reason",
    capTitle: ar ? "حد الخصم لغير المديرين" : "Discount ceiling for non-Admins",
    capSub: ar
      ? "أعلى نسبة يقدر أي حد غير المدير يخصمها. المدير مالوش حد."
      : "The most anyone who is not an Admin can take off. Admins have no ceiling.",
    noCap: ar ? "بدون حد" : "No ceiling",
    saved: ar ? "اتحفظ" : "Saved",
    failed: ar ? "فشل الحفظ" : "Could not save",
  };

  const activeCount = useMemo(() => lists.filter((l) => l.active).length, [lists]);

  const persistLists = async (next: PriceList[], action: string) => {
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", PRICE_LISTS_DOC), { lists: next }, { merge: true });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Price Lists Updated",
        action
      );
      showToast(txt.saved, "success");
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const persistSettings = async (next: DiscountSettings, action: string) => {
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", DISCOUNTS_DOC), next, { merge: true });
      await logActivity({ uid: user?.uid, name: user?.name, role: user?.role }, "Discount Policy Updated", action);
      showToast(txt.saved, "success");
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const addList = async () => {
    const name = newListName.trim();
    if (!name) return;
    const id = slugify(name);
    if (lists.some((l) => l.id === id)) {
      showToast(ar ? "فيه قائمة بنفس الاسم" : "A list with that name already exists", "error");
      return;
    }
    setNewListName("");
    await persistLists(
      [...lists, { id, name, generalDiscountPercent: 0, active: true, isDefault: false }],
      `Added price list "${name}"`
    );
  };

  const setBlanket = async (list: PriceList, percent: number) => {
    const pct = Math.min(100, Math.max(0, percent));
    if (pct === list.generalDiscountPercent) return;
    const ok = await confirm(txt.confirmBlanket(list.name, pct), {
      title: txt.confirmBlanketTitle,
      confirmLabel: ar ? "غيّر" : "Change",
    });
    if (!ok) return;
    await persistLists(
      lists.map((l) => (l.id === list.id ? { ...l, generalDiscountPercent: pct } : l)),
      `Set "${list.name}" blanket discount to ${pct}%`
    );
  };

  const makeDefault = async (list: PriceList) => {
    await persistLists(
      lists.map((l) => ({ ...l, isDefault: l.id === list.id })),
      `Made "${list.name}" the default price list`
    );
  };

  const toggleActive = async (list: PriceList) => {
    if (list.active && list.isDefault) {
      showToast(txt.cannotDeactivateDefault, "error");
      return;
    }
    if (list.active && activeCount <= 1) {
      showToast(txt.cannotDeactivateDefault, "error");
      return;
    }
    await persistLists(
      lists.map((l) => (l.id === list.id ? { ...l, active: !l.active } : l)),
      `${list.active ? "Deactivated" : "Activated"} price list "${list.name}"`
    );
  };

  const removeList = async (list: PriceList) => {
    if (usedListIds.has(list.id)) {
      showToast(txt.inUse, "error");
      return;
    }
    if (list.isDefault) {
      showToast(txt.cannotDeactivateDefault, "error");
      return;
    }
    const ok = await confirm(txt.confirmDelete(list.name), {
      title: txt.confirmDeleteTitle,
      confirmLabel: txt.remove,
      tone: "danger",
    });
    if (!ok) return;
    await persistLists(lists.filter((l) => l.id !== list.id), `Deleted price list "${list.name}"`);
  };

  const addReason = async () => {
    const reason = newReason.trim();
    if (!reason || settings.reasons.includes(reason)) return;
    setNewReason("");
    await persistSettings({ ...settings, reasons: [...settings.reasons, reason] }, `Added discount reason "${reason}"`);
  };

  const removeReason = async (reason: string) => {
    if (settings.reasons.length <= 1) {
      showToast(ar ? "لازم يفضل سبب واحد على الأقل" : "At least one reason has to remain", "error");
      return;
    }
    await persistSettings(
      { ...settings, reasons: settings.reasons.filter((r) => r !== reason) },
      `Removed discount reason "${reason}"`
    );
  };

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* --- lists --- */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-black text-slate-800">
              <Tag size={16} className="text-primary-600" />
              {txt.title}
            </h3>
            <p className="mt-1 max-w-prose text-xs font-medium text-slate-500">{txt.subtitle}</p>
          </div>
          {saving && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </header>

        <ul className="space-y-2">
          {lists.map((list) => (
            <li
              key={list.id}
              className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
                list.active ? "border-slate-200 bg-slate-50/60" : "border-slate-200 bg-slate-100/60 opacity-70"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-black text-slate-800">
                  {ar && list.nameAr ? list.nameAr : list.name}
                  {list.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-black text-primary-700">
                      <Star size={9} /> {txt.isDefault}
                    </span>
                  )}
                  {!list.active && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">
                      {txt.inactive}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-slate-400">{currency}</p>
              </div>

              <label className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{txt.blanket}</span>
                <span className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={list.generalDiscountPercent}
                    disabled={saving}
                    onBlur={(e) => setBlanket(list, Number(e.target.value))}
                    className="w-20 rounded-xl border border-slate-200 bg-white py-1.5 pl-2 pr-6 text-sm font-bold tabular-nums text-slate-700 outline-none focus:border-primary-500 disabled:opacity-60"
                  />
                  <Percent size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                </span>
              </label>

              <div className="flex items-center gap-1">
                {!list.isDefault && list.active && (
                  <button
                    type="button"
                    onClick={() => makeDefault(list)}
                    disabled={saving}
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-white hover:text-primary-700 disabled:opacity-50"
                  >
                    {txt.makeDefault}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleActive(list)}
                  disabled={saving}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:opacity-50"
                >
                  {list.active ? txt.deactivate : txt.activate}
                </button>
                <button
                  type="button"
                  onClick={() => removeList(list)}
                  disabled={saving || usedListIds.has(list.id) || list.isDefault}
                  title={usedListIds.has(list.id) ? txt.inUse : undefined}
                  aria-label={txt.remove}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex gap-2">
          <input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addList()}
            placeholder={txt.listName}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-primary-500 focus:bg-white disabled:opacity-60"
          />
          <button
            type="button"
            onClick={addList}
            disabled={saving || !newListName.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            <Plus size={15} /> {txt.addList}
          </button>
        </div>
      </section>

      {/* --- reasons + ceiling --- */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-4">
          <h3 className="text-base font-black text-slate-800">{txt.reasonsTitle}</h3>
          <p className="mt-1 max-w-prose text-xs font-medium text-slate-500">{txt.reasonsSub}</p>
        </header>

        <div className="flex flex-wrap gap-2">
          {settings.reasons.map((reason) => (
            <span
              key={reason}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1.5 text-xs font-bold text-slate-700"
            >
              {reason}
              <button
                type="button"
                onClick={() => removeReason(reason)}
                disabled={saving}
                aria-label={`${txt.remove} ${reason}`}
                className="rounded-full p-0.5 text-slate-400 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addReason()}
            placeholder={txt.addReason}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-primary-500 focus:bg-white disabled:opacity-60"
          />
          <button
            type="button"
            onClick={addReason}
            disabled={saving || !newReason.trim()}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Check size={15} />
          </button>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <h4 className="text-sm font-black text-slate-800">{txt.capTitle}</h4>
          <p className="mt-1 max-w-prose text-xs font-medium text-slate-500">{txt.capSub}</p>
          <div className="mt-3 flex items-center gap-3">
            <span className="relative">
              <input
                type="number"
                min={0}
                max={100}
                disabled={saving || settings.maxDiscountPercentNonAdmin === null}
                defaultValue={settings.maxDiscountPercentNonAdmin ?? 20}
                key={String(settings.maxDiscountPercentNonAdmin)}
                onBlur={(e) =>
                  persistSettings(
                    { ...settings, maxDiscountPercentNonAdmin: Math.min(100, Math.max(0, Number(e.target.value))) },
                    `Set the non-Admin discount ceiling to ${e.target.value}%`
                  )
                }
                className="w-24 rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-3 pr-7 text-sm font-bold tabular-nums text-slate-700 outline-none focus:border-primary-500 focus:bg-white disabled:opacity-50"
              />
              <Percent size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                checked={settings.maxDiscountPercentNonAdmin === null}
                disabled={saving}
                onChange={(e) =>
                  persistSettings(
                    {
                      ...settings,
                      maxDiscountPercentNonAdmin: e.target.checked ? null : 20,
                    },
                    e.target.checked ? "Removed the non-Admin discount ceiling" : "Restored the non-Admin discount ceiling"
                  )
                }
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              {txt.noCap}
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Exported so a caller can offer the standard set when a clinic has cleared its own. */
export { DEFAULT_DISCOUNT_REASONS };
