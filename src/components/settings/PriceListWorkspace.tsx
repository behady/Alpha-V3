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
  Eye,
  EyeOff,
  Loader2,
  Percent,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { onSnapshot, writeBatch, deleteField, doc, addDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { getGlobalClinicId } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { logActivity } from "@/lib/logger";
import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { matchesTokenizedSubstring } from "@/lib/flexibleSearch";
import { PRICE_LISTS_DOC, STANDARD_LIST_ID, toStoredLists, type PriceList } from "@/lib/priceLists";
import { payerCoverageFilter } from "@/lib/payers";
import { ownedByAnotherList } from "@/lib/serviceMenu";
import { usePricingPolicy } from "@/lib/usePricingPolicy";
import { DEFAULT_PRICING_MODE, type PricingMode } from "@/components/clinical-notes/utils";
import {
  DENTAL_CATEGORIES,
  DentalIcon,
  categoryOf,
  iconForService,
  suggestCategory,
  suggestIcon,
} from "@/lib/dentalIcons";

type ServiceRow = {
  id: string;
  name: string;
  price: number;
  category?: string;
  icon?: string;
  prices?: Record<string, number>;
  /** The list this treatment belongs to. Absent = shared, offered on every list. */
  listId?: string;
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
  const { clinicId } = useClinic();
  const { payers, priceLists } = usePricingPolicy();
  const ar = language === "ar";

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  /** serviceId → what is typed in the cell. "" means "charge the standard price". */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [bulkPercent, setBulkPercent] = useState("");
  /** The "add a treatment to this list" dialog. null = closed. */
  const [newOwn, setNewOwn] = useState<{ name: string; price: string; category: string; pricingMode: PricingMode } | null>(null);
  const [ownBusy, setOwnBusy] = useState(false);

  const isStandard = list.id === STANDARD_LIST_ID;
  /**
   * A treatment created ON this list. It has no standard price to fall back to, so its one
   * price lives in the base `price` field — exactly where the Standard list keeps its own —
   * and the cell here reads and writes that field directly.
   */
  const isOwn = (s: ServiceRow) => !!s.listId && s.listId === list.id;
  const hiddenIds = useMemo(() => new Set(list.hiddenServiceIds ?? []), [list.hiddenServiceIds]);

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
      if (isStandard || isOwn(s)) {
        out[s.id] = Number.isFinite(Number(s.price)) ? String(s.price ?? "") : "";
      } else {
        const v = s.prices?.[list.id];
        out[s.id] = typeof v === "number" ? String(v) : "";
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, list.id, isStandard]);

  const valueFor = (id: string) => (id in drafts ? drafts[id] : (stored[id] ?? ""));

  /** One extra narrow column on every list but Standard: the hide / delete control. */
  const cols = isStandard ? "sm:grid-cols-[1fr_7rem_9rem_7rem]" : "sm:grid-cols-[1fr_7rem_9rem_7rem_2.75rem]";

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

    // Named so it reads as an answer rather than a warning: the treatments are missing on purpose,
    // and the sentence says where to put them back.
    hidden: (n: number) =>
      ar
        ? `${n} علاج مش مغطى من الشركة دي، فمش ظاهر هنا. لو بتغطيهم، فعّلهم من الإعدادات ← التأمين.`
        : `${n} treatment${n === 1 ? " is" : "s are"} not covered by this company, so ${n === 1 ? "it is" : "they are"} not shown. To cover ${n === 1 ? "it" : "them"}, tick ${n === 1 ? "it" : "them"} under Settings → Insurance.`,

    hiddenToast: (name: string) => (ar ? `"${name}" اتخفى من القائمة دي` : `"${name}" hidden on this list`),
    shownToast: (name: string) => (ar ? `"${name}" رجع يظهر على القائمة دي` : `"${name}" shown on this list again`),
    deleteOwnBody: (name: string) =>
      ar
        ? `"${name}" موجود على القائمة دي بس. هيتنقل للمحذوفات ومش هيظهر في أي شاشة.`
        : `"${name}" exists on this list only. It moves to Recently Deleted and leaves every menu.`,
    createdOwn: (name: string) => (ar ? `"${name}" اتضاف على القائمة دي بس` : `"${name}" added to this list only`),

    blanketNote: (pct: number) =>
      ar
        ? `كل خدمة من القائمة دي بتيجي وعليها خصم ${pct}% ظاهر وقابل للتعديل، فوق السعر ده.`
        : `Services picked from this list arrive with a visible, editable ${pct}% discount on top of this price.`,

  };

  /**
   * The treatments this insurer actually covers, and only those.
   *
   * Coverage is ticked once, against the insurer, and this screen has to agree with it. A list
   * that still showed a price box for a treatment the insurer does not pay for would be inviting
   * somebody to set a price that can never be charged — and the treatment is missing from the
   * receptionist's menu anyway, so the number would go nowhere.
   *
   * Everything downstream reads this rather than `services`: the search, the category chips, and
   * the bulk fill, which would otherwise write prices onto rows nobody can see.
   */
  const covered = useMemo(() => {
    const covers = payerCoverageFilter(payers, list.id);
    // Another list's own treatments are not this list's business at all — they are neither
    // priced here nor counted as "not covered". This list's own need no coverage tick.
    return services.filter((s) => !ownedByAnotherList(s, list.id) && (isOwn(s) || covers(s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, payers, list.id]);
  const hiddenCount = services.filter((s) => !ownedByAnotherList(s, list.id)).length - covered.length;

  const filtered = useMemo(
    () =>
      covered.filter(
        (s) =>
          matchesTokenizedSubstring(s.name, search) &&
          (categoryFilter === "all" || (s.category || suggestCategory(s.name)) === categoryFilter)
      ),
    [covered, search, categoryFilter]
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
    const used = new Set(covered.map((s) => s.category || suggestCategory(s.name)));
    return DENTAL_CATEGORIES.filter((c) => used.has(c.key));
  }, [covered]);

  /** Fill blanks from the standard price, so a new list is priced in one gesture, not sixty. */
  const applyBulk = () => {
    const pct = Math.min(100, Math.max(0, Number(bulkPercent)));
    if (!Number.isFinite(pct)) return;
    const next = { ...drafts };
    for (const s of filtered) {
      // A hidden row is not on this list's menu, and an own row HAS no standard price to
      // discount from — the fill would write nonsense onto both.
      if (hiddenIds.has(s.id) || isOwn(s)) continue;
      const base = Number(s.price) || 0;
      next[s.id] = String(money(base * (1 - pct / 100)));
    }
    setDrafts(next);
  };

  const clearAll = () => {
    const next = { ...drafts };
    for (const s of filtered) if (!hiddenIds.has(s.id) && !isOwn(s)) next[s.id] = "";
    setDrafts(next);
  };

  /**
   * Hide or show a shared treatment on this list. Written at once, not on Save: it is one
   * decision about one row, and leaving it as a draft next to sixty price cells would make
   * "3 changes" mean two different kinds of thing.
   */
  const toggleHidden = async (s: ServiceRow) => {
    const hide = !hiddenIds.has(s.id);
    const nextIds = hide ? [...hiddenIds, s.id] : [...hiddenIds].filter((id) => id !== s.id);
    const nextLists = priceLists.map((l) => (l.id === list.id ? { ...l, hiddenServiceIds: nextIds } : l));
    try {
      await setDoc(getClinicDoc("settings", PRICE_LISTS_DOC), { lists: toStoredLists(nextLists) }, { merge: true });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Price Lists Updated",
        `${hide ? "Hid" : "Showed"} "${s.name}" on "${list.name}"`
      );
      showToast(hide ? txt.hiddenToast(s.name) : txt.shownToast(s.name), "success");
    } catch {
      showToast(txt.failed, "error");
    }
  };

  /** A treatment created on this list is deleted the way any treatment is: into the recycle bin. */
  const deleteOwn = async (s: ServiceRow) => {
    const ok = await confirm(txt.deleteOwnBody(s.name), { title: txt.deleteOwnTitle, confirmLabel: txt.deleteOwnConfirm, tone: "danger" });
    if (!ok) return;
    try {
      await deleteRecord(clinicId || "", "services", s.id);
      setDrafts((d) => {
        const next = { ...d };
        delete next[s.id];
        return next;
      });
      showToast(txt.deletedOwn, "info");
    } catch (err) {
      showToast(err instanceof RecycleBinError ? err.message : txt.failed, "error");
    }
  };

  const openNewOwn = () => setNewOwn({ name: "", price: "", category: "", pricingMode: DEFAULT_PRICING_MODE });

  /**
   * Create a treatment that exists on this list alone.
   *
   * The same record shape the Treatments page writes, so every picker, the reports and the
   * phone read it like any other — plus `listId`, which is the whole difference. Category and
   * icon are suggested from the name exactly as the Treatments page does, and stay editable
   * there afterwards.
   */
  const createOwn = async () => {
    if (!newOwn) return;
    const name = newOwn.name.trim();
    const price = Number(newOwn.price);
    if (!name || !Number.isFinite(price) || price < 0) return;
    const category = newOwn.category || suggestCategory(name);
    setOwnBusy(true);
    try {
      await addDoc(getClinicCollection("services"), {
        name,
        price: money(price),
        category,
        icon: suggestIcon(name) || categoryOf(category).icon,
        requiresLab: false,
        estimatedLabFee: 0,
        durationMinutes: null,
        pricingMode: newOwn.pricingMode,
        prices: {},
        listId: list.id,
        createdAt: new Date().toISOString(),
      });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Price Lists Updated",
        `Added "${name}" to "${list.name}" only`
      );
      showToast(txt.createdOwn(name), "success");
      setNewOwn(null);
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setOwnBusy(false);
    }
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
          const own = services.some((s) => s.id === id && isOwn(s));
          if (isStandard || own) {
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
    <div className="w-full space-y-6 pb-4" dir={ar ? "rtl" : "ltr"}>
      {/* The same slab the Prices screen opens with: which list you are pricing, what its
          blanket discount will do to every number below, and the way back. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <button
          type="button"
          onClick={handleBack}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-white/55 transition hover:text-white"
        >
          <ArrowLeft size={14} className={isRTL ? "rotate-180" : ""} /> {txt.back}
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-2xl font-bold tracking-tight text-white">
              {ar && list.nameAr ? list.nameAr : list.name}
            </h3>
            <p className="mt-1 max-w-prose text-xs font-medium text-white/55">{txt.sub}</p>
            {list.generalDiscountPercent > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-400/20 px-2.5 py-1 text-[11px] font-bold text-amber-200">
                <Percent size={11} /> {txt.blanketNote(list.generalDiscountPercent)}
              </p>
            )}
            {isStandard && (
              <p className="mt-2 text-[11px] font-bold text-white/55">{txt.standardWarning}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isStandard && (
              <button
                type="button"
                onClick={openNewOwn}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 px-3 py-2.5 text-xs font-bold text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <Plus size={14} /> {txt.addOwn}
              </button>
            )}
            {changed.length > 0 && (
              <button
                type="button"
                onClick={() => setDrafts({})}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 px-3 py-2.5 text-xs font-bold text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
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
        <div className="rounded-2xl border border-line bg-surface-subtle p-5">
          <h4 className="flex items-center gap-2 text-sm font-black text-ink">
            <Wand2 size={15} className="text-accent" /> {txt.bulkTitle}
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
                className="w-24 rounded-xl border border-line bg-surface-subtle py-2 pl-3 pr-7 text-sm font-bold tabular-nums text-ink-body outline-none focus:border-accent focus:bg-surface disabled:opacity-50"
              />
              <Percent size={12} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "left-2.5" : "right-2.5"}`} />
            </span>
            <button
              type="button"
              onClick={applyBulk}
              disabled={saving || bulkPercent === ""}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-40"
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
      <div>
        {hiddenCount > 0 && (
          <p className="mb-3 rounded-2xl border border-line bg-surface-subtle px-4 py-2.5 text-xs font-semibold text-ink-body">
            {txt.hidden(hiddenCount)}
          </p>
        )}
        <div className="relative">
          <Search size={18} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-4" : "left-4"}`} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={txt.search}
            className={`w-full rounded-2xl border border-line bg-surface-subtle py-3 text-sm font-semibold text-ink outline-none transition-all focus:border-accent focus:bg-surface ${isRTL ? "pr-12 pl-4" : "pl-12 pr-4"}`}
          />
        </div>

        <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all ${
              categoryFilter === "all" ? "bg-accent text-ink-on-accent shadow-sm" : "border border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
            }`}
          >
            {txt.all} · {covered.length}
          </button>
          {usedCategories.map((c) => (
            <button
              type="button"
              key={c.key}
              onClick={() => setCategoryFilter(categoryFilter === c.key ? "all" : c.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                categoryFilter === c.key ? "bg-accent text-ink-on-accent shadow-sm" : "border border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
              }`}
            >
              <DentalIcon id={c.icon} size={15} mono={categoryFilter === c.key} />
              {ar ? c.ar : c.en}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16 text-ink-muted">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="mt-4 rounded-3xl border border-dashed border-line bg-surface-subtle py-16 text-center text-base font-bold text-ink-muted">
            {txt.none}
          </div>
        ) : (
          <div className="mt-5 space-y-7">
            {grouped.map(({ category, items }) => (
              <section key={category.key}>
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-tint text-accent">
                    <DentalIcon id={category.icon} size={16} />
                  </span>
                  <h4 className="text-sm font-black tracking-tight text-ink">{ar ? category.ar : category.en}</h4>
                  <span className="text-xs font-bold text-ink-muted">{items.length}</span>
                  <div className="h-px flex-1 bg-surface-muted" />
                </div>

                {/* Column headings, shown once per group so the numbers never lose their labels. */}
                <div className={`hidden px-3 pb-1 text-[10px] font-black uppercase tracking-wider text-ink-muted sm:grid sm:gap-3 ${cols}`}>
                  <span>{txt.treatment}</span>
                  <span className="text-end">{txt.standard}</span>
                  <span className="text-end">{txt.onThisList}</span>
                  <span className="text-end">{list.generalDiscountPercent > 0 ? txt.patientPays : ""}</span>
                  {!isStandard && <span />}
                </div>

                <ul className="space-y-1.5">
                  {items.map((s) => {
                    const base = Number(s.price) || 0;
                    const raw = valueFor(s.id).trim();
                    const effective = raw === "" ? base : Math.max(0, Number(raw) || 0);
                    const afterBlanket = money(effective * (1 - list.generalDiscountPercent / 100));
                    const isDirty = (drafts[s.id] ?? stored[s.id] ?? "") !== (stored[s.id] ?? "");
                    const own = isOwn(s);
                    const isHidden = !own && hiddenIds.has(s.id);

                    return (
                      <li
                        key={s.id}
                        className={`grid grid-cols-1 items-center gap-2 rounded-2xl border px-3 py-2.5 transition-colors sm:gap-3 ${cols} ${
                          isDirty ? "border-accent-soft bg-accent-tint/60" : isHidden ? "border-dashed border-line bg-surface" : "border-line bg-surface-subtle"
                        } ${isHidden ? "opacity-60" : ""}`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted">
                            <DentalIcon id={iconForService(s)} size={18} />
                          </span>
                          <span className={`truncate text-sm font-bold ${isHidden ? "text-ink-muted line-through decoration-ink-muted/40" : "text-ink"}`}>
                            {s.name}
                          </span>
                          {own && (
                            <span className="shrink-0 rounded-md bg-ink-slab px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                              {txt.onlyHere}
                            </span>
                          )}
                          {isHidden && (
                            <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-ink-muted">
                              {txt.hiddenTag}
                            </span>
                          )}
                        </div>

                        <span className="text-end font-figure text-sm font-semibold text-ink-muted">
                          {own ? "—" : base.toLocaleString()}
                        </span>

                        <span className="relative">
                          <input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            value={valueFor(s.id)}
                            disabled={saving || isHidden}
                            onChange={(e) => setDrafts({ ...drafts, [s.id]: e.target.value })}
                            placeholder={isStandard || own ? "0" : `${base} · ${txt.sameAsStandard}`}
                            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-end font-figure text-sm font-semibold text-ink outline-none transition focus:border-accent disabled:opacity-60"
                          />
                        </span>

                        <span className="text-end font-figure text-sm font-bold text-ink-body">
                          {list.generalDiscountPercent > 0 && !isHidden ? (
                            <>
                              {afterBlanket.toLocaleString()}{" "}
                              <span className="text-[10px] font-bold uppercase text-ink-muted">{currency}</span>
                            </>
                          ) : (
                            ""
                          )}
                        </span>

                        {/* Hide a shared treatment from this list's menu, or delete one the list owns.
                            The Standard list is the full menu and has neither. */}
                        {!isStandard && (
                          <span className="flex justify-end">
                            {own ? (
                              <button
                                type="button"
                                onClick={() => deleteOwn(s)}
                                disabled={saving}
                                title={txt.deleteOwn}
                                aria-label={txt.deleteOwn}
                                className="rounded-lg p-2 text-ink-muted transition hover:bg-danger-tint hover:text-danger disabled:opacity-50"
                              >
                                <Trash2 size={15} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleHidden(s)}
                                disabled={saving}
                                title={isHidden ? txt.show : txt.hide}
                                aria-label={isHidden ? txt.show : txt.hide}
                                className="rounded-lg p-2 text-ink-muted transition hover:bg-surface-muted hover:text-ink disabled:opacity-50"
                              >
                                {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                            )}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* --- add a treatment that exists on this list alone --- */}
      {newOwn && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-6 pb-4 pt-5">
              <h3 className="text-lg font-black tracking-tight text-ink">{txt.addOwnTitle}</h3>
              <button
                type="button"
                onClick={() => setNewOwn(null)}
                className="rounded-full bg-surface-subtle p-2 text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
              >
                <X size={17} />
              </button>
            </div>

            <div className="custom-scrollbar space-y-5 overflow-y-auto px-6 py-5">
              <p className="text-xs font-medium text-ink-muted">{txt.addOwnBody}</p>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{txt.ownName}</label>
                <input
                  autoFocus
                  value={newOwn.name}
                  onChange={(e) => setNewOwn({ ...newOwn, name: e.target.value })}
                  placeholder={txt.ownNamePlaceholder}
                  disabled={ownBusy}
                  className="w-full rounded-xl border border-line bg-surface-subtle px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-accent focus:bg-surface disabled:opacity-60"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{txt.ownPrice}</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={newOwn.price}
                    onChange={(e) => setNewOwn({ ...newOwn, price: e.target.value })}
                    placeholder="0"
                    disabled={ownBusy}
                    className={`w-full rounded-xl border border-line bg-surface-subtle py-3 font-figure text-sm font-bold text-ink outline-none transition focus:border-accent focus:bg-surface disabled:opacity-60 ${isRTL ? "pl-14 pr-4" : "pl-4 pr-14"}`}
                  />
                  <span className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase text-ink-muted ${isRTL ? "left-4" : "right-4"}`}>{currency}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{txt.ownCategory}</label>
                <select
                  value={newOwn.category || suggestCategory(newOwn.name)}
                  onChange={(e) => setNewOwn({ ...newOwn, category: e.target.value })}
                  disabled={ownBusy}
                  className="w-full rounded-xl border border-line bg-surface-subtle px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-accent focus:bg-surface disabled:opacity-60"
                >
                  {DENTAL_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {ar ? c.ar : c.en}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{txt.ownBilling}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["per_tooth", "flat", "per_arch"] as PricingMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setNewOwn({ ...newOwn, pricingMode: mode })}
                      disabled={ownBusy}
                      className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition-all ${
                        newOwn.pricingMode === mode
                          ? "border-accent bg-accent-tint text-accent shadow-sm"
                          : "border-line bg-surface-subtle text-ink-muted hover:border-line-strong"
                      }`}
                    >
                      {txt[`mode_${mode}` as "mode_per_tooth" | "mode_flat" | "mode_per_arch"]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 border-t border-line px-6 py-4">
              <button
                type="button"
                onClick={() => setNewOwn(null)}
                disabled={ownBusy}
                className="flex-1 rounded-xl border border-line px-4 py-3 text-sm font-bold text-ink-body transition hover:bg-surface-subtle disabled:opacity-50"
              >
                {txt.cancel}
              </button>
              <button
                type="button"
                onClick={createOwn}
                disabled={ownBusy || !newOwn.name.trim() || newOwn.price.trim() === "" || !(Number(newOwn.price) >= 0)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-ink-on-accent shadow-md transition hover:bg-accent-strong disabled:opacity-40"
              >
                {ownBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {txt.ownCreate}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky save bar — the list is long, and the Save button must never be a scroll away. */}
      {changed.length > 0 && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.saveCount(changed.length)}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrafts({})}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-xs font-bold text-white/50 transition hover:text-white disabled:opacity-50"
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
