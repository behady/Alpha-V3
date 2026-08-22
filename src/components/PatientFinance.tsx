"use client";

import { useState, useEffect, useMemo, Fragment } from "react";
import { 
  Plus, Wallet, Trash2, Printer, CreditCard, Edit2, 
  X, Save, Link as LinkIcon, ChevronDown, ChevronRight, Check, User, MessageCircle, Loader2, ScrollText, Clock
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { isDentistStaff } from "@/lib/staffRoles";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import {
  buildDentalReceiptPayloadFromLedger,
  downloadDentalReceiptPdf,
} from "@/lib/receiptPdfHtml";
import { parseLedgerProcedureDescription } from "@/lib/ledgerProcedureParse";
import { sendPatientPaymentWhatsApp } from "@/lib/sendPatientPaymentWhatsAppClient";
import { handleWhatsAppApiResult } from "@/lib/whatsappManual";
import {
  MoneyApiError,
  createPayment,
  deleteLedgerRow,
  updateLedgerRow,
} from "@/lib/moneyApi";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
function formatWhatsAppLedgerMessage(
  patientName: string,
  clinicName: string,
  totalTreatment: number,
  totalPaid: number,
  balance: number,
  ledgerItems: LedgerItem[]
): string {
  const toArDigits = (val: string | number): string => {
    const arabicNumbers = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
    return String(val).replace(/[0-9]/g, (w) => arabicNumbers[Number(w)]);
  };

  const today = new Date().toLocaleDateString("en-GB");

  let message = `أهلاً بيك ${patientName}، ✨\n`;
  message += `ده كشف حسابك من عيادة ${clinicName} 🏥\n\n`;
  message += `📅 التاريخ: ${toArDigits(today)}\n`;
  message += `👤 المريض: ${patientName}\n\n`;

  message += `💰 إجمالي العلاج: ${toArDigits(totalTreatment.toLocaleString("en-US"))} ج.م\n`;
  message += `💵 إجمالي المدفوع: ${toArDigits(totalPaid.toLocaleString("en-US"))} ج.م\n`;
  message += `❗ المتبقي المطلوب: ${toArDigits(balance.toLocaleString("en-US"))} ج.م\n\n`;

  message += `آخر التفاصيل 📋:\n`;

  const activeProcedures = ledgerItems
    .filter((t) => t.type === "procedure" && t.status !== "deleted" && t.status !== "cancelled")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  activeProcedures.forEach((item) => {
    const parsed = parseLedgerProcedureDescription(item.description);
    const dateAr = toArDigits(item.date || "—");
    const costAr = toArDigits(Number(item.cost).toLocaleString("en-US"));
    const teethInfo =
      parsed.teeth && !/^gen$/i.test(parsed.teeth.trim())
        ? ` (أسنان: ${toArDigits(parsed.teeth)})`
        : ` (أسنان: عام)`;

    message += `🔹 ${dateAr} | إجراء: ${parsed.procedureLine}${teethInfo} - ${costAr} ج.م\n`;
  });

  message += `\nلو عندك أي استفسار، إحنا دايماً هنا عشانك! 💙`;

  return message;
}

interface LedgerItem {
    id: string;
    date: string;
    description: string;
    type: 'procedure' | 'payment';
    cost: number;
    paid: number;
    method?: string; 
    procedureId?: string;
    doctorId?: string;
    doctorName?: string;
    doctor?: string; // <--- JUST ADD THIS LINE BACK IN
    doctorCommissionAmount?: number;
    clinicProfit?: number;
    labFee?: number;
    createdAt?: any;
    listPrice?: number;
    discountAmount?: number;
    discountMode?: string;
    discountPercent?: number | null;
    discountFixed?: number | null;
    status?: string;
    clinicalNoteId?: string;
    doctorCommissionPercentage?: number | null;
  }
export default function PatientFinance({ patientId }: { patientId: string }) {
  const { showToast, confirm } = useUI();
  const { language } = useLanguage();
  const { user } = useAuth();
  const { clinic, isReadOnly, isAdmin } = useClinic();
  
  const searchParams = useSearchParams();
  const highlightTxId = searchParams?.get("tx");

  const formatTxTime = (item: any): string | null => {
    if (item.createdAt?.toDate) {
      return item.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    if (item.createdAt?.seconds) {
      return new Date(item.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    if (typeof item.createdAt === 'string' && item.createdAt.includes('T')) {
      return new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    if (item.time) return item.time;
    return null;
  };

  const getTxUser = (item: any): string | null => {
    const u = item.receivedBy || item.addedBy || item.createdByName || item.createdBy || item.uploadedBy || item.doctorName;
    if (!u) return null;
    if (typeof u === 'string' && u.includes('@')) return u;
    return String(u).replace(/^Dr\.\s*/i, '');
  };

  const hasEditAccess = isAdmin || user?.permissions?.includes("finance.edit");
  const hasDeleteAccess = isAdmin || user?.permissions?.includes("finance.delete");
  
  const [transactions, setTransactions] = useState<LedgerItem[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]); // NEW: Store doctors for commissions
  const [loading, setLoading] = useState(true);
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  
  
  const [patientName, setPatientName] = useState("Patient");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientDob, setPatientDob] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [clinicInfo, setClinicInfo] = useState({ name: "Alpha Dental", address: "Cairo", phone: "", email: "", doctorName: "Dr. Ahmed" });

  const [editingItem, setEditingItem] = useState<LedgerItem | null>(null);

  const [totalCost, setTotalCost] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [balance, setBalance] = useState(0);

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payNote, setPayNote] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isAddingPaymentStateLocked, setIsAddingPaymentStateLocked] = useState(false); // Fix Scenario 1: Double submit state lock
  const [selectedProcedureId, setSelectedProcedureId] = useState<string>("");
  const [whatsappSendingId, setWhatsappSendingId] = useState<string | null>(null);
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [expandedProcs, setExpandedProcs] = useState<Record<string, boolean>>({});

  const toggleProcExpand = (id: string) => {
    setExpandedProcs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const txt = {
    totalTreatment: language === 'ar' ? "إجمالي العلاج" : "Total Treatment",
    totalPaid: language === 'ar' ? "إجمالي المدفوع" : "Total Paid",
    balanceDue: language === 'ar' ? "المبلغ المستحق" : "Balance Due",
    history: language === 'ar' ? "سجل المعاملات" : "Transaction History",
    print: language === 'ar' ? "تحميل إيصال PDF" : "Download PDF receipt",
    printPdfBusy: language === 'ar' ? "جاري الإنشاء…" : "Generating…",
    addPayment: language === 'ar' ? "إضافة دفعة" : "Add Payment",
    receivePayment: language === 'ar' ? "استلام دفعة" : "Receive Payment",
    linkProcedure: language === 'ar' ? "ربط بإجراء (اختياري)" : "Link to Procedure (Optional)",
    generalPayment: language === 'ar' ? "-- دفعة عامة --" : "-- General Payment --",
    descNote: language === 'ar' ? "الوصف / ملاحظات" : "Description / Notes",
    amount: language === 'ar' ? "المبلغ (ج.م)" : "Amount (EGP)",
    confirm: language === 'ar' ? "تأكيد" : "Confirm",
    editTrans: language === 'ar' ? "تعديل المعاملة" : "Edit Transaction",
    saveChanges: language === 'ar' ? "حفظ التعديلات" : "Save Changes",
    date: language === 'ar' ? "التاريخ" : "Date",
    description: language === 'ar' ? "الوصف" : "Description",
    type: language === 'ar' ? "النوع" : "Type",
    cost: language === 'ar' ? "تكلفة" : "Cost",
    paid: language === 'ar' ? "مدفوع" : "Paid",
    action: language === 'ar' ? "إجراء" : "Action",
    noRecords: language === 'ar' ? "لا توجد سجلات مالية" : "No financial records yet",
    payAccount: language === 'ar' ? "دفعة عامة" : "General Payment",
    payFor: language === 'ar' ? "دفعة مقابل" : "Payment for",
    paidSuccess: language === 'ar' ? "تم تسجيل الدفع" : "Payment recorded",
    addError: language === 'ar' ? "خطأ في التسجيل" : "Error adding payment",
    updateSuccess: language === 'ar' ? "تم التحديث" : "Transaction updated",
    updateError: language === 'ar' ? "فشل التحديث" : "Update failed",
    deleteConfirm: language === 'ar' ? "حذف هذه المعاملة؟" : "Delete this transaction?",
    deleteSuccess: language === 'ar' ? "تم الحذف" : "Transaction deleted",
    paidLabel: language === 'ar' ? "مكتمل" : "Paid",
    linked: language === 'ar' ? "مرتبط" : "Linked",
    method: language === 'ar' ? "الطريقة" : "Method",
    paidAmount: language === 'ar' ? "المبلغ المدفوع" : "Paid Amount",
    discountSummary: language === 'ar' ? "خصم" : "Discount",
    sendWhatsapp: language === 'ar' ? "واتساب" : "WhatsApp",
    sendReceiptWhatsapp: language === 'ar' ? "إرسال كشف حساب واتساب" : "Send Receipt on WhatsApp",
    whatsappSent: language === 'ar' ? "تم الإرسال عبر واتساب" : "Sent on WhatsApp",
    whatsappManual: language === 'ar' ? "افتح واتساب من الرسالة اللي هتظهر عشان تبعت" : "Open WhatsApp from the prompt to send it",
    receiptWhatsappSent: language === 'ar' ? "تم إرسال كشف الحساب عبر واتساب" : "Receipt sent on WhatsApp",
    whatsappFail: language === 'ar' ? "فشل إرسال واتساب" : "WhatsApp send failed",
    receiptWhatsappFail: language === 'ar' ? "فشل إرسال كشف الحساب" : "Receipt send failed",
    whatsappNeedAuth: language === 'ar' ? "سجّل الدخول أولاً" : "Sign in required",
  };

  useEffect(() => {
    if (!patientId) return;

    // Fetch Patient Info + Clinic branding for PDF receipt
    getDoc(getClinicDoc("patients", patientId)).then((snap) => {
        if(snap.exists()) {
            const data = snap.data();
            setPatientName(data.name || "Patient");
            setPatientPhone(data.phone || "");
            setPatientAddress(typeof data.address === "string" ? data.address : "");
            setPatientDob(typeof data.dateOfBirth === "string" ? data.dateOfBirth : "");
            setPatientGender(typeof data.gender === "string" ? data.gender : "");
        }
    });

    getDoc(getClinicDoc("settings", "clinic_info")).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as Record<string, unknown>;
      setClinicInfo({
        name: (typeof d.name === "string" && d.name.trim() ? d.name : typeof d.clinicName === "string" ? d.clinicName : "Alpha Dental") as string,
        address: (typeof d.address === "string" ? d.address : "Cairo") as string,
        phone: (typeof d.phone === "string" ? d.phone : "") as string,
        email: (typeof d.email === "string" ? d.email : "") as string,
        doctorName: (typeof d.doctorName === "string" ? d.doctorName : "Dr. Ahmed") as string,
      });
    });

    // Fetch Doctors for Commission Calculations
    getDocs(getClinicCollection("staff")).then(snap => {
        setDoctors(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((d: any) => isDentistStaff(d)));
    });

    const q = query(getClinicCollection("ledger"), where("patientId", "==", patientId));

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerItem));
      data.sort((a, b) => {
          const dA = a.date || "";
          const dB = b.date || "";
          if (dA !== dB) return dB.localeCompare(dA);
          const tA = (a.createdAt as any)?.toMillis?.() || 0;
          const tB = (b.createdAt as any)?.toMillis?.() || 0;
          return tB - tA;
      });
      setTransactions(data);
      
      const cost = data.reduce((sum, item) => sum + (item.type === "procedure" ? (Number(item.cost) || 0) : 0), 0);
      const paid = data.reduce((sum, item) => sum + (item.type === "payment" ? (Number(item.paid) || 0) : 0), 0);
      setTotalCost(cost);
      setTotalPaid(paid);
      setBalance(cost - paid);
      setLoading(false);
    });

    return () => unsub();
  }, [patientId, showToast]);

  useEffect(() => {
    if (highlightTxId && transactions.length > 0) {
      const targetTx = transactions.find(t => t.id === highlightTxId);
      if (targetTx?.type === 'payment' && targetTx.procedureId) {
        setExpandedProcs(prev => ({ ...prev, [targetTx.procedureId!]: true }));
      }
      
      setTimeout(() => {
        const el = document.getElementById(`tx-${highlightTxId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [highlightTxId, transactions]);

  const proceduresWithBalance = useMemo(() => {
    const rawProcs = transactions.filter(t => t.type === 'procedure');
    const payments = transactions.filter(t => t.type === 'payment');

    return rawProcs.map(proc => {
        const paidForThis = payments.filter(p => p.procedureId === proc.id).reduce((sum, p) => sum + (Number(p.paid) || 0), 0);
        const remaining = (Number(proc.cost) || 0) - paidForThis;
        return { ...proc, remaining: remaining > 0 ? remaining : 0, isPaid: remaining <= 0 };
    });
  }, [transactions]);

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAddingPaymentStateLocked) return; // Fix Scenario 1: Double submit lock
    if (!payAmount) return;

    const payNum = Number(payAmount);
    if (payNum < 0) {
        showToast(language === 'ar' ? "لا يمكن إضافة مبلغ بالسالب" : "Cannot add negative payment amount", "error");
        return;
    } // Fix Scenario 2: Negative Typo protection

    setIsAddingPaymentStateLocked(true);

    let finalDescription = payNote;

    // Description is the only thing worth composing here. The dentist, the lab fee and the
    // commission are resolved server-side from the procedure being settled — this screen used to
    // work them out itself, and the three other screens that took payments each had their own
    // version, two of which left them out entirely.
    if (selectedProcedureId) {
      const linkedProc = proceduresWithBalance.find(p => p.id === selectedProcedureId);
      if (linkedProc && !finalDescription) {
        finalDescription = `${txt.payFor} ${linkedProc.description.split('(')[0].trim()}`;
      }
    }
    if (!finalDescription) finalDescription = txt.payAccount;

    try {
      const { id: paymentId } = await createPayment({
        patientId,
        patientName,
        amount: payNum,
        method: payMethod,
        description: finalDescription,
        procedureId: selectedProcedureId || null,
        clinicId: clinic?.id,
      });

      const wa = await sendPatientPaymentWhatsApp({ patientId, ledgerId: paymentId });
      if (wa.error) {
        showToast(`${txt.whatsappFail}: ${wa.error}`.trim(), "error");
      }
      setIsAddingPayment(false);
      setIsDropdownOpen(false);
      setPayAmount(""); setPayNote(""); setSelectedProcedureId("");
      showToast(txt.paidSuccess, "success");
    } catch (err) {
      showToast(err instanceof MoneyApiError ? err.message : txt.addError, "error");
    } finally {
      setIsAddingPaymentStateLocked(false);
    }
  };

  const buildProcedureDiscountDescription = (
    baseDescription: string,
    listPrice: number,
    finalCost: number,
    discountAmount: number,
    mode: string | undefined,
    pct: number | null | undefined
  ) => {
    const base = baseDescription.split("—")[0].trim() || baseDescription;
    if (!listPrice || !discountAmount || discountAmount <= 0 || finalCost >= listPrice) return baseDescription;
    const tag =
      mode === "percent" && pct != null ? `${pct}% off` : mode === "fixed" ? `${discountAmount} EGP off` : "discount";
    return `${base} — Before ${listPrice} → After ${finalCost} (${tag})`;
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    try {
      // Inputs only. The charged amount, the commission and the linked note's copy of the cost are
      // all derived server-side — this screen used to compute them and send the answer, which meant
      // the stored figure was whatever the browser decided it was.
      const patch: Record<string, unknown> =
        editingItem.type === "procedure"
          ? {
              date: editingItem.date,
              description: editingItem.description,
              listPrice: Number(editingItem.listPrice) || Number(editingItem.cost) || 0,
              discountMode: editingItem.discountMode || "none",
              discountPercent: editingItem.discountPercent ?? null,
              discountFixed: editingItem.discountFixed ?? null,
            }
          : {
              date: editingItem.date,
              description: editingItem.description,
              paid: Number(editingItem.paid),
              method: editingItem.method || null,
            };

      await updateLedgerRow(editingItem.id, patch, clinic?.id);

      setEditingItem(null);
      showToast(txt.updateSuccess, "success");
    } catch (error) {
      showToast(error instanceof MoneyApiError ? error.message : txt.updateError, "error");
    }
  };

  const buildReceiptLedgerPayload = () => {
    let ageSex = "";
    if (patientDob) {
      const birth = new Date(patientDob);
      if (!Number.isNaN(birth.getTime())) {
        const age = Math.abs(new Date(Date.now() - birth.getTime()).getUTCFullYear() - 1970);
        ageSex = `${age} ${language === "ar" ? "سنة" : "yr"}`;
        if (patientGender) ageSex += ` · ${patientGender}`;
      }
    } else if (patientGender) {
      ageSex = patientGender;
    }

    const active = transactions.filter((t) => t.status !== "deleted" && t.status !== "cancelled");
    const totalTreatmentPdf = active.reduce((s, t) => s + (t.type === "procedure" ? Number(t.cost) || 0 : 0), 0);
    const totalPaidPdf = active.reduce((s, t) => s + (t.type === "payment" ? Number(t.paid) || 0 : 0), 0);

    return buildDentalReceiptPayloadFromLedger({
      clinicName: clinicInfo.name?.trim() || "Eleganza Dental Clinic",
      clinicPhone: clinicInfo.phone?.trim() || "+201551558269",
      clinicAddress: clinicInfo.address?.trim() || "برج الأمير, 74 شارع النزهة",
      leadDoctorName: clinicInfo.doctorName?.trim() || "Dr. Ahmed",
      patientName,
      patientPhone,
      patientAddress,
      patientAgeSex: ageSex || undefined,
      patientId,
      transactions: active.map((t) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        type: t.type,
        cost: Number(t.cost) || 0,
        paid: Number(t.paid) || 0,
        method: t.method,
        doctorName: t.doctorName || t.doctor,
        discountAmount: t.discountAmount,
        status: t.status,
      })),
      totals: {
        totalTreatment: totalTreatmentPdf,
        totalPaid: totalPaidPdf,
        balance: totalTreatmentPdf - totalPaidPdf,
      },
    });
  };

  const handlePrintReceipt = () => {
    const payload = buildReceiptLedgerPayload();
    downloadDentalReceiptPdf(payload, `Receipt-${patientId}.pdf`);
  };
  const handleSendLedgerWhatsApp = async (item: LedgerItem) => {
    const u = auth.currentUser;
    if (!u) {
      showToast(txt.whatsappNeedAuth, "error");
      return;
    }
    if (isReadOnly) {
      showToast(language === 'ar' ? 'غير مسموح في وضع القراءة فقط' : 'Not allowed in read-only mode', 'error');
      return;
    }
    setWhatsappSendingId(item.id);
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/whatsapp/send-patient-message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: "invoice", patientId, ledgerId: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(typeof data?.error === "string" ? data.error : "Request failed");
      // "ok: true" here does not mean the patient received anything yet. Without a WhatsApp
      // gateway connected, the server hands back the composed message instead of sending it, and
      // this call used to report success regardless — the toast said "Sent" while nothing had
      // gone anywhere, which is exactly what was reported: a success message with no delivery.
      if (data.manual) {
        handleWhatsAppApiResult(data, patientName);
        showToast(txt.whatsappManual, "info");
      } else {
        showToast(txt.whatsappSent, "success");
      }
    } catch (e) {
      showToast(`${txt.whatsappFail}: ${e instanceof Error ? e.message : ""}`.trim(), "error");
    } finally {
      setWhatsappSendingId(null);
    }
  };

  const handleSendReceiptWhatsApp = async () => {
    const u = auth.currentUser;
    if (!u) {
      showToast(txt.whatsappNeedAuth, "error");
      return;
    }
    if (isReadOnly) {
      showToast(language === 'ar' ? 'غير مسموح في وضع القراءة فقط' : 'Not allowed in read-only mode', 'error');
      return;
    }
    setSendingReceipt(true);
    try {
      const token = await u.getIdToken();
      const text = formatWhatsAppLedgerMessage(
        patientName,
        clinicInfo.name?.trim() || "عيادة الأسنان",
        totalCost,
        totalPaid,
        balance,
        transactions
      );
      const res = await fetch("/api/whatsapp/send-patient-message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: "receipt", patientId, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(typeof data?.error === "string" ? data.error : "Request failed");
      if (data.manual) {
        handleWhatsAppApiResult(data, patientName);
        showToast(txt.whatsappManual, "info");
      } else {
        showToast(txt.receiptWhatsappSent, "success");
      }
    } catch (e) {
      showToast(`${txt.receiptWhatsappFail}: ${e instanceof Error ? e.message : ""}`.trim(), "error");
    } finally {
      setSendingReceipt(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(txt.deleteConfirm))) return;
    try {
      // The rule about what may be deleted, and the rebalancing that follows a payment being
      // removed, both live server-side now — the same rule the finance page and the clinical
      // timeline reach, rather than three screens each deciding for themselves.
      await deleteLedgerRow(id, clinic?.id);
      showToast(txt.deleteSuccess, "info");
    } catch (error) {
      showToast(
        error instanceof MoneyApiError
          ? error.message
          : language === "ar"
            ? "تعذر الحذف"
            : "Could not delete that.",
        "error"
      );
    }
  };

  const selectedProcedureObj = proceduresWithBalance.find(p => p.id === selectedProcedureId);

  return (
    <div className="space-y-6 relative">
      
      {/* 💻 SCREEN UI */}
      <div className="print:hidden space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center justify-center gap-2">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{txt.totalTreatment}</span>
            <span className="text-2xl font-black text-gray-900">{totalCost.toLocaleString()} <span className="text-xs text-gray-400">EGP</span></span>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center justify-center gap-2">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{txt.totalPaid}</span>
            <span className="text-2xl font-black text-green-600">{totalPaid.toLocaleString()} <span className="text-xs text-green-400">EGP</span></span>
            </div>
            <div className={`p-5 rounded-2xl border shadow-sm flex flex-col items-center justify-center gap-2 ${balance > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
            <span className={`text-[10px] font-black uppercase tracking-widest ${balance > 0 ? 'text-red-400' : 'text-green-500'}`}>{txt.balanceDue}</span>
            <span className={`text-2xl font-black ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{balance.toLocaleString()} <span className="text-xs opacity-50">EGP</span></span>
            </div>
        </div>

        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm gap-4 overflow-hidden">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 min-w-0">
            <Wallet size={16} className="text-blue-600"/> {txt.history}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex gap-2 w-full lg:w-auto min-w-0">
            <button
              type="button"
              onClick={handlePrintReceipt}
              className="min-w-0 justify-center text-xs font-bold text-slate-700 hover:text-slate-900 flex items-center gap-2 px-3 py-2.5 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 bg-white leading-tight whitespace-normal text-center"
            >
              <Printer size={16} className="shrink-0"/>
              <span className="min-w-0 break-words">{txt.print}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSendReceiptWhatsApp()}
              disabled={sendingReceipt}
              className="min-w-0 justify-center text-xs font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-2 px-3 py-2.5 rounded-xl transition-colors disabled:opacity-60 leading-tight whitespace-normal text-center"
            >
              {sendingReceipt ? <Loader2 size={16} className="animate-spin shrink-0" /> : <ScrollText size={16} className="shrink-0" />}
              <span className="min-w-0 break-words">{txt.sendReceiptWhatsapp}</span>
            </button>
            <button onClick={() => { setIsAddingPayment(!isAddingPayment); setIsDropdownOpen(false); }} className="min-w-0 col-span-2 sm:col-span-1 justify-center bg-green-500 text-white px-3 py-2.5 rounded-xl font-black text-xs uppercase shadow-md shadow-green-100 hover:bg-green-600 transition-all flex items-center gap-2 leading-tight whitespace-normal text-center">
                <Plus size={16} className="shrink-0"/> <span className="min-w-0 break-words">{txt.addPayment}</span>
            </button>
            </div>
        </div>

        {isAddingPayment && (
            <form onSubmit={handleAddPayment} className="bg-green-50/50 p-6 rounded-2xl border border-green-100 animate-in slide-in-from-top-2">
            <h4 className="font-black text-green-800 mb-4 flex items-center gap-2 text-sm uppercase"><CreditCard size={16}/> {txt.receivePayment}</h4>
            
            <div className="mb-4 relative">
                <label className="text-[10px] font-black text-green-700 uppercase mb-1 block flex items-center gap-1">
                   <LinkIcon size={12}/> {txt.linkProcedure}
                </label>
                
                <button 
                    type="button" 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className={`w-full p-3.5 bg-white border-2 rounded-xl text-sm font-bold outline-none flex justify-between items-center transition-all ${isDropdownOpen ? 'border-green-500 ring-2 ring-green-500/20' : 'border-green-200 hover:border-green-300'}`}
                >
                    <span className={selectedProcedureObj ? "text-gray-900" : "text-gray-500"}>
                        {selectedProcedureObj ? selectedProcedureObj.description.split('(')[0] : txt.generalPayment}
                    </span>
                    <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}/>
                </button>

                {isDropdownOpen && (
                    <div className="absolute top-[100%] left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto p-1.5 space-y-1 animate-in slide-in-from-top-2 fade-in">
                        <button 
                            type="button" 
                            onClick={() => { setSelectedProcedureId(""); setPayAmount(""); setIsDropdownOpen(false); }}
                            className={`w-full text-left p-3 rounded-lg text-sm font-bold transition-all ${!selectedProcedureId ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            {txt.generalPayment}
                        </button>
                        
                        {proceduresWithBalance.map(proc => (
                            <button 
                                key={proc.id} 
                                type="button"
                                disabled={proc.isPaid}
                                onClick={() => {
                                    setSelectedProcedureId(proc.id);
                                    setPayAmount(proc.remaining.toString());
                                    setIsDropdownOpen(false);
                                }}
                                className={`w-full flex items-center justify-between p-3 rounded-lg transition-all text-left ${
                                    selectedProcedureId === proc.id ? 'bg-green-50 ring-1 ring-green-500/50' : 'hover:bg-gray-50 border border-transparent'
                                } ${proc.isPaid ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''}`}
                            >
                                <div className="text-left">
                                    <p className={`font-black text-sm leading-tight ${proc.isPaid ? 'text-gray-500' : 'text-gray-900'}`}>
                                        {proc.description.split('(')[0]}
                                    </p>
                                    <p className="text-[10px] font-bold text-gray-400 mt-1">{proc.date}</p>
                                </div>
                                <div className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider shrink-0 ${
                                    proc.isPaid ? 'bg-gray-200 text-gray-500' : 'bg-red-50 text-red-600 border border-red-100'
                                }`}>
                                    {proc.isPaid ? txt.paidLabel : `${proc.remaining} EGP`}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="md:col-span-2">
                    <label className="text-[10px] font-black text-green-700 uppercase mb-1 block">{txt.descNote}</label>
                    <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder={selectedProcedureId ? "Auto-generated..." : txt.payAccount} className="w-full p-3.5 rounded-xl border border-green-200 text-sm font-bold focus:border-green-500 outline-none placeholder-green-700/30" />
                </div>
                <div>
                    <label className="text-[10px] font-black text-green-700 uppercase mb-1 block">{txt.amount}</label>
                    <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" className="w-full p-3.5 rounded-xl border border-green-200 text-sm font-black focus:border-green-500 outline-none" />
                </div>
                <div>
                    <button type="submit" className="w-full bg-green-600 text-white py-3.5 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-green-700 flex items-center justify-center gap-2 transition-all active:scale-95">
                       <Check size={16}/> {txt.confirm}
                    </button>
                </div>
            </div>

            <div className="flex gap-4 mt-3 overflow-x-auto pb-2 no-scrollbar">
                {['Cash', 'Visa', 'InstaPay', 'Insurance'].map(m => (
                    <button key={m} type="button" onClick={() => setPayMethod(m)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border whitespace-nowrap transition-all ${payMethod === m ? 'bg-green-600 text-white border-green-600 shadow-sm' : 'bg-white text-green-600 border-green-200 hover:border-green-300'}`}>{m}</button>
                ))}
            </div>
            </form>
        )}

        {editingItem && (
            <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                    <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                        <h3 className="font-black text-gray-900 uppercase">{txt.editTrans}</h3>
                        <button onClick={() => setEditingItem(null)} className="p-1 hover:bg-gray-200 rounded-full"><X size={20}/></button>
                    </div>
                    <form onSubmit={handleUpdate} className="p-6 space-y-4">
                        <div><label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">{txt.date}</label><input type="date" value={editingItem.date} onChange={e => setEditingItem({...editingItem, date: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl font-bold text-sm outline-none focus:border-blue-500"/></div>
                        <div><label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">{txt.description}</label><input type="text" value={editingItem.description} onChange={e => setEditingItem({...editingItem, description: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl font-bold text-sm outline-none focus:border-blue-500"/></div>
                        {editingItem.type === 'procedure' ? (
                            <div className="space-y-3">
                              <div><label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">{language === "ar" ? "قبل الخصم (قائمة)" : "List price (EGP)"}</label><input type="number" value={Number(editingItem.listPrice) || ""} onChange={e => setEditingItem({...editingItem, listPrice: Number(e.target.value)})} className="w-full p-3 border border-gray-200 rounded-xl font-black text-sm outline-none focus:border-blue-500"/></div>
                              <div>
                                <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">{txt.discountSummary}</label>
                                <select value={editingItem.discountMode || "none"} onChange={e => setEditingItem({ ...editingItem, discountMode: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl font-bold text-sm outline-none focus:border-blue-500 bg-white">
                                  <option value="none">{language === "ar" ? "بدون خصم" : "No discount"}</option>
                                  <option value="percent">{language === "ar" ? "نسبة %" : "Percent %"}</option>
                                  <option value="fixed">{language === "ar" ? "مبلغ ثابت" : "Fixed EGP"}</option>
                                </select>
                              </div>
                              {editingItem.discountMode === "percent" && (
                                <div><label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">%</label><input type="number" value={editingItem.discountPercent ?? ""} onChange={e => setEditingItem({...editingItem, discountPercent: Number(e.target.value)})} className="w-full p-3 border border-gray-200 rounded-xl font-black text-sm outline-none focus:border-blue-500"/></div>
                              )}
                              {editingItem.discountMode === "fixed" && (
                                <div><label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">EGP</label><input type="number" value={editingItem.discountFixed ?? ""} onChange={e => setEditingItem({...editingItem, discountFixed: Number(e.target.value)})} className="w-full p-3 border border-gray-200 rounded-xl font-black text-sm outline-none focus:border-blue-500"/></div>
                              )}
                              {editingItem.discountMode === "none" && (
                                <div><label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">{txt.cost} (EGP)</label><input type="number" value={editingItem.cost} onChange={e => setEditingItem({...editingItem, cost: Number(e.target.value), listPrice: Number(e.target.value) })} className="w-full p-3 border border-gray-200 rounded-xl font-black text-sm outline-none focus:border-blue-500"/></div>
                              )}
                              <p className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                                {language === "ar" ? "المبلغ النهائي بعد الخصم:" : "Final after discount:"}{" "}
                                <span className="font-black">
                                  {((): string => {
                                    const list = Number(editingItem.listPrice) || 0;
                                    const mode = editingItem.discountMode || "none";
                                    if (mode === "percent") {
                                      const p = Math.min(100, Math.max(0, Number(editingItem.discountPercent) || 0));
                                      const da = Math.round(((list * p) / 100) * 100) / 100;
                                      return `${Math.max(0, list - da).toLocaleString()} EGP`;
                                    }
                                    if (mode === "fixed") {
                                      const f = Math.min(list, Math.max(0, Number(editingItem.discountFixed) || 0));
                                      return `${Math.max(0, list - f).toLocaleString()} EGP`;
                                    }
                                    return `${(Number(editingItem.cost) || 0).toLocaleString()} EGP`;
                                  })()}
                                </span>
                              </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">{txt.paidAmount}</label><input type="number" value={editingItem.paid} onChange={e => setEditingItem({...editingItem, paid: Number(e.target.value)})} className="w-full p-3 border border-gray-200 rounded-xl font-black text-green-600 outline-none focus:border-green-500"/></div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">{txt.method}</label>
                                    <select value={editingItem.method || "Cash"} onChange={e => setEditingItem({...editingItem, method: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl font-bold text-sm outline-none focus:border-green-500 bg-white">
                                        <option>Cash</option><option>Visa</option><option>InstaPay</option><option>Insurance</option>
                                    </select>
                                </div>
                            </div>
                        )}
                        <button type="submit" className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 flex items-center justify-center gap-2 mt-2 transition-all active:scale-95"><Save size={16}/> {txt.saveChanges}</button>
                    </form>
                </div>
            </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-sm text-left min-w-[700px]">
                    <thead className="bg-gray-50 text-gray-500 font-black text-[10px] uppercase tracking-wider">
                    <tr><th className="p-4 whitespace-nowrap">{txt.date}</th><th className="p-4 whitespace-nowrap">{txt.description}</th><th className="p-4 text-center whitespace-nowrap">{txt.type}</th><th className="p-4 text-right whitespace-nowrap">{txt.cost}</th><th className="p-4 text-right whitespace-nowrap">{txt.paid}</th><th className="p-4 text-center whitespace-nowrap no-print">{txt.action}</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                    {transactions.length === 0 ? (
                        <tr><td colSpan={6} className="p-8 text-center text-gray-400 font-bold text-xs uppercase">{txt.noRecords}</td></tr>
                    ) : (
                        (() => {
                            const rawProcs = transactions.filter(t => t.type === 'procedure');
                            const payments = transactions.filter(t => t.type === 'payment');
                            const proceduresWithBalance = rawProcs.map(proc => {
                                const linkedPayments = payments.filter(p => p.procedureId === proc.id);
                                const paidForThis = linkedPayments.reduce((sum, p) => sum + (Number(p.paid) || 0), 0);
                                const remaining = (Number(proc.cost) || 0) - paidForThis;
                                return { ...proc, remaining: remaining > 0 ? remaining : 0, isPaid: remaining <= 0, linkedPayments, paidForThis };
                            });
                            
                            const unlinkedPayments = payments.filter(p => !p.procedureId || !rawProcs.some(rp => rp.id === p.procedureId));

                            return (
                                <>
                                    {proceduresWithBalance.map((item) => {
                                        const procTime = formatTxTime(item);
                                        return (
                                        <Fragment key={item.id}>
                                            <tr 
                                              id={`tx-${item.id}`}
                                              className={`transition-colors group cursor-pointer ${highlightTxId === item.id ? 'bg-blue-50/50 ring-2 ring-blue-500 ring-inset' : 'hover:bg-gray-50'}`}
                                              onClick={() => item.linkedPayments.length > 0 && toggleProcExpand(item.id)}
                                            >
                                                <td className="p-4 font-bold text-gray-500 text-xs">
                                                    <div className="flex items-center gap-2">
                                                        {item.linkedPayments.length > 0 ? (
                                                            <div className="text-gray-400">
                                                                {expandedProcs[item.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                            </div>
                                                        ) : (
                                                            <div className="w-4"></div>
                                                        )}
                                                        <div>
                                                            <div>{item.date}</div>
                                                            {procTime && (
                                                                <div className="text-[10px] text-slate-400 font-semibold flex items-center gap-1 mt-0.5">
                                                                    <Clock size={10} className="text-emerald-500 shrink-0" />
                                                                    <span>{procTime}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-4 font-black text-gray-900 w-full">
                                                   <div className="leading-snug">{item.description}</div>
                                                   {Number(item.discountAmount) > 0 && Number(item.listPrice) > 0 && (
                                                       <div className="mt-1.5 rounded-lg border border-amber-100 bg-amber-50/90 px-2 py-1.5 text-[10px] font-bold leading-relaxed text-amber-900 w-fit">
                                                         {language === "ar" ? (
                                                           <>
                                                             قبل الخصم: {Number(item.listPrice).toLocaleString()} جنيه ← بعد: {Number(item.cost).toLocaleString()} جنيه
                                                             <span className="text-amber-700"> (−{Number(item.discountAmount).toLocaleString()} {txt.discountSummary}{item.discountMode === "percent" && item.discountPercent != null ? ` ${item.discountPercent}%` : ""})</span>
                                                           </>
                                                         ) : (
                                                           <>
                                                             Before {Number(item.listPrice).toLocaleString()} EGP → After {Number(item.cost).toLocaleString()} EGP
                                                             <span className="text-amber-700"> (−{Number(item.discountAmount).toLocaleString()} {txt.discountSummary}{item.discountMode === "percent" && item.discountPercent != null ? ` ${item.discountPercent}%` : ""})</span>
                                                           </>
                                                         )}
                                                       </div>
                                                   )}
                                                   {item.doctorName && <span className="mt-2 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 text-[9px] uppercase font-bold inline-flex items-center gap-1 me-2"><User size={8}/> {item.doctorName.replace(/^Dr\.\s*/i, '')}</span>}
                                                   {getTxUser(item) && getTxUser(item) !== item.doctorName?.replace(/^Dr\.\s*/i, '') && (
                                                     <span className="mt-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[9px] uppercase font-bold inline-flex items-center gap-1 me-2">
                                                       <User size={8}/> {getTxUser(item)}
                                                     </span>
                                                   )}
                                                   
                                                   {/* Progress Bar */}
                                                   <div className="mt-3 w-full max-w-sm h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
                                                       <div 
                                                         className={`h-full transition-all duration-500 ${item.isPaid ? 'bg-green-500' : 'bg-primary-500'}`} 
                                                         style={{ width: `${Math.min(100, item.cost > 0 ? (item.paidForThis / item.cost) * 100 : 0)}%` }}
                                                       ></div>
                                                   </div>
                                                </td>
                                                <td className="p-4 text-center"><span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-blue-50 text-blue-600">{item.type}</span></td>
                                                <td className="p-4 text-right font-bold text-gray-900">{item.cost > 0 ? item.cost.toLocaleString() : "-"}</td>
                                                <td className="p-4 text-right font-bold text-green-600">{item.paidForThis > 0 ? item.paidForThis.toLocaleString() : "-"}</td>
                                                <td className="p-4 text-center no-print">
                                                    <div className="flex items-center justify-center gap-2 transition-opacity">
                                                        <button
                                                          type="button"
                                                          title={txt.sendWhatsapp}
                                                          disabled={whatsappSendingId === item.id}
                                                          onClick={(e) => { e.stopPropagation(); void handleSendLedgerWhatsApp(item); }}
                                                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                                                        >
                                                          {whatsappSendingId === item.id ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
                                                        </button>
                                                        {hasEditAccess && (
                                                            <button onClick={(e) => { e.stopPropagation(); setEditingItem(item); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 size={16}/></button>
                                                        )}
                                                        {hasDeleteAccess && (
                                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16}/></button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* Nested Payments */}
                                            {expandedProcs[item.id] && item.linkedPayments.map(payment => {
                                                const payTime = formatTxTime(payment);
                                                const payUser = getTxUser(payment);
                                                return (
                                                <tr id={`tx-${payment.id}`} key={payment.id} className={`transition-colors ${highlightTxId === payment.id ? 'bg-blue-50/80 ring-2 ring-blue-500 ring-inset' : 'bg-slate-50/50 hover:bg-slate-50'}`}>
                                                    <td className="p-4 pl-12 font-bold text-gray-400 text-xs">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                                                            <div>
                                                                <div>{payment.date}</div>
                                                                {payTime && (
                                                                    <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1 mt-0.5">
                                                                        <Clock size={10} className="text-emerald-500 shrink-0" />
                                                                        <span>{payTime}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 font-bold text-gray-700 text-sm">
                                                        <div className="leading-snug">{payment.description}</div>
                                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                            {payment.method && (
                                                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] uppercase font-extrabold inline-block border border-slate-200">
                                                                    {payment.method}
                                                                </span>
                                                            )}
                                                            {payUser && (
                                                                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[9px] font-extrabold inline-flex items-center gap-1 shadow-2xs">
                                                                    <User size={10} className="text-emerald-600" />
                                                                    {language === "ar" ? "المحصل:" : "Collected by:"} {payUser}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-center"><span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-green-50 text-green-600">{payment.type}</span></td>
                                                    <td className="p-4 text-right font-bold text-gray-400">-</td>
                                                    <td className="p-4 text-right font-bold text-green-600">{payment.paid > 0 ? payment.paid.toLocaleString() : "-"}</td>
                                                    <td className="p-4 text-center no-print">
                                                        <div className="flex items-center justify-center gap-2">
                                                            {hasEditAccess && (
                                                                <button onClick={() => setEditingItem(payment)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 size={16}/></button>
                                                            )}
                                                            {hasDeleteAccess && (
                                                                <button onClick={() => handleDelete(payment.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16}/></button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );})}
                                        </Fragment>
                                    );})}

                                    {/* Unlinked Payments */}
                                    {unlinkedPayments.map((payment) => {
                                        const payTime = formatTxTime(payment);
                                        const payUser = getTxUser(payment);
                                        return (
                                        <tr id={`tx-${payment.id}`} key={payment.id} className={`transition-colors ${highlightTxId === payment.id ? 'bg-blue-50/80 ring-2 ring-blue-500 ring-inset' : 'hover:bg-gray-50'}`}>
                                            <td className="p-4 font-bold text-gray-500 text-xs pl-8">
                                                <div>
                                                    <div>{payment.date}</div>
                                                    {payTime && (
                                                        <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1 mt-0.5">
                                                            <Clock size={10} className="text-emerald-500 shrink-0" />
                                                            <span>{payTime}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 font-black text-gray-900">
                                               <div className="leading-snug">{payment.description}</div>
                                               <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                   {payment.method && (
                                                       <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] uppercase font-extrabold inline-block border border-slate-200">
                                                           {payment.method}
                                                       </span>
                                                   )}
                                                   {payUser && (
                                                       <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[9px] font-extrabold inline-flex items-center gap-1 shadow-2xs">
                                                           <User size={10} className="text-emerald-600" />
                                                           {language === "ar" ? "المحصل:" : "Collected by:"} {payUser}
                                                       </span>
                                                   )}
                                               </div>
                                            </td>
                                            <td className="p-4 text-center"><span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-green-50 text-green-600">{payment.type}</span></td>
                                            <td className="p-4 text-right font-bold text-gray-900">-</td>
                                            <td className="p-4 text-right font-bold text-green-600">{payment.paid > 0 ? payment.paid.toLocaleString() : "-"}</td>
                                            <td className="p-4 text-center no-print">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                      type="button"
                                                      title={txt.sendWhatsapp}
                                                      disabled={whatsappSendingId === payment.id}
                                                      onClick={() => void handleSendLedgerWhatsApp(payment)}
                                                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                                                    >
                                                      {whatsappSendingId === payment.id ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
                                                    </button>
                                                    {hasEditAccess && (
                                                        <button onClick={() => setEditingItem(payment)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 size={16}/></button>
                                                    )}
                                                    {hasDeleteAccess && (
                                                        <button onClick={() => handleDelete(payment.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16}/></button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );})}
                                </>
                            );
                        })()
                    )}
                    </tbody>
                </table>
            </div>
        </div>
      </div>
    </div>
  );
}