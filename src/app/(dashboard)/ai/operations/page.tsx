"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  Check,
  Loader2,
  Package,
  Settings,
  Sparkles,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";
import type { RecallReport } from "@/lib/automation/recallDue";
import type { InventoryAlertReport } from "@/lib/automation/inventoryAlerts";/**
 * Recall list and low-stock alerts on one page.
 *
 * Both are "config-first" features: they read a number the clinic has to state, and when it is
 * missing the page says so and links to the setting rather than showing an empty list that reads
 * as good news.
 */
export default function OperationsPage() {
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";

  const [recalls, setRecalls] = useState<RecallReport | null>(null);
  const [inventory, setInventory] = useState<InventoryAlertReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error(isAr ? "انتهت الجلسة." : "Session expired.");

      const res = await fetch(`/api/ai/recalls?clinicId=${encodeURIComponent(clinicId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Scan failed");

      setRecalls(data.recalls as RecallReport);
      setInventory(data.inventory as InventoryAlertReport);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Scan failed", "error");
    } finally {
      setLoading(false);
    }
  }, [clinicId, isAr, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PermissionGuard permission="dashboard.view">
      <div className="min-h-screen bg-slate-50/50 pb-24 lg:pb-10 text-slate-800" dir={isRTL ? "rtl" : "ltr"}>
        <div className="max-w-[1100px] mx-auto p-4 md:p-6 space-y-6">
          <div>
            <div className="flex items-center gap-2 text-violet-600">
              <Sparkles size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">
                {isAr ? "ذكاء ألفا" : "Alpha Intelligence"}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight mt-1">
              {isAr ? "متابعات ومخزون" : "Recalls & Stock"}
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-1 max-w-2xl">
              {isAr
                ? "المرضى المستحقون للكشف الدوري، والأصناف التي أوشكت على النفاد."
                : "Patients due for a check-up, and supplies running low."}
            </p>
          </div>

          {loading ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 flex justify-center">
              <Loader2 size={24} className="animate-spin text-slate-300" />
            </div>
          ) : (
            <>
              {/* --- Recalls --- */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={16} className="text-violet-600" />
                    <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                      {isAr ? "مستحقون للمتابعة" : "Due for check-up"}
                    </h2>
                  </div>
                  {recalls?.configured && (
                    <span className="text-xs font-black text-slate-400">{recalls.counts.due}</span>
                  )}
                </div>

                {/* Unconfigured is its own state — an empty list would read as "nobody is due". */}
                {recalls && !recalls.configured ? (
                  <div className="p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-4">
                      <AlertCircle size={22} />
                    </div>
                    <p className="text-sm font-black text-slate-900">
                      {isAr ? "لم يتم ضبط فترة المتابعة" : "No recall interval set"}
                    </p>
                    <p className="text-[13px] font-medium text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                      {isAr
                        ? "لا يمكن تحديد المرضى المتأخرين قبل أن تحدد سياسة عيادتك. لن نفترض رقماً نيابةً عنك."
                        : "Nobody can be flagged as overdue until you state your clinic's policy. We will not assume a number on your behalf."}
                    </p>
                    <Link
                      href="/settings?tab=recall"
                      className="inline-flex items-center gap-2 mt-5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                    >
                      <Settings size={13} />
                      {isAr ? "اضبطها الآن" : "Set it now"}
                    </Link>
                  </div>
                ) : recalls && recalls.patients.length === 0 ? (
                  <div className="p-10 text-center">
                    <Check size={24} className="text-emerald-500 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-600">
                      {isAr ? "لا يوجد مرضى متأخرون." : "Nobody is overdue."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {recalls?.patients.map((p) => (
                      <div key={p.patientId} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/patients/${p.patientId}`}
                            className="inline-flex items-center gap-1.5 font-bold text-slate-900 hover:text-violet-600 transition-colors"
                          >
                            {p.patientName}
                            <ArrowUpRight size={13} />
                          </Link>
                          <p className="text-[12px] font-medium text-slate-500 mt-0.5">
                            {isAr
                              ? `آخر زيارة ${p.lastVisitDate}`
                              : `Last visit ${p.lastVisitDate}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {!p.phone && (
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                              {isAr ? "بدون رقم" : "No phone"}
                            </span>
                          )}
                          <span className="text-[10px] font-black uppercase tracking-widest text-violet-700 bg-violet-50 border border-violet-200 px-2 py-1 rounded-lg">
                            {isAr
                              ? `متأخر ${Math.round(p.daysOverdue / 30)} شهر`
                              : `${Math.round(p.daysOverdue / 30)}mo overdue`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {recalls && recalls.notes.length > 0 && (
                  <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
                    {recalls.notes.map((n, i) => (
                      <p key={i} className="text-[11px] font-medium text-slate-400 leading-relaxed">
                        {n}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* --- Inventory --- */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-violet-600" />
                    <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                      {isAr ? "مخزون منخفض" : "Running low"}
                    </h2>
                  </div>
                  <span className="text-xs font-black text-slate-400">{inventory?.counts.low ?? 0}</span>
                </div>

                {inventory && inventory.lowStock.length === 0 ? (
                  <div className="p-10 text-center">
                    <Check size={24} className="text-emerald-500 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-600">
                      {inventory.counts.total === 0
                        ? isAr ? "لا توجد أصناف مسجلة بعد." : "No inventory items recorded yet."
                        : isAr ? "لا يوجد نقص في المخزون." : "Nothing is running low."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {inventory?.lowStock.map((item) => (
                      <div key={item.itemId} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{item.name}</p>
                          <p className="text-[12px] font-medium text-slate-500 mt-0.5">{item.category}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[12px] font-bold text-slate-500 tabular-nums">
                            {item.stock}
                            {item.isPercentage ? "%" : ` ${item.unit}`}
                            <span className="text-slate-300"> / {item.minStock}</span>
                          </span>
                          <span
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border ${
                              item.outOfStock
                                ? "text-rose-700 bg-rose-50 border-rose-200"
                                : "text-amber-700 bg-amber-50 border-amber-200"
                            }`}
                          >
                            {item.outOfStock
                              ? isAr ? "نفد" : "Out"
                              : isAr ? "منخفض" : "Low"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {inventory && inventory.notes.length > 0 && (
                  <div className="px-6 py-3 bg-amber-50 border-t border-amber-200">
                    {inventory.notes.map((n, i) => (
                      <p key={i} className="text-[11px] font-medium text-amber-900 leading-relaxed">
                        {n}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}
