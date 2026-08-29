"use client";

import { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, DollarSign, PieChart, Download, Plus, Search, Edit2, Trash2, Loader2, X, Save, CalendarDays, CalendarClock, Users, ChevronLeft, ChevronRight, SlidersHorizontal, ChevronDown, ChevronUp, Bell, Wallet, FileText } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, addDoc, query, orderBy, serverTimestamp, deleteDoc, doc, updateDoc, where, getDoc, getDocs, onSnapshot } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import Protect from "@/components/Protect";
import PermissionGuard from "@/components/PermissionGuard";
import { logActivity } from "@/lib/logger";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import { useRouter } from "next/navigation";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { MoneyApiError, createLedgerEntry, deleteLedgerRow, updateLedgerRow } from "@/lib/moneyApi";

const ITEMS_PER_PAGE = 15;

interface Transaction {
  id: string; type: 'payment' | 'expense' | 'income' | 'procedure'; description: string; amount?: number; paid?: number; cost?: number; date: string; category?: string; patientName?: string; patientId?: string; doctor?: string; method?: string; isRecurring?: boolean; val: number; doctorName?: string | null; doctorCommissionAmount?: number; labFee?: number; clinicProfit?: number;
  discountAmount?: number;
  /** True when this row is a treatment plan / AR line with no cash collected on the row (shown for reference only). */
  isAccountsReceivableOnly?: boolean;
}

/** Cash-basis amount for finance KPIs and the main +/- column (not full treatment plan totals). */
function ledgerCashValue(d: Record<string, unknown>): number {
  const typ = String(d.type || "");
  if (typ === "expense") return Number(d.cost ?? d.amount ?? 0) || 0;
  if (typ === "procedure") {
    return Number(d.paid ?? 0) || 0;
  }
  return Number(d.paid ?? d.amount ?? 0) || 0;
}

function procedureHasArBalance(d: Record<string, unknown>): boolean {
  const c = Number(d.cost ?? 0) || 0;
  const a = Number(d.amount ?? 0) || 0;
  const p = Number(d.paid ?? 0) || 0;
  return c > 0 || a > 0 || p > 0;
}

function getCreatedAtMillis(item: Transaction): number {
  const raw = (item as { createdAt?: unknown }).createdAt;
  if (typeof raw === "number") return raw;
  if (typeof raw === "object" && raw && "toMillis" in raw) {
    return (raw as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export default function FinancePage() {
  const { language, t, isRTL, toggleLanguage } = useLanguage();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();
  const router = useRouter();

  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  /** Treatment charges raised in the period. Not cash — used only for the discount figures. */
  const [periodProcedures, setPeriodProcedures] = useState<Record<string, unknown>[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterDoctor, setFilterDoctor] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState("");
  const [timeView, setTimeView] = useState<"daily" | "monthly" | "range">("daily");
  const [dateRange, setDateRange] = useState(new Date().toISOString().split("T")[0]);
  const [customStartDate, setCustomStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [customEndDate, setCustomEndDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportTarget, setExportTarget] = useState<'download' | null>(null);

  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [pdfSections, setPdfSections] = useState({ kpis: true, income: true, expenses: true, commissions: true, charts: true });
  const [pdfDateFrom, setPdfDateFrom] = useState('');
  const [pdfDateTo, setPdfDateTo] = useState('');

  const [formType, setFormType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod] = useState("Cash");
  const [isRecurring, setIsRecurring] = useState(false);

  const handleLangToggle = () => {
    toggleLanguage();
  };

  const handleTimeViewChange = (view: "daily" | "monthly" | "range") => {
    setTimeView(view);
    const today = new Date().toISOString().split("T")[0];
    if (view === "daily") {
      if (dateRange.startsWith(today.slice(0, 7))) setDateRange(today);
      else setDateRange(`${dateRange}-01`);
    } else if (view === "monthly") {
      setDateRange(dateRange.slice(0, 7));
    } else {
      setCustomStartDate(customStartDate || today);
      setCustomEndDate(customEndDate || today);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    let startDateStr = dateRange;
    let endDateStr = dateRange;
    if (timeView === "monthly") {
      startDateStr = `${dateRange}-01`;
      const [year, month] = dateRange.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      endDateStr = `${dateRange}-${String(lastDay).padStart(2, "0")}`;
    } else if (timeView === "range") {
      startDateStr = customStartDate || dateRange;
      endDateStr = customEndDate || customStartDate || dateRange;
      if (startDateStr > endDateStr) {
        const tmp = startDateStr;
        startDateStr = endDateStr;
        endDateStr = tmp;
      }
    }

    const q = query(
      getClinicCollection("ledger"),
      where("date", ">=", startDateStr),
      where("date", "<=", endDateStr),
      orderBy("date", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs
          .map((docSnap) => {
            const d = docSnap.data();
            const val = ledgerCashValue(d as Record<string, unknown>);
            const typ = String(d.type || "");
            const isAR =
              typ === "procedure" &&
              procedureHasArBalance(d as Record<string, unknown>) &&
              val <= 0;
            return {
              id: docSnap.id,
              ...d,
              val,
              discountAmount: Number(d.discountAmount) || 0,
              isAccountsReceivableOnly: isAR,
            } as Transaction;
          })
          .sort((a, b) => {
            if (a.date !== b.date) return a.date > b.date ? -1 : 1;
            return getCreatedAtMillis(b) - getCreatedAtMillis(a);
          })
          .filter((t) => {
            if (t.type === "expense") return t.val > 0;
            // Clinic finance = cash only; treatment plans live on the patient ledger until payment.
            if (t.type === "procedure") return false;
            return t.val > 0;
          });
        setAllTransactions(data);
        // Discounts are an accrual figure: the money was given away when the treatment was
        // charged, not when it was paid for. Procedure rows are dropped from the cash list two
        // lines above, which is exactly why the Discounts tile could never show anything but zero
        // — the branches that accumulated it ran after the filter had already removed every row
        // that carries a discount. They are kept here instead, alongside rather than inside the
        // cash figures.
        setPeriodProcedures(
          snapshot.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Record<string, unknown>))
            .filter((row) => String(row.type || "") === "procedure")
            .filter((row) => !["deleted", "cancelled"].includes(String(row.status || "").toLowerCase()))
        );
        setCurrentPage(1);
        setIsLoading(false);
      },
      (error) => {
        console.error("Finance ledger snapshot failed", error);
        showToast("Failed to load period data.", "error");
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [dateRange, timeView, customStartDate, customEndDate, showToast]);

  const { kpiStats, availableDoctors } = useMemo(() => {
      let grossIncome = 0; let totalCommissions = 0; let totalLabFees = 0; let explicitExpenses = 0; let netClinicProfit = 0;
      let totalProcedureDiscounts = 0;
      const docsList = new Set<string>();

      allTransactions.forEach(t => {
          const docLabel = (t.doctorName || t.doctor || "").trim();
          if (filterDoctor !== 'all' && docLabel !== filterDoctor) return;
          if (docLabel) docsList.add(docLabel);

          if (t.type === 'expense') {
            explicitExpenses += t.val;
            return;
          }

          if (t.isAccountsReceivableOnly) {
            if (t.type === 'procedure' && Number(t.discountAmount) > 0) {
              totalProcedureDiscounts += Number(t.discountAmount) || 0;
            }
            return;
          }

          grossIncome += t.val;
          const comm = Number(t.doctorCommissionAmount) || 0;
          const lab = Number(t.labFee) || 0;
          const profit = t.clinicProfit !== undefined ? Number(t.clinicProfit) : (t.val - comm - lab);
          totalCommissions += comm;
          totalLabFees += lab;
          netClinicProfit += profit;

          if (t.type === 'procedure' && Number(t.discountAmount) > 0) {
              totalProcedureDiscounts += Number(t.discountAmount) || 0;
          }
      });
      // Discounts, from the charges rather than the cash. Filtered by the same dentist selection
      // so the tile agrees with the rest of the screen.
      for (const row of periodProcedures) {
        const docLabel = String(row.doctorName || row.doctor || "").trim();
        if (filterDoctor !== 'all' && docLabel !== filterDoctor) continue;
        totalProcedureDiscounts += Number(row.discountAmount) || 0;
      }

      return { availableDoctors: Array.from(docsList), kpiStats: { grossIncome, totalCommissions, totalLabFees, explicitExpenses, netClinicProfit, totalProcedureDiscounts, finalNet: netClinicProfit - explicitExpenses } };
  }, [allTransactions, periodProcedures, filterDoctor]);

  /**
   * What the clinic gave away in this period, and why.
   *
   * The question this answers is the one an owner actually asks at month end — not "how much
   * discount" but "on what". A total with no breakdown is a number nobody can act on.
   */
  const discountsByReason = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const row of periodProcedures) {
      const amount = Number(row.discountAmount) || 0;
      if (amount <= 0) continue;
      const docLabel = String(row.doctorName || row.doctor || "").trim();
      if (filterDoctor !== 'all' && docLabel !== filterDoctor) continue;
      // Charges discounted before reasons were recorded are grouped honestly rather than hidden.
      const reason = String(row.discountReason || "").trim() || (language === "ar" ? "بدون سبب مسجل" : "No reason recorded");
      const entry = map.get(reason) || { amount: 0, count: 0 };
      entry.amount += amount;
      entry.count += 1;
      map.set(reason, entry);
    }
    return Array.from(map.entries())
      .map(([reason, v]) => ({ reason, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);
  }, [periodProcedures, filterDoctor, language]);

  const filteredList = useMemo(() => {
      return allTransactions.filter(t => {
          const docLabel = (t.doctorName || t.doctor || "").trim();
          if (filterDoctor !== 'all' && docLabel !== filterDoctor) return false;
          if (filterType !== 'all') {
              if (filterType === 'income' && t.type === 'expense') return false;
              if (filterType === 'expense' && t.type !== 'expense') return false;
          }
          if (searchQuery) {
               const q = searchQuery.trim();
               const descOk = (t.description || "").toLowerCase().includes(q.toLowerCase());
               const patientOk = patientMatchesSearch(q, t.patientName || "", undefined);
               return descOk || patientOk;
          }
          return true;
      });
  }, [allTransactions, filterDoctor, filterType, searchQuery]);

  useEffect(() => setCurrentPage(1), [filterType, filterDoctor, searchQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredList.length / ITEMS_PER_PAGE));
  const paginatedTransactions = useMemo(() => {
      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      return filteredList.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredList, currentPage]);

  const handleEdit = (tx: Transaction) => {
    setEditingId(tx.id); setFormType(tx.type === 'expense' ? 'expense' : 'income');
    setAmount(tx.val.toString()); setDescription(tx.description || ""); setCategory(tx.category || "General");
    setDate(tx.date); setIsRecurring(!!tx.isRecurring); setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description) return showToast(t('fillRequired'), "error");
    try {
      // The income/expense split (which field the money lands in) and the audit entry are both the
      // server's job now — this screen used to build the row and log it itself, and the same row
      // shape was rebuilt slightly differently in three other places.
      if (editingId) {
        await updateLedgerRow(editingId, {
          date,
          description: description || "No Description",
          amount: Number(amount),
          category: category || "General",
          method: method || "Cash",
          isRecurring: formType === 'expense' ? isRecurring : false,
        });
        showToast("Updated", "success");
      } else {
        await createLedgerEntry({
          type: formType,
          amount: Number(amount),
          description: description || "No Description",
          category: category || "General",
          date,
          method: method || "Cash",
          isRecurring: formType === 'expense' ? isRecurring : false,
        });
        showToast("Saved", "success");
      }
      closeModal();
    } catch (error) {
      showToast(error instanceof MoneyApiError ? error.message : t('saveFailed'), "error");
    }
  };

  const handleDelete = async (id: string, desc: string) => {
    if (!(await confirm(t("deleteConfirm")))) return;
    try {
      // This screen used to warn that payments existed and then cascade through them anyway,
      // leaving the patient's balance short by whatever had been collected and nothing on any
      // screen explaining why. The server refuses now, with the same rule every other screen gets.
      const { deleted } = await deleteLedgerRow(id);
      showToast(t("deleteSuccess"), "info");
      const removed = new Set(deleted.map((row) => row.id));
      setAllTransactions((prev) => prev.filter((row) => !removed.has(row.id)));
    } catch (e) {
      showToast(
        e instanceof MoneyApiError
          ? e.message
          : language === "ar" ? "تعذر الحذف" : "Could not delete that.",
        "error"
      );
    }
  };

  const closeModal = () => { setIsModalOpen(false); setEditingId(null); setAmount(""); setDescription(""); setCategory("General"); setIsRecurring(false); setDate(new Date().toISOString().split('T')[0]); };

  const openPdfModal = () => {
    // Default date range to current view
    if (timeView === 'range') {
      setPdfDateFrom(customStartDate);
      setPdfDateTo(customEndDate);
    } else if (timeView === 'monthly') {
      const [year, month] = dateRange.split('-');
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      setPdfDateFrom(`${dateRange}-01`);
      setPdfDateTo(`${dateRange}-${String(lastDay).padStart(2, '0')}`);
    } else {
      setPdfDateFrom(dateRange);
      setPdfDateTo(dateRange);
    }
    setIsPdfModalOpen(true);
  };

  const handleExport = async (target: 'download') => {
    setIsExporting(true); setExportTarget(target);
    try {
      // Filter transactions by the selected pdf date range
      const from = pdfDateFrom || dateRange;
      const to = pdfDateTo || pdfDateFrom || dateRange;
      const txList = allTransactions.filter(tx => tx.date >= from && tx.date <= to);

      const incomeList = txList.filter(tx => tx.type !== 'expense');
      const expenseList = txList.filter(tx => tx.type === 'expense');
      const commissionList = txList.filter(tx => (tx.doctorCommissionAmount || 0) > 0);

      const totalIncome = incomeList.reduce((s, t) => s + t.val, 0);
      const totalExpenses = expenseList.reduce((s, t) => s + t.val, 0);
      const totalCommissions = commissionList.reduce((s, t) => s + (t.doctorCommissionAmount || 0), 0);
      const netProfit = totalIncome - totalExpenses - totalCommissions;

      let kpiHtml = "";
      if (pdfSections.kpis) {
        kpiHtml = `
          <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
            <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
              <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${language === 'ar' ? 'المدخول' : 'Cash In'}</div>
              <div style="font-size: 18px; font-weight: 800; color: #059669;">+${totalIncome.toLocaleString()} EGP</div>
            </div>
            <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
              <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${language === 'ar' ? 'المصروفات' : 'Expenses'}</div>
              <div style="font-size: 18px; font-weight: 800; color: #dc2626;">-${totalExpenses.toLocaleString()} EGP</div>
            </div>
            <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
              <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${language === 'ar' ? 'العمولات' : 'Commissions'}</div>
              <div style="font-size: 18px; font-weight: 800; color: #d97706;">-${totalCommissions.toLocaleString()} EGP</div>
            </div>
            <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
              <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${language === 'ar' ? 'صافي الربح' : 'Net Profit'}</div>
              <div style="font-size: 18px; font-weight: 800; color: ${netProfit >= 0 ? '#0f172a' : '#dc2626'};">${netProfit.toLocaleString()} EGP</div>
            </div>
          </div>
        `;
      }

      let chartHtml = "";
      if (pdfSections.charts) {
        chartHtml = `
          <h3 style="font-size: 15px; font-weight: 800; margin: 24px 0 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">
            ${language === 'ar' ? 'الدخل مقابل المصروفات' : 'Income vs Expenses'}
          </h3>
          <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
            <div style="margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 11px; font-weight: 600; color: #059669;">
                <span>${language === 'ar' ? 'الدخل' : 'Income'}</span>
                <span>${totalIncome.toLocaleString()}</span>
              </div>
              <div style="height: 12px; background: #d1fae5; border-radius: 6px; overflow: hidden;">
                <div style="height: 100%; background: #059669; width: ${Math.min(100, (totalIncome / Math.max(totalIncome, totalExpenses, 1)) * 100)}%;"></div>
              </div>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 11px; font-weight: 600; color: #dc2626;">
                <span>${language === 'ar' ? 'المصروفات' : 'Expenses'}</span>
                <span>${totalExpenses.toLocaleString()}</span>
              </div>
              <div style="height: 12px; background: #fee2e2; border-radius: 6px; overflow: hidden;">
                <div style="height: 100%; background: #dc2626; width: ${Math.min(100, (totalExpenses / Math.max(totalIncome, totalExpenses, 1)) * 100)}%;"></div>
              </div>
            </div>
          </div>
        `;
      }

      let incomeHtml = "";
      if (pdfSections.income && incomeList.length > 0) {
        incomeHtml = `
          <h3 style="font-size: 15px; font-weight: 800; margin: 30px 0 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">
            ${language === 'ar' ? 'عمليات الدخل' : 'Income Transactions'}
          </h3>
          <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'الوصف' : 'Description'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'المريض' : 'Patient'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'الطبيب' : 'Doctor'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'left' : 'right'};">${language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                ${incomeList.map(tx => `
                  <tr>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.date}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.description || '—'}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.patientName || '—'}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.doctorName || tx.doctor || '—'}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #059669; text-align: ${language === 'ar' ? 'left' : 'right'};">+${tx.val.toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      let expenseHtml = "";
      if (pdfSections.expenses && expenseList.length > 0) {
        expenseHtml = `
          <h3 style="font-size: 15px; font-weight: 800; margin: 30px 0 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">
            ${language === 'ar' ? 'عمليات المصروفات' : 'Expense Transactions'}
          </h3>
          <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'الوصف' : 'Description'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'الفئة' : 'Category'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'left' : 'right'};">${language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                ${expenseList.map(tx => `
                  <tr>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.date}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.description || '—'}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.category || '—'}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #dc2626; text-align: ${language === 'ar' ? 'left' : 'right'};">-${tx.val.toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      let commissionHtml = "";
      if (pdfSections.commissions && commissionList.length > 0) {
        commissionHtml = `
          <h3 style="font-size: 15px; font-weight: 800; margin: 30px 0 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">
            ${language === 'ar' ? 'تفصيل عمولات الأطباء' : 'Doctor Commission Breakdown'}
          </h3>
          <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'الطبيب' : 'Doctor'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'المريض' : 'Patient'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'الوصف' : 'Description'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'النقد' : 'Cash'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? 'العمولة' : 'Commission'}</th>
                  <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'left' : 'right'};">${language === 'ar' ? 'الصافي' : 'Net'}</th>
                </tr>
              </thead>
              <tbody>
                ${commissionList.map(tx => `
                  <tr>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.date}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${(tx.doctorName || tx.doctor || '—').replace(/^Dr\.\s*/i, 'Dr. ')}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.patientName || '—'}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.description || '—'}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'};">${tx.val.toLocaleString()}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #d97706; text-align: ${language === 'ar' ? 'right' : 'left'};">${(tx.doctorCommissionAmount || 0).toLocaleString()}</td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #059669; text-align: ${language === 'ar' ? 'left' : 'right'};">${(tx.clinicProfit ?? tx.val - (tx.doctorCommissionAmount || 0) - (tx.labFee || 0)).toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      const title = language === 'ar' ? "التقرير المالي" : "Financial Report";
      const headerHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e2e8f0;">
          <div>
            <h1 style="margin: 0 0 4px 0; font-size: 24px; font-weight: 800; color: #0f172a;">ALPHA DENTAL</h1>
            <p style="margin: 0; font-size: 14px; color: #64748b;">${title}</p>
          </div>
          <div style="text-align: ${language === 'ar' ? 'left' : 'right'}; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0;">Period: ${from === to ? from : `${from} → ${to}`}</p>
            <p style="margin: 4px 0 0; font-size: 10px; opacity: 0.8;">Generated: ${new Date().toLocaleDateString('en-GB')} by ${user?.name || 'Admin'}</p>
          </div>
        </div>
      `;

      const { buildReportHtmlBase, htmlToPdfBlob } = await import("@/components/reports/reportPdfHtmlUtils");
      const fullHtml = buildReportHtmlBase(title, language, headerHtml + kpiHtml + chartHtml + incomeHtml + expenseHtml + commissionHtml);
      const pdfBlob = await htmlToPdfBlob(fullHtml);

      const fileName = `Alpha_Finance_${from}_to_${to}.pdf`;

      if (target === 'download') {
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Finance Report Exported",
          `Downloaded finance report: ${fileName}`
        );
        showToast("Report Downloaded!", "success");
      }
      setIsPdfModalOpen(false);
    } catch (error) { 
      console.error(error);
      showToast("Export failed", "error"); 
    } finally { 
      setIsExporting(false); 
      setExportTarget(null); 
    }
  };

  const formatCurrency = (val: number) => val.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US');
  
  const generatePageNumbers = () => { const pages = []; const maxVisiblePages = 5; let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2)); let endPage = startPage + maxVisiblePages - 1; if (endPage > totalPages) { endPage = totalPages; startPage = Math.max(1, endPage - maxVisiblePages + 1); } for (let i = startPage; i <= endPage; i++) { pages.push(i); } return pages; };

  const periodLabel =
    timeView === "daily"
      ? new Date(dateRange).toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : timeView === "monthly"
        ? new Date(`${dateRange}-01`).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", { month: "long", year: "numeric" })
        : `${new Date(customStartDate || dateRange).toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB")} → ${new Date(customEndDate || customStartDate || dateRange).toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB")}`;

  return (
    <PermissionGuard permission="access.finance">
      <div className={`min-h-screen bg-gradient-to-br from-slate-100/80 via-white to-slate-50 pb-24 lg:pb-8 flex flex-col font-sans text-slate-800 ${isRTL ? "text-right" : "text-left"}`} dir={isRTL ? "rtl" : "ltr"}>
        
        <div className="w-full max-w-[1920px] mx-auto px-4 md:px-6 xl:px-10 2xl:px-12 pt-6 xl:pt-10 pb-8 space-y-6 xl:space-y-8 flex-1 flex flex-col min-h-0 animate-in fade-in">
          
          {/* Page header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between shrink-0">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-accent">Alpha</p>
              <h1 className="text-2xl xl:text-3xl font-black text-slate-900 tracking-tight mt-1">{t("finance")}</h1>
              <p className="text-slate-500 font-semibold text-sm mt-1 tabular-nums">{periodLabel}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={handleLangToggle} className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 flex items-center justify-center font-bold text-[10px] uppercase tracking-widest shadow-sm transition-colors">
                {language === "ar" ? "EN" : "ع"}
              </button>
              <button type="button" className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-accent flex items-center justify-center shadow-sm transition-colors relative">
                <Bell size={18} />
                <span className="absolute top-2 end-2 w-1.5 h-1.5 bg-red-500 rounded-full border-2 border-white" />
              </button>
            </div>
          </div>

          {/* Hero + metric tiles */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-6 shrink-0">
            <div className="xl:col-span-5 rounded-3xl bg-slate-900 text-white p-6 xl:p-8 shadow-xl shadow-slate-900/25 relative overflow-hidden border border-slate-800">
              <div className="absolute -top-24 -end-24 w-72 h-72 rounded-full bg-accent-soft/15 blur-3xl pointer-events-none" aria-hidden />
              <div className="absolute -bottom-16 -start-16 w-56 h-56 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" aria-hidden />
              <div className="relative">
                <div className="flex items-center gap-2 text-slate-400">
                  <Wallet className="w-4 h-4 text-accent-soft" />
                  <p className="text-xs font-bold uppercase tracking-widest">
                    {language === "ar" ? "صافي العيادة" : "True net"}
                  </p>
                </div>
                <p className={`text-4xl xl:text-5xl font-black mt-3 tabular-nums tracking-tight ${kpiStats.finalNet >= 0 ? "text-white" : "text-red-400"}`}>
                  {isLoading ? <Loader2 className="w-10 h-10 animate-spin text-slate-500" /> : `${formatCurrency(kpiStats.finalNet)}`}
                </p>
                <p className="text-slate-500 text-sm mt-2 font-medium leading-snug">
                  {language === "ar" ? "بعد العمولات، المختبر والمصروفات اليدوية" : "After doctor & lab deductions and recorded expenses"}
                </p>
                <dl className="mt-8 pt-6 border-t border-white/10 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{language === "ar" ? "المتحصل" : "Cash in"}</dt>
                    <dd className="font-black tabular-nums text-emerald-400">+{isLoading ? "—" : formatCurrency(kpiStats.grossIncome)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{language === "ar" ? "الخصومات" : "Discounts"}</dt>
                    <dd className="font-black tabular-nums text-violet-300">{isLoading ? "—" : formatCurrency(kpiStats.totalProcedureDiscounts)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{language === "ar" ? "عمولات + مختبر" : "Commissions + lab"}</dt>
                    <dd className="font-black tabular-nums text-amber-300">
                      −{isLoading ? "—" : formatCurrency(kpiStats.totalCommissions + kpiStats.totalLabFees)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{language === "ar" ? "مصروفات" : "Expenses"}</dt>
                    <dd className="font-black tabular-nums text-red-300">
                      −{isLoading ? "—" : formatCurrency(kpiStats.explicitExpenses)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="xl:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "المتحصل" : "Cash in"}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">{language === "ar" ? "دفعات فعلية" : "Payments received"}</p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <TrendingUp size={22} />
                  </div>
                </div>
                <p className="text-2xl xl:text-3xl font-black text-emerald-600 tabular-nums mt-4">
                  {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-emerald-300" /> : formatCurrency(kpiStats.grossIncome)}
                </p>
              </div>
              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "خصومات ممنوحة" : "Discounts granted"}</p>
                    {/* Named apart from the cash tiles on purpose: this is what was given away when
                        treatments were charged in this period, not what was collected. */}
                    <p
                      className="text-xs text-slate-500 mt-1 font-medium"
                      title={language === "ar"
                        ? "محسوبة على الإجراءات اللي اتسجلت في الفترة دي، مش على المتحصل."
                        : "Counted on treatments charged in this period, not on cash collected."}
                    >
                      {language === "ar" ? "على العلاج المسجل" : "On treatments charged"}
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <PieChart size={22} />
                  </div>
                </div>
                <p className="text-2xl xl:text-3xl font-black text-violet-600 tabular-nums mt-4">
                  {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-violet-300" /> : formatCurrency(kpiStats.totalProcedureDiscounts)}
                </p>
              </div>
              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "استقطاعات" : "Deductions"}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">{language === "ar" ? "من المتحصل" : "From cash-in"}</p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                    <Users size={22} />
                  </div>
                </div>
                <p className="text-2xl xl:text-3xl font-black text-amber-600 tabular-nums mt-4">
                  {isLoading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-amber-300" />
                  ) : (
                    `−${formatCurrency(kpiStats.totalCommissions + kpiStats.totalLabFees)}`
                  )}
                </p>
              </div>
              <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{language === "ar" ? "مصروفات" : "Expenses"}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">{language === "ar" ? "يدوي" : "Manual ledger"}</p>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                    <TrendingDown size={22} />
                  </div>
                </div>
                <p className="text-2xl xl:text-3xl font-black text-red-600 tabular-nums mt-4">
                  {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-red-300" /> : `−${formatCurrency(kpiStats.explicitExpenses)}`}
                </p>
              </div>
            </div>
          </div>

          {/* What was given away, and on what. A total with no breakdown is a number nobody can
              act on — "we discounted 8,000" invites the question this table answers. */}
          {discountsByReason.length > 0 && (
            <div className="rounded-2xl xl:rounded-3xl bg-white border border-slate-200/80 shadow-sm p-5 xl:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                    {language === "ar" ? "الخصومات حسب السبب" : "Discounts by reason"}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-medium">
                    {language === "ar" ? "على العلاج المسجل في الفترة" : "On treatments charged this period"}
                  </p>
                </div>
                <p className="text-xl font-black text-violet-600 tabular-nums">
                  {formatCurrency(kpiStats.totalProcedureDiscounts)}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {discountsByReason.map((row) => (
                      <tr key={row.reason} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-3 font-bold text-slate-700">{row.reason}</td>
                        <td className="py-2.5 px-3 text-right text-xs font-medium text-slate-400 tabular-nums whitespace-nowrap">
                          {row.count} {language === "ar" ? "بند" : row.count === 1 ? "item" : "items"}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-black text-slate-800 tabular-nums whitespace-nowrap">
                          {formatCurrency(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="rounded-2xl xl:rounded-3xl bg-white/95 backdrop-blur border border-slate-200/80 shadow-sm p-4 xl:p-5 flex flex-col gap-4 shrink-0 sticky top-0 z-20">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 shrink-0">
                <button
                  type="button"
                  onClick={() => handleTimeViewChange("daily")}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-lg transition-all ${
                    timeView === "daily" ? "bg-white shadow text-accent border border-slate-200/50" : "text-slate-500"
                  }`}
                >
                  <CalendarDays size={16} />
                  <span>{language === "ar" ? "يومي" : "Daily"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTimeViewChange("monthly")}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-lg transition-all ${
                    timeView === "monthly" ? "bg-white shadow text-accent border border-slate-200/50" : "text-slate-500"
                  }`}
                >
                  <CalendarClock size={16} />
                  <span>{language === "ar" ? "شهري" : "Monthly"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTimeViewChange("range")}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-lg transition-all ${
                    timeView === "range" ? "bg-white shadow text-accent border border-slate-200/50" : "text-slate-500"
                  }`}
                >
                  <CalendarDays size={16} />
                  <span>{language === "ar" ? "نطاق" : "Range"}</span>
                </button>
              </div>
              {timeView === "range" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none px-4 py-2.5 min-w-[160px] cursor-pointer focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20 transition-all"
                  />
                  <span className="text-slate-400 font-bold text-xs">→</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none px-4 py-2.5 min-w-[160px] cursor-pointer focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20 transition-all"
                  />
                </div>
              ) : (
                <input
                  type={timeView === "daily" ? "date" : "month"}
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none px-4 py-2.5 min-w-[160px] cursor-pointer focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20 transition-all"
                />
              )}
              <div className="flex-1 min-w-[80px]" />
              <Protect permission="finance.add">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setIsModalOpen(true);
                  }}
                  data-tour="finance-expense-btn" className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all"
                >
                  <Plus size={18} />
                  <span className="hidden sm:inline">{language === "ar" ? "إدخال يدوي" : "Manual entry"}</span>
                </button>
              </Protect>
              <button
                type="button"
                onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}
                className={`xl:hidden inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs border transition-all ${
                  isFiltersExpanded ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
                }`}
              >
                <SlidersHorizontal size={16} />
                {isFiltersExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            <div
              className={`${isFiltersExpanded ? "flex" : "hidden"} xl:flex flex-col lg:flex-row flex-wrap gap-3 lg:items-center lg:justify-between border-t border-slate-100 pt-4`}
            >
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 shrink-0">
                {(["all", "income", "expense"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFilterType(type)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                      filterType === type ? "bg-slate-900 text-white shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {language === "ar" ? (type === "all" ? "الكل" : type === "income" ? "دخل" : "مصروف") : type}
                  </button>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-3 flex-1 min-w-0 lg:justify-end">
                <select
                  value={filterDoctor}
                  onChange={(e) => setFilterDoctor(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none w-full sm:max-w-[220px] cursor-pointer focus:border-accent-soft"
                >
                  <option value="all">{language === "ar" ? "كل الأطباء" : "All doctors"}</option>
                  {availableDoctors.map((d) => (
                    <option key={d} value={d}>
                      Dr. {d.replace(/^Dr\.\s*/i, "")}
                    </option>
                  ))}
                </select>
                <div className="relative w-full sm:max-w-xs shadow-sm">
                  <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={language === "ar" ? "بحث..." : "Search patient or note..."}
                    className="bg-slate-50 border border-slate-200 rounded-xl ps-10 pe-4 py-2.5 text-sm font-semibold text-slate-800 outline-none w-full focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/15"
                  />
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={openPdfModal}
                    disabled={isLoading}
                    className="flex-1 sm:flex-none inline-flex justify-center items-center gap-2 bg-slate-900 text-white hover:bg-slate-700 px-4 py-2.5 rounded-xl font-bold text-xs border border-slate-800 disabled:opacity-50 transition-colors shadow-md"
                  >
                    <FileText size={16} />
                    {language === "ar" ? "تقرير PDF" : "PDF Report"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Ledger */}
          <div className="bg-white rounded-2xl xl:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col flex-1 min-h-[420px] ring-1 ring-slate-100">
            {isLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 min-h-[320px]">
                <Loader2 size={28} className="animate-spin mb-3 text-accent-soft" />
                <p className="font-bold text-xs text-slate-500 uppercase tracking-widest">
                  {language === "ar" ? "جاري التحميل..." : "Loading ledger..."}
                </p>
              </div>
            ) : filteredList.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 min-h-[320px] px-6">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                  <DollarSign className="w-8 h-8 text-slate-300" />
                </div>
                <p className="font-bold text-slate-600">{t("noData")}</p>
                <p className="text-sm text-slate-400 mt-1 text-center max-w-sm">
                  {language === "ar" ? "غيّر التاريخ أو الفلاتر لرؤية المعاملات." : "Try another date or clear filters to see transactions."}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden lg:block overflow-x-auto flex-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                        <th className="text-start py-4 px-6 w-[110px] whitespace-nowrap">{language === "ar" ? "التاريخ" : "Date"}</th>
                        <th className="text-start py-4 px-4 min-w-[200px]">{language === "ar" ? "التفاصيل" : "Details"}</th>
                        <th className="text-start py-4 px-4 w-[140px]">{language === "ar" ? "المريض" : "Patient"}</th>
                        <th className="text-start py-4 px-4 w-[160px]">{language === "ar" ? "إضافي" : "Allocations"}</th>
                        <th className="text-end py-4 px-6 w-[120px] whitespace-nowrap">{language === "ar" ? "المبلغ" : "Amount"}</th>
                        <th className="text-end py-4 px-4 w-[100px] whitespace-nowrap">{language === "ar" ? "إجراءات" : ""}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedTransactions.map((tx) => {
                        const isExpense = tx.type === "expense";
                        return (
                          <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors group">
                            <td className="py-4 px-6 align-top">
                              <span className="font-bold text-slate-600 tabular-nums text-xs whitespace-nowrap">{tx.date}</span>
                            </td>
                            <td className="py-4 px-4 align-top min-w-0">
                              <div className="flex items-start gap-2">
                                <span
                                  className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                    isExpense ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                                  }`}
                                >
                                  {isExpense ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                                </span>
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-900 leading-snug">
                                    {tx.description}
                                    {tx.isRecurring ? (
                                      <span className="ms-2 align-middle text-[10px] bg-[#A7E2C3] text-[#1E5631] px-1.5 py-0.5 rounded-md font-black uppercase">
                                        Auto
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="text-[11px] font-semibold text-slate-400 uppercase mt-1">
                                    {tx.category || tx.method || "—"}
                                    {(tx.doctorName || tx.doctor) && (
                                      <span className="text-accent ms-2">
                                        · Dr. {(tx.doctorName || tx.doctor || "").replace(/^Dr\.\s*/i, "").split(" ")[0]}
                                      </span>
                                    )}
                                  </p>
                                  {tx.type === "procedure" && Number(tx.discountAmount) > 0 ? (
                                    <p className="text-[11px] font-bold text-violet-600 mt-1">
                                      −{Number(tx.discountAmount).toLocaleString()} {language === "ar" ? "خصم" : "discount"}
                                    </p>
                                  ) : null}
                                  {tx.isAccountsReceivableOnly ? (
                                    <p className="text-[11px] font-bold text-amber-700 mt-1 leading-snug">
                                      {language === "ar" ? "خطة علاج — لم يُحصّل بعد" : "Treatment plan — not cash yet"} ·{" "}
                                      {language === "ar" ? "الإجمالي" : "Plan"}: {Number(tx.cost || tx.amount || 0).toLocaleString()}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4 align-top">
                              {tx.patientId ? (
                                <button
                                  onClick={() => router.push(`/patients/${tx.patientId}?tab=finance&tx=${tx.id}`)}
                                  className="text-slate-700 font-semibold text-sm hover:text-accent-soft hover:underline transition-colors text-start"
                                >
                                  {tx.patientName?.trim() ? tx.patientName.trim().split(" ")[0] : "—"}
                                </button>
                              ) : (
                                <span className="text-slate-700 font-semibold text-sm">
                                  {tx.patientName?.trim() ? tx.patientName.trim().split(" ")[0] : "—"}
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-4 align-top">
                              {tx.doctorCommissionAmount || tx.labFee || tx.clinicProfit !== undefined ? (
                                <div className="flex flex-col gap-1">
                                  {tx.doctorCommissionAmount ? (
                                    <span className="text-[10px] font-bold bg-[#E8F7F0] text-[#1E5631] px-2 py-1 rounded-lg border border-[#A7E2C3] w-fit">
                                      Doc {tx.doctorCommissionAmount}
                                    </span>
                                  ) : null}
                                  {tx.labFee ? (
                                    <span className="text-[10px] font-bold bg-orange-50 text-orange-700 px-2 py-1 rounded-lg border border-orange-100 w-fit">
                                      Lab {tx.labFee}
                                    </span>
                                  ) : null}
                                  {tx.clinicProfit !== undefined ? (
                                    <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg border border-emerald-100 w-fit">
                                      Net {tx.clinicProfit}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="py-4 px-6 align-top text-end">
                              <span
                                className={`font-black text-base tabular-nums ${isExpense ? "text-red-600" : "text-emerald-600"}`}
                              >
                                {isExpense ? "−" : "+"}
                                {tx.val.toLocaleString()}
                              </span>
                            </td>
                            <td className="py-4 px-4 align-top text-end">
                              <div className="inline-flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity justify-end">
                                <Protect permission="finance.edit">
                                  {tx.type !== "payment" && tx.type !== "procedure" ? (
                                    <button
                                      type="button"
                                      onClick={() => handleEdit(tx)}
                                      className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-accent hover:border-[#A7E2C3] shadow-sm"
                                    >
                                      <Edit2 size={16} />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled
                                      title={language === "ar" ? "تعديل المدفوعات يتم من ملف المريض" : "Edit payments from patient profile"}
                                      className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-300 shadow-sm cursor-not-allowed"
                                    >
                                      <Edit2 size={16} />
                                    </button>
                                  )}
                                </Protect>
                                <Protect permission="finance.delete">
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(tx.id, tx.description)}
                                    className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 shadow-sm"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </Protect>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile list */}
                <div className="lg:hidden flex-1 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                  {paginatedTransactions.map((tx) => {
                    const isExpense = tx.type === "expense";
                    return (
                      <div key={tx.id} className="p-4 hover:bg-slate-50 transition-colors flex flex-col gap-3">
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                isExpense ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                              }`}
                            >
                              {isExpense ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-slate-900 text-sm leading-snug">{tx.description}</h4>
                              {tx.patientId ? (
                                <button
                                  onClick={() => router.push(`/patients/${tx.patientId}?tab=finance&tx=${tx.id}`)}
                                  className="text-xs font-bold text-accent mt-1 truncate hover:underline text-start"
                                >
                                  {tx.patientName?.trim() ? tx.patientName.trim() : "—"}
                                </button>
                              ) : tx.patientName?.trim() ? (
                                <p className="text-xs font-bold text-accent mt-1 truncate">
                                  {tx.patientName.trim()}
                                </p>
                              ) : null}
                              <p className="text-[11px] font-bold text-slate-400 uppercase mt-1">
                                {tx.date} · {tx.category || tx.method || "Gen"}
                                {(tx.doctorName || tx.doctor) ? (
                                  <span className="text-accent ms-1">
                                    · Dr. {(tx.doctorName || tx.doctor || "").replace(/^Dr\.\s*/i, "").split(" ")[0]}
                                  </span>
                                ) : null}
                              </p>
                            </div>
                          </div>
                          <span className={`font-black text-sm tabular-nums shrink-0 ${isExpense ? "text-red-600" : "text-emerald-600"}`}>
                            {isExpense ? "−" : "+"}
                            {tx.val.toLocaleString()}
                          </span>
                        </div>
                        {(tx.doctorCommissionAmount || tx.labFee) && (
                          <div className="flex flex-wrap gap-1 ps-12">
                            {tx.doctorCommissionAmount ? (
                              <span className="text-[9px] bg-[#E8F7F0] text-accent px-2 py-0.5 rounded border border-[#A7E2C3] font-bold">
                                Doc: {tx.doctorCommissionAmount}
                              </span>
                            ) : null}
                            {tx.labFee ? (
                              <span className="text-[9px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded border border-orange-100 font-bold">
                                Lab: {tx.labFee}
                              </span>
                            ) : null}
                            {tx.clinicProfit !== undefined ? (
                              <span className="text-[9px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded border border-emerald-100 font-bold">
                                Net: {tx.clinicProfit}
                              </span>
                            ) : null}
                          </div>
                        )}
                        <div className="flex justify-end gap-2 ps-12">
                          <Protect permission="finance.edit">
                            {tx.type !== "payment" && tx.type !== "procedure" ? (
                              <button
                                type="button"
                                onClick={() => handleEdit(tx)}
                                className="p-2 rounded-lg border border-slate-200 text-slate-600"
                              >
                                <Edit2 size={16} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                title={language === "ar" ? "تعديل المدفوعات يتم من ملف المريض" : "Edit payments from patient profile"}
                                className="p-2 rounded-lg border border-slate-200 text-slate-300 cursor-not-allowed"
                              >
                                <Edit2 size={16} />
                              </button>
                            )}
                          </Protect>
                          <Protect permission="finance.delete">
                            <button
                              type="button"
                              onClick={() => handleDelete(tx.id, tx.description)}
                              className="p-2 rounded-lg border border-slate-200 text-red-600"
                            >
                              <Trash2 size={16} />
                            </button>
                          </Protect>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {totalPages > 1 && (
                  <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                    <span className="text-xs font-bold text-slate-500">
                      {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredList.length)} /{" "}
                      {filteredList.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      {generatePageNumbers().map((pageNum) => (
                        <button
                          key={pageNum}
                          type="button"
                          onClick={() => setCurrentPage(pageNum)}
                          className={`min-w-[2.25rem] h-9 px-2 rounded-xl text-xs font-black ${
                            currentPage === pageNum
                              ? "bg-accent text-white shadow-md"
                              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {pageNum}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* PDF REPORT MODAL */}
        {isPdfModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-md rounded-[1.5rem] shadow-2xl border border-slate-100 overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center">
                    <FileText size={16} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900 tracking-tight">{language === "ar" ? "خيارات تقرير PDF" : "PDF Report Options"}</h2>
                    <p className="text-[10px] text-slate-400 font-semibold">{language === "ar" ? "اختر محتوى التقرير" : "Customize your report"}</p>
                  </div>
                </div>
                <button onClick={() => setIsPdfModalOpen(false)} className="p-1.5 bg-slate-100 hover:bg-red-50 hover:text-red-500 rounded-full text-slate-400 transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Date Range */}
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">{language === "ar" ? "النطاق الزمني" : "Date Range"}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{language === "ar" ? "من" : "From"}</label>
                      <input
                        type="date"
                        value={pdfDateFrom}
                        onChange={e => setPdfDateFrom(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/15"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{language === "ar" ? "إلى" : "To"}</label>
                      <input
                        type="date"
                        value={pdfDateTo}
                        onChange={e => setPdfDateTo(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/15"
                      />
                    </div>
                  </div>
                </div>

                {/* Section checkboxes */}
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">{language === "ar" ? "المحتوى" : "Include in Report"}</p>
                  <div className="space-y-1.5">
                    {([
                      { key: 'kpis', label: language === 'ar' ? '📊 ملخص المؤشرات (KPI)' : '📊 Summary KPIs' },
                      { key: 'charts', label: language === 'ar' ? '📈 مخطط الدخل مقابل المصروفات' : '📈 Income vs Expenses Chart' },
                      { key: 'income', label: language === 'ar' ? '💚 جدول الدخل' : '💚 Income Transactions Table' },
                      { key: 'expenses', label: language === 'ar' ? '🔴 جدول المصروفات' : '🔴 Expense Transactions Table' },
                      { key: 'commissions', label: language === 'ar' ? '🟡 تفاصيل العمولات' : '🟡 Doctor Commission Breakdown' },
                    ] as { key: keyof typeof pdfSections; label: string }[]).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-all">
                        <div
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
                            pdfSections[key] ? 'bg-slate-900 border-slate-900' : 'border-slate-300'
                          }`}
                          onClick={() => setPdfSections(prev => ({ ...prev, [key]: !prev[key] }))}
                        >
                          {pdfSections[key] && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-slate-700 select-none">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleExport('download')}
                    disabled={isExporting || isLoading}
                    className="flex-1 inline-flex justify-center items-center gap-2 bg-slate-900 text-white hover:bg-slate-700 px-4 py-3 rounded-xl font-bold text-xs disabled:opacity-50 transition-colors shadow-md"
                  >
                    {isExporting && exportTarget === 'download' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {language === 'ar' ? 'تنزيل PDF' : 'Download PDF'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL FOR MANUAL ENTRIES */}
        {isModalOpen && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white w-full max-w-sm rounded-[1.5rem] shadow-2xl border border-slate-100 overflow-hidden">
                 <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h2 className="text-base font-bold text-slate-900 tracking-tight">{editingId ? 'Edit Manual Entry' : 'Manual Ledger Entry'}</h2>
                    <button onClick={closeModal} className="p-1.5 bg-slate-100 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500"><X size={16}/></button>
                 </div>
                 <form onSubmit={handleSave} className="p-5 space-y-4">
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                       <button type="button" onClick={() => setFormType('income')} className={`flex-1 py-1.5 text-[11px] font-bold uppercase rounded-md ${formType === 'income' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>Income</button>
                       <button type="button" data-tour="finance-type-expense" onClick={() => setFormType('expense')} className={`flex-1 py-1.5 text-[11px] font-bold uppercase rounded-md ${formType === 'expense' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}>Expense</button>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">{t('date')}</label>
                       <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-lg text-xs font-semibold text-slate-900 outline-none focus:border-accent-soft"/>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">{t('description')}</label>
                       <input required value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Electricity Bill" data-tour="finance-expense-desc" className="w-full px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-lg text-xs font-semibold text-slate-900 outline-none focus:border-accent-soft"/>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                       <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">{language === 'ar' ? 'المبلغ' : 'Amount'}</label>
                          <input required type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-lg text-xs font-semibold text-slate-900 outline-none focus:border-accent-soft"/>
                       </div>
                       <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider pl-1">{t('category')}</label>
                          <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-lg text-xs font-semibold text-slate-900 outline-none focus:border-accent-soft">
                             <option value="General">General</option><option value="Supplies">Supplies</option><option value="Rent">Rent</option><option value="Salary">Salary</option><option value="Lab">Lab</option>
                          </select>
                       </div>
                    </div>
                    <button data-tour="finance-expense-save" type="submit" className="w-full py-3 bg-slate-900 text-white rounded-lg font-bold text-xs hover:bg-slate-800 active:scale-95 shadow-sm mt-2 flex justify-center items-center gap-1.5"><Save size={14}/> {t('save')}</button>
                 </form>
              </div>
            </div>
        )}
      </div>
    </PermissionGuard>
  );
}
