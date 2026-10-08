"use client";

import { serviceMenuById } from "@/lib/serviceMenu";
import { memo, useCallback, useMemo, useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { X, Save, Check, CheckCircle2, Loader2, Camera, Edit2 } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, query, where, deleteDoc, getDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { useUI } from "@/context/UIContext";
import { isArchPicked, missingInArch, missingTeeth, toggleArch, type ArchPick } from "@/lib/archSelection";
import { isMissingStatus, normalizeToothData } from "@/lib/diagnosisCatalog";
import { cairo } from "@/lib/fonts/arabic";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import { MoneyApiError, createProcedure, updateApprovalProcedure, updateProcedure } from "@/lib/moneyApi";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import TeethChart, { type ToothData } from "@/components/TeethChart";
import { TREATMENT_STATES, pendingTreatments, resolveTreatments, type ToothTreatment } from "@/lib/toothTreatments";
import { isDentistStaff } from "@/lib/staffRoles";
import { generalDoctorLabel } from "@/lib/generalDentist";
import { Note, Service, Staff } from "./types";
import {
  compressImage, computeProcedureLabFee, parseTeethString,
  DEFAULT_PRICING_MODE, isPricingMode, pricingUnitsFor, type PricingMode,
} from "./utils";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import type { LabCaseSeed } from "@/lib/labCases";
import DiscountEditor, { EMPTY_DISCOUNT, discountPayload, type DiscountState } from "@/components/shared/DiscountEditor";
import { isDiscountMode, resolveListPrice, type DiscountMode } from "@/lib/discountMath";
import { listsForBranch } from "@/lib/priceLists";
import { usePricingPolicy } from "@/lib/usePricingPolicy";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  /** The patient's own price list, used when this note has none of its own. */
  patientDefaultPriceListId?: string | null;
  /** The branch this treatment happens at, so only that branch's price lists are offered. */
  branchId?: string | null;
  appointmentId: string | null;
  initialNote: Note | null;
  servicesList: Service[];
  doctors: Staff[];
  /**
   * Called after a successful save. Receives a lab-order seed when the treatment just written
   * uses a service flagged `requiresLab`, so the screen above can offer to raise the order.
   */
  onSaved: (labSeed?: LabCaseSeed) => void;
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
  /**
   * The patient's charted diagnoses, and what has actually been done to each tooth.
   *
   * The chart in this popup was rendered with `data={{}}` — a blank, healthy mouth, every time,
   * for every patient. Which meant the one moment a dentist is deciding WHICH tooth to treat was
   * the one moment the chart told them nothing about it: no caries, no existing crown, no
   * extraction, no root canal done last month. They had to close the popup, read the chart behind
   * it, remember, and reopen.
   */
  teethData?: Record<string, ToothData>;
  treatments?: Record<string, ToothTreatment[]>;
  /**
   * Chair mode: the dentist's editor with no money in it. Hides the cost, the price list, the
   * discount, the billing strip, the "add to bill" tick and the dentist picker; the treatment
   * is still priced from the clinic's default list and billed, on the dentist themselves
   * (`meStaffId`). Reception's editor is byte-for-byte unchanged when this is off.
   */
  dentistMode?: boolean;
  meStaffId?: string;
}


/**
 * The chart panel in the editor popup: the patient's history and the tooth picker, one control.
 *
 * Declared at module scope, and that is load-bearing rather than tidiness. It used to be defined
 * inside the editor's render body, which gives it a new function identity on every render — and a
 * new identity is a new element type, so React unmounted and remounted the entire subtree: 32
 * teeth, 32 `next/image` loads, 32 mark SVGs, on every single keystroke in the cost or note field.
 * The chart's scroll-centering effect re-fired with them, so a dentist who had scrolled across to
 * tooth 38 was yanked back to the midline one character at a time.
 */
export const TeethChartSelector = memo(function TeethChartSelector({
  selected,
  onToggle,
  onSetSelected,
  teethData: teethDataProp,
  treatments,
  isAr,
  narrow,
  patientId,
}: {
  selected: string[];
  onToggle: (toothCode: string) => void;
  onSetSelected: Dispatch<SetStateAction<string[]>>;
  teethData: Record<string, ToothData>;
  treatments: Record<string, ToothTreatment[]>;
  isAr: boolean;
  /** True in the side sheet, where the panel is 672px however wide the monitor is. */
  narrow: boolean;
  /**
   * Whose chart this is. With it, the panel offers "mark the extracted teeth": each tap writes
   * `surg_missing` onto that tooth in the patient's own record, so the ✕ shows here, on the
   * diagnosis chart and in the booking popup alike. Without it the chart is read-only history.
   */
  patientId?: string;
}) {
    const { confirm, showToast } = useUI();
    // Convert string array to number array for TeethChart
    const selectedNumbers = selected.map(s => parseInt(s, 10)).filter(n => !isNaN(n));

    /** Marking mode: taps flag teeth as missing instead of picking them for the treatment. */
    const [markingMissing, setMarkingMissing] = useState(false);
    /**
     * What this panel has written since it opened, over the chart it was given. The booking popup
     * loads the patient once rather than listening, so without this a tooth marked missing there
     * would show the ✕ only after the popup was reopened.
     */
    const [missingOverride, setMissingOverride] = useState<Record<string, boolean>>({});
    const teethData = useMemo(() => {
      const codes = Object.keys(missingOverride);
      if (codes.length === 0) return teethDataProp;
      const next: Record<string, ToothData> = { ...teethDataProp };
      for (const code of codes) {
        const cur = normalizeToothData(next[code]);
        const statuses = (cur.statuses ?? []).filter((s) => s !== "surg_missing");
        next[code] = { ...cur, statuses: missingOverride[code] ? [...statuses, "surg_missing"] : statuses };
      }
      return next;
    }, [teethDataProp, missingOverride]);

    const toggleMissing = async (code: string) => {
      if (!patientId) return;
      const cur = normalizeToothData(teethData[code]);
      const wasMissing = isMissingStatus(cur.statuses ?? []);
      const statuses = (cur.statuses ?? []).filter((s) => s !== "surg_missing" && s !== "dev_hypodontia");
      const next: ToothData = { ...cur, statuses: wasMissing ? statuses : [...statuses, "surg_missing"] };
      setMissingOverride((m) => ({ ...m, [code]: !wasMissing }));
      // A tooth that is not there cannot be picked for this treatment by accident.
      if (!wasMissing) onSetSelected((prev) => prev.filter((t) => t !== code));
      try {
        await updateDoc(getClinicDoc("patients", patientId), { [`teethData.${code}`]: next });
      } catch (e) {
        console.error(e);
        setMissingOverride((m) => ({ ...m, [code]: wasMissing }));
        showToast(isAr ? "ماتحفظش — جرّب تاني" : "Not saved — try again", "error");
      }
    };

    /** Teeth the chart says are gone: a missing diagnosis, or an extraction nothing replaced. */
    const missing = useMemo(() => missingTeeth(teethData, treatments), [teethData, treatments]);

    /**
     * Tick or untick the upper arch, the lower arch, or the whole mouth. When the arch has teeth
     * the chart records as gone, the dentist is asked whether to count them: a per-tooth price
     * multiplies by the teeth picked, and only they know whether this work covers the gaps (a
     * bridge over a gap does, a scaling does not). Closing the question counts them out.
     */
    const pickArch = async (pick: ArchPick) => {
      const gone = missingInArch(pick, missing);
      let includeMissing = false;
      if (gone.length > 0 && !isArchPicked(selected, pick, missing)) {
        includeMissing = await confirm(
          isAr
            ? `الأسنان دي متسجلة مخلوعة أو مش موجودة: ${gone.join("، ")}. تتحسب مع الفك؟`
            : `These teeth are recorded as extracted or missing: ${gone.join(", ")}. Count them in?`,
          {
            title: isAr ? "أسنان مش موجودة" : "Missing teeth",
            confirmLabel: isAr ? `احسبهم (${gone.length})` : `Count them (${gone.length})`,
            cancelLabel: isAr ? "من غيرهم" : "Leave them out",
          }
        );
      }
      onSetSelected((prev) => toggleArch(prev, pick, missing, includeMissing));
    };

    const archBoxes: Array<{ pick: ArchPick; label: string }> = [
      { pick: "upper", label: isAr ? "الفك العلوي" : "Upper arch" },
      { pick: "full", label: isAr ? "الفم كله" : "Full mouth" },
      { pick: "lower", label: isAr ? "الفك السفلي" : "Lower arch" },
    ];

    /**
     * What is ALREADY on the teeth just picked.
     *
     * This is the line the popup exists for. A chart you can look at answers "what has been done
     * to this mouth"; this answers the narrower question actually being asked at the moment of
     * choosing — *am I about to treat a tooth that already carries a crown, or one we root-filled
     * in March?* On a phone there is no hover and therefore no tooltip, so without this the
     * history is visible and unreadable.
     */
    const onSelected = selected
      .map((t) => {
        const entries = treatments[t];
        const { form, mark } = resolveTreatments(entries);
        const pending = pendingTreatments(entries);
        if (!form && !mark && pending.length === 0) return null;
        const parts = [
          ...[form, mark]
            .filter((d): d is NonNullable<typeof d> => Boolean(d))
            .map((d) => (isAr ? TREATMENT_STATES[d.state].labelAr : TREATMENT_STATES[d.state].labelEn)),
          ...(pending.length ? [isAr ? "مخطط له" : "planned"] : []),
        ];
        return `${t}: ${parts.join(" · ")}`;
      })
      .filter(Boolean) as string[];

    return (
      <div className="w-full p-3 bg-surface border border-line rounded-2xl min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] font-black text-ink">
            {isAr ? "اختار الأسنان" : "Pick the teeth"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {patientId && (
              <button
                type="button"
                aria-pressed={markingMissing}
                onClick={() => setMarkingMissing((v) => !v)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold transition-colors ${
                  markingMissing
                    ? "border-rose-600 bg-rose-600 text-white"
                    : "border-line-strong bg-surface text-ink hover:border-rose-400"
                }`}
              >
                <X size={13} strokeWidth={3} className={markingMissing ? "text-white" : "text-rose-600"} />
                {markingMissing
                  ? isAr ? "خلاص، رجّعني للاختيار" : "Done marking"
                  : isAr ? "علّم الأسنان المخلوعة" : "Mark extracted teeth"}
              </button>
            )}
            <span className={`rounded-full px-3 py-1 text-[12px] font-black tabular-nums ${selected.length > 0 ? "bg-accent text-ink-on-accent" : "bg-surface-muted text-ink-muted"}`}>
              <span className="font-figure">{selected.length}</span> {isAr ? "مختارين" : "selected"}
            </span>
          </div>
        </div>
        {markingMissing && (
          <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-bold leading-relaxed text-rose-700">
            {isAr
              ? "اضغط على كل سن مش موجود في فم المريض. بيتحفظ في مخطط المريض فورًا وبيظهر بعلامة ✕ هنا وفي ملف المريض وفي نافذة الحجز. مكان السن المخلوع بيفضل تقدر تختاره لزرعة أو كوبري أو طقم."
              : "Tap every tooth that is not in the patient's mouth. It is saved to the patient's chart at once and shows with an ✕ here, in the patient file and in the booking popup. The gap can still be picked for an implant, a bridge or a denture."}
          </p>
        )}

        {/*
         * No `overflow-y-auto` and no fixed height. The box was `max-h-[300px]` with the scrollbar
         * hidden, so on a short screen the chart was silently clipped and the lower arch simply was
         * not there — with nothing on screen to suggest anything had been cut off.
         */}
        {/* The chart, and beside it the three arch ticks: upper on top, full mouth, lower at the
            bottom — where each sits against the chart it selects. */}
        <div className="flex items-stretch gap-2">
          <div className={`min-w-0 flex-1 rounded-xl border bg-surface-subtle ${markingMissing ? "border-rose-400 border-dashed" : "border-line"}`}>
            <TeethChart
              data={teethData}
              treatments={treatments}
              selectionMode={true}
              compactMode={true}
              dense
              narrow={narrow}
              selectedTeeth={selectedNumbers}
              onToggleTooth={(id) => (markingMissing ? void toggleMissing(id.toString()) : onToggle(id.toString()))}
            />
          </div>
          <div className="flex w-[6.5rem] shrink-0 flex-col justify-between gap-2 rounded-xl border border-line bg-surface p-2">
            {archBoxes.map(({ pick, label }) => {
              const on = isArchPicked(selected, pick, missing);
              return (
                <button
                  key={pick}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => void pickArch(pick)}
                  className={`flex flex-1 items-center gap-2 rounded-lg border px-2 py-2 text-start text-[12px] font-bold transition-colors ${
                    on ? "border-ink-slab bg-accent-tint text-ink" : "border-line bg-surface-subtle text-ink-body hover:border-line-strong"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-ink-slab bg-ink-slab text-[#FACC15]" : "border-line-strong bg-surface"
                    }`}
                    aria-hidden="true"
                  >
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="leading-tight">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {onSelected.length > 0 && (
          <p className="mt-2 text-[12px] font-bold text-ink-body leading-relaxed">
            <span className="text-ink-muted">{isAr ? "متسجّل قبل كده على الأسنان دي:" : "Already on these:"}</span>{" "}
            {onSelected.join("  ·  ")}
          </p>
        )}
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-ink-muted">
          <span><span className="me-1.5 inline-block h-3 w-3 rounded-full bg-accent align-[-2px] ring-2 ring-ink-slab" />{isAr ? "السن المختار" : "picked tooth"}</span>
          <span><span className="me-1.5 inline-block rounded border border-emerald-200 bg-emerald-50 px-1 text-[9px] text-emerald-800">حشو</span>{isAr ? "الكلمة تحت السن = إجراء متسجّل عليه" : "word under a tooth = work recorded on it"}</span>
          <span><span className="me-1.5 inline-block font-black text-rose-600">✕</span>{isAr ? "سن مخلوع — ينفع تختاره لزرعة أو كوبري" : "extracted — can still take an implant or a bridge"}</span>
        </p>
      </div>
    );
  });

export default function ServiceEditorDrawer({
  isOpen, onClose, patientId, patientName, patientDefaultPriceListId, branchId = null, appointmentId, initialNote, servicesList, doctors, onSaved, inline = false,
  hideTeethSelector = false, selectedTeethOverride, onSelectedTeethChange, compact = false,
  teethData = {}, treatments = {}, dentistMode = false, meStaffId = ""
}: Props) {
  const { showToast, clinicalEditorMode } = useUI();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tooth, setTooth] = useState("");
  const [internalSelectedTeeth, setInternalSelectedTeeth] = useState<string[]>([]);

  // One name for the selection whether it lives here or in the parent, so nothing below has to
  // care which layout it is running in.
  const isTeethControlled = Array.isArray(selectedTeethOverride) && !!onSelectedTeethChange;
  const selectedTeeth = isTeethControlled ? (selectedTeethOverride as string[]) : internalSelectedTeeth;
  /**
   * Kept in a ref so the two callbacks below can have a STABLE identity.
   *
   * The chart panel is memoised, and memo compares props: a setter rebuilt on every render is a
   * changed prop, which defeats it entirely and remounts all thirty-two teeth on every keystroke —
   * the exact cost the memo exists to avoid. The values still have to be current, hence the ref.
   */
  const teethTargetRef = useRef({ isTeethControlled, selectedTeethOverride, onSelectedTeethChange });
  teethTargetRef.current = { isTeethControlled, selectedTeethOverride, onSelectedTeethChange };

  const setSelectedTeeth = useCallback<Dispatch<SetStateAction<string[]>>>((action) => {
    const target = teethTargetRef.current;
    if (target.isTeethControlled) {
      const next = typeof action === "function"
        ? (action as (prev: string[]) => string[])(target.selectedTeethOverride as string[])
        : action;
      target.onSelectedTeethChange!(next);
      return;
    }
    setInternalSelectedTeeth(action);
  }, []);

  /**
   * Every change the DENTIST makes on the chart, as opposed to the form being seeded from a note.
   *
   * It clears the legacy free-text `tooth` field, and that is not tidiness — it is the difference
   * between the chart telling the truth and not. `tooth` is seeded from the saved note and posted
   * on every save, and the server falls back to it whenever the selection arrives empty:
   *
   *     toothText = selectedTeeth.length > 0 ? selectedTeeth.join(",") : String(body.tooth || "")
   *
   * So opening a note on "11,12", clearing both teeth on the chart, and saving re-persisted
   * "11,12" — and the chart went on painting two teeth the dentist had just explicitly deselected,
   * with the screen showing none selected. A disagreement in the direction hardest to notice.
   */
  const setSelectedTeethFromChart = useCallback<Dispatch<SetStateAction<string[]>>>((action) => {
    setTooth("");
    setSelectedTeeth(action);
  }, [setSelectedTeeth]);

  const toggleSelectedTooth = useCallback((toothCode: string) => {
    setSelectedTeethFromChart((prev) =>
      prev.includes(toothCode) ? prev.filter((t) => t !== toothCode) : [...prev, toothCode]
    );
  }, [setSelectedTeethFromChart]);
  const [procedure, setProcedure] = useState("");
  const [multiProceduresText, setMultiProceduresText] = useState("");
  const [cost, setCost] = useState("");
  const [noteText, setNoteText] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [procedureStatus, setProcedureStatus] = useState<'Planned' | 'Ongoing' | 'Completed'>('Planned');
  const [addToLedger, setAddToLedger] = useState(true);
  // Price list + discount for this line. The server recomputes and enforces both; this is the
  // preview and the input.
  const { priceLists, payers, discountSettings, maxDiscountPercent } = usePricingPolicy();
  /** The clinic's main list: what a dentist's treatment is charged from, this branch's first. */
  const defaultListId =
    listsForBranch(priceLists, branchId).find((l) => l.active && l.isDefault)?.id ?? priceLists.find((l) => l.isDefault)?.id ?? "";

  const [discount, setDiscount] = useState<DiscountState>(EMPTY_DISCOUNT);

  /**
   * Only what the selected list actually covers.
   *
   * A treatment the insurer does not pay for is not offered at all, so the menu means what it
   * says. Leaving it visible and quietly recording it as private would be a screen that lets
   * somebody pick a wrong answer and then overrules them without saying so.
   */
  // Every service, whoever pays: coverage lists are gone, the price box is the price.
  // Every service whoever pays (coverage lists are gone); only the price list's own menu applies:
  // another list's own treatments are left out, and the shared ones this list hides.
  const offeredServices = useMemo(() => {
    const offered = serviceMenuById(priceLists, payers, discount.priceListId || null, servicesList);
    return servicesList.filter((s) => offered(String(s.id)));
  }, [servicesList, priceLists, payers, discount.priceListId]);

  /**
   * Re-price a catalogue pick when the prefill list is changed; a free-typed name keeps its price.
   *
   * Only a change made FROM a list that was on screen counts. The first list a form receives —
   * the reopened note's own list, or the editor resolving a blank or retired one — is not a
   * decision, and re-pricing on it would move a saved treatment to today's rate just by opening
   * it. Declared ahead of the seeding effect so the seed can mark its list as already priced.
   */
  const pricedListRef = useRef(discount.priceListId);
  useEffect(() => {
    const prev = pricedListRef.current;
    const next = discount.priceListId;
    pricedListRef.current = next;
    if (!next || prev === next) return;
    if (!listsForBranch(priceLists, branchId).some((l) => l.active && l.id === prev)) return;
    const svc = servicesList.find((s) => s.name === procedure.trim());
    if (svc) setCost(String(resolveListPrice(svc, next)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discount.priceListId]);

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
      
      // Same reasoning as the price list below: reopening a treatment must not move it onto a
      // different payer, which would move the revenue AND the dentist's rate.
      // Reopen the note on the list and discount it was priced with, so re-saving never silently
      // re-prices it at today's rates.
      pricedListRef.current = (initialNote as { priceListId?: string }).priceListId || "";
      setDiscount({
        payerId: (initialNote as { payerId?: string }).payerId || "",
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
      pricedListRef.current = EMPTY_DISCOUNT.priceListId;
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
    selectError: language === 'ar' ? "اختر الإجراء" : "Name the procedure",
    extraProcedures: language === 'ar' ? "إجراءات إضافية" : "More procedures",
    hide: language === 'ar' ? "إخفاء" : "Hide",
    needsPrice: language === 'ar' ? "اكتب سعر للعلاج اللي مش في قائمتك" : "Type a price for a treatment that is not in your list",
  };

  /**
   * A treatment an insurance approval wrote. Its service, teeth, date and money come from the
   * approval paper and change only on the patient's Insurance tab; here the desk sets the state,
   * the dentist and the note. The form used to send its whole self back, and anything it
   * re-derived on opening (the price list, say) read as an edit, so the server refused the save.
   */
  const approval = useMemo(() => {
    const n = initialNote as (Note & { claimId?: unknown; approvalNumber?: unknown; payerName?: unknown; insurerCovered?: unknown; patientShare?: unknown }) | null;
    if (!n || typeof n.claimId !== "string" || !n.claimId) return null;
    return {
      number: String(n.approvalNumber || ""),
      payer: String(n.payerName || ""),
      insurer: Number(n.insurerCovered) || 0,
      share: Number(n.patientShare) || 0,
      cost: Number(n.cost) || 0,
    };
  }, [initialNote]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return; // Fix Scenario 1: Double-click protection
    if (approval && initialNote) {
      setIsSaving(true);
      try {
        await updateApprovalProcedure(initialNote.id, {
          patientId,
          appointmentId: initialNote.appointmentId ?? null,
          status: procedureStatus,
          doctorId: selectedDoctorId || null,
          note: noteText,
        });
        showToast(language === "ar" ? "اتحفظ" : "Procedure Updated", "success");
        onSaved();
        onClose();
      } catch (err) {
        showToast(err instanceof MoneyApiError ? err.message : "Error saving procedure", "error");
        console.error(err);
      } finally {
        setIsSaving(false);
      }
      return;
    }
    // The dentist is no longer required: an empty picker means General, a treatment the clinic
    // did rather than a person.
    if (!procedure && !multiProceduresText) return showToast(txt.selectError, "error");
    if (Number(cost) < 0) return showToast(language === 'ar' ? "لا يمكن إضافة تكلفة بالسالب" : "Cannot add negative cost", "error"); // Fix Scenario 2: Negative typo protection
    if (needsTypedPrice) return showToast(txt.needsPrice, "error");

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
      // Dentist mode: no typed cost, no discount, no payer choice — the clinic's default list,
      // billed, on the dentist themselves. The server prices it; the dentist never sees it.
      const billing = discountPayload(dentistMode ? EMPTY_DISCOUNT : discount);
      const payload = {
        patientId,
        appointmentId: initialNote ? initialNote.appointmentId ?? null : appointmentId || null,
        procedures,
        selectedTeeth,
        tooth,
        unitCost: dentistMode ? null : cost === "" ? null : Number(cost),
        pricingMode: dentistMode ? null : pricingModeOverride,
        doctorId: dentistMode ? meStaffId || null : selectedDoctorId,
        status: procedureStatus,
        note: noteText,
        date,
        addToLedger: dentistMode ? true : addToLedger,
        ...billing,
        priceListId: dentistMode ? defaultListId || null : billing.priceListId,
        patientDefaultPriceListId: patientDefaultPriceListId || null,
      };

      let labSeed: LabCaseSeed | undefined;

      if (initialNote) {
        await updateProcedure(initialNote.id, payload);
      } else {
        const result = await createProcedure(payload);

        /**
         * Offer to raise a lab order for work that needs one.
         *
         * Only on a NEW treatment: re-saving an existing crown must not offer a second order for
         * a case that is already at a lab. Detection is client-side because the server computes
         * `requiresLab` and then discards it — the HTTP response carries the note and ledger ids
         * and nothing about the lab.
         *
         * The seed is handed UP rather than shown here. This component is unmounted the instant a
         * save succeeds — the drawer closes on mobile, and the inline editor is remounted by a
         * changed `key` on desktop — so a prompt owned by this component would be destroyed
         * before anyone saw it.
         */
        const { reqLab, labFee } = computeProcedureLabFee({
          matchedServices: previewMatched,
          pricingUnits: previewUnits,
        });
        if (reqLab) {
          labSeed = {
            patientId,
            patientName,
            doctorId: selectedDoctorId,
            doctorName: doctors.find((d) => d.id === selectedDoctorId)?.name || "",
            clinicalNoteId: result.noteId,
            ledgerId: result.ledgerId || undefined,
            teeth: selectedTeeth.map((t) => parseInt(t, 10)).filter((n) => !Number.isNaN(n)),
            workDescription: procedures.join(", "),
            units: previewUnits,
            branchId: branchId || undefined,
            agreedPrice: Math.round(labFee) || undefined,
          };
        }
      }

      showToast(initialNote ? "Procedure Updated" : "Procedure Logged", "success");
      onSaved(labSeed);
      onClose();
    } catch (err) {
        showToast(err instanceof MoneyApiError ? err.message : "Error saving procedure", "error");
        console.error(err);
    } finally {
        setIsSaving(false);
        setSaveStatusText("");
    }
  };

  /**
   * A pick from the list prefills its price on the list being charged from; anything else is just
   * the name. The combobox reports free text on every keystroke, so a typed name must not be
   * matched against ids (typing "1" would become service 1) or prefill a price half-way through
   * a longer name that happens to start like a catalogue one.
   */
  const handleProcedureChange = (val: string, svc?: { name: string; price?: number; prices?: Record<string, number> }) => {
    if (svc) {
      setProcedure(svc.name);
      setCost(String(resolveListPrice(svc, discount.priceListId || null)));
      return;
    }
    setProcedure(val);
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
  // The same figure the server charges: a blank box is the catalogue on the chosen list, anything
  // typed — 0 included — is the price.
  const previewUnitCost =
    cost === ""
      ? previewMatched.reduce((sum, s) => sum + resolveListPrice(s, discount.priceListId || null), 0)
      : Math.max(0, Number(cost) || 0);
  /**
   * A name that is not in the catalogue has no price to fall back on, so a blank box would record
   * the treatment with no charge and still report it added. Only matters when it is being billed.
   */
  const needsTypedPrice =
    !dentistMode && addToLedger && cost === "" && previewMatched.length < previewProcedures.length;
  /** A name not in the list: the dentist may still write it; reception prices it later. */
  const unpricedName = dentistMode && previewMatched.length < previewProcedures.length;
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
    <div className="rounded-xl border border-line bg-surface-subtle px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs font-bold text-ink-body">
          {previewMode === "flat" ? (
            <>
              {language === "ar" ? "هيتحسب" : "Charging"}{" "}
              <span className="text-ink tabular-nums">{previewTotal.toLocaleString()} EGP</span>{" "}
              <span className="text-slate-400">({unitsLabel})</span>
            </>
          ) : (
            <>
              {language === "ar" ? "هيتحسب" : "Charging"}{" "}
              <span className="tabular-nums">{previewUnitCost.toLocaleString()}</span>
              {" × "}
              <span className="tabular-nums">{unitsLabel}</span>
              {" = "}
              <span className="text-ink tabular-nums">{previewTotal.toLocaleString()} EGP</span>
            </>
          )}
        </p>

        <label className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-bold text-ink-muted">
            {language === "ar" ? "طريقة الحساب" : "Billing"}
          </span>
          <select
            value={previewMode}
            onChange={(e) => setPricingModeOverride(e.target.value as PricingMode)}
            className="bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-xs font-bold text-ink outline-none focus:border-ink"
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
    "w-full bg-surface border border-line-strong rounded-xl px-4 py-2.5 text-[15px] font-bold text-ink outline-none focus:border-ink";
  const labelClass = "block text-[13px] font-bold text-ink-muted mb-1";

  const dateField = (
    <div>
      <label className={labelClass}>{txt.date}</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} required className={inputClass} />
    </div>
  );

  /** Three buttons, in the dentist's own words, instead of an English dropdown. */
  const statusOptions: Array<{ value: "Planned" | "Ongoing" | "Completed"; label: string }> = [
    { value: "Planned", label: isAr ? "مخطط" : "Planned" },
    { value: "Ongoing", label: isAr ? "جاري" : "Ongoing" },
    { value: "Completed", label: isAr ? "اتعمل" : "Done" },
  ];
  const statusField = (
    <div>
      <span className={labelClass}>{txt.status}</span>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={txt.status}>
        {statusOptions.map((o) => {
          const on = procedureStatus === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setProcedureStatus(o.value)}
              className={`flex h-[46px] items-center justify-center gap-1.5 rounded-xl border px-2 text-[15px] font-bold transition-colors ${
                on ? "border-ink-slab bg-ink-slab text-white" : "border-line-strong bg-surface text-ink hover:border-ink"
              }`}
            >
              {on && o.value === "Completed" && <Check size={16} strokeWidth={3} className="text-[#FACC15]" />}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const doctorField = (
    <div>
      <label className={labelClass}>{txt.selectDoctor}</label>
      <select value={selectedDoctorId} onChange={e => setSelectedDoctorId(e.target.value)} className={inputClass}>
        {/* No dentist is a real answer here, not an empty field: the clinic did the work. It is
            charged the same way and earns nobody a commission. */}
        <option value="">{generalDoctorLabel(language)}</option>
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
      {needsTypedPrice && (
        <p className="mt-1 text-[11px] font-semibold text-amber-700">{txt.needsPrice}</p>
      )}
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
            className="p-2.5 bg-surface-muted text-ink-body hover:bg-slate-200 rounded-xl border border-line transition-colors shrink-0"
            title={language === "ar" ? "تغيير من القائمة" : "Change from list"}
          >
            <Edit2 size={18} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div data-tour="clinical-procedure-name" className="flex-1 min-w-0">
            <ServiceCombobox
              priceListId={discount.priceListId || null}
              services={offeredServices} value={procedure}
              onChange={handleProcedureChange}
              placeholder={isAr ? "اكتب اسم العلاج…" : "Search procedures..."}
              valueKey="name"
              allowFreeText
            />
          </div>
          {initialNote && isChangingService && (
            <button
              type="button"
              onClick={() => setIsChangingService(false)}
              className="p-2.5 bg-surface-muted text-ink-body hover:bg-slate-200 rounded-xl border border-line transition-colors shrink-0"
              title={language === "ar" ? "إلغاء" : "Cancel"}
            >
              <X size={18} />
            </button>
          )}
        </div>
      )}
      {unpricedName && (
        <p className="mt-1 text-[12px] font-bold text-amber-700">
          {language === "ar" ? "مش في القائمة — الاستقبال هيحط السعر" : "Not in the list — reception sets the price"}
        </p>
      )}
    </div>
  );

  const extraProceduresField = (rows: number) => (
    <textarea
      value={multiProceduresText} onChange={(e) => setMultiProceduresText(e.target.value)}
      rows={rows}
      placeholder={isAr ? "علاجات تانية في نفس الزيارة (كل واحد في سطر)" : "Additional procedures (one per line)"}
      className={`${inputClass} resize-y`}
    />
  );

  const noteField = (rows: number) => (
    <div>
      <label className={labelClass}>{txt.notes}</label>
      <textarea
        value={noteText} onChange={e => setNoteText(e.target.value)} placeholder={isAr ? "أي حاجة الدكتور الجاي محتاج يعرفها" : "Clinical details..."}
        rows={rows}
        className={`${inputClass} resize-y`}
      />
    </div>
  );


  /**
   * What an insurance approval fixed on this treatment, shown instead of the controls that would
   * change it. Teeth, service and money are the approval's; the desk changes them on the patient's
   * Insurance tab, where the approval itself lives.
   */
  const approvalSummary = approval ? (
    <div className="rounded-2xl border border-accent-soft bg-accent-tint px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-[14px] font-black text-ink">
          {approval.payer && <InsurerBadge name={approval.payer} size={24} />}
          {approval.payer ? `${approval.payer} · ` : ""}
          {language === "ar" ? "موافقة تأمين" : "Insurance approval"}
        </p>
        {approval.number && <bdi dir="ltr" className="font-figure text-[14px] font-bold text-ink-body">{approval.number}</bdi>}
      </div>
      <p className="mt-2 text-2xl font-black leading-tight text-ink">{procedure}</p>
      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px] font-bold text-ink-body">
        {selectedTeeth.length > 0 && (
          <span>
            {language === "ar" ? "الأسنان" : "Teeth"} <bdi dir="ltr" className="font-figure font-black text-ink">{selectedTeeth.join(", ")}</bdi>
          </span>
        )}
        <span>
          {language === "ar" ? "الإجمالي" : "Total"} <span className="font-figure font-black text-ink">{approval.cost.toLocaleString()}</span> {language === "ar" ? "ج.م" : "EGP"}
        </span>
        {approval.share > 0 && (
          <>
            <span>
              {language === "ar" ? "الشركة تدفع" : "Insurer pays"} <span className="font-figure font-black text-ink">{approval.insurer.toLocaleString()}</span>
            </span>
            <span>
              {language === "ar" ? "المريض يدفع" : "Patient pays"} <span className="font-figure font-black text-ink">{approval.share.toLocaleString()}</span>
            </span>
          </>
        )}
      </p>
      <p className="mt-2 text-[13px] font-bold leading-relaxed text-accent-ink">
        {language === "ar"
          ? "العلاج والأسنان والسعر جايين من ورقة الموافقة. عايز تغيّرهم؟ من تبويب التأمين في ملف المريض. هنا تغيّر الحالة والدكتور والملاحظات."
          : "The treatment, teeth and price come from the approval paper. To change them, go to the patient's Insurance tab. Here you change the state, the dentist and the notes."}
      </p>
    </div>
  ) : null;

  const discountField = (
    <DiscountEditor
      listTotal={previewTotal}
      priceLists={priceLists}
      branchId={branchId}
      payers={payers}
      reasons={discountSettings.reasons}
      maxPercent={maxDiscountPercent}
      value={discount}
      onChange={setDiscount}
      disabled={isSaving}
    />
  );

  const ledgerField = !(initialNote?.isContinued) ? (
    <label className={`flex items-center gap-3 bg-surface-subtle border border-line rounded-xl cursor-pointer hover:bg-surface-muted transition-colors ${compact ? "px-3 py-2.5" : "p-4"}`}>
      <input
        type="checkbox" checked={addToLedger} onChange={(e) => setAddToLedger(e.target.checked)}
        className="w-5 h-5 rounded accent-ink-slab border-line-strong shrink-0"
      />
      <span className={`font-bold text-ink ${compact ? "text-xs" : "text-[15px]"}`}>{txt.addToFinance}</span>
    </label>
  ) : null;

  const saveButton = (
    <button
      type="submit" data-tour="clinical-save"
      form="service-form"
      disabled={isSaving || needsTypedPrice}
      className={`w-full flex justify-center items-center gap-2 bg-accent hover:bg-accent-strong text-ink-on-accent font-black rounded-2xl shadow-sm transition-all disabled:opacity-70 ${compact ? "py-2.5 text-sm" : "py-4 text-lg"}`}
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
          {approval ? (
            <>
              <div className="md:col-span-4">{approvalSummary}</div>
              {statusField}
              {doctorField}
              <div className="md:col-span-2">
                <span className={labelClass} aria-hidden="true">&nbsp;</span>
                {saveButton}
              </div>
              <div className="md:col-span-4">{noteField(3)}</div>
            </>
          ) : (
          <>
          <div className="md:col-span-2">{procedureField}</div>
          {!dentistMode && doctorField}
          {dateField}

          {statusField}
          {!dentistMode && costField}
          {!dentistMode && (
            <div>
              {/* Empty label so this lines up with the fields beside it. */}
              <span className={labelClass} aria-hidden="true">&nbsp;</span>
              {discountField}
              {ledgerField}
            </div>
          )}
          <div>
            <span className={labelClass} aria-hidden="true">&nbsp;</span>
            {saveButton}
          </div>

          {!dentistMode && <div className="md:col-span-4">{billingStrip}</div>}

          <div className="md:col-span-4">{noteField(3)}</div>

          {/* Rarely used, so it stays out of the way — but never hides text that would be saved. */}
          {!dentistMode && (
          <div className="md:col-span-4">
            {showExtraProcedures || multiProceduresText.trim().length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>{txt.extraProcedures}</label>
                  {multiProceduresText.trim().length === 0 && (
                    <button
                      type="button"
                      onClick={() => setShowExtraProcedures(false)}
                      className="text-[11px] font-bold text-slate-400 hover:text-ink-body transition-colors"
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
                className="text-[12px] font-bold text-ink underline-offset-4 hover:underline"
              >
                + {txt.extraProcedures}
              </button>
            )}
          </div>
          )}
          </>
          )}
        </form>
      </div>
    );
  }

  const content = (
    <div
      /* Portalled to <body>, outside the dashboard wrapper that sets the direction and the Arabic
         face — so the window sets both itself, or Arabic reads left-to-right in the system font. */
      dir={isAr ? "rtl" : "ltr"}
      className={`${cairo.variable} ${isAr ? "arabic-ui" : ""} w-full bg-surface flex flex-col ${!inline ? (clinicalEditorMode === 'modal' ? 'h-full max-h-[90vh] rounded-[2rem] shadow-2xl overflow-hidden' : 'h-full min-h-0 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.2)] rounded-t-3xl rounded-b-none lg:rounded-3xl border border-line overflow-hidden') : 'rounded-2xl border border-line mt-4'}`}
    >
      {!inline && (
        /*
          * A title bar, not a title page.
          *
          * It was 112px of chrome — `p-8`, a 48px icon tile and a 20px heading — above a window
          * whose whole job is a teeth chart and a form. On a laptop that is the difference between
          * the Save button being on screen and being one more scroll away, and the chart is the
          * thing people came here to look at. Same words, a third of the height.
          */
        <div className="flex items-center justify-between gap-3 px-5 py-3 md:px-6 bg-ink-slab text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent text-ink-on-accent flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-[#FACC15] tracking-tight leading-tight truncate">{txt.title}</h2>
              <p className="text-[13px] font-bold text-white/85 truncate">{patientName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={txt.cancel}
            className="w-9 h-9 rounded-xl border border-white/20 bg-white/5 hover:bg-white/15 text-white flex items-center justify-center transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/*
        * Chart pinned, form scrolling.
        *
        * The chart used to sit in the middle of the scrolling form, between the procedure box and
        * the cost. So you scrolled down to fill in the price and the teeth you had just chosen
        * left the screen — at the exact moment you would want to check them — and on a phone the
        * Save button was two more scrolls below that. Lifting it out of the scroll area costs
        * nothing and means the chart and the button are on screen together.
        *
        * Always stacked: chart on top, form scrolling underneath it.
        *
        * It used to go side by side at `lg` — but `lg` measures the SCREEN, and this panel is
        * 672px as a side sheet or 896px as a modal. So on any ordinary monitor it split into a
        * fixed 420px chart column, too narrow for sixteen teeth, beside a ~200px form column that
        * truncated every label and control in it. Neither panel is ever wide enough for two real
        * columns, so there was nothing to win by pretending otherwise.
        */}
      {/*
        * On a phone the chart filled the screen and the form scrolled in the sliver under it
        * (owner's screenshot, 2026-10-08). Below `md` the whole body scrolls as one piece and
        * only the Save bar stays put; from `md` up the chart is pinned and the form scrolls.
        */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar md:overflow-visible md:flex md:flex-col">
        {!hideTeethSelector && (
          <div
            className={`md:shrink-0 ${!inline ? "px-6 pt-4" : "px-4 pt-4"} ${approval ? "pointer-events-none" : ""}`}
            aria-disabled={approval ? true : undefined}
          >
            <TeethChartSelector
              selected={selectedTeeth}
              onToggle={toggleSelectedTooth}
              onSetSelected={setSelectedTeethFromChart}
              teethData={teethData}
              treatments={treatments}
              isAr={isAr}
              narrow={clinicalEditorMode !== 'modal'}
              patientId={patientId}
            />
          </div>
        )}

        <div className={`md:flex-1 md:min-h-0 md:overflow-y-auto custom-scrollbar ${!inline ? 'p-6' : 'p-4 md:max-h-[500px]'}`}>
        <form id="service-form" onSubmit={handleSave} className="space-y-6">
          {approval ? (
            <>
              {approvalSummary}
              <div className="grid grid-cols-2 gap-4">
                {statusField}
                {doctorField}
              </div>
              {noteField(4)}
            </>
          ) : (
          <>

          <div className="grid grid-cols-2 gap-4">
            {dateField}
            {statusField}
          </div>

          {!dentistMode && doctorField}

          <div className="space-y-2">
            {procedureField}
            {!dentistMode && extraProceduresField(3)}
          </div>

          {!dentistMode && costField}

          {/*
            The price list, in the drawer as well as in the compact editor.

            It was only ever rendered in the inline form, which the tooth chart uses — so the
            drawer that opens from the patient's file and from the appointment panel, which is
            where the front desk actually records treatments, had no way to choose a list at all.
            Every treatment recorded there silently took the clinic's default.

            That was survivable while a list was only a discount sheet. It stopped being
            survivable when the list became the insurer: an insurance case recorded from the desk
            was charged at clinic prices and counted as private revenue, and the screen gave
            nobody a way to say otherwise.
          */}
          {!dentistMode && discountField}

          {!dentistMode && billingStrip}

          {noteField(4)}

          {!dentistMode && ledgerField}
          </>
          )}

        </form>
        </div>
      </div>

      <div className={`px-6 py-4 border-t border-line bg-surface shrink-0 ${!inline ? 'pb-24 lg:pb-4' : ''}`}>
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
        {/*
          Wide enough for the chart to be the size it wants to be. The teeth need ~820px including
          the card around them; at the old `max-w-4xl` (896px) they just cleared it with the form
          fields squeezed underneath, and there is no reason to be that tight on a desktop.
        */}
        <div className="relative w-full max-w-5xl z-10 animate-in zoom-in-95 duration-200">
          {content}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-3xl z-50 transform transition-transform duration-300 translate-x-0">
        {content}
      </div>
    </div>,
    document.body
  );
}