"use client";

/**
 * What the clinic owes each lab.
 *
 * A debt list, not a second set of books. The lab fee already came off profit when the treatment
 * was saved, so nothing on this screen touches the ledger — paying a lab settles a cost that was
 * recorded months ago rather than creating a new one. `labAccounts.ts` carries the reasoning.
 */

import { useMemo, useState } from "react";
import {
  Banknote,
  ChevronDown,
  Loader2,
  Printer,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Protect from "@/components/Protect";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { localYmd } from "@/lib/clinicDate";
import type { DentalLab } from "@/lib/dentalLabs";
import { workTypeLabel, type LabCase } from "@/lib/labCases";
import {
  LAB_PAYMENT_METHODS,
  buildStatement,
  isBillable,
  labAccounts,
  labAccountsTotal,
  type LabPayment,
} from "@/lib/labAccounts";
import { deleteLabPayment, recordLabPayment } from "@/lib/labCaseWrite";
import { loadLabOrderClinic, printLabStatement } from "@/lib/labOrderPrint";

const INPUT =
  "w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all";

function money(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default function LabAccountsPanel({
  labs,
  cases,
  payments,
  currentUserName,
}: {
  labs: DentalLab[];
  cases: LabCase[];
  payments: LabPayment[];
  currentUserName?: string;
}) {
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";

  const [openLab, setOpenLab] = useState("");
  const [payingLab, setPayingLab] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localYmd());
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState("");

  const accounts = useMemo(() => labAccounts(labs, cases, payments), [labs, cases, payments]);
  const totals = useMemo(() => labAccountsTotal(accounts, cases), [accounts, cases]);

  const resetForm = () => {
    setPayingLab("");
    setAmount("");
    setReference("");
    setDate(localYmd());
    setMethod("cash");
  };

  const submitPayment = async (lab: DentalLab) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      showToast(isAr ? "اكتب مبلغ أكبر من صفر" : "Enter an amount greater than zero", "error");
      return;
    }
    setBusy(lab.id);
    try {
      await recordLabPayment({
        labId: lab.id,
        labName: lab.name,
        amount: value,
        date,
        method,
        reference: reference.trim(),
        createdBy: currentUserName,
      });
      showToast(
        isAr ? `اتسجل دفع ${money(value)} لـ ${lab.name}` : `Paid ${money(value)} to ${lab.name}`,
        "success"
      );
      resetForm();
    } catch (err) {
      console.error("Lab payment failed", err);
      showToast(isAr ? "فشل تسجيل الدفع" : "Could not record the payment", "error");
    } finally {
      setBusy("");
    }
  };

  const removePayment = async (payment: LabPayment) => {
    const ok = await confirm(
      isAr
        ? `حذف دفعة ${money(payment.amount)} لـ ${payment.labName}؟`
        : `Delete the ${money(payment.amount)} payment to ${payment.labName}?`,
      { tone: "danger", confirmLabel: isAr ? "حذف" : "Delete" }
    );
    if (!ok) return;
    setBusy(payment.id);
    try {
      await deleteLabPayment(payment.id);
      showToast(isAr ? "اتحذفت الدفعة" : "Payment deleted", "info");
    } catch {
      showToast(isAr ? "فشل الحذف" : "Could not delete it", "error");
    } finally {
      setBusy("");
    }
  };

  const printStatement = async (lab: DentalLab) => {
    setBusy(lab.id);
    try {
      const account = accounts.find((a) => a.labId === lab.id);
      if (!account) return;
      const { lines, closing } = buildStatement(lab.id, cases, payments, (c) =>
        [workTypeLabel(c.workType, language), c.workDescription].filter(Boolean).join(" · ")
      );
      const clinic = await loadLabOrderClinic("");
      await printLabStatement({
        clinicName: clinic.name,
        clinicPhone: clinic.phone,
        account,
        lines,
        closing,
        unpricedCount: cases.filter((c) => c.labId === lab.id && isBillable(c) && !(Number(c.agreedPrice) > 0)).length,
        generatedOn: localYmd(),
        language,
      });
      showToast(isAr ? "بيفتح كشف الحساب" : "Opening the statement", "success");
    } catch (err) {
      console.error("Statement print failed", err);
      showToast(isAr ? "فشلت الطباعة" : "Could not print the statement", "error");
    } finally {
      setBusy("");
    }
  };

  if (labs.length === 0) {
    return (
      <div className="py-20 px-6 text-center bg-white border border-slate-200/80 rounded-2xl xl:rounded-3xl shadow-sm ring-1 ring-slate-100">
        <div className="w-14 h-14 rounded-2xl bg-slate-50 text-slate-300 flex items-center justify-center mx-auto mb-4">
          <Banknote size={26} />
        </div>
        <p className="text-sm font-bold text-slate-500">
          {isAr ? "مفيش معامل مسجلة." : "No labs are set up yet."}
        </p>
        <p className="text-xs font-semibold text-slate-400 mt-2">
          {isAr ? "الإعدادات ← المعامل" : "Settings → Dental Labs"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: isAr ? "مسلّم" : "Delivered", value: totals.delivered, tone: "text-slate-900" },
          { label: isAr ? "مدفوع" : "Paid", value: totals.paid, tone: "text-emerald-600" },
          { label: isAr ? "المتبقي عليك" : "You owe", value: totals.outstanding, tone: totals.outstanding > 0 ? "text-rose-600" : "text-slate-400" },
          { label: isAr ? "لسه في المعامل" : "Still at labs", value: totals.committed, tone: "text-sky-600" },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm ring-1 ring-slate-100">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{t.label}</p>
            <p className={`text-xl xl:text-2xl font-black tabular-nums mt-2 ${t.tone}`}>{money(t.value)}</p>
          </div>
        ))}
      </div>

      {/* The number that explains a disagreement with the lab's own invoice, before it happens. */}
      {totals.unpriced > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
          <TriangleAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-amber-800 leading-relaxed">
            {isAr
              ? `${totals.unpriced} حالة مسلّمة من غير سعر متفق عليه، فمش داخلة في الإجمالي. دي غالبًا سبب اختلاف حسابك عن فاتورة المعمل — افتح الحالة وحط السعر.`
              : `${totals.unpriced} delivered case(s) carry no agreed price, so they are not in these totals. That is the usual reason your figure and a lab's invoice disagree — open the case and add the price.`}
          </p>
        </div>
      )}

      {/* Per lab */}
      <div className="space-y-3">
        {accounts.map((account) => {
          const lab = labs.find((l) => l.id === account.labId)!;
          const expanded = openLab === account.labId;
          const labPayments = payments
            .filter((p) => p.labId === account.labId)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));

          return (
            <div key={account.labId} className="bg-white border border-slate-200/80 rounded-2xl shadow-sm ring-1 ring-slate-100 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                <button
                  onClick={() => setOpenLab(expanded ? "" : account.labId)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-start"
                >
                  <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-slate-800 truncate">{account.labName}</span>
                    <span className="block text-[11px] font-bold text-slate-400">
                      {account.deliveredCount} {isAr ? "مسلّمة" : "delivered"}
                      {account.committedCount > 0 && ` · ${account.committedCount} ${isAr ? "في المعمل" : "at the lab"}`}
                      {account.remakesAtLabCost > 0 &&
                        ` · ${account.remakesAtLabCost} ${isAr ? "إعادة على حسابهم" : "remade at their cost"}`}
                    </span>
                  </span>
                </button>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-end">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      {isAr ? "المتبقي" : "Outstanding"}
                    </p>
                    <p className={`text-lg font-black tabular-nums ${account.outstanding > 0 ? "text-rose-600" : "text-slate-400"}`}>
                      {money(account.outstanding)}
                    </p>
                  </div>
                  <button
                    onClick={() => void printStatement(lab)}
                    disabled={busy === account.labId}
                    className="p-2 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                    title={isAr ? "طباعة كشف الحساب" : "Print statement"}
                  >
                    {busy === account.labId ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                  </button>
                  <Protect permission="finance.add">
                    <button
                      onClick={() => {
                        setPayingLab(payingLab === account.labId ? "" : account.labId);
                        setOpenLab(account.labId);
                        // Offered, not imposed: a clinic usually settles the whole balance, and
                        // typing it again from the number directly above is pure friction.
                        setAmount(account.outstanding > 0 ? String(Math.round(account.outstanding)) : "");
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-wide hover:bg-slate-700 transition-colors whitespace-nowrap"
                    >
                      {isAr ? "تسجيل دفع" : "Record payment"}
                    </button>
                  </Protect>
                </div>
              </div>

              {payingLab === account.labId && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-4 grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      {isAr ? "المبلغ" : "Amount"}
                    </label>
                    <input type="number" min={0} dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      {isAr ? "التاريخ" : "Date"}
                    </label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      {isAr ? "الطريقة" : "Method"}
                    </label>
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT}>
                      {LAB_PAYMENT_METHODS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {isAr ? m.ar : m.en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      {isAr ? "رقم مرجعي" : "Reference"}
                    </label>
                    <input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void submitPayment(lab)}
                      disabled={busy === lab.id}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {busy === lab.id ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
                      {isAr ? "حفظ" : "Save"}
                    </button>
                    <button
                      onClick={resetForm}
                      className="px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide text-slate-500 hover:bg-slate-200/60 transition-colors"
                    >
                      {isAr ? "إلغاء" : "Cancel"}
                    </button>
                  </div>
                  <p className="col-span-2 lg:col-span-5 text-[11px] font-semibold text-slate-500 leading-relaxed">
                    {isAr
                      ? "ده بيسدد حساب المعمل بس. تكلفة المعمل اتحسبت خلاص وقت تسجيل العلاج، فالدفعة دي مش مصروف جديد ومش هتظهر تاني في تقارير الأرباح."
                      : "This settles the lab's account only. The lab cost was already booked when the treatment was saved, so this payment is not a new expense and will not appear again in your profit reports."}
                  </p>
                </div>
              )}

              {expanded && (
                <div className="border-t border-slate-100 p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      [isAr ? "مسلّم" : "Delivered", account.delivered],
                      [isAr ? "مدفوع" : "Paid", account.paid],
                      [isAr ? "في المعمل" : "At the lab", account.committed],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl bg-slate-50/60 border border-slate-200 p-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
                        <p className="text-sm font-black text-slate-700 tabular-nums mt-1">{money(Number(value))}</p>
                      </div>
                    ))}
                  </div>

                  {labPayments.length === 0 ? (
                    <p className="text-xs font-semibold text-slate-400 py-2">
                      {isAr ? "مفيش دفعات مسجلة للمعمل ده." : "No payments recorded to this lab yet."}
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                      {labPayments.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50/60 transition-colors">
                          <span className="text-xs font-bold text-slate-400 tabular-nums shrink-0" dir="ltr">
                            {p.date}
                          </span>
                          <span className="flex-1 min-w-0 text-xs font-semibold text-slate-500 truncate">
                            {[
                              LAB_PAYMENT_METHODS.find((m) => m.id === p.method)?.[isAr ? "ar" : "en"] || p.method,
                              p.reference,
                              p.createdBy,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="text-sm font-black text-emerald-600 tabular-nums shrink-0">
                            {money(p.amount)}
                          </span>
                          <Protect permission="finance.delete">
                            <button
                              onClick={() => void removePayment(p)}
                              disabled={busy === p.id}
                              className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                              aria-label={isAr ? "حذف" : "Delete"}
                            >
                              {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </Protect>
                        </div>
                      ))}
                    </div>
                  )}

                  {account.remakesTotal > 0 && (
                    <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                      <RotateCcw size={13} className="text-slate-400" />
                      {isAr
                        ? `${account.remakesTotal} إعادة عمل، منهم ${account.remakesAtLabCost} على حساب المعمل`
                        : `${account.remakesTotal} remake(s), ${account.remakesAtLabCost} at the lab's own cost`}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
