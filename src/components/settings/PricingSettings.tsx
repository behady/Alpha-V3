"use client";

import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { useSettingsText } from "@/lib/useSettingsText";
import { useClinic } from "@/context/ClinicContext";
import { useState, useMemo } from "react";
import { Search, Plus, Edit2, Trash2, X, Save, Clock, FlaskConical, AlertTriangle } from "lucide-react";
import { updateDoc, addDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { matchesTokenizedSubstring } from "@/lib/flexibleSearch";
import { DEFAULT_PRICING_MODE, isPricingMode, type PricingMode } from "@/components/clinical-notes/utils";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { STANDARD_LIST_ID, type PriceList } from "@/lib/priceLists";
import {
  DENTAL_CATEGORIES,
  DENTAL_ICONS,
  DentalIcon,
  categoryOf,
  iconForService,
  suggestCategory,
  suggestIcon,
} from "@/lib/dentalIcons";

export interface ServiceRow {
  id: string;
  name: string;
  price: number;
  category?: string;
  icon?: string;
  requiresLab?: boolean;
  estimatedLabFee?: number;
  durationMinutes?: number | null;
  /** Whether the price multiplies by the teeth treated. Absent = never set, treated as per tooth. */
  pricingMode?: PricingMode;
  /** Per-list overrides, keyed by list id. Absent entry = charge `price`. */
  prices?: Record<string, number>;
}

/**
 * The price list, organised the way a clinic thinks about it: by category.
 *
 * Every service belongs to a category (crowns, veneers, implants…) and carries an
 * icon from the dental icon library. Both are saved on the service document, so
 * every picker in the system — clinical notes, booking, the Android app — can
 * group and illustrate services the same way. Category and icon are suggested
 * automatically from the name as it is typed ("Zircon Crown" finds the zircon
 * icon by itself) and stay overridable.
 */
export default function PricingSettings({
  currency,
  services,
  priceLists,
}: {
  currency: string;
  services: ServiceRow[];
  priceLists: PriceList[];
}) {
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();

  const [serviceSearch, setServiceSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    price: "",
    category: "other",
    icon: "tooth",
    requiresLab: false,
    estimatedLabFee: "",
    durationMinutes: "",
    pricingMode: DEFAULT_PRICING_MODE as PricingMode,
  });
  /**
   * Per-list prices, keyed by list id. Blank means "charge the standard price" rather than zero —
   * a clinic only fills these in for the treatments it actually charges differently, so an empty
   * field has to mean "same as standard" or every new list would price everything at nothing.
   */
  const [listPrices, setListPrices] = useState<Record<string, string>>({});
  // Once someone picks a category or icon by hand, typing in the name stops overriding it.
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [iconTouched, setIconTouched] = useState(false);

  const ar = language === "ar";

  const txt = {
    ...useSettingsText("pricing"),
    billingModes: {
      per_tooth: ar ? "لكل سن" : "Per tooth",
      flat: ar ? "سعر ثابت" : "Flat fee",
      per_arch: ar ? "لكل فك" : "Per arch",
    } as Record<PricingMode,
    string>,
    billingHint: {
      per_tooth: ar
        ? "السعر يتضرب في عدد الأسنان المختارة. مناسب للحشو والتيجان والخلع."
        : "The price is multiplied by the number of teeth selected. Right for fillings, crowns, extractions.",
      flat: ar
        ? "سعر واحد مهما كان عدد الأسنان. مناسب للكشف والتنظيف والتبييض والفلورايد."
        : "One price no matter how many teeth. Right for consultation, cleaning, bleaching, fluoride.",
      per_arch: ar
        ? "السعر يتضرب في عدد الفكوك المختارة (واحد أو اتنين)."
        : "The price is multiplied by how many arches are selected (one or two).",
    } as Record<PricingMode,
    string>,
  };

  const openAdd = () => {
    setEditingService(null);
    setForm({ name: "", price: "", category: "other", icon: "tooth", requiresLab: false, estimatedLabFee: "", durationMinutes: "", pricingMode: DEFAULT_PRICING_MODE });
    loadListPrices(null);
    setCategoryTouched(false);
    setIconTouched(false);
    setIsModalOpen(true);
  };

  const openEdit = (s: ServiceRow) => {
    setEditingService(s);
    setForm({
      name: s.name,
      price: s.price.toString(),
      category: s.category || suggestCategory(s.name),
      icon: iconForService(s),
      requiresLab: s.requiresLab || false,
      estimatedLabFee: s.estimatedLabFee ? s.estimatedLabFee.toString() : "",
      durationMinutes: s.durationMinutes ? s.durationMinutes.toString() : "",
      pricingMode: isPricingMode(s.pricingMode) ? s.pricingMode : DEFAULT_PRICING_MODE,
    });
    loadListPrices(s);
    setCategoryTouched(true);
    setIconTouched(true);
    setIsModalOpen(true);
  };

  const handleNameChange = (name: string) => {
    setForm((f) => ({
      ...f,
      name,
      category: categoryTouched ? f.category : suggestCategory(name),
      icon: iconTouched ? f.icon : suggestIcon(name) || categoryOf(categoryTouched ? f.category : suggestCategory(name)).icon,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.price) return;

    const payload = {
      name: form.name,
      price: Number(form.price),
      category: form.category,
      icon: form.icon,
      requiresLab: form.requiresLab,
      estimatedLabFee: Number(form.estimatedLabFee) || 0,
      // Optional. Left null rather than defaulted, so slot suggestions can tell "this takes 60
      // minutes" from "nobody said how long this takes" instead of assuming one standard slot.
      durationMinutes: Number(form.durationMinutes) > 0 ? Number(form.durationMinutes) : null,
      // Written explicitly on every save, so "never set" and "deliberately per tooth" stay
      // distinguishable — that difference is what the review flag on the list below reads.
      pricingMode: form.pricingMode,
      // Only lists with a number typed against them are stored. An absent entry falls back to
      // `price`, which is what makes the standard list the one that needs no configuration.
      prices: Object.fromEntries(
        Object.entries(listPrices)
          .filter(([, v]) => v !== "" && Number.isFinite(Number(v)))
          .map(([listId, v]) => [listId, Number(v)])
      ),
    };

    try {
      if (editingService) {
        await updateDoc(getClinicDoc("services", editingService.id), payload);
        showToast(ar ? "تم تحديث العلاج" : "Treatment updated", "success");
      } else {
        await addDoc(getClinicCollection("services"), { ...payload, createdAt: new Date().toISOString() });
        showToast(ar ? "تمت إضافة العلاج" : "Treatment added", "success");
      }
      setIsModalOpen(false);
    } catch {
      showToast(ar ? "فشل حفظ العلاج" : "Failed to save treatment", "error");
    }
  };

  /** Load a service's per-list prices into the form, blank where it charges the standard price. */
  const loadListPrices = (service: ServiceRow | null) => {
    const stored = service?.prices || {};
    setListPrices(
      Object.fromEntries(
        priceLists
          .filter((l) => l.id !== STANDARD_LIST_ID)
          .map((l) => [l.id, typeof stored[l.id] === "number" ? String(stored[l.id]) : ""])
      )
    );
  };

  const deleteService = async (id: string, name: string) => {
    if (await confirm(ar ? `حذف "${name}" من قائمة الأسعار؟` : `Remove "${name}" from the price list?`)) {
      try {
        await deleteRecord(clinicId || "", "services", id);
        showToast(ar ? "تم نقل العلاج إلى المحذوفات" : "Treatment moved to Recently Deleted", "info");
      } catch (err) {
        showToast(err instanceof RecycleBinError ? err.message : ar ? "تعذر الحذف" : "Could not delete", "error");
      }
    }
  };

  const filtered = services.filter(
    (s) =>
      matchesTokenizedSubstring(s.name, serviceSearch) &&
      (categoryFilter === "all" || (s.category || suggestCategory(s.name)) === categoryFilter)
  );

  // Group in the canonical category order, so the page always reads the same way.
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

  // Only categories that actually contain services become filter chips.
  const usedCategories = useMemo(() => {
    const used = new Set(services.map((s) => s.category || suggestCategory(s.name)));
    return DENTAL_CATEGORIES.filter((c) => used.has(c.key));
  }, [services]);

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Search first, because a clinic with fifty treatments looks for one rather than reads
          the list. Add sits beside it instead of above a fold. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={19} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-4" : "left-4"}`} />
          <input
            value={serviceSearch}
            onChange={(e) => setServiceSearch(e.target.value)}
            placeholder={txt.searchTreatments}
            className={`w-full py-3.5 bg-surface-subtle rounded-2xl border border-line font-semibold text-ink text-sm outline-none focus:bg-surface focus:border-accent focus:ring-4 focus:ring-accent/10 transition-all ${isRTL ? "pr-12 pl-4" : "pl-12 pr-4"}`}
          />
        </div>
          <button
            data-tour="price-add-service" onClick={openAdd}
            className="bg-accent text-ink-on-accent px-6 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-accent-strong transition-all shadow-md shrink-0 active:scale-95"
          >
            <Plus size={18} /> {txt.addTreatment}
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              categoryFilter === "all" ? "bg-accent text-ink-on-accent shadow-sm" : "border border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
            }`}
          >
            {txt.all} · {services.length}
          </button>
          {usedCategories.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategoryFilter(categoryFilter === c.key ? "all" : c.key)}
              className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                categoryFilter === c.key ? "bg-accent text-ink-on-accent shadow-sm" : "border border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
              }`}
            >
              <DentalIcon id={c.icon} size={15} mono={categoryFilter === c.key} />
              {ar ? c.ar : c.en}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped services */}
      {grouped.length === 0 ? (
        <div className="py-16 text-center text-ink-muted font-bold text-base bg-surface-subtle rounded-3xl border border-dashed border-line">
          {txt.noTreatments}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, items }) => (
            <section key={category.key}>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="w-8 h-8 rounded-xl bg-accent-tint text-accent flex items-center justify-center">
                  <DentalIcon id={category.icon} size={18} />
                </span>
                <h3 className="text-sm font-black text-ink tracking-tight">
                  {ar ? category.ar : category.en}
                </h3>
                <span className="text-xs font-bold text-ink-muted">{items.length}</span>
                <div className="flex-1 h-px bg-surface-muted" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 bg-surface-subtle rounded-2xl flex items-center gap-3.5 border border-line hover:border-accent-soft hover:bg-surface hover:shadow-sm transition-all group"
                  >
                    <span className="w-11 h-11 shrink-0 rounded-xl bg-surface border border-line text-ink-body group-hover:border-accent-soft group-hover:text-accent flex items-center justify-center transition-colors">
                      <DentalIcon id={iconForService(s)} size={24} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-ink text-sm leading-snug truncate">{s.name}</p>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1">
                        <span className="font-figure text-sm font-bold text-ink">
                          {s.price} <span className="text-[10px] font-bold uppercase text-ink-muted">{currency}</span>
                        </span>
                        {Number(s.durationMinutes) > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ink-muted">
                            <Clock size={11} /> {s.durationMinutes} {txt.minutes}
                          </span>
                        )}
                        {s.requiresLab && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn">
                            <FlaskConical size={11} /> {s.estimatedLabFee} {currency}
                          </span>
                        )}
                        {/* Only worth showing when it is not the obvious default. */}
                        {isPricingMode(s.pricingMode) && s.pricingMode !== "per_tooth" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ink-muted bg-surface-muted px-1.5 py-0.5 rounded">
                            {txt.billingModes[s.pricingMode]}
                          </span>
                        )}
                        {!isPricingMode(s.pricingMode) && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold border border-warn/25 bg-warn-tint text-warn px-1.5 py-0.5 rounded">
                            <AlertTriangle size={10} /> {txt.ruleNotSet}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(s)}
                        className="p-2 text-ink-muted hover:bg-accent-tint hover:text-accent rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => deleteService(s.id, s.name)}
                        className="p-2 text-ink-muted hover:bg-danger-tint hover:text-danger rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Add / edit modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-surface rounded-[2rem] w-full max-w-lg shadow-2xl animate-in zoom-in-95 border border-line flex flex-col max-h-[92vh]">
            <div className="flex justify-between items-center px-7 pt-6 pb-4 border-b border-line">
              <h2 className="text-lg font-black text-ink tracking-tight">
                {editingService ? txt.editTreatment : txt.newTreatment}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-ink-muted bg-surface-subtle hover:bg-danger-tint hover:text-danger p-2 rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-7 py-5 space-y-5 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.name}</label>
                  <input
                    autoFocus
                    required
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder={ar ? "مثال: تاج زيركون" : "e.g. Zircon Crown"} data-tour="price-service-name"
                    className="w-full py-3 px-4 bg-surface-subtle rounded-xl border border-line font-semibold text-ink text-sm outline-none focus:bg-surface focus:border-accent transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                    {txt.price} ({currency})
                  </label>
                  <input
                    required
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="0"
                    className="w-full py-3 px-4 bg-surface-subtle rounded-xl border border-line font-semibold text-ink text-sm outline-none focus:bg-surface focus:border-accent transition-all"
                  />
                </div>
              </div>

              {/* Per-list prices. Blank means "charge the standard price", not zero — a clinic only
                  fills these in for the treatments it genuinely charges differently. */}
              {priceLists.filter((l) => l.active && l.id !== STANDARD_LIST_ID).length > 0 && (
                <div className="space-y-2 rounded-xl border border-line bg-surface-subtle p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                    {ar ? "أسعار القوائم الأخرى" : "Other price lists"}
                  </p>
                  <p className="text-[11px] font-medium text-ink-muted">
                    {ar ? "سيبها فاضية لو نفس السعر الأساسي." : "Leave blank to charge the standard price."}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {priceLists
                      .filter((l) => l.active && l.id !== STANDARD_LIST_ID)
                      .map((list) => (
                        <label key={list.id} className="space-y-1">
                          <span className="text-[11px] font-bold text-ink-muted">
                            {ar && list.nameAr ? list.nameAr : list.name}
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={listPrices[list.id] ?? ""}
                            onChange={(e) => setListPrices({ ...listPrices, [list.id]: e.target.value })}
                            placeholder={form.price || "0"}
                            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition-all focus:border-accent"
                          />
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.category}</label>
                <div className="flex flex-wrap gap-1.5">
                  {DENTAL_CATEGORIES.map((c) => (
                    <button
                      type="button"
                      key={c.key}
                      onClick={() => {
                        setCategoryTouched(true);
                        setForm((f) => ({ ...f, category: c.key, icon: iconTouched ? f.icon : c.icon }));
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                        form.category === c.key
                          ? "bg-accent text-ink-on-accent shadow-sm"
                          : "border border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
                      }`}
                    >
                      <DentalIcon id={c.icon} size={14} mono={form.category === c.key} />
                      {ar ? c.ar : c.en}
                    </button>
                  ))}
                </div>
              </div>

              {/* Icon picker */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                  {txt.icon}
                  {!iconTouched && form.name && suggestIcon(form.name) === form.icon && (
                    <span className={`text-accent lowercase font-bold ${ar ? "mr-2" : "ml-2"}`}>· {txt.suggested}</span>
                  )}
                </label>
                <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 p-3 bg-surface-subtle rounded-2xl border border-line max-h-44 overflow-y-auto custom-scrollbar">
                  {DENTAL_ICONS.map((icon) => (
                    <button
                      type="button"
                      key={icon.id}
                      title={ar ? icon.ar : icon.en}
                      onClick={() => {
                        setIconTouched(true);
                        setForm((f) => ({ ...f, icon: icon.id }));
                      }}
                      className={`aspect-square rounded-xl flex items-center justify-center transition-all ${
                        form.icon === icon.id
                          ? "bg-accent text-ink-on-accent shadow-md scale-105"
                          : "bg-surface text-ink-muted border border-line hover:border-accent-soft hover:text-accent"
                      }`}
                    >
                      <DentalIcon id={icon.id} size={22} mono={form.icon === icon.id} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.duration}</label>
                <div className="relative">
                  <Clock size={16} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-4" : "left-4"}`} />
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={form.durationMinutes}
                    onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                    placeholder="45"
                    className={`w-full py-3 bg-surface-subtle rounded-xl border border-line font-semibold text-ink text-sm outline-none focus:bg-surface focus:border-accent transition-all ${isRTL ? "pr-10 pl-4" : "pl-10 pr-4"}`}
                  />
                </div>
                <p className="text-[11px] font-medium text-ink-muted">{txt.durationHint}</p>
              </div>

              {/*
                The rule that stops a full-arch selection turning a 200 EGP check-up into 6,400.
                Sits next to the price because it is part of what the price means.
              */}
              <div className="space-y-1.5 pt-3 border-t border-line">
                <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{txt.billing}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["per_tooth", "flat", "per_arch"] as PricingMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setForm({ ...form, pricingMode: mode })}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                        form.pricingMode === mode
                          ? "border-accent bg-accent-tint text-accent shadow-sm"
                          : "border-line bg-surface-subtle text-ink-muted hover:border-line-strong"
                      }`}
                    >
                      {txt.billingModes[mode]}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] font-medium text-ink-muted">{txt.billingHint[form.pricingMode]}</p>
              </div>

              <div className="flex items-center gap-3 pt-3 border-t border-line">
                <input
                  type="checkbox"
                  checked={form.requiresLab}
                  onChange={(e) => setForm({ ...form, requiresLab: e.target.checked })}
                  className="w-5 h-5 rounded text-accent focus:ring-accent cursor-pointer"
                />
                <label className="text-sm font-bold text-ink-body">{txt.lab}</label>
              </div>

              {form.requiresLab && (
                <div className="space-y-1.5 animate-in slide-in-from-top-2">
                  <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                    {txt.labFee} ({currency})
                  </label>
                  <input
                    required
                    type="number"
                    value={form.estimatedLabFee}
                    onChange={(e) => setForm({ ...form, estimatedLabFee: e.target.value })}
                    placeholder="500"
                    className="w-full py-3 px-4 rounded-xl border border-warn/30 bg-warn-tint text-sm font-semibold text-ink outline-none focus:border-warn transition-all"
                  />
                </div>
              )}

              <button
                type="submit" data-tour="price-service-save"
                className="w-full bg-accent text-ink-on-accent py-3.5 rounded-xl font-bold text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Save size={16} /> {editingService ? txt.update : txt.save}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
