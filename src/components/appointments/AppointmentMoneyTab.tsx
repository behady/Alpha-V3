"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import {
  AlertTriangle, Banknote, Check, ChevronDown, History, Loader2, Pencil, Plus, Printer, Receipt, Tag, Trash2,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { isDentistStaff } from "@/lib/staffRoles";
import { treatmentsByTooth } from "@/lib/toothTreatments";
import { suggestCategory } from "@/lib/dentalIcons";
import { usePricingPolicy } from "@/lib/usePricingPolicy";
import { checkAllocation, allocationMessage, allocationMessageAr } from "@/lib/paymentAllocation";
import {
  MoneyApiError, createPayment, createProcedure, deleteProcedure, updateLedgerRow,
} from "@/lib/moneyApi";
import { sendPatientPaymentWhatsApp } from "@/lib/sendPatientPaymentWhatsAppClient";
import { printPaymentReceipt } from "@/lib/printPatientReceipt";
import { loadReceiptSettings } from "@/lib/receiptSettingsClient";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import ServiceEditorDrawer, { TeethChartSelector } from "@/components/clinical-notes/ServiceEditorDrawer";
import { stagedLineTotal, stagedMode, stagedUnits, toothListLabel } from "@/lib/stagedProcedures";
import type { Note, Service, Staff } from "@/components/clinical-notes/types";
import { resolveListPrice } from "@/lib/discountMath";
import { PRIVATE_PAYER_ID, findPayer, payerForPriceList } from "@/lib/payers";
import { serviceMenuById } from "@/lib/serviceMenu";
import InsurerBadge from "@/components/shared/InsurerBadge";

/**
 * The money and the treatments it is for, on one screen.
 *
 * They used to be two tabs, and they are the same fact: a receptionist reading a cost in Services
 * had to switch to Ledger, find the same treatment again among charges and payments mixed into one
 * list, and hold the subtraction in her head while a patient waited. Here each treatment is one
 * row carrying its own money — charged, paid, left — with Collect and Discount on the row itself.
 *
 * Nothing here computes what is owed from scratch: the server keeps a charge's `paid` in step with
 * its payments, so "750 left on the crown" is read, not derived, and cannot drift from the books.
 */

type Charge = {
  id: string;
  description: string;
  date: string;
  cost: number;
  paid: number;
  listPrice: number;
  discountAmount: number;
  clinicalNoteId: string | null;
  remaining: number;
  /** Who this treatment is charged to; null for the clinic's own (Private) work and for old rows. */
  payerName: string | null;
  /** The dentist who did it, by name; "" when nobody is on it yet (no money is taken until there is). */
  dentistName: string;
};

type Payment = {
  id: string;
  date: string;
  amount: number;
  method: string;
  description: string;
  procedureId: string | null;
};

/** Cash, and the two things Egyptian clinics are actually handed instead of it. */
const METHODS = [
  { id: "Cash", en: "Cash", ar: "كاش" },
  { id: "Card", en: "Card", ar: "فيزا" },
  { id: "Instapay", en: "Instapay", ar: "انستاباي" },
];

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export default function AppointmentMoneyTab({
  appointment,
  doctorsList = [],
  servicesList = [],
  onQuickPay,
  section = "all",
  scope = "visit",
}: {
  appointment: any;
  doctorsList?: any[];
  servicesList?: any[];
  onQuickPay?: (patientId: string, patientName: string) => void;
  /**
   * Which half to draw. The booking popup splits this tab in two — treatments on its Service tab,
   * money on its Payment tab — while the side panel keeps everything on one ("all").
   */
  section?: "all" | "service" | "payment";
  /**
   * "visit" (the default) lists this appointment's treatments and keeps the rest under "older";
   * "patient" (the Quick Pay popup, which has no visit) lists everything the patient owes as one
   * list, and the payment it takes belongs to no appointment.
   */
  scope?: "visit" | "patient";
}) {
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";
  const { priceLists, payers, discountSettings, maxDiscountPercent } = usePricingPolicy();

  /**
   * Which list this quick-added treatment is charged on — and therefore who is paying for it.
   *
   * This box had no list at all. It read `service.price`, sent no list, and the server fell back
   * to the clinic's default, so a treatment added from the appointment panel could never be an
   * insurance case: it was charged at clinic rates and counted as private revenue, whatever the
   * clinic had set up. It is also the fastest way to record a treatment, which means it is the
   * one the front desk actually uses.
   */
  const activeLists = useMemo(() => priceLists.filter((l) => l.active), [priceLists]);
  const [procListId, setProcListId] = useState("");
  useEffect(() => {
    if (activeLists.length === 0) return;
    if (activeLists.some((l) => l.id === procListId)) return;
    setProcListId((activeLists.find((l) => l.isDefault) || activeLists[0]).id);
  }, [activeLists, procListId]);

  // Re-price a catalogue pick when the prefill list changes; a free-typed name keeps its typed price.
  useEffect(() => {
    const name = procName.trim();
    if (!name) return;
    const svc = services.find((x) => String(x.name) === name);
    if (svc) setProcCost(resolveListPrice(svc as { price?: number; prices?: Record<string, number> }, procListId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procListId]);
  // Who pays, chosen outright. Picking an insurer points the prefill at its own list when it has one.
  const [procPayerId, setProcPayerId] = useState(PRIVATE_PAYER_ID);
  const activePayers = useMemo(() => {
    const live = payers.filter((p) => p.active);
    return [...live.filter((p) => p.id === PRIVATE_PAYER_ID), ...live.filter((p) => p.id !== PRIVATE_PAYER_ID)];
  }, [payers]);
  const pickPayer = (id: string) => {
    setProcPayerId(id);
    const own = findPayer(payers, id)?.priceListId;
    if (own && activeLists.some((l) => l.id === own)) {
      setProcListId(own);
    } else if (payerForPriceList(payers, procListId).id !== PRIVATE_PAYER_ID && activeLists.length > 0) {
      // A payer with no list of its own (Private, always) must not keep another payer's list:
      // that recorded a private case at the insurer's tariff. Back to the default list.
      setProcListId((activeLists.find((l) => l.isDefault) || activeLists[0]).id);
    }
  };

  const patientId = appointment?.patientId as string | undefined;
  const appointmentId = appointment?.id as string | undefined;

  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [notes, setNotes] = useState<Note[]>([]);
  const [teethData, setTeethData] = useState<Record<string, any>>({});

  /**
   * Lookups the panel may or may not have been handed. The appointments page passes no services at
   * all and no screen passes dentists in the shape the editor wants, so whatever is missing is
   * fetched here — otherwise the same tab behaves differently depending on which page opened it.
   */
  const [fetchedServices, setFetchedServices] = useState<Service[] | null>(null);
  const [fetchedDoctors, setFetchedDoctors] = useState<Staff[] | null>(null);

  // Collect
  const [collectOpen, setCollectOpen] = useState(false);
  /** A charge id, "all" (spread over everything owed) or "general" (on account). */
  const [collectTarget, setCollectTarget] = useState<string>("all");
  const [collectAmount, setCollectAmount] = useState<number | "">("");
  const [collectMethod, setCollectMethod] = useState("Cash");
  const [collecting, setCollecting] = useState(false);

  // Discount
  const [discountTarget, setDiscountTarget] = useState<string | null>(null); // charge id or "visit"
  const [discountMode, setDiscountMode] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState<number | "">("");
  const [discountReason, setDiscountReason] = useState("");
  const [discounting, setDiscounting] = useState(false);

  // Quick add
  /** The service as typed or picked: a catalogue name prefills the price, anything else is recorded as typed. */
  const [procName, setProcName] = useState("");
  const [procCost, setProcCost] = useState<number | "">("");
  /**
   * Teeth picked on the chart for the quick add (FDI codes) — the booking popup's Service tab only;
   * the side panel keeps its compact form. Empty = a general treatment, as before.
   */
  const [procTeeth, setProcTeeth] = useState<string[]>([]);
  const [addingProcedure, setAddingProcedure] = useState(false);

  // Full editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editorApptId, setEditorApptId] = useState<string | null>(null);

  // Open on the Payment tab: its figures include earlier visits, so the rows behind them are shown.
  const [showOlder, setShowOlder] = useState(section === "payment");
  // On a tab that is only about money, the receipts are the content, not a footnote.
  const [showReceipts, setShowReceipts] = useState(section === "payment");
  const [printingId, setPrintingId] = useState<string | null>(null);

  const printReceipt = async (paymentId: string) => {
    if (!patientId) return;
    setPrintingId(paymentId);
    try {
      const result = await printPaymentReceipt(patientId, paymentId, { fallbackName: appointment?.patientName, language });
      if (!result.ok) showToast(result.message, "error");
    } finally {
      setPrintingId(null);
    }
  };

  useEffect(() => {
    if (!patientId) {
      setLedger([]);
      setLedgerLoading(false);
      return;
    }
    setLedgerLoading(true);
    const unsub = onSnapshot(
      query(getClinicCollection("ledger"), where("patientId", "==", patientId)),
      (snap) => {
        setLedger(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLedgerLoading(false);
      },
      () => setLedgerLoading(false)
    );
    return () => unsub();
  }, [patientId]);

  useEffect(() => {
    if (!patientId) {
      setNotes([]);
      return;
    }
    const unsub = onSnapshot(
      query(getClinicCollection("clinical_notes"), where("patientId", "==", patientId)),
      (snap) => setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Note))),
      () => setNotes([])
    );
    return () => unsub();
  }, [patientId]);

  // The charted mouth, so the editor's teeth chart shows this patient's history, not a healthy one.
  useEffect(() => {
    if (!patientId) return;
    getDoc(getClinicDoc("patients", patientId))
      .then((snap) => setTeethData(snap.exists() ? snap.data().teethData || {} : {}))
      .catch(() => setTeethData({}));
  }, [patientId]);

  useEffect(() => {
    if (servicesList.length > 0 || fetchedServices) return;
    getDocs(getClinicCollection("services"))
      .then((snap) =>
        setFetchedServices(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as Service)).sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setFetchedServices([]));
  }, [servicesList.length, fetchedServices]);

  useEffect(() => {
    if (fetchedDoctors) return;
    getDocs(getClinicCollection("staff"))
      .then((snap) =>
        setFetchedDoctors(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff)).filter((s) => isDentistStaff(s)))
      )
      .catch(() => setFetchedDoctors([]));
  }, [fetchedDoctors]);

  const services: Service[] = useMemo(
    () => (servicesList.length > 0 ? (servicesList as Service[]) : fetchedServices || []),
    [servicesList, fetchedServices]
  );
  const doctors: Staff[] = fetchedDoctors && fetchedDoctors.length > 0 ? fetchedDoctors : (doctorsList as Staff[]);

  /**
   * Only what the selected list actually covers.
   *
   * A treatment the insurer does not pay for is not offered at all, so the menu means what it
   * says. Leaving it visible and quietly recording it as private would be a screen that lets
   * somebody pick a wrong answer and then overrules them without saying so.
   */
  // Every service, whoever pays: the price box is the price.
  // Every service whoever pays (coverage lists are gone); only the price list's own menu applies:
  // another list's own treatments are left out, and the shared ones this list hides.
  const offeredServices = useMemo(() => {
    const offered = serviceMenuById(priceLists, payers, procListId, services);
    return services.filter((s) => offered(String(s.id)));
  }, [services, priceLists, payers, procListId]);
  /**
   * A name that is not in the catalogue has no price to fall back on: a blank box would record the
   * treatment with no charge and still say "Service added". 0 typed is a real answer and allowed.
   */
  const quickNeedsPrice =
    !!procName.trim() && procCost === "" && !services.some((s) => String(s.name) === procName.trim());
  const quickNeedsPriceText = isAr ? "اكتب سعر للعلاج اللي مش في قائمتك" : "Type a price for a treatment that is not in your list";
  /** The picked service's own billing rule (per tooth / per jaw / flat); a free-typed name is per tooth, as on the server. */
  const quickPricingMode = (services.find((x) => String(x.name) === procName.trim()) as { pricingMode?: string } | undefined)?.pricingMode ?? null;

  const treatments = useMemo(() => {
    const categoryById = new Map(services.map((s) => [s.id, s.category]));
    return treatmentsByTooth(notes, (id) => categoryById.get(id) || undefined, (name) => suggestCategory(name));
  }, [notes, services]);

  const charges: Charge[] = useMemo(
    () =>
      ledger
        .filter((r) => r.type === "procedure")
        .map((r) => {
          const cost = money(r.cost);
          const paid = money(r.paid);
          return {
            id: r.id,
            description: String(r.description || (isAr ? "إجراء" : "Treatment")),
            date: String(r.date || ""),
            cost,
            paid,
            listPrice: money(r.listPrice || r.cost),
            discountAmount: money(r.discountAmount),
            clinicalNoteId: typeof r.clinicalNoteId === "string" ? r.clinicalNoteId : null,
            remaining: money(cost - paid),
            payerName:
              typeof r.payerId === "string" && r.payerId && r.payerId !== PRIVATE_PAYER_ID && r.payerName
                ? String(r.payerName)
                : null,
            dentistName: String(r.doctorName || r.doctor || (r.doctorId ? "—" : "")).trim(),
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date)),
    [ledger, isAr]
  );

  const payments: Payment[] = useMemo(
    () =>
      ledger
        .filter((r) => r.type === "payment")
        .map((r) => ({
          id: r.id,
          date: String(r.date || ""),
          // A payment's money lives in `paid`; `amount` mirrors it, and older rows left one of the
          // two as a placeholder zero — so take whichever is actually non-zero.
          amount: money(Number(r.paid) || Number(r.amount) || 0),
          method: String(r.method || "Cash"),
          description: String(r.description || ""),
          procedureId: typeof r.procedureId === "string" && r.procedureId ? r.procedureId : null,
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [ledger]
  );

  const chargeById = useMemo(() => new Map(charges.map((c) => [c.id, c])), [charges]);
  const noteByLedgerId = useMemo(() => {
    const m = new Map<string, Note>();
    notes.forEach((n) => {
      if (n.ledgerId) m.set(String(n.ledgerId), n);
    });
    return m;
  }, [notes]);

  const visitNoteIds = useMemo(
    () => new Set(notes.filter((n) => n.appointmentId === appointmentId).map((n) => n.id)),
    [notes, appointmentId]
  );
  const patientWide = scope === "patient";
  const visitCharges = useMemo(
    () => (patientWide ? [...charges].reverse() : charges.filter((c) => c.clinicalNoteId && visitNoteIds.has(c.clinicalNoteId))),
    [charges, visitNoteIds, patientWide]
  );
  const olderCharges = useMemo(
    () => (patientWide ? [] : charges.filter((c) => !(c.clinicalNoteId && visitNoteIds.has(c.clinicalNoteId))).reverse()),
    [charges, visitNoteIds, patientWide]
  );

  /** Treatments the dentist recorded on this visit that were never billed. */
  const unbilledNotes = useMemo(
    () => notes.filter((n) => (patientWide || n.appointmentId === appointmentId) && !n.ledgerId),
    [notes, appointmentId, patientWide]
  );

  const totalCost = money(charges.reduce((s, c) => s + c.cost, 0));
  const totalDiscount = money(charges.reduce((s, c) => s + c.discountAmount, 0));
  const totalPaid = money(payments.reduce((s, p) => s + p.amount, 0));
  const remaining = money(totalCost - totalPaid);
  /** Money taken on account: paid to the clinic but settling no particular treatment. */
  const credit = money(totalPaid - charges.reduce((s, c) => s + c.paid, 0));
  const unpaidCharges = useMemo(() => charges.filter((c) => c.remaining > 0.009), [charges]);

  /**
   * How one amount is spread over what is owed: oldest charge first, never more than each is short.
   *
   * The server refuses a payment bigger than the treatment it settles, one call at a time. So
   * "collect the lot" is not one payment against one charge — it is the split, made here, shown
   * before it is taken, and written as one payment per charge.
   */
  const allocationPlan = useMemo(() => {
    const amount = Number(collectAmount) || 0;
    if (amount <= 0) return [] as { charge: Charge; amount: number }[];
    if (collectTarget === "general") return [];
    if (collectTarget !== "all") {
      const charge = chargeById.get(collectTarget);
      return charge ? [{ charge, amount: money(Math.min(amount, charge.remaining)) }] : [];
    }
    let left = amount;
    const plan: { charge: Charge; amount: number }[] = [];
    for (const charge of unpaidCharges) {
      if (left <= 0.009) break;
      const take = money(Math.min(left, charge.remaining));
      plan.push({ charge, amount: take });
      left = money(left - take);
    }
    return plan;
  }, [collectAmount, collectTarget, unpaidCharges, chargeById]);

  const plannedTotal = money(allocationPlan.reduce((s, r) => s + r.amount, 0));
  const overflow = money((Number(collectAmount) || 0) - plannedTotal);

  const openCollect = (target: string) => {
    setCollectTarget(target);
    setCollectOpen(true);
    if (target === "all") setCollectAmount(remaining > 0 ? remaining : "");
    else if (target === "general") setCollectAmount("");
    else setCollectAmount(chargeById.get(target)?.remaining || "");
  };

  const openDiscount = (target: string) => {
    const charge = target === "visit" ? null : chargeById.get(target);
    setDiscountTarget(target);
    setDiscountMode("percent");
    setDiscountValue("");
    setDiscountReason(charge && charge.discountAmount > 0 ? "" : "");
  };

  const handleCollect = async () => {
    const amount = Number(collectAmount) || 0;
    if (amount <= 0) {
      showToast(isAr ? "اكتبي المبلغ" : "Enter an amount", "error");
      return;
    }

    // What the server will refuse, refused here first — before the money is in the drawer and the
    // patient is halfway out of the door.
    const rows =
      collectTarget === "general"
        ? [{ charge: null as Charge | null, amount }]
        : allocationPlan.map((r) => ({ charge: r.charge as Charge | null, amount: r.amount }));

    if (rows.length === 0) {
      showToast(isAr ? "مفيش حاجة متبقية على المريض ده" : "Nothing is outstanding for this patient", "error");
      return;
    }
    // The owner's rule: no money for a treatment that names no dentist. Checked before the first
    // payment, so a payment spread over several treatments is never taken half way.
    const noDentist = rows.filter((r) => r.charge && !r.charge.dentistName).map((r) => r.charge!.description);
    if (noDentist.length > 0) {
      showToast(
        isAr
          ? `اختار الطبيب الأول لـ: ${noDentist.join("، ")}`
          : `Choose the dentist first for: ${noDentist.join(", ")}`,
        "error",
      );
      return;
    }
    if (overflow > 0.009 && collectTarget !== "general") {
      showToast(
        isAr
          ? `المبلغ أكبر من المتبقي بـ ${overflow.toLocaleString()} ج.م — سجّلي الزيادة كدفعة عامة`
          : `That is ${overflow.toLocaleString()} EGP more than is owed — record the extra as a general payment`,
        "error"
      );
      return;
    }
    for (const row of rows) {
      if (!row.charge) continue;
      const verdict = checkAllocation({
        cost: row.charge.cost,
        otherPaymentsTotal: row.charge.paid,
        amount: row.amount,
      });
      if (!verdict.ok) {
        showToast(
          isAr ? allocationMessageAr(verdict, row.charge.description) : allocationMessage(verdict, row.charge.description),
          "error"
        );
        return;
      }
    }

    setCollecting(true);
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split("T")[0];
    let taken = 0;
    let lastPaymentId: string | null = null;
    try {
      for (const row of rows) {
        const { id: paymentId } = await createPayment({
          patientId: appointment.patientId,
          patientName: appointment.patientName,
          amount: row.amount,
          method: collectMethod,
          description: row.charge ? `Payment for ${row.charge.description}` : "Payment on account",
          procedureId: row.charge ? row.charge.id : null,
          date: localDate,
        });
        taken = money(taken + row.amount);
        lastPaymentId = paymentId;

        // Fire-and-forget, as everywhere else that takes money: the payment is recorded either
        // way, and a messaging outage must not look like the payment failed.
        void sendPatientPaymentWhatsApp({
          patientId: String(appointment.patientId),
          ledgerId: paymentId,
          patientName: appointment.patientName,
        });
      }
      showToast(
        isAr ? `اتسجل ${taken.toLocaleString()} ج.م` : `Recorded ${taken.toLocaleString()} EGP`,
        "success"
      );
      // One print for the sitting: "all owed" can create several rows, and a receipt per row would
      // open the print dialog that many times over. The last row's receipt is the one handed over.
      if (lastPaymentId) {
        const receiptSettings = await loadReceiptSettings();
        if (receiptSettings.autoPrintAfterPayment) void printReceipt(lastPaymentId);
      }
      setCollectOpen(false);
      setCollectAmount("");
      setCollectTarget("all");
    } catch (e) {
      showToast(
        e instanceof MoneyApiError
          ? taken > 0
            ? `${e.message} ${isAr ? `— اتسجل ${taken.toLocaleString()} ج.م قبل الخطأ` : `— ${taken.toLocaleString()} EGP was recorded before this failed`}`
            : e.message
          : isAr
          ? "خطأ في تسجيل الدفعة"
          : "Could not record that payment",
        "error"
      );
    } finally {
      setCollecting(false);
    }
  };

  const handleDiscount = async () => {
    const value = Number(discountValue) || 0;
    if (value <= 0) {
      showToast(isAr ? "اكتبي قيمة الخصم" : "Enter a discount", "error");
      return;
    }
    if (!discountReason) {
      showToast(isAr ? "اختاري سبب الخصم" : "Choose a reason for this discount", "error");
      return;
    }

    const targets = discountTarget === "visit" ? visitCharges : [chargeById.get(discountTarget || "")].filter(Boolean) as Charge[];
    if (targets.length === 0) {
      showToast(isAr ? "مفيش إجراءات على الزيارة دي" : "There is nothing to discount on this visit", "error");
      return;
    }

    /**
     * A discount on a visit is a discount on each treatment in it.
     *
     * The books hold a discount against the treatment that was cheapened — there is no such row as
     * "the visit" — so a percentage goes on each line unchanged (which is the same result), and a
     * fixed amount is split in proportion to what each line costs. The largest line absorbs the
     * rounding so the pennies add up to what she typed.
     */
    const listTotal = money(targets.reduce((s, c) => s + (c.listPrice || c.cost), 0));
    const patches = targets.map((charge) => {
      const list = money(charge.listPrice || charge.cost);
      if (discountMode === "percent") {
        return { charge, patch: { listPrice: list, discountMode: "percent", discountPercent: value, discountFixed: null, discountReason } };
      }
      const share = listTotal > 0 ? money((value * list) / listTotal) : 0;
      return { charge, patch: { listPrice: list, discountMode: "fixed", discountPercent: null, discountFixed: share, discountReason } };
    });
    if (discountMode === "fixed") {
      const spread = money(patches.reduce((s, p) => s + Number(p.patch.discountFixed || 0), 0));
      const drift = money(value - spread);
      if (Math.abs(drift) > 0.009) {
        const biggest = patches.reduce((a, b) => (Number(a.patch.discountFixed) >= Number(b.patch.discountFixed) ? a : b));
        biggest.patch.discountFixed = money(Number(biggest.patch.discountFixed) + drift);
      }
    }

    setDiscounting(true);
    try {
      for (const { charge, patch } of patches) {
        await updateLedgerRow(charge.id, patch);
      }
      showToast(isAr ? "تم الخصم" : "Discount applied", "success");
      setDiscountTarget(null);
      setDiscountValue("");
      setDiscountReason("");
    } catch (e) {
      showToast(
        e instanceof MoneyApiError ? e.message : isAr ? "مقدرناش نطبق الخصم" : "Could not apply that discount",
        "error"
      );
    } finally {
      setDiscounting(false);
    }
  };

  const handleQuickAdd = async () => {
    const name = procName.trim();
    if (!name) {
      showToast(isAr ? "اكتب اسم الخدمة" : "Name the treatment", "error");
      return;
    }
    if (quickNeedsPrice) {
      showToast(quickNeedsPriceText, "error");
      return;
    }
    setAddingProcedure(true);
    try {
      const today = new Date();
      const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split("T")[0];
      // Attribution follows the appointment's dentist, never whoever is clicking — a receptionist
      // recording a treatment must not become the person it pays out to. A visit with no dentist
      // is charged all the same and simply earns nobody a commission.
      await createProcedure({
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        procedures: [name],
        // The chart's teeth (popup only); none = a general treatment. The server multiplies the
        // price by the units they make under the service's rule, as it does from the patient's file.
        selectedTeeth: [...procTeeth],
        tooth: "Gen",
        // The box is the price of one unit; blank means "price it from the catalogue".
        unitCost: procCost === "" ? null : Number(procCost),
        ...(quickPricingMode ? { pricingMode: quickPricingMode } : {}),
        priceListId: procListId || null,
        payerId: procPayerId || null,
        doctorId: appointment.doctorId || null,
        status: "Completed",
        date: localDate,
        addToLedger: true,
      });
      showToast(isAr ? "اتضافت الخدمة" : "Service added", "success");
      setProcName("");
      setProcCost("");
      setProcTeeth([]);
    } catch (err) {
      showToast(
        err instanceof MoneyApiError ? err.message : isAr ? "خطأ في إضافة الخدمة" : "Could not add that service",
        "error"
      );
    } finally {
      setAddingProcedure(false);
    }
  };

  const handleDeleteCharge = async (charge: Charge) => {
    if (!charge.clinicalNoteId) return;
    const ok = await confirm(
      isAr ? "حذف الإجراء ده؟ هيتشال كمان من الحساب." : "Delete this treatment? Its charge goes with it."
    );
    if (!ok) return;
    try {
      await deleteProcedure(charge.clinicalNoteId);
      showToast(isAr ? "تم الحذف" : "Deleted", "info");
    } catch (e) {
      showToast(
        e instanceof MoneyApiError ? e.message : isAr ? "خطأ في الحذف" : "Could not delete that",
        "error"
      );
    }
  };

  const openEditor = (note: Note | null) => {
    setEditingNote(note);
    setEditorApptId(note ? note.appointmentId || null : appointmentId || null);
    setEditorOpen(true);
  };

  if (!patientId) {
    return (
      <p className="text-sm text-center text-slate-400 italic py-6">
        {isAr ? "الموعد ده مش مربوط بمريض" : "This appointment has no patient on file"}
      </p>
    );
  }

  const capHint =
    maxDiscountPercent === null
      ? isAr ? "مفيش حد أقصى للخصم" : "No ceiling on your discounts"
      : isAr ? `أقصى خصم مسموح ليكي ${maxDiscountPercent}%` : `Your ceiling is ${maxDiscountPercent}%`;

  const chargeRow = (charge: Charge, dim = false) => {
    const note = charge.clinicalNoteId ? noteByLedgerId.get(charge.clinicalNoteId) : undefined;
    const settled = charge.remaining <= 0.009;
    return (
      <div
        key={charge.id}
        className={`rounded-xl border px-3 py-2.5 ${dim ? "border-line bg-surface-subtle" : settled ? "border-line bg-surface" : "border-line-strong bg-surface shadow-sm"}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{charge.description}</p>
            <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
              {charge.date}
              {note?.tooth && note.tooth !== "Gen" ? ` · ${note.tooth}` : ""}
            </p>
            {!charge.dentistName && !settled && (
              <p className="mt-1 text-[11px] font-bold text-danger">
                {isAr ? "مفيش طبيب على العلاج ده — اختاره قبل ما تحصّل" : "No dentist on this treatment — choose one before taking money"}
              </p>
            )}
            {/* The insurer is a fact of the charge, not of the patient: say it on the row it belongs to. */}
            {charge.payerName && (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-ink-body">
                <InsurerBadge name={charge.payerName} size={14} />
                <span className="truncate">
                  {isAr ? "على حساب" : "Charged to"} {charge.payerName}
                </span>
              </p>
            )}
          </div>
          <span className="text-sm font-black text-ink shrink-0">{charge.cost.toLocaleString()}</span>
        </div>

        {charge.discountAmount > 0 && (
          <p className="text-[11px] font-semibold text-slate-400 mt-1">
            {isAr ? "قبل الخصم" : "Was"} {charge.listPrice.toLocaleString()} · {isAr ? "خصم" : "discount"}{" "}
            {charge.discountAmount.toLocaleString()}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 mt-2">
          {settled ? (
            <span className="text-[11px] font-bold text-emerald-600">{isAr ? "مدفوع بالكامل" : "Paid in full"}</span>
          ) : (
            <span className="text-[11px] font-bold text-amber-600">
              {isAr ? "متبقي" : "Left"} {charge.remaining.toLocaleString()}
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Collecting opens the box on the balance card, which the Service half does not draw. */}
            {!settled && section !== "service" && (
              <button
                onClick={() => openCollect(charge.id)}
                className="text-[11px] font-bold rounded-full border border-line-strong px-3 py-1 flex items-center gap-1 hover:bg-surface-muted transition-colors"
              >
                <Banknote size={13} className="text-emerald-600" /> {isAr ? "تحصيل" : "Collect"}
              </button>
            )}
            <button
              onClick={() => openDiscount(charge.id)}
              className="text-[11px] font-bold rounded-full border border-line px-3 py-1 flex items-center gap-1 text-ink-muted hover:bg-surface-muted transition-colors"
            >
              <Tag size={13} className="text-pink-500" /> {isAr ? "خصم" : "Discount"}
            </button>
            {note && (
              <button
                onClick={() => openEditor(note)}
                title={isAr ? "تعديل كامل" : "Full editor"}
                className="p-1.5 rounded-lg text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-100 transition-colors"
              >
                <Pencil size={13} />
              </button>
            )}
            <button
              onClick={() => handleDeleteCharge(charge)}
              title={isAr ? "حذف" : "Delete"}
              className="p-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {discountTarget === charge.id && discountBox}
      </div>
    );
  };

  const discountBox = (
    <div className="mt-3 rounded-xl border border-pink-200 bg-pink-50/60 p-3 animate-in slide-in-from-top-2 duration-200">
      <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 mb-2">
        <Tag size={14} className="text-pink-500" />
        {discountTarget === "visit" ? (isAr ? "خصم على الزيارة كلها" : "Discount the whole visit") : isAr ? "خصم" : "Discount"}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-full border border-line overflow-hidden shrink-0 bg-surface">
          {(["percent", "fixed"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setDiscountMode(m)}
              className={`text-[11px] font-bold px-3 py-1.5 transition-colors ${
                discountMode === m ? "bg-ink-slab text-white" : "text-ink-muted hover:bg-surface-muted"
              }`}
            >
              {m === "percent" ? "%" : isAr ? "مبلغ" : "EGP"}
            </button>
          ))}
        </div>
        <input
          type="number"
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value ? Number(e.target.value) : "")}
          placeholder="0"
          className="flex-1 min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-800 outline-none focus:ring-2 focus:ring-pink-300"
        />
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2">
        {discountSettings.reasons.map((reason) => (
          <button
            key={reason}
            onClick={() => setDiscountReason(reason)}
            className={`text-[11px] font-bold rounded-full px-3 py-1 border transition-colors ${
              discountReason === reason
                ? "bg-ink-slab text-white border-ink-slab"
                : "border-line text-ink-muted hover:bg-surface-muted bg-surface"
            }`}
          >
            {reason}
          </button>
        ))}
      </div>

      <p className="text-[10px] font-semibold text-slate-400 mt-2">
        {capHint} · {isAr ? "السبب مطلوب" : "a reason is required"}
      </p>

      <div className="flex gap-2 mt-3">
        <button
          disabled={discounting}
          onClick={handleDiscount}
          className="flex-1 bg-ink-slab hover:bg-slate-800 text-white text-sm font-bold rounded-lg py-2 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
        >
          {discounting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {isAr ? "تطبيق" : "Apply"}
        </button>
        <button
          onClick={() => setDiscountTarget(null)}
          className="text-sm font-bold text-ink-muted border border-line rounded-lg px-4 bg-surface hover:bg-surface-muted transition-colors"
        >
          {isAr ? "إلغاء" : "Cancel"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Balance — the one figure she is asked for, and the two actions that change it */}
      {section !== "service" && (
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        {section === "payment" ? (
          // The booking popup's Payment tab: the three figures side by side, for the whole account.
          <>
          <p className="mb-2 text-[12px] font-bold text-ink-muted">{isAr ? "حساب المريض كله — كل الزيارات" : "The patient's whole account — every visit"}</p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {[
              {
                label: isAr ? "إجمالي الخدمات" : "Total services",
                value: totalCost,
                note: totalDiscount > 0 ? `${isAr ? "بعد خصم" : "after"} ${totalDiscount.toLocaleString()} ${isAr ? "" : "discount"}`.trim() : "",
                tone: "text-ink",
              },
              { label: isAr ? "المدفوع" : "Paid", value: totalPaid, note: "", tone: "text-ink" },
              { label: isAr ? "المتبقي" : "Remaining", value: remaining, note: "", tone: remaining > 0 ? "text-ink" : "text-ok" },
            ].map((tile, i) => (
              <div key={i} className={`rounded-xl border px-4 py-3 ${i === 2 ? "border-ink-slab" : "border-line"}`}>
                <p className="text-[11px] font-black uppercase tracking-widest text-ink-muted">{tile.label}</p>
                <p className={`mt-0.5 font-figure text-2xl font-semibold tabular-nums ${tile.tone}`}>
                  {tile.value.toLocaleString()}
                  <span className="ms-1 text-[11px] font-bold text-ink-faint">{isAr ? "ج.م" : "EGP"}</span>
                </p>
                {tile.note && <p className="text-[11px] font-semibold text-ink-faint">{tile.note}</p>}
              </div>
            ))}
          </div>
          </>
        ) : (
          <>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-black text-ink-muted uppercase tracking-widest">
            {isAr ? "المتبقي" : "Remaining"}
          </span>
          <span className={`text-3xl font-black tabular-nums ${remaining > 0 ? "text-ink" : "text-emerald-600"}`}>
            {remaining.toLocaleString()}
            <span className="text-[11px] font-bold text-slate-400 ms-1">EGP</span>
          </span>
        </div>
        <p className="text-[11px] font-semibold text-slate-400 mt-1">
          {isAr ? "الإجمالي" : "Total"} {totalCost.toLocaleString()}
          {totalDiscount > 0 ? ` · ${isAr ? "خصم" : "discount"} ${totalDiscount.toLocaleString()}` : ""} ·{" "}
          {isAr ? "المدفوع" : "paid"} {totalPaid.toLocaleString()}
        </p>
          </>
        )}

        {credit > 0.009 && (
          <p className="text-[11px] font-bold text-sky-600 mt-1.5">
            {isAr ? "رصيد غير مخصص" : "Unallocated credit"} {credit.toLocaleString()} EGP
          </p>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => (collectOpen ? setCollectOpen(false) : openCollect("all"))}
            className="flex-1 bg-ink-slab hover:bg-slate-800 text-white text-sm font-bold rounded-xl py-2.5 flex items-center justify-center gap-1.5 transition-colors shadow-sm"
          >
            <Banknote size={15} className="text-emerald-300" />
            {collectOpen ? (isAr ? "إغلاق" : "Close") : isAr ? "تحصيل دفعة" : "Collect payment"}
          </button>
          {visitCharges.length > 0 && (
            <button
              onClick={() => (discountTarget === "visit" ? setDiscountTarget(null) : openDiscount("visit"))}
              className="text-sm font-bold text-ink-body border border-line bg-surface hover:bg-surface-muted rounded-xl px-4 flex items-center gap-1.5 transition-colors"
            >
              <Tag size={15} className="text-pink-500" /> {isAr ? "خصم" : "Discount"}
            </button>
          )}
        </div>

        {discountTarget === "visit" && discountBox}

        {collectOpen && (
          <div className="mt-3 rounded-xl border border-line bg-surface-subtle p-3 animate-in slide-in-from-top-2 duration-200">
            <p className="text-[11px] font-bold text-ink-muted mb-2">
              {collectTarget === "general"
                ? isAr ? "دفعة عامة — من غير إجراء محدد" : "On account — not against a treatment"
                : collectTarget === "all"
                ? isAr ? "هيتوزع على المتبقي، الأقدم الأول" : "Spread over what is owed, oldest first"
                : `${isAr ? "على" : "Against"} ${chargeById.get(collectTarget)?.description || ""}`}
            </p>

            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value ? Number(e.target.value) : "")}
                placeholder="0"
                className="flex-1 min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-lg font-black text-slate-800 outline-none focus:ring-2 focus:ring-emerald-300"
              />
              <button
                disabled={collecting || !collectAmount}
                onClick={handleCollect}
                className="bg-ink-slab hover:bg-slate-800 text-white text-sm font-bold rounded-lg px-5 py-2.5 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {collecting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {isAr ? "تأكيد" : "Confirm"}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2">
              {remaining > 0 && (
                <button
                  onClick={() => openCollect("all")}
                  className={`text-[11px] font-bold rounded-full px-3 py-1 border transition-colors ${
                    collectTarget === "all" ? "bg-ink-slab text-white border-ink-slab" : "bg-surface border-line text-ink-muted"
                  }`}
                >
                  {isAr ? "كل المتبقي" : "Everything owed"} {remaining.toLocaleString()}
                </button>
              )}
              <button
                onClick={() => openCollect("general")}
                className={`text-[11px] font-bold rounded-full px-3 py-1 border transition-colors ${
                  collectTarget === "general" ? "bg-ink-slab text-white border-ink-slab" : "bg-surface border-line text-ink-muted"
                }`}
              >
                {isAr ? "دفعة عامة" : "On account"}
              </button>
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setCollectMethod(m.id)}
                  className={`text-[11px] font-bold rounded-full px-3 py-1 border transition-colors ${
                    collectMethod === m.id ? "bg-ink-slab text-white border-ink-slab" : "bg-surface border-line text-ink-muted"
                  }`}
                >
                  {isAr ? m.ar : m.en}
                </button>
              ))}
            </div>

            {allocationPlan.length > 1 && (
              <p className="text-[11px] font-semibold text-slate-500 mt-2">
                {isAr ? "هيتوزع:" : "Splits as:"}{" "}
                {allocationPlan.map((r) => `${r.charge.description} ${r.amount.toLocaleString()}`).join(" · ")}
              </p>
            )}
            {overflow > 0.009 && collectTarget !== "general" && (
              <p className="text-[11px] font-bold text-amber-600 mt-2 flex items-center gap-1">
                <AlertTriangle size={12} />
                {isAr
                  ? `أكبر من المتبقي بـ ${overflow.toLocaleString()} — سجّليها كدفعة عامة`
                  : `${overflow.toLocaleString()} more than is owed — record it on account`}
              </p>
            )}
          </div>
        )}
      </div>
      )}

      {/* Today's visit */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-black text-ink-muted uppercase tracking-widest">
            {patientWide ? (isAr ? "كل العلاجات" : "All treatments") : isAr ? "زيارة اليوم" : "This visit"}
          </h3>
          {onQuickPay && (
            <button
              onClick={() => onQuickPay(appointment.patientId, appointment.patientName)}
              className="text-[11px] font-bold text-ink-muted hover:text-ink-body transition-colors"
            >
              {isAr ? "شاشة الدفع" : "Payment window"}
            </button>
          )}
        </div>

        {ledgerLoading ? (
          <div className="flex justify-center p-4">
            <Loader2 className="animate-spin text-slate-300" size={22} />
          </div>
        ) : visitCharges.length === 0 && unbilledNotes.length === 0 ? (
          <p className="text-sm text-center text-slate-400 italic py-3">
            {patientWide ? (isAr ? "مفيش علاجات متسجلة على المريض ده" : "No treatments on file for this patient") : isAr ? "مفيش خدمات على الزيارة دي" : "No treatments on this visit yet"}
          </p>
        ) : (
          <div className="space-y-2">
            {visitCharges.map((c) => chargeRow(c))}
            {unbilledNotes.map((note) => (
              <div key={note.id} className="rounded-xl border border-dashed border-line-strong bg-surface-subtle px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{note.procedure || note.serviceName}</p>
                    <p className="text-[11px] font-bold text-amber-600 mt-0.5">{isAr ? "غير مفوتر" : "Not billed"}</p>
                  </div>
                  <button
                    onClick={() => openEditor(note)}
                    className="text-[11px] font-bold rounded-full border border-line-strong px-3 py-1 shrink-0 hover:bg-surface-muted transition-colors"
                  >
                    {isAr ? "افوترها" : "Bill it"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add a treatment — service and price, everything else in the full editor */}
      {section !== "payment" && (
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
        <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 mb-2">
          <Plus size={14} className="text-emerald-600" /> {isAr ? "إضافة خدمة" : "Add a treatment"}
        </div>
        <div className="flex flex-col gap-2">
          {activeLists.length > 1 && (
            <select
              value={procListId}
              onChange={(e) => setProcListId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-ink outline-none"
            >
              {activeLists.map((l) => {
                // The company behind the list, in the option itself. A list called "AXA" that no
                // insurer points at charges exactly like the clinic's own, and looked identical
                // here — so the case was recorded as private and vanished from AXA's report.
                const owner = payerForPriceList(payers, l.id);
                return (
                  <option key={l.id} value={l.id}>
                    {isAr ? l.nameAr || l.name : l.name}
                    {owner.id !== PRIVATE_PAYER_ID ? ` · ${owner.name}` : ""}
                  </option>
                );
              })}
            </select>
          )}
          {activePayers.length > 1 && (
            <select
              value={procPayerId}
              onChange={(e) => pickPayer(e.target.value)}
              aria-label={isAr ? "مين بيدفع" : "Who pays"}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-ink outline-none"
            >
              {activePayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === PRIVATE_PAYER_ID ? (isAr ? "خاص (العيادة)" : "Private (the clinic)") : isAr ? p.nameAr || p.name : p.name}
                </option>
              ))}
            </select>
          )}
          <ServiceCombobox
            priceListId={procListId}
            services={offeredServices}
            value={procName}
            onChange={(val: string, svc: any) => {
              setProcName(svc ? svc.name : val);
              if (svc) setProcCost(resolveListPrice(svc, procListId));
            }}
            valueKey="name"
            allowFreeText
            placeholder={isAr ? "اكتب أو اختار الخدمة..." : "Type or pick a treatment..."}
            language={language}
            className="w-full text-sm py-2 font-bold border border-line rounded-lg bg-surface"
          />
          {section === "service" && (
            <div>
              <TeethChartSelector
                selected={procTeeth}
                onToggle={(code) => setProcTeeth((prev) => (prev.includes(code) ? prev.filter((t) => t !== code) : [...prev, code]))}
                onSetSelected={setProcTeeth}
                teethData={teethData}
                treatments={treatments}
                isAr={isAr}
                narrow={false}
              />
              <p className="mt-1.5 text-xs font-semibold text-ink-body">
                {procTeeth.length
                  ? `${isAr ? "الأسنان:" : "Teeth:"} ${toothListLabel(procTeeth)}`
                  : isAr ? "من غير أسنان = علاج عام" : "No teeth picked = a general treatment"}
                {procTeeth.length > 0 && (
                  <button type="button" onClick={() => setProcTeeth([])} className="ms-3 text-xs font-bold text-ink-muted underline hover:text-ink">
                    {isAr ? "امسح" : "Clear"}
                  </button>
                )}
              </p>
              {procTeeth.length > 0 && stagedMode({ pricingMode: quickPricingMode }) !== "flat" && (
                <p className="mt-1 text-xs font-bold text-ink-muted">
                  {stagedMode({ pricingMode: quickPricingMode }) === "per_arch"
                    ? isAr ? "السعر تحت للفك الواحد" : "The price below is per jaw"
                    : isAr ? "السعر تحت للسنة الواحدة" : "The price below is per tooth"}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="number"
              value={procCost}
              onChange={(e) => setProcCost(e.target.value ? Number(e.target.value) : "")}
              placeholder="0"
              className="flex-1 min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-800 outline-none focus:ring-2 focus:ring-emerald-300"
            />
            <button
              disabled={addingProcedure || !procName.trim() || quickNeedsPrice}
              onClick={handleQuickAdd}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg px-4 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {addingProcedure ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {isAr ? "إضافة" : "Add"}
            </button>
            <button
              onClick={() => openEditor(null)}
              title={isAr ? "أسنان، خصم، حالة، صور" : "Teeth, discount, status, photos"}
              className="text-sm font-bold text-ink-body border border-line bg-surface hover:bg-surface-muted rounded-lg px-3 transition-colors"
            >
              {isAr ? "تفاصيل" : "More"}
            </button>
          </div>
          {section === "service" && procTeeth.length > 0 && procCost !== "" && (() => {
            const pricing = { cost: Number(procCost) || 0, addToLedger: true, teeth: procTeeth, pricingMode: quickPricingMode };
            const units = stagedUnits(pricing);
            return (
              <p className="text-sm font-bold text-ink tabular-nums">
                {units > 1
                  ? `${Number(procCost).toLocaleString("en-US")} × ${units} = ${stagedLineTotal(pricing).toLocaleString("en-US")} ${isAr ? "ج.م" : "EGP"}`
                  : `${isAr ? "الإجمالي" : "Total"} ${stagedLineTotal(pricing).toLocaleString("en-US")} ${isAr ? "ج.م" : "EGP"}`}
              </p>
            );
          })()}
          {quickNeedsPrice && <p className="text-[11px] font-semibold text-amber-700">{quickNeedsPriceText}</p>}
        </div>
      </div>
      )}

      {/* Earlier visits */}
      {/* On the Payment tab too: the figures above cover every visit, so what they add up must be visible here. */}
      {olderCharges.length > 0 && (
        <div>
          <button
            onClick={() => setShowOlder((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-black text-ink-muted uppercase tracking-widest py-2"
          >
            <span className="flex items-center gap-1.5">
              <History size={14} className="text-violet-500" />
              {isAr ? "زيارات سابقة" : "Earlier visits"} ({olderCharges.length})
              {money(olderCharges.reduce((t, c) => t + c.remaining, 0)) > 0 && (
                <span className="normal-case tracking-normal text-amber-700">
                  · {isAr ? "عليه" : "owed"} {money(olderCharges.reduce((t, c) => t + c.remaining, 0)).toLocaleString()}
                </span>
              )}
            </span>
            <ChevronDown size={16} className={`transition-transform ${showOlder ? "rotate-180" : ""}`} />
          </button>
          {showOlder && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 animate-in slide-in-from-top-2 duration-200">
              {olderCharges.map((c) => chargeRow(c, true))}
            </div>
          )}
        </div>
      )}

      {/* Receipts */}
      {payments.length > 0 && section !== "service" && (
        <div>
          <button
            onClick={() => setShowReceipts((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-black text-ink-muted uppercase tracking-widest py-2"
          >
            <span className="flex items-center gap-1.5">
              <Receipt size={14} className="text-amber-500" />
              {isAr ? "الإيصالات" : "Receipts"} ({payments.length})
            </span>
            <ChevronDown size={16} className={`transition-transform ${showReceipts ? "rotate-180" : ""}`} />
          </button>
          {showReceipts && (
            <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1 animate-in slide-in-from-top-2 duration-200">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">
                      {p.procedureId ? chargeById.get(p.procedureId)?.description || p.description : isAr ? "دفعة عامة" : "On account"}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-400">
                      {p.date} · {p.method}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-black text-emerald-600">
                      +{p.amount.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      title={isAr ? "طباعة الإيصال" : "Print receipt"}
                      disabled={printingId === p.id}
                      onClick={() => void printReceipt(p.id)}
                      className="p-1.5 text-slate-400 hover:text-ink hover:bg-surface-muted rounded-lg transition-colors disabled:opacity-50"
                    >
                      {printingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editorOpen && (
        <ServiceEditorDrawer
          isOpen={editorOpen}
          inline={false}
          onClose={() => {
            setEditorOpen(false);
            setEditingNote(null);
            setEditorApptId(null);
          }}
          patientId={patientId}
          patientName={appointment?.patientName || ""}
          appointmentId={editorApptId}
          branchId={appointment?.branchId || null}
          initialNote={editingNote}
          servicesList={services}
          teethData={teethData}
          treatments={treatments}
          doctors={doctors}
          onSaved={() => {
            setEditorOpen(false);
            setEditingNote(null);
            setEditorApptId(null);
          }}
        />
      )}
    </div>
  );
}
