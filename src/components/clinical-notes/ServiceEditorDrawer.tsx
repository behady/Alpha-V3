"use client";

import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { X, Save, CheckCircle2, Loader2, Camera, Edit2 } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, query, where, deleteDoc, getDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import { MoneyApiError, createProcedure, updateProcedure } from "@/lib/moneyApi";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import TeethChart from "@/components/TeethChart";
import { isDentistStaff } from "@/lib/staffRoles";
import { Note, Service, Staff } from "./types";
import {
  ALL_TEETH, UPPER_LEFT_TEETH, UPPER_RIGHT_TEETH, LOWER_LEFT_TEETH, LOWER_RIGHT_TEETH,
  compressImage, computeProcedureLabFee, parseTeethString,
  DEFAULT_PRICING_MODE, isPricingMode, pricingUnitsFor, type PricingMode,
} from "./utils";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import DiscountEditor, { EMPTY_DISCOUNT, discountPayload, type DiscountState } from "@/components/shared/DiscountEditor";
import { isDiscountMode, type DiscountMode } from "@/lib/discountMath";
import { usePricingPolicy } from "@/lib/usePricingPolicy";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  /** The patient's own price list, used when this note has none of its own. */
  patientDefaultPriceListId?: string | null;
  appointmentId: string | null;
  initialNote: Note | null;
  servicesList: Service[];
  doctors: Staff[];
  onSaved: () => void;
  inline?: boolean;
  /**
   * Chart-first desktop layout: the teeth chart lives above this form instead of inside it, so the
   * selection has to be owned by the parent. Pass all three together — the selector is hidden here
   * and every read/write of the selection is routed to the parent's state.
   */
  hideTeethSelector?: boolean;
  selectedTeethOverride?: string[];
  onSelectedTeethChange?: (teeth: string[]) => void;
  /** Full-width grid instead of the drawer's tall single column. Desktop chart-first layout. */
  compact?: boolean;
}

export default function ServiceEditorDrawer({
  isOpen, onClose, patientId, patientName, patientDefaultPriceListId, appointmentId, initialNote, servicesList, doctors, onSaved, inline = false,
  hideTeethSelector = false, selectedTeethOverride, onSelectedTeethChange, compact = false
}: Props) {
  const { showToast, clinicalEditorMode } = useUI();
  const { language } = useLanguage();
  const { user } = useAuth();

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tooth, setTooth] = useState("");
  const [internalSelectedTeeth, setInternalSelectedTeeth] = useState<string[]>([]);

  // One name for the selection whether it lives here or in the parent, so nothing below has to
  // care which layout it is running in.
  const isTeethControlled = Array.isArray(selectedTeethOverride) && !!onSelectedTeethChange;
  const selectedTeeth = isTeethControlled ? (selectedTeethOverride as string[]) : internalSelectedTeeth;
  const setSelectedTeeth: Dispatch<SetStateAction<string[]>> = (action) => {
    if (isTeethControlled) {
      const next = typeof action === "function"
        ? (action as (prev: string[]) => string[])(selectedTeethOverride as string[])
        : action;
      onSelectedTeethChange!(next);
      return;
    }
    setInternalSelectedTeeth(action);
  };
  const [procedure, setProcedure] = useState("");
  const [multiProceduresText, setMultiProceduresText] = useState("");
  const [cost, setCost] = useState("");
  const [noteText, setNoteText] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [procedureStatus, setProcedureStatus] = useState<'Planned' | 'Ongoing' | 'Completed'>('Planned');
  const [addToLedger, setAddToLedger] = useState(true);
  // Price list + discount for this line. The server recomputes and enforces both; this is the
  // preview and the input.
  const { priceLists, discountSettings, maxDiscountPercent } = usePricingPolicy();
  const [discount, setDiscount] = useState<DiscountState>(EMPTY_DISCOUNT);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState("");
  const [isChangingService, setIsChangingService] = useState(false);
  /** Compact layout only: the extra-procedures box is folded away until someone needs it. */
  const [showExtraProcedures, setShowExtraProcedures] = useState(false);
  /** Set only when the user deliberately departs from the service's own billing rule. */
  const [pricingModeOverride, setPricingModeOverride] = useState<PricingMode | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * Which target the form has already been filled in for.
   *
   * The seeding below used to re-run whenever `doctors` or `user` changed identity — harmless for a
   * pop-up that opens after those have loaded, but the inline desktop editor is mounted and open
   * the whole time, so the staff list arriving a moment later wiped whatever had just been typed
   * or clicked on the chart. Seed once per note (or once per blank form) instead.
   */
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) seededForRef.current = null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const seedKey = initialNote ? `note:${initialNote.id}` : "new";
    if (seededForRef.current === seedKey) return;
    seededForRef.current = seedKey;

    if (initialNote) {
      setDate(initialNote.date || new Date().toISOString().split("T")[0]);
      setTooth(initialNote.tooth || "");
      setSelectedTeeth(parseTeethString(initialNote.tooth || ""));
      setProcedure(initialNote.serviceName || initialNote.procedure || initialNote.title || "");
      setProcedureStatus(initialNote.status || 'Planned');
      setIsChangingService(false);
      setMultiProceduresText((initialNote.procedures || []).slice(1).join("\n"));
      setCost(initialNote.unitCost != null ? String(initialNote.unitCost) : (initialNote.cost != null ? String(initialNote.cost) : ""));
      setNoteText(initialNote.note || "");
      
      if (initialNote.doctorId) {
          setSelectedDoctorId(initialNote.doctorId);
      } else if (initialNote.doctor) {
          const docObj = doctors.find(d => d.name === initialNote.doctor);
          if (docObj) setSelectedDoctorId(docObj.id);
      }
      
      // Reopen the note on the list and discount it was priced with, so re-saving never silently
      // re-prices it at today's rates.
      setDiscount({
        priceListId: (initialNote as { priceListId?: string }).priceListId || "",
        mode: isDiscountMode((initialNote as { discountMode?: string }).discountMode)
          ? ((initialNote as { discountMode?: DiscountMode }).discountMode as DiscountMode)
          : "none",
        value:
          typeof (initialNote as { discountValue?: number }).discountValue === "number"
            ? ((initialNote as { discountValue?: number }).discountValue as number)
            : "",
        reason: (initialNote as { discountReason?: string }).discountReason || "",
      });
      // A note that carries a cost was billed, whether or not its own ledgerId survived. The
      // charge itself no longer has to be looked up from here: the server follows both link
      // directions when it saves, so this checkbox only has to represent what the user intends.
      setAddToLedger(!!initialNote.ledgerId || Number(initialNote.cost) > 0);
      // Reopen the note on the rule it was priced with, so simply re-saving never moves the total.
      setPricingModeOverride(isPricingMode(initialNote.pricingMode) ? initialNote.pricingMode : null);
    } else {
      // Reset form
      setDate(new Date().toISOString().split('T')[0]);
      setTooth("");
      setProcedure(""); setMultiProceduresText(""); setCost(""); setNoteText("");
      setProcedureStatus('Planned');
      setAddToLedger(true);
      setDiscount(EMPTY_DISCOUNT);
      setIsChangingService(false);
      setPricingModeOverride(null);
      // When the chart above owns the selection, clearing it is the parent's call — the user may
      // well have picked the teeth before touching this form.
      if (!isTeethControlled) setSelectedTeeth([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialNote]);

  /**
   * Pick the doctor once the staff list has actually arrived. Split out of the seeding effect so a
   * late-loading list fills this one field instead of resetting the whole form, and so it never
   * overrides a doctor the user has already chosen.
   */
  useEffect(() => {
    if (!isOpen || selectedDoctorId || doctors.length === 0) return;
    if (initialNote) {
      const byName = initialNote.doctor ? doctors.find(d => d.name === initialNote.doctor) : undefined;
      if (byName) setSelectedDoctorId(byName.id);
      return;
    }
    const defaultDocId = (user && isDentistStaff(user))
        ? (doctors.find(d => d.name.toLowerCase() === user.name.toLowerCase() || d.id === user.uid)?.id || doctors[0]?.id)
        : doctors[0]?.id;
    if (defaultDocId) setSelectedDoctorId(defaultDocId);
  }, [isOpen, initialNote, doctors, user, selectedDoctorId]);

  const txt = {
    title: initialNote ? (language === "ar" ? "تعديل الإجراء" : "Edit Procedure") : (language === "ar" ? "إجراء جديد" : "New Procedure"),
    date: language === 'ar' ? "التاريخ" : "Date",
    procedure: language === 'ar' ? "الإجراء" : "Procedure Name",
    cost: language === 'ar' ? "التكلفة" : "Cost (EGP)",
    notes: language === 'ar' ? "ملاحظات" : "Note",
    selectDoctor: language === 'ar' ? "اختر الطبيب" : "Select Doctor",
    status: language === 'ar' ? "الحالة" : "Status",
    save: language === 'ar' ? "حفظ الإجراء" : "Log Procedure",
    cancel: language === 'ar' ? "إلغاء" : "Cancel",
    addToFinance: language === 'ar' ? "إضافة للمالية" : "Add to Ledger",
    selectError: language === 'ar' ? "اختر الإجراء والطبيب" : "Select a procedure AND doctor",
    extraProcedures: language === 'ar' ? "إجراءات إضافية" : "More procedures",
    hide: language === 'ar' ? "إخفاء" : "Hide",
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return; // Fix Scenario 1: Double-click protection
    if (!selectedDoctorId || (!procedure && !multiProceduresText)) return showToast(txt.selectError, "error");
    if (Number(cost) < 0) return showToast(language === 'ar' ? "لا يمكن إضافة تكلفة بالسالب" : "Cannot add negative cost", "error"); // Fix Scenario 2: Negative typo protection

    setIsSaving(true);
    setSaveStatusText("Saving to Database...");

    try {
      const extraProcedures = multiProceduresText.split("\n").map((line) => line.trim()).filter(Boolean);
      const procedures = Array.from(new Set([procedure.trim(), ...extraProcedures].filter(Boolean)));

      // The figures shown on screen are a preview. The server recomputes the cost, the lab fee and
      // the commission from the price list and the staff record it reads itself — a cost arriving
      // in a request body is a number the caller chose — and writes the note, its charge, their
      // back-link and the appointment's services[] mirror as one transaction. Those were four
      // separate writes from here, and a failure between any two left a charge with no treatment
      // behind it or a treatment nobody was billed for.
      const payload = {
        patientId,
        appointmentId: initialNote ? initialNote.appointmentId ?? null : appointmentId || null,
        procedures,
        selectedTeeth,
        tooth,
        unitCost: cost === "" ? null : Number(cost),
        pricingMode: pricingModeOverride,
        doctorId: selectedDoctorId,
        status: procedureStatus,
        note: noteText,
        date,
        addToLedger,
        ...discountPayload(discount),
        patientDefaultPriceListId: patientDefaultPriceListId || null,
      };

      if (initialNote) {
        await updateProcedure(initialNote.id, payload);
      } else {
        await createProcedure(payload);
      }

      showToast(initialNote ? "Procedure Updated" : "Procedure Logged", "success");
      onSaved();
      onClose();
    } catch (err) {
        showToast(err instanceof MoneyApiError ? err.message : "Error saving procedure", "error");
        console.error(err);
    } finally {
        setIsSaving(false);
        setSaveStatusText("");
    }
  };

  const handleProcedureChange = (val: string, svc?: any) => {
    const matchedSvc = svc || servicesList.find(s => s.name === val || String(s.id) === val);
    setProcedure(matchedSvc ? matchedSvc.name : val);
    if (matchedSvc) {
      setCost(matchedSvc.price.toString());
    }
  };

  const toggleTooth = (value: string, setter: Dispatch<SetStateAction<string[]>>) => {
    setter((prev) => (prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]));
  };

  const TeethChartSelector = ({ selected, onToggle }: { selected: string[]; onToggle: (toothCode: string) => void }) => {
    // Convert string array to number array for TeethChart
    const selectedNumbers = selected.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    
    const handleSelectArch = (arch: "upper" | "lower") => {
      const archTeeth = arch === "upper" 
        ? [...UPPER_RIGHT_TEETH, ...UPPER_LEFT_TEETH] 
        : [...LOWER_RIGHT_TEETH, ...LOWER_LEFT_TEETH];
      
      const allSelected = archTeeth.every(t => selected.includes(t));
      
      if (allSelected) {
        // Deselect all in arch
        setSelectedTeeth(prev => prev.filter(t => !archTeeth.includes(t)));
      } else {
        // Select all in arch
        setSelectedTeeth(prev => {
          const newSet = new Set([...prev, ...archTeeth]);
          return Array.from(newSet);
        });
      }
    };
    
    return (
      <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl min-w-0">
        <p className="text-[10px] font-bold text-slate-500 mb-4">{language === "ar" ? "اختر الأسنان من المخطط" : "Select teeth from chart"}</p>
        <div className="max-h-[300px] overflow-y-auto no-scrollbar rounded-xl border border-slate-200 bg-white shadow-inner">
          <TeethChart
            data={{}}
            selectionMode={true}
            compactMode={true}
            selectedTeeth={selectedNumbers}
            onToggleTooth={(id) => onToggle(id.toString())}
            onSelectArch={handleSelectArch}
          />
        </div>
      </div>
    );
  };

  /** A service's own billing rule, taken from the main procedure. */
  const servicePricingMode = (matched: Service[]): PricingMode => {
    const first = matched[0];
    return isPricingMode(first?.pricingMode) ? first.pricingMode : DEFAULT_PRICING_MODE;
  };

  // Live preview of what will actually be charged. Recomputed every render so the number on
  // screen is the number that gets saved — the multiplication used to be invisible until the
  // procedure showed up in the ledger at thirty-two times the price.
  const previewProcedures = Array.from(
    new Set([procedure.trim(), ...multiProceduresText.split("\n").map((s) => s.trim())].filter(Boolean))
  );
  const previewMatched = previewProcedures
    .map((name) => servicesList.find((s) => s.name === name))
    .filter((s): s is Service => Boolean(s));
  const previewMode = pricingModeOverride ?? servicePricingMode(previewMatched);
  const previewUnitCost =
    Number(cost) || previewMatched.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
  const previewUnits = pricingUnitsFor(previewMode, selectedTeeth);
  const previewTotal = previewUnitCost * previewUnits;
  /** True when the picked service predates billing rules, so the fallback is being used. */
  const pricingRuleUnset =
    previewMatched.length > 0 && !isPricingMode(previewMatched[0]?.pricingMode) && !pricingModeOverride;

  const modeLabels: Record<PricingMode, string> = {
    per_tooth: language === "ar" ? "لكل سن" : "Per tooth",
    flat: language === "ar" ? "سعر ثابت" : "Flat fee",
    per_arch: language === "ar" ? "لكل فك" : "Per arch",
  };

  const unitsLabel =
    previewMode === "flat"
      ? language === "ar" ? "سعر ثابت" : "flat fee"
      : previewMode === "per_arch"
        ? `${previewUnits} ${language === "ar" ? (previewUnits === 1 ? "فك" : "فكين") : previewUnits === 1 ? "arch" : "arches"}`
        : `${previewUnits} ${language === "ar" ? "سن" : previewUnits === 1 ? "tooth" : "teeth"}`;

  const billingStrip = (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs font-bold text-slate-600">
          {previewMode === "flat" ? (
            <>
              {language === "ar" ? "هيتحسب" : "Charging"}{" "}
              <span className="text-slate-900 tabular-nums">{previewTotal.toLocaleString()} EGP</span>{" "}
              <span className="text-slate-400">({unitsLabel})</span>
            </>
          ) : (
            <>
              {language === "ar" ? "هيتحسب" : "Charging"}{" "}
              <span className="tabular-nums">{previewUnitCost.toLocaleString()}</span>
              {" × "}
              <span className="tabular-nums">{unitsLabel}</span>
              {" = "}
              <span className="text-slate-900 tabular-nums">{previewTotal.toLocaleString()} EGP</span>
            </>
          )}
        </p>

        <label className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-bold text-slate-500">
            {language === "ar" ? "طريقة الحساب" : "Billing"}
          </span>
          <select
            value={previewMode}
            onChange={(e) => setPricingModeOverride(e.target.value as PricingMode)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
          >
            <option value="per_tooth">{modeLabels.per_tooth}</option>
            <option value="flat">{modeLabels.flat}</option>
            <option value="per_arch">{modeLabels.per_arch}</option>
          </select>
        </label>
      </div>

      {pricingRuleUnset && (
        <p className="text-[11px] font-semibold text-amber-700 mt-2">
          {language === "ar"
            ? "الخدمة دي لسه مالهاش طريقة حساب محددة — بنستخدم «لكل سن». حددها من الإعدادات ← الأسعار."
            : "This service has no billing rule set yet — using per tooth. Set it in Settings → Pricing."}
        </p>
      )}
    </div>
  );

  // --- Individual controls, so the two layouts below share one set of inputs ---
  const inputClass =
    "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500";
  const labelClass = "block text-xs font-bold text-slate-500 mb-1";

  const dateField = (
    <div>
      <label className={labelClass}>{txt.date}</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} required className={inputClass} />
    </div>
  );

  const statusField = (
    <div>
      <label className={labelClass}>{txt.status}</label>
      <select value={procedureStatus} onChange={e => setProcedureStatus(e.target.value as any)} className={inputClass}>
        <option value="Planned">Planned</option>
        <option value="Ongoing">Ongoing</option>
        <option value="Completed">Completed</option>
      </select>
    </div>
  );

  const doctorField = (
    <div>
      <label className={labelClass}>{txt.selectDoctor}</label>
      <select value={selectedDoctorId} onChange={e => setSelectedDoctorId(e.target.value)} required className={inputClass}>
        <option value="">Select doctor...</option>
        {doctors.map(d => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </div>
  );

  const costField = (
    <div>
      <label className={labelClass}>{txt.cost}</label>
      <input
        type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0"
        className={inputClass}
      />
    </div>
  );

  const procedureField = (
    <div>
      <label className={labelClass}>{txt.procedure}</label>
      {initialNote && !isChangingService ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={procedure}
            onChange={(e) => setProcedure(e.target.value)}
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="button"
            onClick={() => setIsChangingService(true)}
            className="p-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors shrink-0"
            title={language === "ar" ? "تغيير من القائمة" : "Change from list"}
          >
            <Edit2 size={18} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ServiceCombobox
              services={servicesList} value={procedure}
              onChange={handleProcedureChange}
              placeholder="Search procedures..."
              valueKey="name"
              allowFreeText
            />
          </div>
          {initialNote && isChangingService && (
            <button
              type="button"
              onClick={() => setIsChangingService(false)}
              className="p-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors shrink-0"
              title={language === "ar" ? "إلغاء" : "Cancel"}
            >
              <X size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );

  const extraProceduresField = (rows: number) => (
    <textarea
      value={multiProceduresText} onChange={(e) => setMultiProceduresText(e.target.value)}
      rows={rows}
      placeholder="Additional procedures (one per line)"
      className={`${inputClass} resize-y`}
    />
  );

  const noteField = (rows: number) => (
    <div>
      <label className={labelClass}>{txt.notes}</label>
      <textarea
        value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Clinical details..."
        rows={rows}
        className={`${inputClass} resize-y`}
      />
    </div>
  );

  const discountField = (
    <DiscountEditor
      listTotal={previewTotal}
      priceLists={priceLists}
      reasons={discountSettings.reasons}
      maxPercent={maxDiscountPercent}
      value={discount}
      onChange={setDiscount}
      disabled={isSaving}
    />
  );

  const ledgerField = !(initialNote?.isContinued) ? (
    <label className={`flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors ${compact ? "px-3 py-2.5" : "p-4"}`}>
      <input
        type="checkbox" checked={addToLedger} onChange={(e) => setAddToLedger(e.target.checked)}
        className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 shrink-0"
      />
      <span className={`font-bold text-slate-700 ${compact ? "text-xs" : "text-sm"}`}>{txt.addToFinance}</span>
    </label>
  ) : null;

  const saveButton = (
    <button
      type="submit"
      form="service-form"
      disabled={isSaving}
      className={`w-full flex justify-center items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-lg shadow-blue-500/30 transition-all disabled:opacity-70 ${compact ? "py-2.5 text-sm" : "py-4"}`}
    >
      {isSaving ? (
        <>
          <Loader2 size={compact ? 16 : 20} className="animate-spin" />
          <span>{saveStatusText}</span>
        </>
      ) : (
        <>
          <Save size={compact ? 16 : 20} />
          <span>{txt.save}</span>
        </>
      )}
    </button>
  );

  /**
   * Desktop chart-first layout: one dense grid across the full width, no inner scroll area.
   * The stacked version below is built for a ~450px drawer, and at full width it turned into a
   * 700px-tall column with its own scrollbar — the form pushed the work it was describing off
   * the bottom of the screen.
   */
  if (compact) {
    return (
      <div className="w-full">
        {/*
          Four equal columns, and every cell is exactly one label above one control of the same
          height. That is what makes the rows line up — mixing a two-row textarea and a stacked
          checkbox-plus-button into the same row as a select is what left everything ragged.
        */}
        <form id="service-form" onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-4 mt-3 items-start">
          <div className="md:col-span-2">{procedureField}</div>
          {doctorField}
          {dateField}

          {statusField}
          {costField}
          <div>
            {/* Empty label so this lines up with the fields beside it. */}
            <span className={labelClass} aria-hidden="true">&nbsp;</span>
            {discountField}
            {discountField}
          {ledgerField}
          </div>
          <div>
            <span className={labelClass} aria-hidden="true">&nbsp;</span>
            {saveButton}
          </div>

          <div className="md:col-span-4">{billingStrip}</div>

          <div className="md:col-span-4">{noteField(3)}</div>

          {/* Rarely used, so it stays out of the way — but never hides text that would be saved. */}
          <div className="md:col-span-4">
            {showExtraProcedures || multiProceduresText.trim().length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>{txt.extraProcedures}</label>
                  {multiProceduresText.trim().length === 0 && (
                    <button
                      type="button"
                      onClick={() => setShowExtraProcedures(false)}
                      className="text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {txt.hide}
                    </button>
                  )}
                </div>
                {extraProceduresField(2)}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowExtraProcedures(true)}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
              >
                + {txt.extraProcedures}
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  const content = (
    <div
      className={`w-full bg-white flex flex-col ${!inline ? (clinicalEditorMode === 'modal' ? 'h-full max-h-[90vh] rounded-[2rem] shadow-2xl overflow-hidden' : 'h-full min-h-0 shadow-[0_4px_20px_-4px_rgba(6,81,237,0.1)] rounded-t-3xl rounded-b-none lg:rounded-3xl border border-slate-100 overflow-hidden') : 'rounded-2xl border border-slate-200 mt-4'}`}
    >
      {!inline && (
        <div className="flex items-center justify-between p-6 md:p-8 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">{txt.title}</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">{patientName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}

      <div className={`flex-1 overflow-y-auto custom-scrollbar ${!inline ? 'p-6' : 'p-4 max-h-[500px]'}`}>
        <form id="service-form" onSubmit={handleSave} className="space-y-6">

          <div className="grid grid-cols-2 gap-4">
            {dateField}
            {statusField}
          </div>

          {doctorField}

          <div className="space-y-2">
            {procedureField}
            {extraProceduresField(3)}
          </div>

          {!hideTeethSelector && (
            <TeethChartSelector selected={selectedTeeth} onToggle={(t) => toggleTooth(t, setSelectedTeeth)} />
          )}

          {costField}

          {billingStrip}

          {noteField(4)}

          {ledgerField}

        </form>
      </div>

      <div className={`p-6 border-t border-slate-100 bg-white shrink-0 ${!inline ? 'pb-24 lg:pb-6' : ''}`}>
        {saveButton}
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  if (!mounted) return null;

  if (clinicalEditorMode === 'modal') {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
        <div className="relative w-full max-w-4xl z-10 animate-in zoom-in-95 duration-200">
          {content}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-2xl z-50 transform transition-transform duration-300 translate-x-0">
        {content}
      </div>
    </div>,
    document.body
  );
}