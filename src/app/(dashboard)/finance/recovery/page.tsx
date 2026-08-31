"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  FileWarning,
  Loader2,
  MessageCircle,
  Phone,
  PhoneOff,
  RefreshCcw,
  Search,
  Wallet,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { onSnapshot, setDoc } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { openWhatsAppWithText } from "@/lib/whatsappManual";
import type { RecoveryList, RecoveryRow } from "@/lib/paymentRecovery";

/**
 * Where a patient stands after someone has actually spoken to them.
 *
 * Kept separate from the money itself: the ledger says what is owed, this says what happened when
 * the clinic chased it. A patient who promised to pay on Saturday still owes the money — but the
 * person making calls on Thursday needs to know not to ring them again.
 */
type FollowUpStatus = "open" | "promised" | "settled" | "ignored";

interface FollowUp {
  status: FollowUpStatus;
  lastContactedAt?: string;
  note?: string;
  updatedByName?: string;
}

type SortKey = "amount" | "age" | "name";
type Filter = "all" | "balance" | "unbilled" | "no_phone" | "needs_call";

const FOLLOWUP_COLLECTION = "recovery_followups";

export default function RecoverPaymentsPage() {
  const { language, isRTL } = useLanguage();
  const { clinic, clinicId } = useClinic();
  const { user } = useAuth();
  const { showToast } = useUI();
  const isAr = language === "ar";

  const [list, setList] = useState<RecoveryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<Record<string, FollowUp>>({});

  const txt = {
    title: isAr ? "تحصيل المستحقات" : "Recover Payments",
    subtitle: isAr
      ? "كل مريض عليه مبلغ للعيادة، ورقم هاتفه، مرتبين من الأكبر إلى الأصغر."
      : "Every patient who owes the clinic money, with their phone number, largest first.",
    refresh: isAr ? "تحديث" : "Refresh",
    loading: isAr ? "جارٍ حساب المستحقات..." : "Working out who owes what...",
    searchPlaceholder: isAr ? "ابحث بالاسم أو رقم الهاتف..." : "Search by name or phone number...",
    totalOwed: isAr ? "إجمالي المستحق" : "Total owed",
    unpaid: isAr ? "مفوتر وغير مدفوع" : "Billed, not paid",
    neverInvoiced: isAr ? "علاج لم يُفوتر" : "Treated, never invoiced",
    patients: isAr ? "مريض" : "patients",
    all: isAr ? "الكل" : "All",
    onlyBalance: isAr ? "أرصدة غير مدفوعة" : "Unpaid balances",
    onlyUnbilled: isAr ? "لم يُفوتر" : "Never invoiced",
    noPhone: isAr ? "بدون رقم" : "No phone",
    needsCall: isAr ? "لم يتم الاتصال" : "Not contacted yet",
    sortAmount: isAr ? "الأكبر مبلغاً" : "Largest amount",
    sortAge: isAr ? "الأقدم" : "Oldest debt",
    sortName: isAr ? "الاسم" : "Name",
    empty: isAr ? "لا توجد مستحقات. كل شيء محصّل." : "Nothing outstanding. Everything is collected.",
    noMatch: isAr ? "لا نتائج تطابق بحثك." : "No one matches that search.",
    call: isAr ? "اتصال" : "Call",
    whatsapp: isAr ? "واتساب" : "WhatsApp",
    file: isAr ? "الملف" : "File",
    noPhoneOnFile: isAr ? "لا يوجد رقم هاتف في الملف" : "No phone number on file",
    optedOut: isAr ? "رفض استقبال الرسائل" : "Opted out of messages",
    lastSeen: isAr ? "آخر حركة" : "Last activity",
    daysAgo: isAr ? "يوم" : "days ago",
    noActivity: isAr ? "لا توجد حركة مؤرخة" : "no dated activity",
    detailsUnbilled: isAr ? "علاج مسجل ولم يُفوتر:" : "Recorded but never invoiced:",
    invoiceFirst: isAr
      ? "هذا المبلغ لم يُطلب من المريض بعد — افتح ملفه وسجّل الفاتورة أولاً قبل الاتصال به."
      : "The patient has never been asked for this — open their file and invoice it before you call.",
    statusOpen: isAr ? "لم يتم التواصل" : "Not contacted",
    statusPromised: isAr ? "وعد بالدفع" : "Promised to pay",
    statusSettled: isAr ? "تم التحصيل" : "Collected",
    statusIgnored: isAr ? "تم التجاهل" : "Written off",
    markedBy: isAr ? "بواسطة" : "by",
    whatsappBody: isAr ? "نص الرسالة" : "Message",
    misTitle: isAr ? "دفعات على العلاج الخطأ" : "Payments on the wrong treatment",
    misSubtitle: isAr
      ? "هذه المبالغ مسجلة على علاج لا يتحملها، فرصيد المريض خطأ بنفس المقدار — لصالحه. لن تظهر في القائمة أعلاه لأن القائمة تعرض المدينين فقط."
      : "These amounts settle a treatment that cannot carry them, so the patient's balance is wrong by that much — in their favour. They cannot appear on the list above, which shows debtors only.",
    misOver: isAr ? "أكثر من قيمة العلاج" : "More than the treatment costs",
    misOrphan: isAr ? "العلاج محذوف" : "Treatment deleted",
    misExcess: isAr ? "الفرق" : "Off by",
    misFix: isAr
      ? "افتح ملف المريض ← المالية ← عدّل الدفعة واختر العلاج الصحيح، أو حوّلها تحت الحساب."
      : "Open the patient's file → Finance → edit the payment and pick the treatment it belongs to, or move it to their account.",
    misOrphanFix: isAr
      ? "العلاج الذي كانت تخصه لم يعد موجودًا. عدّل الدفعة واختر العلاج الصحيح، أو حوّلها تحت الحساب."
      : "The treatment it settled no longer exists. Edit the payment and pick the right treatment, or move it to the patient's account.",
    misPayments: isAr ? "دفعة" : "payment(s)",
    misOpen: isAr ? "افتح المالية" : "Open finance",
  };

  const money = useCallback(
    (n: number) => `${Math.round(n).toLocaleString(isAr ? "ar-EG" : "en-US")} EGP`,
    [isAr]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(isAr ? "انتهت الجلسة" : "Session expired");

      const res = await fetch("/api/finance/recovery", { headers: { Authorization: `Bearer ${idToken}` } });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not load the list");

      setList(data as RecoveryList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the list");
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  useEffect(() => {
    if (!clinicId) return;
    void load();
  }, [clinicId, load]);

  // Follow-up state is small and changes as staff work through the list together, so it streams
  // live rather than being folded into the server scan — two people making calls at the same time
  // see each other's progress instead of ringing the same patient twice.
  useEffect(() => {
    if (!clinicId) return;
    const unsub = onSnapshot(
      getClinicCollection(FOLLOWUP_COLLECTION),
      (snap) => {
        const next: Record<string, FollowUp> = {};
        snap.docs.forEach((d) => {
          next[d.id] = d.data() as FollowUp;
        });
        setFollowUps(next);
      },
      (err) => console.error("Could not read follow-ups", err)
    );
    return () => unsub();
  }, [clinicId]);

  const setFollowUpStatus = async (row: RecoveryRow, status: FollowUpStatus) => {
    try {
      await setDoc(
        getClinicDoc(FOLLOWUP_COLLECTION, row.patientId),
        {
          status,
          patientName: row.patientName,
          lastContactedAt: new Date().toISOString(),
          updatedByName: user?.name || user?.email || "",
          amountAtContact: row.totalOwed,
        },
        { merge: true }
      );
    } catch (e) {
      showToast(isAr ? "تعذّر حفظ الحالة" : "Could not save that", "error");
    }
  };

  const chaseMessage = (row: RecoveryRow) => {
    const clinicName = clinic?.name || "our clinic";
    return isAr
      ? `مرحباً ${row.patientName}، نود تذكيركم بوجود مبلغ ${Math.round(row.balance)} جنيه مستحق لدى ${clinicName}. برجاء التواصل معنا لترتيب السداد. شكراً لكم.`
      : `Hello ${row.patientName}, this is a friendly reminder that ${Math.round(row.balance)} EGP is outstanding on your account at ${clinicName}. Please get in touch to arrange payment. Thank you.`;
  };

  const rows = useMemo(() => {
    if (!list) return [];
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");

    let out = list.rows.filter((row) => {
      if (filter === "balance" && row.balance <= 0) return false;
      if (filter === "unbilled" && row.unbilled <= 0) return false;
      if (filter === "no_phone" && row.phone) return false;
      if (filter === "needs_call") {
        const status = followUps[row.patientId]?.status;
        if (status && status !== "open") return false;
      }
      if (!term) return true;

      const nameHit = row.patientName.toLowerCase().includes(term);
      // Match on digits so "0100 123" finds a number stored as "+20100123..." — staff read numbers
      // off a screen or a scrap of paper, spacing and all.
      const phoneHit = digits.length > 0 && row.phone.replace(/\D/g, "").includes(digits);
      return nameHit || phoneHit;
    });

    out = [...out].sort((a, b) => {
      if (sortKey === "name") return a.patientName.localeCompare(b.patientName, isAr ? "ar" : "en");
      if (sortKey === "age") {
        // Patients with no dated activity sort last: there is nothing to say they have been
        // waiting a long time, and putting them on top would push real stale debt down.
        const ageA = a.ageDays ?? -1;
        const ageB = b.ageDays ?? -1;
        return ageB - ageA;
      }
      return b.totalOwed - a.totalOwed;
    });

    return out;
  }, [list, search, filter, sortKey, followUps, isAr]);

  const statusMeta: Record<FollowUpStatus, { label: string; className: string }> = {
    open: { label: txt.statusOpen, className: "bg-surface-muted text-ink-body border-line" },
    promised: { label: txt.statusPromised, className: "bg-amber-50 text-amber-700 border-amber-200" },
    settled: { label: txt.statusSettled, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    ignored: { label: txt.statusIgnored, className: "bg-surface-subtle text-slate-400 border-line" },
  };

  return (
    <PermissionGuard permission="access.finance">
      <div className="min-h-screen bg-slate-50/50 pb-24 lg:pb-10 text-slate-800" dir={isRTL ? "rtl" : "ltr"}>
        <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-teal-600">
                <BadgeDollarSign size={16} />
                <span className="text-[11px] font-black uppercase tracking-widest">
                  {isAr ? "المالية" : "Finance"}
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-ink tracking-tight mt-1">{txt.title}</h1>
              <p className="text-sm font-medium text-ink-muted mt-1 max-w-2xl">{txt.subtitle}</p>
            </div>

            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-md shadow-slate-200 active:scale-[0.98] disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
              {txt.refresh}
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-2xl p-4">
              <AlertCircle size={18} className="text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm font-bold text-rose-700">{error}</p>
            </div>
          )}

          {/* Totals */}
          {list && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-surface rounded-3xl border border-line p-5 shadow-sm">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{txt.totalOwed}</p>
                <p className="text-2xl font-black text-ink mt-2">{money(list.totals.totalOwed)}</p>
                <p className="text-xs font-bold text-slate-400 mt-1">
                  {list.totals.patients} {txt.patients}
                </p>
              </div>
              <div className="bg-surface rounded-3xl border border-line p-5 shadow-sm">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Wallet size={13} /> {txt.unpaid}
                </p>
                <p className="text-2xl font-black text-amber-600 mt-2">{money(list.totals.balance)}</p>
              </div>
              <div className="bg-surface rounded-3xl border border-line p-5 shadow-sm">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <FileWarning size={13} /> {txt.neverInvoiced}
                </p>
                <p className="text-2xl font-black text-rose-600 mt-2">{money(list.totals.unbilled)}</p>
              </div>
            </div>
          )}

          {/*
            Money sitting on a charge that cannot carry it.
            Placed above the debtors list rather than inside it, because these patients owe nothing
            — their books are simply wrong, in their favour, and the list below clamps a credit to
            zero on purpose so one patient's overpayment cannot cancel out another's arrears. Which
            is correct, and is exactly why this had to be its own section: without it a patient
            whose file reads BALANCE −1,200 appears on no report in the app.
          */}
          {list && list.misallocations.length > 0 && (
            <div className="bg-surface rounded-3xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="bg-amber-50 border-b border-amber-200 px-5 py-4">
                <p className="text-sm font-black text-amber-900 flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  {txt.misTitle} · {money(list.misallocatedTotal)}
                </p>
                <p className="text-xs font-bold text-amber-800/80 mt-1.5 leading-relaxed">{txt.misSubtitle}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {list.misallocations.map((mis) => (
                  <div key={`${mis.procedureId}-${mis.paymentIds.join("-")}`} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-ink text-sm truncate">{mis.patientName}</p>
                      <p className="text-xs font-bold text-ink-muted mt-1 leading-relaxed">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-black uppercase me-1.5">
                          {mis.kind === "orphaned_payment" ? txt.misOrphan : txt.misOver}
                        </span>
                        {mis.kind === "orphaned_payment" ? (
                          <>{money(mis.paidTotal)} · {mis.paymentIds.length} {txt.misPayments}</>
                        ) : (
                          <>{mis.procedureDescription} · {money(mis.procedureCost)} → {money(mis.paidTotal)}</>
                        )}
                        {mis.date && <span className="text-slate-400"> · {mis.date}</span>}
                      </p>
                      <p className="text-[11px] font-bold text-slate-400 mt-1 leading-relaxed">
                        {mis.kind === "orphaned_payment" ? txt.misOrphanFix : txt.misFix}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-end">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{txt.misExcess}</p>
                        <p className="text-lg font-black text-amber-700">{money(mis.excess)}</p>
                      </div>
                      {/*
                        `tx` is the row the patient's finance tab scrolls to and highlights, so
                        whoever is fixing this lands on it rather than hunting for it. For an
                        over-allocated charge that is the charge itself — it carries the "Overpaid
                        by" badge and opens to show every payment on it, and which one does not
                        belong is a judgement only a person can make. An orphan has no charge left
                        to land on, so it points at the payment.
                      */}
                      <Link
                        href={`/patients/${mis.patientId}?tab=finance&tx=${mis.kind === "orphaned_payment" ? (mis.paymentIds[0] || "") : mis.procedureId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 transition-colors"
                      >
                        {txt.misOpen} <ArrowUpRight size={13} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Anything the scan could not see or do — said plainly rather than left implied. */}
          {list && list.notes.length > 0 && (
            <div className="bg-surface border border-line rounded-2xl p-4 space-y-1.5">
              {list.notes.map((note) => (
                <p key={note} className="text-xs font-bold text-ink-muted flex items-start gap-2">
                  <AlertCircle size={13} className="text-slate-400 shrink-0 mt-0.5" />
                  {note}
                </p>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="bg-surface rounded-3xl border border-line p-4 shadow-sm space-y-3">
            <div className="relative">
              <Search
                size={16}
                className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={txt.searchPlaceholder}
                className={`w-full py-3 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-surface focus:border-teal-500 transition-all ${
                  isRTL ? "pr-11 pl-4" : "pl-11 pr-4"
                }`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["all", txt.all],
                  ["balance", txt.onlyBalance],
                  ["unbilled", txt.onlyUnbilled],
                  ["needs_call", txt.needsCall],
                  ["no_phone", txt.noPhone],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all border ${
                    filter === key
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}

              <div className={`flex items-center gap-2 ${isRTL ? "mr-auto" : "ml-auto"}`}>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="py-2 px-3 bg-surface-subtle border border-line rounded-xl text-xs font-black text-ink-body outline-none focus:border-teal-500"
                >
                  <option value="amount">{txt.sortAmount}</option>
                  <option value="age">{txt.sortAge}</option>
                  <option value="name">{txt.sortName}</option>
                </select>
              </div>
            </div>
          </div>

          {/* List */}
          {loading && !list ? (
            <div className="bg-surface rounded-3xl border border-line p-12 text-center">
              <Loader2 size={26} className="text-slate-400 animate-spin mx-auto mb-3" />
              <p className="text-sm font-bold text-ink-muted">{txt.loading}</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="bg-surface rounded-3xl border border-line border-dashed p-12 text-center">
              <CheckCircle2 size={26} className="text-emerald-500 mx-auto mb-3" />
              <p className="text-base font-black text-ink">
                {list && list.rows.length > 0 ? txt.noMatch : txt.empty}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => {
                const followUp = followUps[row.patientId];
                const status: FollowUpStatus = followUp?.status ?? "open";
                const isOpen = expanded === row.patientId;

                return (
                  <div
                    key={row.patientId}
                    className="bg-surface rounded-3xl border border-line shadow-sm overflow-hidden"
                  >
                    <div className="p-4 md:p-5 flex flex-wrap items-center gap-4">
                      {/* Who */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-black text-ink truncate">{row.patientName}</p>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${statusMeta[status].className}`}
                          >
                            {statusMeta[status].label}
                          </span>
                          {row.whatsappOptOut && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-surface-muted text-ink-muted border border-line">
                              {txt.optedOut}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {row.phone ? (
                            <a
                              href={`tel:${row.phone}`}
                              dir="ltr"
                              className="text-sm font-bold text-ink-body hover:text-teal-600 transition-colors inline-flex items-center gap-1.5"
                            >
                              <Phone size={13} /> {row.phone}
                            </a>
                          ) : (
                            <span className="text-xs font-bold text-rose-500 inline-flex items-center gap-1.5">
                              <PhoneOff size={13} /> {txt.noPhoneOnFile}
                            </span>
                          )}

                          <span className="text-xs font-bold text-slate-400">
                            {txt.lastSeen}:{" "}
                            {row.ageDays === undefined ? txt.noActivity : `${row.ageDays} ${txt.daysAgo}`}
                          </span>
                        </div>
                      </div>

                      {/* How much */}
                      <div className={isRTL ? "text-left" : "text-right"}>
                        <p className="text-xl font-black text-ink">{money(row.totalOwed)}</p>
                        <div className="flex items-center gap-2 justify-end mt-0.5 flex-wrap">
                          {row.balance > 0 && (
                            <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                              {money(row.balance)} · {txt.unpaid}
                            </span>
                          )}
                          {row.unbilled > 0 && (
                            <button
                              onClick={() => setExpanded(isOpen ? null : row.patientId)}
                              className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md inline-flex items-center gap-1 hover:bg-rose-100 transition-colors"
                            >
                              {money(row.unbilled)} · {txt.neverInvoiced}
                              <ChevronDown size={11} className={isOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* What to do */}
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={row.phone ? `tel:${row.phone}` : undefined}
                          onClick={() => row.phone && void setFollowUpStatus(row, "promised")}
                          aria-disabled={!row.phone}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition-colors ${
                            row.phone
                              ? "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100"
                              : "bg-surface-subtle text-slate-300 border-line cursor-not-allowed pointer-events-none"
                          }`}
                        >
                          <Phone size={13} /> {txt.call}
                        </a>

                        <button
                          onClick={() => {
                            if (!row.phone) return;
                            openWhatsAppWithText(row.phone, chaseMessage(row));
                            void setFollowUpStatus(row, "promised");
                          }}
                          disabled={!row.phone || row.whatsappOptOut}
                          title={row.whatsappOptOut ? txt.optedOut : txt.whatsapp}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 disabled:bg-surface-subtle disabled:text-slate-300 disabled:border-line disabled:cursor-not-allowed transition-colors"
                        >
                          <MessageCircle size={13} /> {txt.whatsapp}
                        </button>

                        <Link
                          href={`/patients/${row.patientId}?tab=finance`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border bg-surface-subtle text-ink-body border-line hover:bg-surface-muted transition-colors"
                        >
                          {txt.file} <ArrowUpRight size={13} />
                        </Link>
                      </div>
                    </div>

                    {/* Mark what happened. */}
                    <div className="px-4 md:px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                      {(["open", "promised", "settled", "ignored"] as FollowUpStatus[]).map((key) => (
                        <button
                          key={key}
                          onClick={() => void setFollowUpStatus(row, key)}
                          className={`text-[11px] font-black px-2.5 py-1 rounded-lg border transition-all ${
                            status === key
                              ? statusMeta[key].className
                              : "bg-surface text-slate-400 border-line hover:border-line-strong"
                          }`}
                        >
                          {statusMeta[key].label}
                        </button>
                      ))}
                      {followUp?.lastContactedAt && (
                        <span className="text-[11px] font-bold text-slate-400 ms-auto">
                          {new Date(followUp.lastContactedAt).toLocaleDateString(isAr ? "ar-EG" : "en-US")}
                          {followUp.updatedByName ? ` · ${txt.markedBy} ${followUp.updatedByName}` : ""}
                        </span>
                      )}
                    </div>

                    {/* The un-invoiced detail, so nobody chases a bill that was never sent. */}
                    {isOpen && row.unbilledItems.length > 0 && (
                      <div className="px-4 md:px-5 py-4 bg-rose-50/40 border-t border-rose-100">
                        <p className="text-[11px] font-black uppercase tracking-widest text-rose-500 mb-2">
                          {txt.detailsUnbilled}
                        </p>
                        <div className="space-y-1.5">
                          {row.unbilledItems.map((item) => (
                            <div key={item.noteId} className="flex items-center justify-between gap-3 text-sm">
                              <span className="font-bold text-slate-700 truncate">{item.procedure}</span>
                              <span className="text-xs font-bold text-slate-400 shrink-0">{item.date || "—"}</span>
                              <span className="font-black text-ink shrink-0">{money(item.cost)}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs font-bold text-rose-700 mt-3 leading-relaxed">{txt.invoiceFirst}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}
