"use client";

import { useState, useEffect } from "react";
import { 
    X, Search, Check, Wallet, Loader2, 
    AlertCircle, Receipt, PiggyBank
} from "lucide-react";
import { db } from "@/lib/firebase";
import { 
    collection, query, getDocs, addDoc, 
    serverTimestamp, where, doc, getDoc, limit
} from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import { sendPatientPaymentWhatsApp } from "@/lib/sendPatientPaymentWhatsAppClient";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { allocationMessage, allocationMessageAr, checkAllocation } from "@/lib/paymentAllocation";
import { MoneyApiError, createPayment } from "@/lib/moneyApi";

const GENERAL_PAYMENT = {
    id: 'general_payment',
    description: 'General Account Payment (Advance/Deposit)',
    descriptionAr: 'دفعة عامة (رصيد مقدم / تحت الحساب)',
    cost: null,
    paid: null,
    remaining: Infinity
};

export default function QuickPaymentModal({ isOpen, onClose, onSave, patients, preSelectedPatient }: any) {
  const { showToast } = useUI();
    const { language, isRTL } = useLanguage();
    const { user } = useAuth();
    
    // --- TRANSLATIONS DICTIONARY ---
    const t = {
        title: language === 'ar' ? "تسجيل دفعة نقدية" : "Receive Payment",
        subtitle: language === 'ar' ? "نظام حسابات ألفا" : "Alpha Clinic Billing",
        searchPlaceholder: language === 'ar' ? "البحث باسم المريض أو رقم الهاتف..." : "Search patient name or phone...",
        scanning: language === 'ar' ? "جاري البحث عن الفواتير المستحقة..." : "Scanning ledger for unpaid procedures...",
        paymentType: language === 'ar' ? "نوع الدفعة" : "Payment Type",
        generalPayment: language === 'ar' ? "دفعة عامة (حساب المريض)" : "General Payment",
        generalDesc: language === 'ar' ? "إضافة رصيد مقدم أو دفعة تحت الحساب" : "Add advance credit",
        orPayBill: language === 'ar' ? "أو تسديد فاتورة" : "OR PAY BILL",
        outstandingProcedures: language === 'ar' ? "الإجراءات غير المدفوعة" : "Outstanding Procedures",
        owes: language === 'ar' ? "المتبقي:" : "Owes:",
        payingToward: language === 'ar' ? "الدفع لحساب إجراء:" : "Paying Toward",
        totalCost: language === 'ar' ? "التكلفة الإجمالية" : "Total Cost",
        paidSoFar: language === 'ar' ? "المدفوع مسبقاً" : "Paid So Far",
        amountPayingNow: language === 'ar' ? "المبلغ المدفوع الآن" : "Amount Paying Now",
        currency: language === 'ar' ? "ج.م" : "EGP",
        cannotExceed: language === 'ar' ? "لا يمكن تجاوز المبلغ المتبقي:" : "Cannot exceed",
        confirmPayment: language === 'ar' ? "تأكيد الدفع" : "Confirm Payment",
        selectPrompt: language === 'ar' ? "يرجى اختيار نوع الدفعة من القائمة." : "Select a payment type from the list.",
        errorExceed: language === 'ar' ? "المبلغ المدفوع أكبر من الرصيد المتبقي." : "Payment amount cannot exceed the remaining balance.",
        errorSync: language === 'ar' ? "حدث خطأ أثناء مزامنة الدفع. راجع النظام." : "Payment sync failed. Check console."
    };

    // UI States
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    
    // Data States
    const [selectedPatient, setSelectedPatient] = useState<any>(null);
    const [unpaidProcedures, setUnpaidProcedures] = useState<any[]>([]);
    
    // Payment States
    const [selectedProcedure, setSelectedProcedure] = useState<any>(null);
    const [payAmount, setPayAmount] = useState<number | "">("");
    const [patientStats, setPatientStats] = useState<{ totalOwed: number, totalPaid: number, balance: number } | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        if (preSelectedPatient) {
            handleSelectPatient(preSelectedPatient);
        } else {
            resetForm();
        }
    }, [isOpen, preSelectedPatient]);

    const resetForm = () => {
        setSelectedPatient(null);
        setSearchQuery("");
        setUnpaidProcedures([]);
        setSelectedProcedure(null);
        setPayAmount("");
        setPatientStats(null);
    };

    const handleSelectPatient = async (patient: any) => {
        setSelectedPatient(patient);
        setLoading(true);
        setSelectedProcedure(null);
        setPayAmount("");
        
        try {
            const q = query(getClinicCollection("ledger"), where("patientId", "==", patient.id));
            const snap = await getDocs(q);

            type LedgerRow = {
              id: string;
              type?: string;
              cost?: number;
              procedureId?: string;
              paid?: number;
              date?: string;
            };
            const all: LedgerRow[] = snap.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            })) as LedgerRow[];
            const rawProcs = all.filter((row) => row.type === "procedure");
            const payments = all.filter((row) => row.type === "payment");

            const procedures: any[] = [];
            rawProcs.forEach((proc) => {
                const cost = Number(proc.cost) || 0;
                const paidForProc = payments
                    .filter((p) => p.procedureId === proc.id)
                    .reduce((sum, p) => sum + (Number(p.paid) || 0), 0);
                const remaining = cost - paidForProc;
                if (remaining > 0) {
                    procedures.push({ ...proc, paid: paidForProc, remaining });
                }
            });
            
            procedures.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            setUnpaidProcedures(procedures);

            // Calculate global stats
            const totalOwed = all.filter((row) => row.type === "procedure").reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
            const totalPaid = all.filter((row) => row.type === "payment").reduce((sum, row) => sum + (Number(row.paid) || 0), 0);
            const balance = totalOwed - totalPaid;
            setPatientStats({ totalOwed, totalPaid, balance });

            if (procedures.length === 0) setSelectedProcedure(GENERAL_PAYMENT);
            
        } catch (error) {
            console.error("Failed to fetch unpaid procedures", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectProcedure = (proc: any) => {
        setSelectedProcedure(proc);
        setPayAmount(proc.remaining === Infinity ? "" : proc.remaining);
    };

    const handleConfirmPayment = async () => {
        if (!selectedPatient || !selectedProcedure || !payAmount || Number(payAmount) <= 0) return;
        
        const amountToPay = Number(payAmount);
        
        // The one rule, shared with the patient ledger, the appointment side panel and the server.
        // This screen already refused an overpayment; the other two did not, and the server never
        // asked at all — so what the books could say was decided by whichever screen was loosest.
        if (selectedProcedure.id !== 'general_payment') {
            const verdict = checkAllocation({
                cost: Number(selectedProcedure.cost) || 0,
                otherPaymentsTotal: Number(selectedProcedure.paid) || 0,
                amount: amountToPay,
            });
            if (!verdict.ok) {
                showToast(
                    language === 'ar'
                        ? allocationMessageAr(verdict, selectedProcedure.description)
                        : allocationMessage(verdict, selectedProcedure.description),
                    "error"
                );
                return;
            }
        }

        setLoading(true);
        try {
            const isGeneral = selectedProcedure.id === 'general_payment';

            // The dentist, their percentage, the lab fee and whether this is the first payment are
            // all resolved server-side from the procedure being settled. This screen used to look
            // the dentist up itself, which meant three screens with three slightly different
            // versions of the same lookup.
            const { id: paymentId } = await createPayment({
                patientId: String(selectedPatient.id),
                patientName: selectedPatient.name,
                amount: amountToPay,
                method: "Cash",
                description: isGeneral
                    ? (language === 'ar' ? GENERAL_PAYMENT.descriptionAr : GENERAL_PAYMENT.description)
                    : `${language === 'ar' ? 'تسديد دفعة لـ' : 'Payment for'}: ${selectedProcedure.description}`,
                procedureId: isGeneral ? null : selectedProcedure.id,
                category: isGeneral ? 'Advance Payment' : 'Treatment Payment',
            });

            // Fire-and-forget: the payment is recorded either way, and a messaging outage must
            // not make it look like the money was not taken.
            void sendPatientPaymentWhatsApp({ patientId: String(selectedPatient.id), ledgerId: paymentId });

            await logActivity(
                { uid: user?.uid, name: user?.name, role: user?.role },
                "Payment Received",
                isGeneral
                    ? `General payment received from ${selectedPatient.name}: ${amountToPay} EGP`
                    : `Treatment payment for ${selectedPatient.name}: ${amountToPay} EGP toward "${selectedProcedure.description}"`
            );

            onSave();
            onClose();
        } catch (error) {
            console.error(error);
            showToast(error instanceof MoneyApiError ? error.message : t.errorSync, "error");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" dir={isRTL ? "rtl" : "ltr"}>
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh] font-sans">
                
                {/* HEADER */}
                <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                            <Wallet size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 leading-none">{t.title}</h2>
                            <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">{t.subtitle}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl text-slate-400 transition-colors"><X size={20}/></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/50">
                    
                    {/* PATIENT SEARCH */}
                    {!selectedPatient ? (
                        <div className="space-y-4 max-w-xl mx-auto py-4">
                            <div className="relative">
                                <Search className="absolute start-4 top-1/2 -translate-y-1/2 text-emerald-500" size={22}/>
                                <input 
                                    autoFocus
                                    className="w-full bg-white border border-slate-200 rounded-2xl py-4 ps-12 pe-4 text-sm font-bold text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all shadow-sm"
                                    placeholder={t.searchPlaceholder}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                                {patients.filter((p:any) => patientMatchesSearch(searchQuery, p.name, p.phone)).slice(0, 6).map((p: any) => (
                                    <button key={p.id} onClick={() => handleSelectPatient(p)} className="flex items-center gap-4 p-4 bg-white hover:bg-emerald-50 rounded-2xl border border-slate-100 hover:border-emerald-200 transition-all shadow-sm group text-start">
                                        <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center font-black text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors shrink-0">{p.name[0]}</div>
                                        <div className="overflow-hidden">
                                            <p className="font-bold text-slate-900 text-sm truncate">{p.name}</p>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{p.phone}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in fade-in">
                            
                            {/* PATIENT CARD */}
                            <div className="bg-slate-900 rounded-[2rem] shadow-md overflow-hidden text-white">
                                <div className="p-5 flex justify-between items-center gap-4 border-b border-white/10">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center font-black text-emerald-400">{selectedPatient.name[0]}</div>
                                        <div>
                                            <p className="font-black leading-none">{selectedPatient.name}</p>
                                            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">{selectedPatient.phone}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => resetForm()} className="p-2.5 hover:bg-white/10 rounded-xl transition-colors"><X size={18}/></button>
                                </div>
                                {patientStats && (
                                    <div className="grid grid-cols-3 bg-white/5 divide-x divide-white/10 rtl:divide-x-reverse text-center py-3">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider mb-0.5">{language === 'ar' ? 'المستحق الكلي' : 'Total Owed'}</span>
                                            <span className="text-sm font-black text-white">{patientStats.totalOwed} {t.currency}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider mb-0.5">{language === 'ar' ? 'المدفوع الكلي' : 'Total Paid'}</span>
                                            <span className="text-sm font-black text-emerald-400">{patientStats.totalPaid} {t.currency}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider mb-0.5">{language === 'ar' ? 'المتبقي' : 'Remaining'}</span>
                                            <span className={`text-sm font-black ${patientStats.balance > 0 ? 'text-amber-400' : 'text-white'}`}>{patientStats.balance} {t.currency}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {loading ? (
                                <div className="py-12 flex flex-col items-center justify-center text-emerald-600">
                                    <Loader2 size={32} className="animate-spin mb-4" />
                                    <p className="text-sm font-bold animate-pulse">{t.scanning}</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    
                                    {/* LEFT: PAYMENT OPTIONS */}
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{t.paymentType}</label>
                                        
                                        <button 
                                            onClick={() => handleSelectProcedure(GENERAL_PAYMENT)}
                                            className={`w-full text-start p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${selectedProcedure?.id === 'general_payment' ? 'bg-emerald-50 border-emerald-500 shadow-md' : 'bg-white border-slate-100 hover:border-emerald-200'}`}
                                        >
                                            <div className={`p-2 rounded-xl shrink-0 ${selectedProcedure?.id === 'general_payment' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                                <PiggyBank size={20} />
                                            </div>
                                            <div>
                                                <p className="font-bold text-sm text-slate-900">{t.generalPayment}</p>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.generalDesc}</p>
                                            </div>
                                        </button>

                                        {unpaidProcedures.length > 0 && (
                                            <>
                                                <div className="flex items-center gap-2 my-2 opacity-50">
                                                    <div className="flex-1 h-px bg-slate-300"></div>
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{t.orPayBill}</span>
                                                    <div className="flex-1 h-px bg-slate-300"></div>
                                                </div>

                                                <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar pe-2">
                                                    {unpaidProcedures.map(proc => (
                                                        <button 
                                                            key={proc.id} 
                                                            onClick={() => handleSelectProcedure(proc)}
                                                            className={`w-full text-start p-4 rounded-2xl border-2 transition-all ${selectedProcedure?.id === proc.id ? 'bg-orange-50 border-orange-500 shadow-md' : 'bg-white border-slate-100 hover:border-orange-200'}`}
                                                        >
                                                            <div className="flex justify-between items-start mb-2">
                                                                <span className="font-bold text-sm text-slate-900 line-clamp-2">{proc.description}</span>
                                                            </div>
                                                            <div className="flex justify-between items-center text-[11px] font-black">
                                                                <span className="text-slate-400">{proc.date}</span>
                                                                <span className="text-orange-600 bg-orange-100/50 px-2 py-1 rounded-md">{t.owes} {proc.remaining} {t.currency}</span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* RIGHT: PAYMENT INPUT */}
                                    <div>
                                        {selectedProcedure ? (
                                            <div className={`bg-white border rounded-[2rem] p-5 shadow-sm sticky top-0 animate-in ${isRTL ? 'slide-in-from-left-4' : 'slide-in-from-right-4'} ${selectedProcedure.id === 'general_payment' ? 'border-emerald-200' : 'border-slate-200'}`}>
                                                
                                                <div className="mb-6 pb-4 border-b border-slate-100">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t.payingToward}</p>
                                                    <p className="font-bold text-slate-900 text-sm">{selectedProcedure.id === 'general_payment' && language === 'ar' ? GENERAL_PAYMENT.descriptionAr : selectedProcedure.description}</p>
                                                    
                                                    {selectedProcedure.id !== 'general_payment' && (
                                                        <div className="flex gap-4 mt-3">
                                                            <div>
                                                                <p className="text-[9px] font-black text-slate-400 uppercase">{t.totalCost}</p>
                                                                <p className="font-bold text-slate-700">{selectedProcedure.cost}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[9px] font-black text-slate-400 uppercase">{t.paidSoFar}</p>
                                                                <p className="font-bold text-emerald-600">{selectedProcedure.paid}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div>
                                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">{t.amountPayingNow}</label>
                                                    <div className="relative">
                                                        <span className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">{t.currency}</span>
                                                        <input 
                                                            autoFocus
                                                            type="number" 
                                                            value={payAmount} 
                                                            onChange={(e) => setPayAmount(e.target.value ? Number(e.target.value) : "")} 
                                                            className={`w-full bg-slate-50 border rounded-xl py-4 ps-14 pe-4 text-2xl font-black outline-none focus:ring-4 transition-all ${selectedProcedure.id === 'general_payment' ? 'focus:border-emerald-500 focus:ring-emerald-500/10 text-emerald-600 border-slate-200' : 'focus:border-orange-500 focus:ring-orange-500/10 text-orange-600 border-slate-200'}`}
                                                        />
                                                    </div>
                                                    {selectedProcedure.id !== 'general_payment' && Number(payAmount) > selectedProcedure.remaining && (
                                                        <p className="text-xs font-bold text-red-500 mt-2 flex items-center gap-1"><AlertCircle size={14}/> {t.cannotExceed} {selectedProcedure.remaining} {t.currency}</p>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 rounded-[2rem] bg-slate-50/50">
                                                <Receipt size={32} className="text-slate-300 mb-3" />
                                                <p className="text-sm font-bold text-slate-500">{t.selectPrompt}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                <div className="p-6 border-t border-slate-100 bg-white shrink-0">
                    <button 
                        onClick={handleConfirmPayment}
                        disabled={loading || !selectedProcedure || !payAmount || Number(payAmount) <= 0 || (selectedProcedure.id !== 'general_payment' && Number(payAmount) > selectedProcedure?.remaining)}
                        className={`w-full text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg disabled:opacity-40 disabled:active:scale-100 ${selectedProcedure?.id === 'general_payment' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20' : 'bg-slate-900 hover:bg-slate-800 shadow-slate-900/20'}`}
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <Check size={20} />}
                        {t.confirmPayment}
                    </button>
                </div>

            </div>
        </div>
    );
}