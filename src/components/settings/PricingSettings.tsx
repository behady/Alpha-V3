"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Edit2, Trash2, X, Save, Clock, FlaskConical } from "lucide-react";
import { onSnapshot, query, orderBy, deleteDoc, updateDoc, addDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { matchesTokenizedSubstring } from "@/lib/flexibleSearch";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import {
  DENTAL_CATEGORIES,
  DENTAL_ICONS,
  DentalIcon,
  categoryLabel,
  categoryOf,
  iconForService,
  suggestCategory,
  suggestIcon,
} from "@/lib/dentalIcons";

interface ServiceRow {
  id: string;
  name: string;
  price: number;
  category?: string;
  icon?: string;
  requiresLab?: boolean;
  estimatedLabFee?: number;
  durationMinutes?: number | null;
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
export default function PricingSettings({ currency }: { currency: string }) {
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();

  const [services, setServices] = useState<ServiceRow[]>([]);
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
  });
  // Once someone picks a category or icon by hand, typing in the name stops overriding it.
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [iconTouched, setIconTouched] = useState(false);

  const ar = language === "ar";
  const txt = {
    title: ar ? "الخدمات والأسعار" : "Services & Prices",
    subtitle: ar
      ? "كل خدمة لها فئة وأيقونة تظهران في كل مكان تُختار فيه."
      : "Each service has a category and an icon, shown everywhere services are picked.",
    searchTreatments: ar ? "البحث في العلاجات..." : "Search treatments...",
    addTreatment: ar ? "إضافة علاج" : "Add treatment",
    noTreatments: ar ? "لم يتم العثور على علاجات" : "No treatments found",
    all: ar ? "الكل" : "All",
    name: ar ? "اسم العلاج" : "Treatment name",
    price: ar ? "السعر" : "Price",
    category: ar ? "الفئة" : "Category",
    icon: ar ? "الأيقونة" : "Icon",
    suggested: ar ? "مقترحة" : "suggested",
    duration: ar ? "المدة المعتادة (دقائق) — اختياري" : "Typical duration (minutes) — optional",
    durationHint: ar
      ? "تُسجل للجدولة. اتركها فارغة إذا كانت تختلف."
      : "Recorded for scheduling. Leave blank if it varies.",
    lab: ar ? "يحتاج معمل خارجي" : "Needs external lab work",
    labFee: ar ? "رسوم المعمل التقديرية" : "Estimated lab fee",
    newTreatment: ar ? "علاج جديد" : "New treatment",
    editTreatment: ar ? "تعديل العلاج" : "Edit treatment",
    save: ar ? "حفظ" : "Save",
    update: ar ? "تحديث" : "Update",
    minutes: ar ? "د" : "min",
  };

  useEffect(() => {
    const q = query(getClinicCollection("services"), orderBy("name"));
    const unsub = onSnapshot(q, (s) =>
      setServices(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ServiceRow, "id">) })))
    );
    return () => unsub();
  }, []);

  const openAdd = () => {
    setEditingService(null);
    setForm({ name: "", price: "", category: "other", icon: "tooth", requiresLab: false, estimatedLabFee: "", durationMinutes: "" });
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
    });
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

  const deleteService = async (id: string, name: string) => {
    if (await confirm(ar ? `حذف "${name}" من قائمة الأسعار؟` : `Remove "${name}" from the price list?`)) {
      await deleteDoc(getClinicDoc("services", id));
      showToast(ar ? "تم حذف العلاج" : "Treatment removed", "info");
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
    <div className="space-y-6 animate-in fade-in max-w-6xl mx-auto bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200/50">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-black text-slate-900 tracking-tight">{txt.title}</h2>
            <p className="text-sm font-medium text-slate-500 mt-0.5">{txt.subtitle}</p>
          </div>
          <button
            onClick={openAdd}
            className="bg-slate-900 text-white px-6 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-md shrink-0 active:scale-95"
          >
            <Plus size={18} /> {txt.addTreatment}
          </button>
        </div>

        <div className="relative">
          <Search size={19} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`} />
          <input
            value={serviceSearch}
            onChange={(e) => setServiceSearch(e.target.value)}
            placeholder={txt.searchTreatments}
            className={`w-full py-3.5 bg-slate-50 rounded-2xl border border-slate-200/60 font-semibold text-slate-900 text-sm outline-none focus:bg-white focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all ${isRTL ? "pr-12 pl-4" : "pl-12 pr-4"}`}
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              categoryFilter === "all" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {txt.all} · {services.length}
          </button>
          {usedCategories.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategoryFilter(categoryFilter === c.key ? "all" : c.key)}
              className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                categoryFilter === c.key ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <DentalIcon id={c.icon} size={15} />
              {ar ? c.ar : c.en}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped services */}
      {grouped.length === 0 ? (
        <div className="py-16 text-center text-slate-400 font-bold text-base bg-slate-50 rounded-3xl border border-dashed border-slate-200">
          {txt.noTreatments}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, items }) => (
            <section key={category.key}>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="w-8 h-8 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center">
                  <DentalIcon id={category.icon} size={18} />
                </span>
                <h3 className="text-sm font-black text-slate-800 tracking-tight">
                  {ar ? category.ar : category.en}
                </h3>
                <span className="text-xs font-bold text-slate-400">{items.length}</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 bg-slate-50/70 rounded-2xl flex items-center gap-3.5 border border-slate-200/60 hover:border-primary-300 hover:bg-white hover:shadow-sm transition-all group"
                  >
                    <span className="w-11 h-11 shrink-0 rounded-xl bg-white border border-slate-200/70 text-slate-600 group-hover:text-primary-600 group-hover:border-primary-200 flex items-center justify-center transition-colors">
                      <DentalIcon id={iconForService(s)} size={24} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm leading-snug truncate">{s.name}</p>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1">
                        <span className="text-sm font-black text-primary-600">
                          {s.price} <span className="text-[10px] font-bold text-slate-400 uppercase">{currency}</span>
                        </span>
                        {Number(s.durationMinutes) > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400">
                            <Clock size={11} /> {s.durationMinutes} {txt.minutes}
                          </span>
                        )}
                        {s.requiresLab && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-500">
                            <FlaskConical size={11} /> {s.estimatedLabFee} {currency}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(s)}
                        className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => deleteService(s.id, s.name)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl animate-in zoom-in-95 border border-slate-100 flex flex-col max-h-[92vh]">
            <div className="flex justify-between items-center px-7 pt-6 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-black text-slate-900 tracking-tight">
                {editingService ? txt.editTreatment : txt.newTreatment}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-7 py-5 space-y-5 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.name}</label>
                  <input
                    autoFocus
                    required
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder={ar ? "مثال: تاج زيركون" : "e.g. Zircon Crown"}
                    className="w-full py-3 px-4 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 text-sm outline-none focus:bg-white focus:border-primary-500 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {txt.price} ({currency})
                  </label>
                  <input
                    required
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="0"
                    className="w-full py-3 px-4 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 text-sm outline-none focus:bg-white focus:border-primary-500 transition-all"
                  />
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.category}</label>
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
                          ? "bg-slate-900 text-white shadow-sm"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      <DentalIcon id={c.icon} size={14} />
                      {ar ? c.ar : c.en}
                    </button>
                  ))}
                </div>
              </div>

              {/* Icon picker */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  {txt.icon}
                  {!iconTouched && form.name && suggestIcon(form.name) === form.icon && (
                    <span className={`text-primary-500 lowercase font-bold ${ar ? "mr-2" : "ml-2"}`}>· {txt.suggested}</span>
                  )}
                </label>
                <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 p-3 bg-slate-50 rounded-2xl border border-slate-200/60 max-h-44 overflow-y-auto custom-scrollbar">
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
                          ? "bg-slate-900 text-white shadow-md scale-105"
                          : "bg-white text-slate-500 border border-slate-200/70 hover:border-primary-300 hover:text-primary-600"
                      }`}
                    >
                      <DentalIcon id={icon.id} size={22} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{txt.duration}</label>
                <div className="relative">
                  <Clock size={16} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`} />
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={form.durationMinutes}
                    onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                    placeholder="45"
                    className={`w-full py-3 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 text-sm outline-none focus:bg-white focus:border-primary-500 transition-all ${isRTL ? "pr-10 pl-4" : "pl-10 pr-4"}`}
                  />
                </div>
                <p className="text-[11px] font-medium text-slate-400">{txt.durationHint}</p>
              </div>

              <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                <input
                  type="checkbox"
                  checked={form.requiresLab}
                  onChange={(e) => setForm({ ...form, requiresLab: e.target.checked })}
                  className="w-5 h-5 rounded text-primary-600 focus:ring-primary-500 cursor-pointer"
                />
                <label className="text-sm font-bold text-slate-700">{txt.lab}</label>
              </div>

              {form.requiresLab && (
                <div className="space-y-1.5 animate-in slide-in-from-top-2">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {txt.labFee} ({currency})
                  </label>
                  <input
                    required
                    type="number"
                    value={form.estimatedLabFee}
                    onChange={(e) => setForm({ ...form, estimatedLabFee: e.target.value })}
                    placeholder="500"
                    className="w-full py-3 px-4 bg-orange-50 rounded-xl border border-orange-200 font-semibold text-orange-900 text-sm outline-none focus:border-orange-500 transition-all"
                  />
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-2"
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
