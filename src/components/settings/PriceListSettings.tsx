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
import { onSnapshot, setDoc, writeBatch, doc, getDocs } from "firebase/firestore";
import { Check, Loader2, Plus, Star, Tag, Trash2, X, Percent, Copy, SlidersHorizontal, Building2, Layers } from "lucide-react";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc, getGlobalClinicId } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { logActivity } from "@/lib/logger";
import { useAuth } from "@/context/AuthContext";
import PriceListWorkspace from "@/components/settings/PriceListWorkspace";
import { LOCATIONS_DOC, parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";
import {
  DEFAULT_DISCOUNT_REASONS,
  DISCOUNTS_DOC,
  PRICE_LISTS_DOC,
  STANDARD_LIST_ID,
  parseDiscountSettings,
  parsePriceLists,
  toStoredLists,
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
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();
  const ar = language === "ar";

  const [lists, setLists] = useState<PriceList[]>(() => parsePriceLists(null));
  const [settings, setSettings] = useState<DiscountSettings>(() => parseDiscountSettings(null));
  const [usedListIds, setUsedListIds] = useState<Set<string>>(new Set());
  /** listId → how many treatments carry a price of their own on it. */
  const [pricedCounts, setPricedCounts] = useState<Record<string, number>>({});
  const [serviceCount, setServiceCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newReason, setNewReason] = useState("");
  /** Which list is open for pricing. null = the lists overview. */
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  /** "" = start fresh; otherwise the id of the list whose prices are copied. */
  const [copyFrom, setCopyFrom] = useState("");
  const [newBlanket, setNewBlanket] = useState("0");
  /** "" = clinic-wide, offered at every branch. Otherwise the branch the new list belongs to. */
  const [newBranchId, setNewBranchId] = useState("");
  const [branches, setBranches] = useState<ClinicBranch[]>([]);

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
    const unsubBranches = onSnapshot(getClinicDoc("settings", LOCATIONS_DOC), (snap) => {
      setBranches(parseClinicBranches(snap.exists() ? snap.data() : null));
    });
    const unsubServices = onSnapshot(getClinicCollection("services"), (snap) => {
      const used = new Set<string>();
      const counts: Record<string, number> = {};
      for (const doc of snap.docs) {
        const prices = doc.data()?.prices;
        if (prices && typeof prices === "object") {
          for (const key of Object.keys(prices)) {
            used.add(key);
            counts[key] = (counts[key] || 0) + 1;
          }
        }
      }
      setUsedListIds(used);
      setPricedCounts(counts);
      setServiceCount(snap.size);
    });
    return () => {
      unsubLists();
      unsubDiscounts();
      unsubServices();
      unsubBranches();
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
    editPrices: ar ? "الأسعار" : "Prices",
    newListTitle: ar ? "قائمة أسعار جديدة" : "New price list",
    startFrom: ar ? "تبدأ منين؟" : "Start from",
    fresh: ar ? "من الأول" : "Start fresh",
    freshHint: ar
      ? "كل العلاجات هتتحاسب بالسعر الأساسي لحد ما تغيّرها."
      : "Every treatment charges the standard price until you change it.",
    copyOf: (name: string) => (ar ? `نسخة من "${name}"` : `Copy of "${name}"`),
    copyHint: ar
      ? "بينسخ كل أسعار القائمة دي، وبعدين تعدّل اللي عايزه."
      : "Copies that list's prices across, then you edit what differs.",
    create: ar ? "إنشاء" : "Create list",
    listNamePlaceholder: ar ? "مثلاً: تأمين مصر" : "e.g. Misr Insurance",
    priced: (n: number) => (ar ? `${n} علاج مسعّر` : `${n} priced`),
    pricedNone: ar ? "بالسعر الأساسي" : "all at standard price",
    clinicWide: ar ? "كل الفروع" : "All branches",
    branchInherits: ar
      ? "الفرع ده بيحاسب بأسعار العيادة العامة. اعمل له قائمة لو أسعاره مختلفة."
      : "This branch charges the clinic-wide prices. Give it a list of its own if it charges differently.",
    orphaned: ar ? "فروع محذوفة" : "Lists on a deleted branch",
    branchLabel: ar ? "الفرع" : "Branch",
    branchAll: ar ? "كل الفروع" : "All branches (clinic-wide)",
    branchHint: ar
      ? "القائمة دي هتظهر بس في الفرع ده. سيبها على كل الفروع لو الأسعار واحدة."
      : "The list is only offered at that branch. Leave it clinic-wide if every branch charges it.",
  };

  const clinicWideActiveCount = useMemo(
    () => lists.filter((l) => l.active && !l.branchId).length,
    [lists]
  );
  const branchName = (id?: string | null) =>
    branches.find((b) => b.id === id)?.name || (ar ? "فرع محذوف" : "Deleted branch");

  /**
   * The lists grouped the way the screen reads them: everything clinic-wide first, then one
   * section per branch. A branch with no lists of its own still gets a section, because "this
   * branch charges the clinic's prices" is an answer worth seeing rather than an empty space.
   */
  const grouped = useMemo(() => {
    const clinicWide = lists.filter((l) => !l.branchId);
    const byBranch = branches.map((b) => ({ branch: b, items: lists.filter((l) => l.branchId === b.id) }));
    // Lists pointing at a branch that has since been deleted would otherwise vanish from the
    // screen while still being charged. Surface them so they can be moved or removed.
    const knownIds = new Set(branches.map((b) => b.id));
    const orphaned = lists.filter((l) => l.branchId && !knownIds.has(l.branchId));
    return { clinicWide, byBranch, orphaned };
  }, [lists, branches]);

  const persistLists = async (next: PriceList[], action: string) => {
    setSaving(true);
    try {
      // `toStoredLists` and not the raw array: a list with no Arabic name carries `nameAr:
      // undefined`, which Firestore refuses outright, and the refusal surfaced here as nothing
      // but "Could not save". See the note in parsePriceLists.
      await setDoc(getClinicDoc("settings", PRICE_LISTS_DOC), { lists: toStoredLists(next) }, { merge: true });
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

  /**
   * Copy every per-service price from one list onto another.
   *
   * A new list almost never starts from nothing — it starts as "the standard list, but cheaper",
   * or as last year's insurer rates with a few lines moved. Copying is what makes that the work of
   * one dialog instead of one dialog per treatment.
   *
   * Copying FROM the standard list reads `price`, because `price` IS the standard list's price;
   * copying from any other reads its entry in `prices` and falls back to `price` where it has
   * none, so the copy reflects what that list actually charges rather than only its overrides.
   */
  const copyPricesTo = async (targetId: string, sourceId: string) => {
    const snap = await getDocs(getClinicCollection("services"));
    const clinicId = getGlobalClinicId();

    const updates: Array<{ id: string; value: number }> = [];
    for (const d of snap.docs) {
      const data = d.data() as { price?: number; prices?: Record<string, number> };
      const base = Number(data.price) || 0;
      const value = Number(sourceId === STANDARD_LIST_ID ? base : (data.prices?.[sourceId] ?? base)) || 0;
      // An override identical to the standard price is worth nothing: an absent entry already
      // charges exactly that, and every stored row is one more number to keep in step later.
      // Copying FROM the standard list therefore writes nothing at all, which is correct — the
      // new list already charges the standard price everywhere.
      if (value !== base) updates.push({ id: d.id, value });
    }

    for (let i = 0; i < updates.length; i += 400) {
      const batch = writeBatch(db);
      for (const u of updates.slice(i, i + 400)) {
        batch.update(doc(db, `clinics/${clinicId}/services`, u.id), { [`prices.${targetId}`]: u.value });
      }
      await batch.commit();
    }
    return updates.length;
  };

  const addList = async () => {
    const name = newListName.trim();
    if (!name) return;
    const id = slugify(name);
    if (lists.some((l) => l.id === id)) {
      showToast(ar ? "فيه قائمة بنفس الاسم" : "A list with that name already exists", "error");
      return;
    }
    const blanket = Math.min(100, Math.max(0, Number(newBlanket) || 0));
    const source = copyFrom ? lists.find((l) => l.id === copyFrom) : null;

    setSaving(true);
    try {
      // The list row is written first. If the price copy fails half way, the clinic is left with a
      // real list carrying some of its prices, which they can finish by hand — rather than a pile
      // of orphaned prices on a list that does not exist.
      await setDoc(
        getClinicDoc("settings", PRICE_LISTS_DOC),
        {
          lists: toStoredLists([
            ...lists,
            {
              id,
              name,
              generalDiscountPercent: blanket,
              active: true,
              // A branch's FIRST list becomes that branch's default, because a branch that has
              // one list and no default would keep quietly charging clinic-wide prices and the
              // list would look broken. Clinic-wide lists never auto-promote: the clinic already
              // has a default, and stealing it is not what "add a list" means.
              isDefault: !!newBranchId && !lists.some((l) => l.branchId === newBranchId && l.active),
              ...(newBranchId ? { branchId: newBranchId } : {}),
            },
          ]),
        },
        { merge: true }
      );
      let copied = 0;
      if (source) copied = await copyPricesTo(id, source.id);
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Price Lists Updated",
        source
          ? `Added price list "${name}"${newBranchId ? ` for ${branchName(newBranchId)}` : ""} by copying ${copied} price${copied === 1 ? "" : "s"} from "${source.name}"`
          : `Added price list "${name}"${newBranchId ? ` for ${branchName(newBranchId)}` : ""}`
      );
      showToast(txt.saved, "success");
      setNewListName("");
      setCopyFrom("");
      setNewBlanket("0");
      setNewBranchId("");
      setIsNewOpen(false);
      // Straight into pricing it — that is the next thing anyone wants, and the reason the old
      // flow felt unfinished was that creating a list left you looking at the list of lists.
      setOpenListId(id);
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
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
    // Only within its own scope. Making the downtown insurance list the default there must not
    // clear the default at the seaside branch, or at the clinic — each scope answers "which price
    // when nobody chose one?" for itself.
    const scope = list.branchId ?? "";
    await persistLists(
      lists.map((l) => ((l.branchId ?? "") === scope ? { ...l, isDefault: l.id === list.id } : l)),
      list.branchId
        ? `Made "${list.name}" the default price list for ${branchName(list.branchId)}`
        : `Made "${list.name}" the clinic-wide default price list`
    );
  };

  const toggleActive = async (list: PriceList) => {
    if (list.active && list.isDefault) {
      showToast(txt.cannotDeactivateDefault, "error");
      return;
    }
    // The last active list in a scope may only go if the scope still has somewhere to fall back
    // to. A branch can lose its last list — it inherits the clinic-wide one. The clinic cannot.
    const isClinicWide = !list.branchId;
    if (list.active && isClinicWide && clinicWideActiveCount <= 1) {
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

  /** One row. Shared by the clinic-wide section and every branch section. */
  const renderList = (list: PriceList) => (
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
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-400">
              {branches.length > 1 && (
                <span className="inline-flex items-center gap-1 rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                  {list.branchId ? <Building2 size={9} /> : <Layers size={9} />}
                  {list.branchId ? branchName(list.branchId) : txt.clinicWide}
                </span>
              )}
              {currency}
              {" · "}
              {list.id === STANDARD_LIST_ID
                ? txt.priced(serviceCount)
                : pricedCounts[list.id]
                  ? txt.priced(pricedCounts[list.id])
                  : txt.pricedNone}
            </p>
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
            {/* The way in. Pricing a list used to be reachable only from inside each
                treatment's own edit dialog, which is why nobody could find it. */}
            <button
              type="button"
              onClick={() => setOpenListId(list.id)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              <SlidersHorizontal size={12} /> {txt.editPrices}
            </button>
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
  );

  // Pricing a list takes the whole screen. It is a table of every treatment the clinic offers, and
  // squeezing that into a panel under the lists is what made it unusable in the first place.
  const openList = openListId ? lists.find((l) => l.id === openListId) : null;
  if (openList) {
    return <PriceListWorkspace list={openList} currency={currency} onBack={() => setOpenListId(null)} />;
  }

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

        {/* Clinic-wide first: the lists every branch may charge. */}
        {grouped.clinicWide.length > 0 && (
          <section>
            {branches.length > 1 && (
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">
                <Layers size={12} /> {txt.clinicWide}
              </h4>
            )}
            <ul className="space-y-2">{grouped.clinicWide.map(renderList)}</ul>
          </section>
        )}

        {/* Then one section per branch. A branch with no lists of its own is shown saying so,
            rather than left out — "this branch charges the clinic's prices" is the answer. */}
        {branches.length > 1 &&
          grouped.byBranch.map(({ branch, items }) => (
            <section key={branch.id} className="mt-5">
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">
                <Building2 size={12} className="text-primary-600" /> {branch.name}
              </h4>
              {items.length > 0 ? (
                <ul className="space-y-2">{items.map(renderList)}</ul>
              ) : (
                <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-3 text-[11px] font-bold text-slate-400">
                  {txt.branchInherits}
                </p>
              )}
            </section>
          ))}

        {grouped.orphaned.length > 0 && (
          <section className="mt-5">
            <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-amber-600">
              <Building2 size={12} /> {txt.orphaned}
            </h4>
            <ul className="space-y-2">{grouped.orphaned.map(renderList)}</ul>
          </section>
        )}

        <button
          type="button"
          onClick={() => setIsNewOpen(true)}
          disabled={saving}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-600 transition hover:border-primary-400 hover:bg-white hover:text-primary-700 disabled:opacity-50"
        >
          <Plus size={15} /> {txt.addList}
        </button>
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

      {/* --- new list --- */}
      {isNewOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 pb-4 pt-5">
              <h3 className="text-lg font-black tracking-tight text-slate-900">{txt.newListTitle}</h3>
              <button
                type="button"
                onClick={() => setIsNewOpen(false)}
                className="rounded-full bg-slate-50 p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
              >
                <X size={17} />
              </button>
            </div>

            <div className="custom-scrollbar space-y-5 overflow-y-auto px-6 py-5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{txt.listName}</label>
                <input
                  autoFocus
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder={txt.listNamePlaceholder}
                  disabled={saving}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-primary-500 focus:bg-white disabled:opacity-60"
                />
              </div>

              {/* Fresh, or a copy. A clinic's second list is almost always "the standard one, but
                  cheaper" — offering that as the starting point is the difference between one
                  dialog and one per treatment. */}
              {branches.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{txt.branchLabel}</label>
                  <select
                    value={newBranchId}
                    onChange={(e) => setNewBranchId(e.target.value)}
                    disabled={saving}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-primary-500 focus:bg-white disabled:opacity-60"
                  >
                    <option value="">{txt.branchAll}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <p className="text-[11px] font-medium text-slate-400">{txt.branchHint}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{txt.startFrom}</label>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setCopyFrom("")}
                    className={`w-full rounded-xl border px-4 py-3 text-start transition-all ${
                      copyFrom === "" ? "border-primary-500 bg-primary-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <Plus size={14} /> {txt.fresh}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium text-slate-500">{txt.freshHint}</span>
                  </button>

                  {lists.map((l) => (
                    <button
                      type="button"
                      key={l.id}
                      onClick={() => setCopyFrom(l.id)}
                      className={`w-full rounded-xl border px-4 py-3 text-start transition-all ${
                        copyFrom === l.id ? "border-primary-500 bg-primary-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <Copy size={14} /> {txt.copyOf(ar && l.nameAr ? l.nameAr : l.name)}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-slate-500">{txt.copyHint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{txt.blanket}</label>
                <span className="relative block">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newBlanket}
                    onChange={(e) => setNewBlanket(e.target.value)}
                    disabled={saving}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-4 pr-9 text-sm font-bold tabular-nums text-slate-900 outline-none transition-all focus:border-primary-500 focus:bg-white disabled:opacity-60"
                  />
                  <Percent size={13} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "left-3.5" : "right-3.5"}`} />
                </span>
                <p className="text-[11px] font-medium text-slate-400">{txt.subtitle}</p>
              </div>
            </div>

            <div className="border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={addList}
                disabled={saving || !newListName.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3.5 text-sm font-bold text-white shadow-md transition-all active:scale-95 disabled:opacity-40"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {txt.create}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Exported so a caller can offer the standard set when a clinic has cleared its own. */
export { DEFAULT_DISCOUNT_REASONS };
