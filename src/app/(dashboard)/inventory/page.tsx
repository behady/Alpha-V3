"use client";

import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { useClinic } from "@/context/ClinicContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Edit2, Filter, Layers, Loader2, Package, Plus, RotateCcw, Save, Search, Trash2, TrendingDown, TrendingUp, Download, BookOpen, Send } from "lucide-react";
// Inventory used root-level `inventory` / `inventory_transactions` / `categories` collections,
// which no Firestore rule grants access to and which the rest of the app (and the assistant,
// which reads clinics/{clinicId}/inventory) never sees. Reads there resolve to an empty set
// rather than an error, so low-stock checks silently reported "nothing is low".
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { Timestamp, addDoc, deleteDoc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import PermissionGuard from "@/components/PermissionGuard";
import Protect from "@/components/Protect";
import { useUI } from "@/context/UIContext";
import { logActivity } from "@/lib/logger";
import { matchesTokenizedSubstring } from "@/lib/flexibleSearch";

const ROWS_PER_PAGE = 25;

interface Material {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  unit: string;
  isPercentage?: boolean;
}

interface Category {
  id: string;
  name: string;
  parentId?: string | null;
}

interface InventoryTxRow {
  id: string;
  itemId?: string;
  itemName: string;
  change: number;
  type: string;
  user: string;
  notes?: string;
  date: Date;
}

type StockStatusFilter = "all" | "low" | "ok";
type TrackingFilter = "all" | "qty" | "pct";
type SortKey = "name" | "stock" | "value" | "category";
type SortDir = "asc" | "desc";

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function lineValue(item: Material) {
  const qty = item.isPercentage ? toNumber(item.stock) / 100 : toNumber(item.stock);
  return qty * toNumber(item.costPerUnit);
}

/**
 * A reorder threshold of 0 means nobody ever set one — it is the field's old default, not a
 * deliberate "alert me only when this hits empty". Treating it as a real threshold made every
 * unconfigured item permanently "in stock", so a low-stock check reported all-clear over a
 * shelf nobody had configured. Items without a threshold are surfaced as their own count.
 */
function hasThreshold(item: Material): boolean {
  return toNumber(item.minStock) > 0;
}

function isLowStock(item: Material): boolean {
  return hasThreshold(item) && toNumber(item.stock) <= toNumber(item.minStock);
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function InventoryPage() {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { showToast, confirm } = useUI();
  const { clinicId, clinic, isAdmin } = useClinic();

  const canAddInventory = isAdmin || user?.permissions?.includes("inventory.add");
  const canEditInventory = isAdmin || user?.permissions?.includes("inventory.edit");
  const showInventoryForm = canAddInventory || canEditInventory;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [inventory, setInventory] = useState<Material[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [periodTransactions, setPeriodTransactions] = useState<InventoryTxRow[]>([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSubCategory, setSelectedSubCategory] = useState("All");
  const [stockStatusFilter, setStockStatusFilter] = useState<StockStatusFilter>("all");
  const [trackingFilter, setTrackingFilter] = useState<TrackingFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [page, setPage] = useState(1);
  const [editingItem, setEditingItem] = useState<Material | null>(null);

  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("General");
  const [formSubCategory, setFormSubCategory] = useState("");
  const [formStock, setFormStock] = useState("0");
  const [formMinStock, setFormMinStock] = useState("");
  const [formCost, setFormCost] = useState("0");
  const [formUnit, setFormUnit] = useState("pcs");
  const [formIsPercentage, setFormIsPercentage] = useState(false);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSubCategoryName, setNewSubCategoryName] = useState("");
  const [subCategoryParent, setSubCategoryParent] = useState("");

  const fetchPeriodTransactions = useCallback(async (): Promise<InventoryTxRow[]> => {
    const from = new Date(`${startDate}T00:00:00`);
    const to = new Date(`${endDate}T23:59:59.999`);
    const q = query(
      getClinicCollection("inventory_transactions"),
      where("date", ">=", Timestamp.fromDate(from)),
      where("date", "<=", Timestamp.fromDate(to)),
      orderBy("date", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const ts = data.date as Timestamp | undefined;
      return {
        id: d.id,
        itemId: typeof data.itemId === "string" ? data.itemId : undefined,
        itemName: String(data.itemName || ""),
        change: toNumber(data.change),
        type: String(data.type || ""),
        user: String(data.user || ""),
        notes: typeof data.notes === "string" ? data.notes : "",
        date: ts?.toDate?.() ?? new Date(),
      };
    });
  }, [startDate, endDate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [invSnap, catSnap] = await Promise.all([
        getDocs(query(getClinicCollection("inventory"), orderBy("name"))),
        getDocs(query(getClinicCollection("categories"), orderBy("name"))),
      ]);
      setInventory(
        invSnap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: String(data.name || ""),
            category: String(data.category || "General"),
            subCategory: data.subCategory ? String(data.subCategory) : "",
            stock: toNumber(data.stock),
            minStock: toNumber(data.minStock),
            costPerUnit: toNumber(data.costPerUnit),
            unit: String(data.unit || "pcs"),
            isPercentage: Boolean(data.isPercentage),
          };
        })
      );
      setCategories(
        catSnap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return { id: d.id, name: String(data.name || ""), parentId: (data.parentId as string | null | undefined) ?? null };
        })
      );
    } catch (error) {
      console.error(error);
      showToast(language === "ar" ? "تعذر تحميل البيانات" : "Failed to load inventory data", "error");
    } finally {
      setLoading(false);
    }
  }, [language, showToast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await fetchPeriodTransactions();
        if (active) setPeriodTransactions(rows);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchPeriodTransactions]);

  const categoryOptions = useMemo(() => ["All", ...Array.from(new Set(inventory.map((i) => i.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, language === "ar" ? "ar" : "en"))], [inventory, language]);

  const subCategoryOptions = useMemo(() => {
    const source = selectedCategory === "All" ? inventory : inventory.filter((i) => i.category === selectedCategory);
    return ["All", ...Array.from(new Set(source.map((i) => i.subCategory).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, language === "ar" ? "ar" : "en"))];
  }, [inventory, selectedCategory, language]);

  const filteredInventory = useMemo(() => {
    let rows = inventory;
    if (searchTerm.trim()) {
      rows = rows.filter((item) => matchesTokenizedSubstring([item.name, item.category, item.subCategory || "", item.unit].join(" "), searchTerm.trim()));
    }
    if (selectedCategory !== "All") rows = rows.filter((i) => i.category === selectedCategory);
    if (selectedSubCategory !== "All") rows = rows.filter((i) => i.subCategory === selectedSubCategory);
    if (stockStatusFilter === "low") rows = rows.filter(isLowStock);
    if (stockStatusFilter === "ok") rows = rows.filter((i) => hasThreshold(i) && !isLowStock(i));
    if (trackingFilter === "qty") rows = rows.filter((i) => !i.isPercentage);
    if (trackingFilter === "pct") rows = rows.filter((i) => i.isPercentage);

    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name, language === "ar" ? "ar" : "en");
      if (sortBy === "category") cmp = a.category.localeCompare(b.category, language === "ar" ? "ar" : "en");
      if (sortBy === "stock") cmp = toNumber(a.stock) - toNumber(b.stock);
      if (sortBy === "value") cmp = lineValue(a) - lineValue(b);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [inventory, searchTerm, selectedCategory, selectedSubCategory, stockStatusFilter, trackingFilter, sortBy, sortDir, language]);

  useEffect(() => setPage(1), [filteredInventory.length]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * ROWS_PER_PAGE;
    return filteredInventory.slice(start, start + ROWS_PER_PAGE);
  }, [filteredInventory, page]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredInventory.length / ROWS_PER_PAGE)), [filteredInventory.length]);

  const stockSummary = useMemo(() => ({
    totalItems: filteredInventory.length,
    lowStock: filteredInventory.filter(isLowStock).length,
    // Counted and shown separately: an item with no reorder threshold can never be "low", so
    // without this a shelf full of unconfigured items reads as a clean bill of health.
    noThreshold: filteredInventory.filter((i) => !hasThreshold(i)).length,
    totalValue: filteredInventory.reduce((sum, i) => sum + lineValue(i), 0),
  }), [filteredInventory]);

  const periodSummary = useMemo(() => {
    const allowedIds = new Set(filteredInventory.map((i) => i.id));
    const allowedNames = new Set(filteredInventory.map((i) => i.name));
    const txs = periodTransactions.filter((t) => (t.itemId && allowedIds.has(t.itemId)) || allowedNames.has(t.itemName));
    let boughtQty = 0;
    let consumedQty = 0;
    let boughtValue = 0;
    let consumedValue = 0;
    const priceById = new Map(filteredInventory.map((i) => [i.id, toNumber(i.costPerUnit)]));
    const priceByName = new Map(filteredInventory.map((i) => [i.name, toNumber(i.costPerUnit)]));
    for (const tx of txs) {
      const unitPrice = (tx.itemId ? priceById.get(tx.itemId) : undefined) ?? priceByName.get(tx.itemName) ?? 0;
      if (tx.change > 0) {
        boughtQty += tx.change;
        boughtValue += tx.change * unitPrice;
      } else if (tx.change < 0) {
        const qty = Math.abs(tx.change);
        consumedQty += qty;
        consumedValue += qty * unitPrice;
      }
    }
    return { txs, boughtQty, consumedQty, boughtValue, consumedValue, netValue: boughtValue - consumedValue };
  }, [filteredInventory, periodTransactions]);

  const resetFilters = () => {
    setSearchTerm("");
    setSelectedCategory("All");
    setSelectedSubCategory("All");
    setStockStatusFilter("all");
    setTrackingFilter("all");
    setSortBy("name");
    setSortDir("asc");
  };

  const resetForm = () => {
    setEditingItem(null);
    setFormName("");
    setFormCategory("General");
    setFormSubCategory("");
    setFormStock("0");
    setFormMinStock("0");
    setFormCost("0");
    setFormUnit("pcs");
    setFormIsPercentage(false);
  };

  const openForEdit = (item: Material) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormCategory(item.category || "General");
    setFormSubCategory(item.subCategory || "");
    setFormStock(String(item.stock));
    setFormMinStock(String(item.minStock));
    setFormCost(String(item.costPerUnit));
    setFormUnit(item.unit || "pcs");
    setFormIsPercentage(Boolean(item.isPercentage));
    
    document.getElementById('inventory-form')?.scrollIntoView({ behavior: 'smooth' });
  };

  const saveMaterial = async () => {
    if (!formName.trim()) {
      showToast(language === "ar" ? "اسم الصنف مطلوب" : "Item name is required", "error");
      return;
    }
    // Without a real threshold this item can never trigger a low-stock alert, and a silent 0
    // is indistinguishable from a deliberate one — so it has to be stated.
    if (!formMinStock.trim() || toNumber(formMinStock) <= 0) {
      showToast(
        language === "ar"
          ? "حدّ إعادة الطلب مطلوب (أكبر من صفر) حتى تعمل تنبيهات النقص"
          : "A reorder threshold above zero is required for low-stock alerts to work",
        "error"
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        category: formCategory.trim() || "General",
        subCategory: formSubCategory.trim() || "",
        stock: toNumber(formStock),
        minStock: toNumber(formMinStock),
        costPerUnit: toNumber(formCost),
        unit: formUnit.trim() || "pcs",
        isPercentage: formIsPercentage,
        updatedAt: serverTimestamp(),
      };
      if (editingItem) {
        await updateDoc(getClinicDoc("inventory", editingItem.id), payload);
      } else {
        await addDoc(getClinicCollection("inventory"), { ...payload, createdAt: serverTimestamp() });
      }
      await logActivity({ uid: user?.uid, name: user?.name, role: user?.role }, editingItem ? "Inventory item updated" : "Inventory item created", formName.trim());
      resetForm();
      await fetchData();
      showToast(language === "ar" ? "تم الحفظ بنجاح" : "Saved successfully", "success");
    } catch (error) {
      console.error(error);
      showToast(language === "ar" ? "تعذر الحفظ" : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAdjust = async (item: Material, delta: number) => {
    try {
      await updateDoc(getClinicDoc("inventory", item.id), { stock: Math.max(0, toNumber(item.stock) + delta), updatedAt: serverTimestamp() });
      await addDoc(getClinicCollection("inventory_transactions"), {
        itemId: item.id,
        itemName: item.name,
        change: delta,
        type: delta > 0 ? "add" : "use",
        user: user?.name || "System",
        notes: delta > 0 ? "Quick add" : "Quick consume",
        date: serverTimestamp(),
      });
      await fetchData();
    } catch (error) {
      console.error(error);
      showToast(language === "ar" ? "فشل تعديل المخزون" : "Failed to adjust stock", "error");
    }
  };

  const handleDelete = async (item: Material) => {
    const ok = await confirm(language === "ar" ? "هل تريد حذف هذا الصنف نهائيًا؟" : "Delete this item permanently?");
    if (!ok) return;
    try {
      await deleteRecord(clinicId || "", "inventory", item.id);
      showToast(language === "ar" ? "تم النقل إلى المحذوفات" : "Moved to Recently Deleted", "success");
    } catch (err) {
      showToast(
        err instanceof RecycleBinError ? err.message : language === "ar" ? "تعذر الحذف" : "Could not delete",
        "error"
      );
    }
    await fetchData();
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    await addDoc(getClinicCollection("categories"), { name: newCategoryName.trim(), parentId: null });
    setNewCategoryName("");
    await fetchData();
  };

  const handleAddSubCategory = async () => {
    if (!newSubCategoryName.trim() || !subCategoryParent) return;
    await addDoc(getClinicCollection("categories"), { name: newSubCategoryName.trim(), parentId: subCategoryParent });
    setNewSubCategoryName("");
    await fetchData();
  };

  const exportToCSV = () => {
    const rows: string[] = [];
    if (language === "ar") {
      rows.push("تقرير المخزون - ألفا دنتال");
      rows.push(`التاريخ: ${new Date().toLocaleString("ar-EG")}`);
      rows.push(`الفلاتر: بحث=${searchTerm || "-"} | تصنيف=${selectedCategory} | فرعي=${selectedSubCategory} | حالة=${stockStatusFilter} | تتبع=${trackingFilter}`);
      rows.push("");
      rows.push(`الفترة,${startDate},${endDate}`);
      rows.push(`إجمالي المشتريات (كمية),${periodSummary.boughtQty.toFixed(2)}`);
      rows.push(`إجمالي المستهلك (كمية),${periodSummary.consumedQty.toFixed(2)}`);
      rows.push(`قيمة المشتريات,${periodSummary.boughtValue.toFixed(2)}`);
      rows.push(`قيمة المستهلك,${periodSummary.consumedValue.toFixed(2)}`);
      rows.push(`الصافي المالي,${periodSummary.netValue.toFixed(2)}`);
      rows.push("");
      rows.push("التاريخ,الصنف,النوع,التغيير,المستخدم,ملاحظات");
    } else {
      rows.push("Alpha Dental - Inventory Report");
      rows.push(`Generated: ${new Date().toLocaleString("en-GB")}`);
      rows.push(`Filters: search=${searchTerm || "-"} | category=${selectedCategory} | subcategory=${selectedSubCategory} | status=${stockStatusFilter} | tracking=${trackingFilter}`);
      rows.push("");
      rows.push(`Period,${startDate},${endDate}`);
      rows.push(`Bought Qty,${periodSummary.boughtQty.toFixed(2)}`);
      rows.push(`Consumed Qty,${periodSummary.consumedQty.toFixed(2)}`);
      rows.push(`Bought Value,${periodSummary.boughtValue.toFixed(2)}`);
      rows.push(`Consumed Value,${periodSummary.consumedValue.toFixed(2)}`);
      rows.push(`Net Financial Value,${periodSummary.netValue.toFixed(2)}`);
      rows.push("");
      rows.push("Date,Item,Type,Change,User,Notes");
    }
    for (const tx of periodSummary.txs) {
      rows.push([tx.date.toLocaleString(language === "ar" ? "ar-EG" : "en-GB"), tx.itemName, tx.type, tx.change.toFixed(2), tx.user, tx.notes || ""].map(csvEscape).join(","));
    }

    const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Alpha_Inventory_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const topCategories = useMemo(() => categories.filter((c) => !c.parentId), [categories]);
  const subCategoriesByParent = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [categories]);

  if (loading && inventory.length === 0) {
    return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-[#27ae60]" size={40} /></div>;
  }

  const formatCurrency = (val: number) => val.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US');

  return (
    <PermissionGuard permission="access.inventory">
      <div className={`min-h-screen bg-gradient-to-br from-slate-100/80 via-white to-slate-50 pb-24 lg:pb-8 flex flex-col font-sans text-slate-800 ${isRTL ? "text-right" : "text-left"}`} dir={isRTL ? "rtl" : "ltr"}>
        <div className="w-full max-w-[1920px] mx-auto px-4 md:px-6 xl:px-10 2xl:px-12 pt-6 xl:pt-10 pb-8 space-y-6 xl:space-y-8 flex-1 flex flex-col min-h-0 animate-in fade-in">
          
          {/* Page header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between shrink-0">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#27ae60]">Alpha</p>
              <h1 className="text-2xl xl:text-3xl font-black text-slate-900 tracking-tight mt-1">{language === "ar" ? "إدارة المخزون" : "Inventory"}</h1>
              <p className="text-slate-500 font-semibold text-sm mt-1">{language === "ar" ? "نظرة عامة على الأرصدة والقيمة الإجمالية" : "Overview of stock levels and total value"}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
               <button onClick={exportToCSV} className="flex-1 sm:flex-none inline-flex justify-center items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2.5 rounded-xl font-bold text-xs border border-slate-200 transition-colors">
                  <Download size={16} /> CSV
               </button>
            </div>
          </div>

          {/* Hero + metric tiles */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-6 shrink-0">
            {/* Main Dark Card */}
            <div className="xl:col-span-5 rounded-3xl bg-slate-900 text-white p-6 xl:p-8 shadow-xl shadow-slate-900/25 relative overflow-hidden border border-slate-800">
              <div className="absolute -top-24 -end-24 w-72 h-72 rounded-full bg-[#60d297]/15 blur-3xl pointer-events-none" aria-hidden />
              <div className="absolute -bottom-16 -start-16 w-56 h-56 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" aria-hidden />
              <div className="relative">
                <div className="flex items-center gap-2 text-slate-400">
                  <Package className="w-4 h-4 text-[#60d297]" />
                  <p className="text-xs font-bold uppercase tracking-widest">
                    {language === "ar" ? "إجمالي القيمة" : "Total Value"}
                  </p>
                </div>
                <p className="text-4xl xl:text-5xl font-black mt-3 tabular-nums tracking-tight text-white">
                  {formatCurrency(stockSummary.totalValue)}
                </p>
                <p className="text-slate-500 text-sm mt-2 font-medium leading-snug">
                  {language === "ar" ? "القيمة التقديرية الحالية لجميع الأصناف" : "Estimated current value of all items"}
                </p>
                <dl className="mt-8 pt-6 border-t border-white/10 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{language === "ar" ? "قيمة المشتريات للفترة" : "Bought value (period)"}</dt>
                    <dd className="font-black tabular-nums text-emerald-400">+{formatCurrency(periodSummary.boughtValue)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{language === "ar" ? "قيمة المستهلك للفترة" : "Consumed value (period)"}</dt>
                    <dd className="font-black tabular-nums text-red-300">−{formatCurrency(periodSummary.consumedValue)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 pt-2 border-t border-white/10">
                    <dt className="text-slate-400 font-semibold">{language === "ar" ? "الصافي المالي للفترة" : "Net financial (period)"}</dt>
                    <dd className={`font-black tabular-nums ${periodSummary.netValue >= 0 ? 'text-emerald-400' : 'text-red-300'}`}>
                      {periodSummary.netValue >= 0 ? '+' : ''}{formatCurrency(periodSummary.netValue)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Metric Tiles */}
            <div className="xl:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "أصناف مطابقة" : "Total items"}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">{language === "ar" ? "حسب الفلاتر" : "Matching filters"}</p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-[#E8F7F0] text-[#27ae60] flex items-center justify-center shrink-0">
                    <Layers size={22} />
                  </div>
                </div>
                <p className="text-2xl xl:text-3xl font-black text-[#27ae60] tabular-nums mt-4">
                  {formatCurrency(stockSummary.totalItems)}
                </p>
              </div>

              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "أصناف منخفضة" : "Low stock"}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">{language === "ar" ? "تتطلب إعادة طلب" : "Requires reorder"}</p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                    <AlertTriangle size={22} />
                  </div>
                </div>
                {/* A count of items, not a money value — this ran through formatCurrency and
                    rendered "3 items low" as a price. */}
                <p className="text-2xl xl:text-3xl font-black text-amber-600 tabular-nums mt-4">
                  {stockSummary.lowStock}
                </p>
                {stockSummary.noThreshold > 0 && (
                  // Without this, items that can never trigger an alert are invisible and the
                  // zero above reads as "everything is fine".
                  <p className="text-[11px] font-bold text-slate-400 mt-1 leading-snug">
                    {language === "ar"
                      ? `${stockSummary.noThreshold} صنف بدون حد لإعادة الطلب — لن تظهر في التنبيهات`
                      : `${stockSummary.noThreshold} item${stockSummary.noThreshold === 1 ? "" : "s"} have no reorder threshold — they can never appear here`}
                  </p>
                )}
              </div>

              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "مشتريات" : "Purchased qty"}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">{language === "ar" ? "للفترة المحددة" : "Selected period"}</p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <TrendingUp size={22} />
                  </div>
                </div>
                <p className="text-2xl xl:text-3xl font-black text-emerald-600 tabular-nums mt-4">
                  +{formatCurrency(periodSummary.boughtQty)}
                </p>
              </div>

              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "استهلاك" : "Consumed qty"}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">{language === "ar" ? "للفترة المحددة" : "Selected period"}</p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                    <TrendingDown size={22} />
                  </div>
                </div>
                <p className="text-2xl xl:text-3xl font-black text-red-600 tabular-nums mt-4">
                  −{formatCurrency(periodSummary.consumedQty)}
                </p>
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="rounded-2xl xl:rounded-3xl bg-white/95 backdrop-blur border border-slate-200/80 shadow-sm p-4 xl:p-5 flex flex-col gap-4 shrink-0 sticky top-0 z-20">
             <div className="flex flex-wrap items-center gap-3">
               <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 shrink-0">
                 {(["all", "low", "ok"] as const).map((type) => (
                   <button
                     key={type}
                     type="button"
                     onClick={() => setStockStatusFilter(type)}
                     className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                       stockStatusFilter === type ? "bg-white text-[#27ae60] shadow-sm border border-slate-200/50" : "text-slate-500"
                     }`}
                   >
                     {language === "ar" ? (type === "all" ? "الكل" : type === "low" ? "منخفض" : "جيد") : type}
                   </button>
                 ))}
               </div>
               
               <input
                 type="date"
                 value={startDate}
                 onChange={(e) => setStartDate(e.target.value)}
                 className="bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none px-4 py-2.5 min-w-[140px] cursor-pointer focus:border-[#60d297] focus:ring-2 focus:ring-[#60d297]/20 transition-all"
               />
               <span className="text-slate-400 font-bold">-</span>
               <input
                 type="date"
                 value={endDate}
                 onChange={(e) => setEndDate(e.target.value)}
                 className="bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none px-4 py-2.5 min-w-[140px] cursor-pointer focus:border-[#60d297] focus:ring-2 focus:ring-[#60d297]/20 transition-all"
               />

               <div className="flex-1 min-w-[40px]" />

               <Protect permission="inventory.add">
                 <button
                   type="button"
                   onClick={() => {
                     resetForm();
                     document.getElementById('inventory-form')?.scrollIntoView({ behavior: 'smooth' });
                   }}
                   data-tour="inventory-add" className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all"
                 >
                   <Plus size={18} />
                   <span className="hidden sm:inline">{language === "ar" ? "إضافة صنف" : "Add Item"}</span>
                 </button>
               </Protect>

               <button
                 type="button"
                 onClick={() => setFiltersExpanded(!filtersExpanded)}
                 className={`xl:hidden inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs border transition-all ${
                   filtersExpanded ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
                 }`}
               >
                 <Filter size={16} />
                 {filtersExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
               </button>
             </div>

             <div className={`${filtersExpanded ? "flex" : "hidden"} xl:flex flex-col lg:flex-row flex-wrap gap-3 lg:items-center lg:justify-between border-t border-slate-100 pt-4`}>
                <div className="flex flex-col sm:flex-row gap-3 flex-1 min-w-0">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none w-full sm:max-w-[180px] cursor-pointer focus:border-[#60d297]"
                  >
                    {categoryOptions.map((c) => <option key={c} value={c}>{c === "All" ? (language === "ar" ? "كل التصنيفات" : "All Categories") : c}</option>)}
                  </select>
                  
                  <select
                    value={selectedSubCategory}
                    onChange={(e) => setSelectedSubCategory(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none w-full sm:max-w-[180px] cursor-pointer focus:border-[#60d297]"
                  >
                    {subCategoryOptions.map((c) => <option key={c} value={c}>{c === "All" ? (language === "ar" ? "كل الفروع" : "All Sub-cats") : c}</option>)}
                  </select>

                  <div className="relative w-full shadow-sm flex-1 max-w-sm">
                    <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 pointer-events-none" />
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder={language === "ar" ? "بحث بالاسم..." : "Search items..."}
                      className="bg-slate-50 border border-slate-200 rounded-xl ps-10 pe-4 py-2.5 text-sm font-semibold text-slate-800 outline-none w-full focus:border-[#60d297] focus:ring-2 focus:ring-[#60d297]/15"
                    />
                  </div>
                </div>

                <div className="flex gap-2 shrink-0">
                   <button
                     type="button"
                     onClick={resetFilters}
                     className="inline-flex justify-center items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2.5 rounded-xl font-bold text-xs border border-slate-200 transition-colors"
                   >
                     <RotateCcw size={16} />
                     {language === "ar" ? "إعادة ضبط" : "Reset"}
                   </button>
                </div>
             </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-white rounded-2xl xl:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col flex-1 min-h-[420px] ring-1 ring-slate-100">
             <div className="overflow-x-auto flex-1">
               <table className="w-full text-sm">
                 <thead>
                   <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                     <th className="text-start py-4 px-6">{language === "ar" ? "الصنف" : "Item"}</th>
                     <th className="text-start py-4 px-4">{language === "ar" ? "التصنيف" : "Category"}</th>
                     <th className="text-center py-4 px-4">{language === "ar" ? "المخزون" : "Stock"}</th>
                     <th className="text-center py-4 px-4">{language === "ar" ? "الحد الأدنى" : "Min"}</th>
                     <th className="text-end py-4 px-4">{language === "ar" ? "التكلفة" : "Unit cost"}</th>
                     <th className="text-end py-4 px-6">{language === "ar" ? "القيمة" : "Value"}</th>
                     <th className="text-center py-4 px-4">{language === "ar" ? "حالة" : "Status"}</th>
                     <th className="text-center py-4 px-4">{language === "ar" ? "إجراءات" : "Actions"}</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {paginatedRows.map((item) => {
                     const isLow = isLowStock(item);
                     return (
                       <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                         <td className="py-4 px-6 align-top min-w-[200px]">
                           <div className="font-bold text-slate-900 leading-snug">{item.name}</div>
                           <div className="text-[11px] font-semibold text-slate-400 mt-1 uppercase tracking-wider">{item.unit}</div>
                         </td>
                         <td className="py-4 px-4 align-top">
                           <span className="text-slate-700 font-semibold text-sm">{item.category}</span>
                           {item.subCategory && <div className="text-[11px] font-semibold text-slate-400 mt-1">{item.subCategory}</div>}
                         </td>
                         <td className="py-4 px-4 align-top text-center">
                           <span className="font-black text-slate-800 tabular-nums">
                             {item.isPercentage ? `${item.stock}%` : item.stock}
                           </span>
                         </td>
                         <td className="py-4 px-4 align-top text-center">
                           <span className="font-bold text-slate-400 tabular-nums text-xs">
                             {item.isPercentage ? `${item.minStock}%` : item.minStock}
                           </span>
                         </td>
                         <td className="py-4 px-4 align-top text-end">
                           <span className="font-bold text-slate-600 tabular-nums text-xs">
                             {formatCurrency(item.costPerUnit)}
                           </span>
                         </td>
                         <td className="py-4 px-6 align-top text-end">
                           <span className="font-black text-slate-800 tabular-nums">
                             {formatCurrency(lineValue(item))}
                           </span>
                         </td>
                         <td className="py-4 px-4 align-top text-center">
                           <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${isLow ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                             {isLow ? <AlertTriangle size={12} /> : null}
                             {language === "ar" ? (isLow ? "منخفض" : "جيد") : isLow ? "Low" : "OK"}
                           </span>
                         </td>
                         <td className="py-4 px-4 align-top text-center">
                           <div className="inline-flex items-center gap-1 justify-center">
                             <Protect permission="inventory.edit">
                                <button onClick={() => void handleQuickAdjust(item, item.isPercentage ? -10 : -1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 shadow-sm flex items-center justify-center font-bold text-xs transition-colors">-1</button>
                                <button onClick={() => void handleQuickAdjust(item, item.isPercentage ? 10 : 1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-200 shadow-sm flex items-center justify-center font-bold text-xs transition-colors">+1</button>
                                <div className="w-2" />
                                <button onClick={() => openForEdit(item)} className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-[#27ae60] hover:border-[#A7E2C3] shadow-sm transition-colors">
                                  <Edit2 size={16} />
                                </button>
                             </Protect>
                             <Protect permission="inventory.delete">
                                <button onClick={() => void handleDelete(item)} className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 shadow-sm transition-colors">
                                  <Trash2 size={16} />
                                </button>
                             </Protect>
                           </div>
                         </td>
                       </tr>
                     );
                   })}
                   {paginatedRows.length === 0 && (
                     <tr>
                       <td className="px-6 py-12 text-center" colSpan={8}>
                         <div className="flex flex-col items-center justify-center text-slate-400">
                           <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                             <Package className="w-8 h-8 text-slate-300" />
                           </div>
                           <p className="font-bold text-slate-600">{language === "ar" ? "لا توجد نتائج مطابقة" : "No matching items"}</p>
                         </div>
                       </td>
                     </tr>
                   )}
                 </tbody>
               </table>
             </div>
             
             {totalPages > 1 && (
               <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                 <span className="text-xs font-bold text-slate-500">
                   {(page - 1) * ROWS_PER_PAGE + 1}–{Math.min(page * ROWS_PER_PAGE, filteredInventory.length)} / {filteredInventory.length}
                 </span>
                 <div className="flex items-center gap-2">
                   <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 text-xs font-bold transition-colors">
                     {language === "ar" ? "السابق" : "Previous"}
                   </button>
                   <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 text-xs font-bold transition-colors">
                     {language === "ar" ? "التالي" : "Next"}
                   </button>
                 </div>
               </div>
             )}
          </div>

          {/* Forms Section */}
          {showInventoryForm && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5" id="inventory-form">
              {/* Add / Edit Form */}
            <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm ring-1 ring-slate-100 space-y-4">
              <h3 className="text-lg font-black text-slate-900 tracking-tight">{editingItem ? (language === "ar" ? "تعديل صنف" : "Edit item") : language === "ar" ? "إضافة صنف" : "Add item"}</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === "ar" ? "اسم الصنف" : "Item name"}</label>
                  <input data-tour="inventory-item-name" value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === "ar" ? "التصنيف" : "Category"}</label>
                  <input value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === "ar" ? "التصنيف الفرعي" : "Sub-category"}</label>
                  <input value={formSubCategory} onChange={(e) => setFormSubCategory(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === "ar" ? "الوحدة" : "Unit"}</label>
                  <input value={formUnit} onChange={(e) => setFormUnit(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === "ar" ? "المخزون" : "Stock"}</label>
                  <input type="number" value={formStock} onChange={(e) => setFormStock(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === "ar" ? "الحد الأدنى" : "Min stock"}</label>
                  <input type="number" value={formMinStock} onChange={(e) => setFormMinStock(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === "ar" ? "تكلفة الوحدة" : "Cost per unit"}</label>
                  <input type="number" value={formCost} onChange={(e) => setFormCost(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                </div>
                <div className="flex items-center pt-5 pl-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center justify-center">
                      <input type="checkbox" checked={formIsPercentage} onChange={(e) => setFormIsPercentage(e.target.checked)} className="peer sr-only" />
                      <div className="w-5 h-5 border-2 border-slate-300 rounded peer-checked:bg-[#27ae60] peer-checked:border-primary-600 transition-colors"></div>
                      <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                    <span className="text-sm font-bold text-slate-600 group-hover:text-slate-900 transition-colors">{language === "ar" ? "تتبع كنسبة مئوية" : "Track as percentage"}</span>
                  </label>
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button data-tour="inventory-save" onClick={() => void saveMaterial()} disabled={saving} className="flex-1 inline-flex justify-center items-center gap-2 bg-slate-900 text-white px-4 py-3 rounded-xl font-bold text-xs uppercase shadow-md hover:bg-slate-800 disabled:opacity-60 transition-all">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {language === "ar" ? "حفظ" : "Save"}
                </button>
                <button onClick={resetForm} className="px-6 py-3 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold uppercase transition-colors">
                  {language === "ar" ? "تفريغ" : "Clear"}
                </button>
              </div>
            </div>

            {/* Categories Management */}
            <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm ring-1 ring-slate-100 space-y-5">
              <h3 className="text-lg font-black text-slate-900 tracking-tight">{language === "ar" ? "التصنيفات" : "Categories"}</h3>
              
              <div className="flex gap-2">
                <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder={language === "ar" ? "تصنيف رئيسي جديد" : "New top-level category"} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                <button onClick={() => void handleAddCategory()} className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-[#27ae60] hover:border-[#A7E2C3] transition-colors">
                  <Plus size={18} />
                </button>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={subCategoryParent} onChange={(e) => setSubCategoryParent(e.target.value)} className="w-full sm:w-1/2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297] cursor-pointer">
                  <option value="">{language === "ar" ? "اختر تصنيفًا رئيسيًا" : "Select parent"}</option>
                  {topCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="flex gap-2 w-full sm:w-1/2">
                  <input value={newSubCategoryName} onChange={(e) => setNewSubCategoryName(e.target.value)} placeholder={language === "ar" ? "تصنيف فرعي" : "Sub-category"} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#60d297]" />
                  <button onClick={() => void handleAddSubCategory()} className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-[#27ae60] hover:border-[#A7E2C3] transition-colors shrink-0">
                    <Plus size={18} />
                  </button>
                </div>
              </div>
              
              <div className="max-h-64 overflow-auto custom-scrollbar border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-3">
                {topCategories.map((cat) => (
                  <div key={cat.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <p className="font-bold text-slate-900 text-sm">{cat.name}</p>
                    <div className="mt-2 space-y-1.5 ps-3 border-s-2 border-slate-100">
                      {(subCategoriesByParent.get(cat.id) ?? []).map((sub) => (
                        <p key={sub.id} className="text-xs font-semibold text-slate-500">{sub.name}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </PermissionGuard>
  );
}