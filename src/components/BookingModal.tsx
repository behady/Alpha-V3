"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ServiceCombobox from "./shared/ServiceCombobox";
import { usePricingPolicy } from "@/lib/usePricingPolicy";
import { listsForBranch, resolveActiveListId } from "@/lib/priceLists";
import { resolveListPrice } from "@/lib/discountMath";
import { autosaveVerdict } from "@/lib/appointmentAutosave";
import {
  X,
  Calendar,
  Clock,
  Loader2,
  User,
  Check,
  CheckCircle2,
  Hourglass,
  Stethoscope,
  Sparkles,
  ClipboardList,
  DollarSign,
  Phone,
  MapPin,
  ChevronDown,
  Trash2,
  CloudOff,
  Pencil,
} from "lucide-react";
import {
  DEFAULT_COUNTRY_CODE,
  COUNTRY_CODE_OPTIONS,
  buildE164FromCountryCode,
} from "@/lib/phoneNumber";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, serverTimestamp, deleteDoc, onSnapshot } from "firebase/firestore";
import { appointmentLinkFields, openLines, parseClaimLinks, type ClaimLink } from "@/lib/insurance/appointments";
import { CLAIMS_COLLECTION, parseClaim, type InsuranceClaim } from "@/lib/insurance/claims";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import Protect from "@/components/Protect";
import { isDentistStaff } from "@/lib/staffRoles";
import { clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { LOCATIONS_DOC, parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import {
  findDoctorConflicts,
  findRoomConflicts,
  type ConflictCandidate,
} from "@/lib/appointmentConflicts";
import {
  doctorFieldFromPicker,
  isGeneralDoctorValue,
  pickerValueFromDoctorField,
} from "@/lib/generalDentist";
import PatientPicker from "./appointments/booking/PatientPicker";

import SlotPicker from "./appointments/booking/SlotPicker";
import PatientTimeline, { formatDayLabel, formatTimeLabel, type TimelineAppointment } from "./appointments/booking/PatientTimeline";
import AvailabilityPicker from "./appointments/booking/AvailabilityPicker";
import InsuranceApprovals from "./appointments/booking/InsuranceApprovals";
import ApprovalUploadPanel from "./appointments/booking/ApprovalUploadPanel";
import InsuranceShareDue from "./appointments/booking/InsuranceShareDue";
import AppointmentMoneyTab from "./appointments/AppointmentMoneyTab";
import AppointmentStagePicker from "./appointments/AppointmentStagePicker";
import { getAppointmentStageLabel } from "@/lib/appointmentStages";
import { minutesToTimeKey, parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { generalDoctorLabel } from "@/lib/generalDentist";
import { PRIVATE_PAYER_ID, payerForPriceList } from "@/lib/payers";
import InsurerBadge from "@/components/shared/InsurerBadge";

interface AppointmentData {
  patientId: string;
  patientName: string;
  isNewPatient?: boolean;
  newPatientPhone?: string;
  newPatientDob?: string;
  newPatientAddress?: string;
  newPatientSource?: string;
  newPatientGender?: string;
  treatment: string;
  doctor: string;
  /** Staff id of the dentist; `doctor` is a display name and not a stable grouping key. */
  doctorId?: string | null;
  date: string;
  time: string;
  duration: number;
  branchId?: string | null;
  branchName?: string | null;
  roomId?: string | null;
  roomName?: string | null;
  type: string;
  notes: string;
  /** Final amount after discount (ledger / balance) */
  cost: number;
  clinicalNoteId?: string | null;
  /** The insurance approval service this visit is for; null = a plain visit. */
  claimId?: string | null;
  claimLine?: number | null;
  /** Every approved service this visit is for; the pair above mirrors its first entry. */
  claimLinks?: ClaimLink[];
  newProcedureName?: string | null;
  /** false = follow-up on existing case, no extra charge unless staff adds an extra procedure */
  chargeForVisit?: boolean;
  /** Catalog list price before discount */
  listPrice?: number;
  discountMode?: "none" | "percent" | "fixed";
  discountPercent?: number | null;
  discountFixed?: number | null;
  /** Applied discount in EGP */
  discountAmount?: number;
  /** When set, parent updates this appointment instead of creating a new one */
  existingAppointmentId?: string | null;
  status?: string;
  discountDistribution?: "total" | "each";
  /**
   * `priceListId` is part of this contract, not an internal detail.
   *
   * The modal stages each treatment against the list chosen above it, and the list is what says
   * who is paying. Dropping it here handed the caller a cost with no idea where it came from: the
   * server then fell back to the clinic default, so a visit booked on an insurer was charged at
   * the insurer's price and filed as private revenue — the cost survived the trip and the payer
   * did not.
   */
  sessionProcedures?: { id?: string; serviceId?: string | null; name: string; cost: number; addToLedger: boolean; priceListId?: string | null }[];
}

export type BookingEditSnapshot = {
  id: string;
  patientId: string;
  patientName: string;
  treatment?: string;
  doctor?: string;
  doctorId?: string | null;
  date?: string;
  time?: string;
  duration?: number;
  branchId?: string | null;
  roomId?: string | null;
  clinicalNoteId?: string | null;
  claimId?: string | null;
  claimLine?: number | null;
  claimLinks?: unknown;
  cost?: number;
  listPrice?: number | null;
  discountMode?: string | null;
  discountPercent?: number | null;
  discountFixed?: number | null;
  discountAmount?: number | null;
  notes?: string;
  status?: string;
};

export interface SelectedService {
  id: string;
  serviceId: string | null;
  serviceName: string;
  cost: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: AppointmentData) => void | Promise<void>;
  /**
   * Save without closing or toasting — the panel is still open and being edited.
   *
   * Supplying it turns on autosave, and ONLY for an appointment that already exists. A booking
   * being created stays behind its button on purpose: that press is the moment the clinic commits,
   * and committing writes any staged procedures to the ledger, alerts the owner, and sends the
   * patient "you're booked". None of that should happen because somebody filled in a time and
   * then walked away mid-thought.
   */
  onAutosave?: (data: AppointmentData) => Promise<void>;
  patients: { id: string | number; name: string; phone?: string }[];
  doctors: { id: string; name: string }[];
  preSelectedDate?: string;
  preSelectedTime?: string;
  preSelectedDoctor?: string;
  settingsConfig?: Partial<ClinicScheduleConfig>;
  /** Full appointment document for edit mode — same modal as booking */
  editAppointment?: BookingEditSnapshot | null;
  preSelectedPatient?: { id: string; name: string } | null;
  onDelete?: (appointmentId: string) => void | Promise<void>;
  inlineDesktop?: boolean;
  servicesList?: any[];
  /**
   * The branch the caller is working at. Used only as the starting value for a NEW appointment —
   * editing an existing one keeps whatever branch it was booked at, because moving a booking
   * between branches has to be a deliberate act, not a side effect of who opened the screen.
   */
  preSelectedBranchId?: string;
  /**
   * An insurance approval's service to book this visit for (the Book button on the patient's
   * Insurance tab). Fills the dentist and the reason from the approval; the desk can still change
   * either. Ignored in edit mode, where the link comes from the appointment itself.
   */
  preSelectedClaimLine?: ClaimLink | null;
  /**
   * The wide booking popup (desktop only): patient timeline on the left, Appointment / Service /
   * Payment / Insurance tabs on the right, every time of the day shown with taken ones in red.
   * Same form, same save — only the layout differs. Ignored inline and on small screens.
   */
  wide?: boolean;
}

/**
 * Exactly the fields this form puts on screen, compared against the appointment on file.
 *
 * Anything else — a discount, a cost, a clinical note id — is carried through untouched, and
 * comparing it would report a change on every render and autosave in a loop.
 */
const AUTOSAVE_FIELDS = ["date", "time", "doctor", "treatment", "duration", "notes", "status", "roomId"] as const;

function dateIsClinicClosed(dateStr: string, offDays: string[]): boolean {
  if (!dateStr || !offDays.length) return false;
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  const dayName = dt.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  return offDays.includes(dayName);
}

export default function BookingModal({
  isOpen,
  onClose,
  onSave,
  onAutosave,
  patients,
  doctors,
  onDelete,
  preSelectedDate,
  preSelectedTime: preSelectedTimeProp,
  preSelectedDoctor,
  settingsConfig,
  editAppointment: editAppointmentProp = null,
  preSelectedPatient: preSelectedPatientProp = null,
  inlineDesktop = false,
  servicesList = [],
  preSelectedBranchId = "",
  preSelectedClaimLine = null,
  wide = false,
}: Props) {
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();

  /**
   * The wide popup moves between the patient's visits without closing: a card on its timeline
   * opens that visit, "New visit" books another for the same patient. Everything below reads these
   * three names, so a switch reloads the form exactly as closing and reopening would.
   */
  type VisitSwitch = { kind: "edit"; appt: BookingEditSnapshot } | { kind: "new"; patient: { id: string; name: string } };
  const [switchedTo, setSwitchedTo] = useState<VisitSwitch | null>(null);
  useEffect(() => setSwitchedTo(null), [isOpen, editAppointmentProp, preSelectedPatientProp]);
  const editAppointment = switchedTo ? (switchedTo.kind === "edit" ? switchedTo.appt : null) : editAppointmentProp;
  const preSelectedPatient = switchedTo?.kind === "new" ? switchedTo.patient : preSelectedPatientProp;
  const preSelectedTime = switchedTo?.kind === "new" ? "" : preSelectedTimeProp;

  const sched: ClinicScheduleConfig = {
    startHour: settingsConfig?.startHour ?? 9,
    startMinute: settingsConfig?.startMinute ?? 0,
    endHour: settingsConfig?.endHour ?? 21,
    endMinute: settingsConfig?.endMinute ?? 0,
    slotDuration: settingsConfig?.slotDuration ?? 30,
    offDays: settingsConfig?.offDays ?? [],
    isConfigured: settingsConfig?.isConfigured ?? false,
  };

  const getLocalDate = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(preSelectedPatient);
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const [doctor, setDoctor] = useState(preSelectedDoctor || (doctors.length > 0 ? doctors[0].name : ""));
  /**
   * What the picker's choice becomes once stored. "General" is a UI sentinel only — see
   * lib/generalDentist — and lands as no dentist name and no staff id, so nothing downstream reads
   * it as a person: not the conflict check, not a commission, not the payout report.
   *
   * `doctorId` is forced to null rather than falling back to the appointment's old id, otherwise
   * moving a visit off a dentist would leave that dentist still being paid for it.
   */
  const doctorField = doctorFieldFromPicker(doctor);
  const resolvedDoctorId = isGeneralDoctorValue(doctor)
    ? null
    : doctors.find((d) => d.name === doctorField)?.id || editAppointment?.doctorId || null;
  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(preSelectedDate || getLocalDate());
  const [time, setTime] = useState(preSelectedTime || "");
  const [duration, setDuration] = useState(sched.slotDuration);
  const [appointmentStatus, setAppointmentStatus] = useState("Scheduled");
  
  // Local State: Services/Pricing
  const [treatment, setTreatment] = useState("");
  const [services, setServices] = useState<SelectedService[]>([]);
  const [cost, setCost] = useState(0);

  // Add Procedure State
  const [showAddProcedure, setShowAddProcedure] = useState(false);
  const [procServiceId, setProcServiceId] = useState("");
  const [procCost, setProcCost] = useState<number | "">("");
  const [addProcToLedger, setAddProcToLedger] = useState(true);
  const [addingProcedure, setAddingProcedure] = useState(false);
  /** The staged procedure whose details are back in the form for changing; null = adding a new one. */
  const [editingProcId, setEditingProcId] = useState<string | null>(null);
  const [sessionProcedures, setSessionProcedures] = useState<{ id: string; serviceId: string | null; name: string; cost: number; addToLedger: boolean; priceListId?: string | null }[]>([]);

  /**
   * Which price list the desk is booking against.
   *
   * Booking read `service.price` and nothing else, so a clinic could set up an insurer list in
   * Settings and still have reception quote the walk-in rate — the lists existed but only the
   * chair ever saw them. Reception is where a patient's rate is usually known ("she's on the
   * family list"), so the choice belongs here too.
   */
  const { priceLists, payers } = usePricingPolicy();
  const [procListId, setProcListId] = useState("");
  // Only the lists this branch actually charges: its own, plus every clinic-wide one. Booking at
  // the seaside desk must not be able to quote the downtown insurer's rates.
  const activePriceLists = useMemo(
    () => listsForBranch(priceLists, branchId).filter((l) => l.active),
    [priceLists, branchId]
  );
  const effectiveListId = useMemo(
    () => resolveActiveListId(priceLists, procListId, null, branchId),
    [priceLists, procListId, branchId]
  );

  /**
   * Reprice the picked service whenever the list actually in force changes.
   *
   * Changing the BRANCH can change the list without anyone touching the list dropdown — a branch
   * has its own default, and a list the previous branch offered may not be offered here. Without
   * this the cost box keeps the old branch's number, which is the kind of wrong that gets invoiced.
   */
  useEffect(() => {
    if (!procServiceId) return;
    const svc = servicesList.find((x) => String(x.id) === String(procServiceId));
    if (svc) setProcCost(resolveListPrice(svc, effectiveListId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveListId]);
  const selectedPriceList = activePriceLists.find((l) => l.id === effectiveListId) || null;
  const bookingPayer = payerForPriceList(payers, effectiveListId);

  /**
   * Only what the selected list actually covers.
   *
   * A treatment the insurer does not pay for is not offered at all, so the menu means what it
   * says. Leaving it visible and quietly recording it as private would be a screen that lets
   * somebody pick a wrong answer and then overrules them without saying so.
   */
  // Every service, whoever pays: coverage lists are gone; the price list only prefills a price.
  const offeredServices = servicesList;

  // Local State: Financial & Payment
  const [chargeForVisit, setChargeForVisit] = useState(true);
  const [visitNotes, setVisitNotes] = useState("");
  
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientPhone, setNewPatientPhone] = useState("");
  const [newPatientCountryCode, setNewPatientCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [newPatientDob, setNewPatientDob] = useState("");
  const [newPatientAddress, setNewPatientAddress] = useState("");
  const [newPatientSource, setNewPatientSource] = useState("");
  const [newPatientGender, setNewPatientGender] = useState("Male");
  
  const [sourcesOptions, setSourcesOptions] = useState<string[]>(["Walk-in", "Social Media", "Friend / Family", "Other Doctor", "Google"]);
  const [visitReasonsOptions, setVisitReasonsOptions] = useState<string[]>(["كشف"]);

  // --- insurance: which approved service this visit is for --------------------------------------
  /** Every approved service this visit is for. A visit can cover several (the wide popup lets you tick them). */
  const [claimLinks, setClaimLinks] = useState<ClaimLink[]>([]);
  const claimLink = claimLinks[0] ?? null;
  const isLinked = (claimId: string, line: number) => claimLinks.some((l) => l.claimId === claimId && l.claimLine === line);
  const [patientClaims, setPatientClaims] = useState<{ patientId: string; claims: InsuranceClaim[] }>({ patientId: "", claims: [] });
  const claimPatientId = selectedPatient && !isNewPatient ? String(selectedPatient.id) : "";
  useEffect(() => {
    if (!isOpen || !claimPatientId) return;
    // Clinic members may read claims; only the server writes them. A clinic without the insurance
    // add-on simply gets no rows (or a denied read), and the picker stays hidden either way.
    return onSnapshot(
      query(getClinicCollection(CLAIMS_COLLECTION), where("patientId", "==", claimPatientId)),
      (snap) => setPatientClaims({ patientId: claimPatientId, claims: snap.docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is InsuranceClaim => c !== null) }),
      () => setPatientClaims({ patientId: claimPatientId, claims: [] }),
    );
  }, [isOpen, claimPatientId]);
  const claimsLoaded = !!claimPatientId && patientClaims.patientId === claimPatientId;
  /** Every service still open on this patient's approvals, plus the one already on the appointment. */
  const lineOptions = useMemo(() => {
    if (!claimsLoaded) return [];
    const out: { value: string; link: ClaimLink; label: string; dentistName: string; reason: string }[] = [];
    for (const c of patientClaims.claims) {
      const open = new Set(openLines(c));
      c.lines.forEach((line, i) => {
        const current = isLinked(c.id, i);
        if (!open.has(i) && !current) return;
        const dentistName = c.dentists[i]?.name ?? "";
        out.push({ value: `${c.id}|${i}`, link: { claimId: c.id, claimLine: i }, label: `${line.description} · ${c.approvalNumber}${dentistName ? ` · ${dentistName}` : ""}`, dentistName, reason: line.description });
      });
    }
    return out;
  }, [claimsLoaded, patientClaims, claimLinks]); // eslint-disable-line react-hooks/exhaustive-deps
  /** One service and only that one (the single dropdown, and the Book button's pick). "" = a plain visit. */
  const pickLine = (value: string) => {
    const opt = lineOptions.find((o) => o.value === value) ?? null;
    setClaimLinks(opt ? [opt.link] : []);
    if (!opt) return;
    setTreatment(opt.reason);
    if (opt.dentistName && doctors.some((d) => d.name === opt.dentistName)) setDoctor(opt.dentistName);
  };
  /** Add a service to this visit, or take it off. The first one also fills the reason and dentist, as a single pick did. */
  const toggleLine = (value: string) => {
    const opt = lineOptions.find((o) => o.value === value) ?? null;
    if (!opt) return;
    if (isLinked(opt.link.claimId, opt.link.claimLine)) {
      setClaimLinks((prev) => prev.filter((l) => !(l.claimId === opt.link.claimId && l.claimLine === opt.link.claimLine)));
      return;
    }
    if (claimLinks.length === 0) {
      setTreatment(opt.reason);
      if (opt.dentistName && doctors.some((d) => d.name === opt.dentistName)) setDoctor(opt.dentistName);
    }
    setClaimLinks((prev) => [...prev, opt.link]);
  };
  // Links that do not belong to the patient on screen (the picker moved to someone else) are dropped.
  useEffect(() => {
    if (!claimsLoaded || claimLinks.length === 0) return;
    const mine = claimLinks.filter((l) => patientClaims.claims.some((c) => c.id === l.claimId));
    if (mine.length !== claimLinks.length) setClaimLinks(mine);
  }, [claimsLoaded, patientClaims, claimLinks]);
  // The Book button's pick fills the form once its approval has loaded.
  const appliedPreselect = useRef("");
  useEffect(() => {
    if (!isOpen || editAppointment || !preSelectedClaimLine || !claimsLoaded) return;
    const k = `${claimPatientId}|${preSelectedClaimLine.claimId}|${preSelectedClaimLine.claimLine}`;
    if (appliedPreselect.current === k) return;
    const opt = lineOptions.find((o) => o.link.claimId === preSelectedClaimLine.claimId && o.link.claimLine === preSelectedClaimLine.claimLine);
    if (!opt) return;
    appliedPreselect.current = k;
    pickLine(opt.value);
  });
  useEffect(() => {
    if (!isOpen) appliedPreselect.current = "";
  }, [isOpen]);
  /** The reason box must be able to show the approved service's wording even when the clinic's list lacks it. */
  const reasonOptions = treatment && !visitReasonsOptions.includes(treatment) ? [treatment, ...visitReasonsOptions] : visitReasonsOptions;

  useEffect(() => {
    getDoc(getClinicDoc("settings", "patient_sources")).then((snap) => {
      if (snap.exists() && Array.isArray(snap.data().sources) && snap.data().sources.length > 0) {
        setSourcesOptions(snap.data().sources);
      }
    });
    getDoc(getClinicDoc("settings", "visit_reasons")).then((snap) => {
      if (snap.exists() && Array.isArray(snap.data().reasons) && snap.data().reasons.length > 0) {
        setVisitReasonsOptions(snap.data().reasons);
      }
    });
    getDoc(getClinicDoc("settings", LOCATIONS_DOC)).then((snap) => {
      setBranches(parseClinicBranches(snap.exists() ? snap.data() : null));
    });
  }, []);
  
  const [isChecking, setIsChecking] = useState(false);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const txt = useMemo(
    () => ({
      title: language === "ar" ? "حجز موعد" : "Book Appointment",
      editTitle: language === "ar" ? "تعديل الموعد" : "Edit appointment",
      subtitle:
        language === "ar"
          ? "المواعيد على حسب معاد العيادة اللي محطوط في الإعدادات."
          : "Times follow the clinic hours saved under Settings.",
      searchPlaceholder:
        language === "ar" ? "دور بالاسم أو رقم الموبايل…" : "Search name or phone…",
      patient: language === "ar" ? "المريض" : "Patient",
      sectionService: language === "ar" ? "الخدمة والحساب" : "Service & billing",
      sectionLink: language === "ar" ? "العلاج على السجل" : "Clinical record",
      manualProcedure:
        language === "ar" ? "اسم الإجراء (مفيش قائمة أسعار)" : "Procedure name (no catalog)",
      discountSection: language === "ar" ? "الخصم" : "Discount",
      noDiscount: language === "ar" ? "بدون خصم" : "No discount",
      pctDiscount: language === "ar" ? "نسبة %" : "Percent %",
      amtDiscount: language === "ar" ? "مبلغ ثابت" : "Fixed amount",
      discountPlaceholderPct:
        language === "ar" ? "مثال: 10" : "e.g. 10",
      discountPlaceholderAmt:
        language === "ar" ? "مثال: 50" : "e.g. 50",
      before: language === "ar" ? "قبل الخصم" : "Before",
      after: language === "ar" ? "بعد الخصم" : "After",
      off: language === "ar" ? "خصم" : "off",
      serviceSelect:
        language === "ar" ? "اختار الخدمة من قائمة الأسعار" : "Select service from price list",
      planned: language === "ar" ? "المبلغ المتوقع" : "Planned cost",
      currency: language === "ar" ? "جنيه" : "EGP",
      newLine: language === "ar" ? "علاج جديد" : "New treatment",
      existingLine: language === "ar" ? "متابعة / مراجعة" : "Follow-up visit",
      followUpHint:
        language === "ar"
          ? "متابعة مع نفس الحالة — من غير رسوم إضافية، إلا لو في إجراء جديد النهاردة."
          : "Follow-up on the same case — no extra charge unless you add a paid procedure below.",
      extraPaidToggle:
        language === "ar"
          ? "في إجراء مدفوع النهاردة (خدمة إضافية من القائمة)"
          : "Add a paid procedure today (extra service)",
      ongoingPick: language === "ar" ? "اختار الحالة اللي شغالين عليها" : "Choose ongoing case",
      followUpFreeInfo:
        language === "ar"
          ? "الموعد ده متابعة بس؛ مش هيتسجل عالحساب غير لو علّمت إجراء إضافي فوق."
          : "This visit is follow-up only—nothing posts to finance unless you add an extra procedure.",
      doctor: language === "ar" ? "الدكتور" : "Dentist",
      date: language === "ar" ? "اليوم" : "Date",
      clock: language === "ar" ? "الميعاد" : "Time",
      duration: language === "ar" ? "المدة" : "Duration",
      cancel: language === "ar" ? "إلغاء" : "Cancel",
      // With autosave on, "Cancel" would be a lie — the edits are already in. The button only
      // closes the panel, so it says so.
      done: language === "ar" ? "تم" : "Done",
      confirm: language === "ar" ? "أكّد الحجز" : "Confirm booking",
      saveEdit: language === "ar" ? "حفظ التعديلات" : "Save changes",
      confirmClosedDayTitle: language === "ar" ? "العيادة قفلة اليوم ده" : "Clinic closed this day",
      confirmClosedDayBody:
        language === "ar"
          ? "يا سلام، اليوم ده العيادة قفلة حسب إعداداتك — عايز تكمّل الحجز برضه؟"
          : "This day is closed according to your clinic settings. Do you still want to book anyway?",
      branch: language === "ar" ? "الفرع" : "Branch",
      room: language === "ar" ? "الغرفة" : "Room",
      anyRoom: language === "ar" ? "أي غرفة" : "Any room",
      noRooms: language === "ar" ? "مفيش غرف للفرع ده" : "No rooms in this branch",
      pickBranchFirst: language === "ar" ? "اختار الفرع الأول" : "Pick a branch first",
      confirmRoomTakenTitle: language === "ar" ? "الغرفة مشغولة" : "Room occupied",
      confirmRoomTakenBody:
        language === "ar"
          ? "الغرفة دي عليها موعد تاني في نفس الوقت — عايز تكمّل الحجز برضه؟"
          : "This room already has another appointment at that time. Do you want to proceed anyway?",
      confirmSlotTakenTitle: language === "ar" ? "الميعاد متاخد" : "Slot already taken",
      confirmSlotTakenBody:
        language === "ar"
          ? "الميعاد ده متاخد على حد تاني — عايز تكمّل الحجز برضه؟"
          : "This time slot is already taken. Do you want to proceed anyway?",
      yesProceed: language === "ar" ? "أيوه، كمّل" : "Yes, proceed",
      noCancel: language === "ar" ? "لأ" : "No",
      error: language === "ar" ? "حصل غلط في الحجز" : "Booking error",
      notFound: language === "ar" ? "مفيش حد بالبيانات دي" : "No match",
      noDoctors: language === "ar" ? "مفيش دكاترة مسجلين" : "No dentists",
      noServices: language === "ar" ? "مفيش خدمات في قائمة الأسعار" : "No catalog services",
      pickService:
        language === "ar" ? "اختار خدمة من قائمة الأسعار الأول" : "Select a catalog service first",
      selectPatient: language === "ar" ? "اختار المريض الأول" : "Select a patient first",
      pickDentist: language === "ar" ? "اختار الدكتور" : "Pick a dentist",
      pickTime: language === "ar" ? "اختار الميعاد" : "Pick a time",
      stillNeeded: language === "ar" ? "ناقص:" : "Still needed:",
      needPatient: language === "ar" ? "المريض" : "a patient",
      needDentist: language === "ar" ? "الطبيب" : "a dentist",
      needDate: language === "ar" ? "التاريخ" : "a date",
      needTime: language === "ar" ? "الوقت" : "a time",
      noFollowCase: language === "ar" ? "مفيش متابعة متاحة للمريض ده" : "No ongoing case to link",
      needLabel:
        language === "ar"
          ? "اكتب اسم الإجراء (مفيش قائمة أسعار)"
          : "Enter a procedure name (no catalog)",
      needServiceOrName:
        language === "ar" ? "اختار خدمة من القائمة" : "Pick a service from the list",
      notesLabel: language === "ar" ? "ملاحظات الموعد" : "Visit notes",
      pickPatientForBilling:
        language === "ar"
          ? "بعد ما تختار المريض، هتظهر خيارات العلاج والأسعار والمتابعة."
          : "After you choose a patient, treatment options, pricing, and follow-up appear here.",
    }),
    [language]
  );

  const displayTime = (timeStr: string) => {
    if (!timeStr) return "";
    if (language !== "ar") return timeStr;
    return timeStr.replace("AM", "ص").replace("PM", "م");
  };

  useEffect(() => {
    if (!isOpen) return;
    const slots: string[] = [];
    const { start, end } = clinicDayBoundsMinutes(sched);
    for (let m = start; m < end; m += sched.slotDuration) {
      const minsMod = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
      const h24 = Math.floor(minsMod / 60);
      const mins = minsMod % 60;
      const hour12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
      const ampmStandard = h24 < 12 ? "AM" : "PM";
      const pad = (n: number) => n.toString().padStart(2, "0");
      slots.push(`${pad(hour12)}:${pad(mins)} ${ampmStandard}`);
    }
    setAvailableTimes(slots);
    if (!time || !slots.includes(time)) {
      if (preSelectedTime && slots.includes(preSelectedTime)) setTime(preSelectedTime);
      else if (slots.length > 0) setTime(slots[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sched.startHour, sched.startMinute, sched.endHour, sched.endMinute, sched.slotDuration, preSelectedTime]);

  /**
   * Keep the state honest about what the selects are showing.
   *
   * Two effects race on open: the slot builder sets `time` to the first slot, then the reset
   * effect below clears it back to "" whenever booking was not started from a calendar slot. A
   * `<select>` with no matching value silently renders its first option, so the form LOOKED
   * complete — 09:00 AM showing, dentist showing — while `time` was empty and the confirm button
   * stayed disabled with nothing on screen to explain why.
   *
   * It only ever worked by accident: when the clinic's schedule document arrived after the modal
   * mounted, the slot builder re-ran and repaired the empty time. A cached schedule, or one whose
   * values happen to match the defaults, meant no second run and a permanently grey button.
   *
   * `doctor` has the identical trap when the doctors list loads after mount — the select shows the
   * first dentist while the state holds "", and saving is refused for a reason the screen
   * contradicts.
   */
  useEffect(() => {
    if (isOpen && !time && availableTimes.length > 0) setTime(availableTimes[0]);
  }, [isOpen, time, availableTimes]);

  useEffect(() => {
    if (isOpen && !doctor && doctors.length > 0) setDoctor(doctors[0].name);
  }, [isOpen, doctor, doctors]);
  // Note the repair above is why "General" carries a sentinel value instead of "": an empty string
  // would be treated as "not chosen yet" and snapped back to the first dentist on staff.

  useEffect(() => {
    // Always reset isChecking when the modal opens or closes so a stale
    // "true" from a previous session never permanently disables the button.
    setIsChecking(false);
    if (!isOpen) return;

    setShowAddProcedure(false);
    setProcServiceId("");
    setProcCost("");
    setAddProcToLedger(true);
    setSessionProcedures([]);
    setEditingProcId(null);

    if (editAppointment) {
      setIsNewPatient(false);
      setNewPatientName("");
      setNewPatientPhone("");
      setNewPatientDob("");
      setNewPatientAddress("");
      setNewPatientSource("");
      setSelectedPatient({
        id: String(editAppointment.patientId),
        name: editAppointment.patientName || "",
      });
      // An appointment with no dentist on it reopens on General — it must not be quietly handed to
      // whoever happens to be first on staff.
      setDoctor(pickerValueFromDoctorField(editAppointment.doctor));
      setBranchId(editAppointment.branchId || "");
      setRoomId(editAppointment.roomId || "");
      setDate(editAppointment.date || getLocalDate());
      setTime(editAppointment.time || "");
      setDuration(editAppointment.duration || sched.slotDuration);
      setTreatment(editAppointment.treatment || "");
      setVisitNotes(editAppointment.notes || "");
      setAppointmentStatus(editAppointment.status || "Scheduled");
      setClaimLinks(parseClaimLinks(editAppointment));
    } else {
      setIsNewPatient(false);
      setNewPatientName("");
      setNewPatientPhone("");
      setNewPatientDob("");
      setNewPatientAddress("");
      setNewPatientSource("");
      
      if (preSelectedDoctor) setDoctor(preSelectedDoctor);
      setSearchTerm("");
      setSelectedPatient(preSelectedPatient || null);
      
      setDate(preSelectedDate || getLocalDate());
      setTime(preSelectedTime || "");
      setDuration(sched.slotDuration);
      setTreatment("");
      setVisitNotes("");
      setAppointmentStatus("Scheduled");
      setBranchId("");
      setRoomId("");
      setClaimLinks(preSelectedClaimLine ? [preSelectedClaimLine] : []);
    }
  }, [isOpen, editAppointment, doctors, sched.slotDuration, preSelectedDoctor, preSelectedPatient, preSelectedDate, preSelectedTime, preSelectedClaimLine]);

  // A clinic with exactly one branch shouldn't have to pick it on every booking.
  useEffect(() => {
    if (!isOpen || branchId) return;
    // The branch you are standing in, then the only one there is. Both are guesses the user can
    // override; neither applies in edit mode, where branchId is already set from the appointment.
    if (preSelectedBranchId && branches.some((b) => b.id === preSelectedBranchId)) {
      setBranchId(preSelectedBranchId);
    } else if (branches.length === 1) {
      setBranchId(branches[0].id);
    }
  }, [isOpen, branchId, branches, preSelectedBranchId]);

  const selectedBranch = branches.find((b) => b.id === branchId) || null;
  const selectedRoom = selectedBranch?.rooms.find((r) => r.id === roomId) || null;



  

  const durationOptions = [
    { label: language === "ar" ? "15 دقيقة" : "15 min", value: 15 },
    { label: language === "ar" ? "30 دقيقة" : "30 min", value: 30 },
    { label: language === "ar" ? "45 دقيقة" : "45 min", value: 45 },
    { label: language === "ar" ? "ساعة" : "1 hr", value: 60 },
    { label: language === "ar" ? "1.5 ساعة" : "1.5 hr", value: 90 },
    { label: language === "ar" ? "ساعتين" : "2 hr", value: 120 },
  ];

  const filteredPatients = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return patients.filter((p) =>
      patientMatchesSearch(searchTerm, String(p.name || ""), p.phone ? String(p.phone) : undefined)
    );
  }, [patients, searchTerm]);

  /**
   * Everything still standing between this form and a saved appointment.
   *
   * One list, used both to disable the button and to say why — so the two can never disagree.
   * `doctor` is included here rather than only being caught inside handleSubmit: a clinic with no
   * dentists on file could previously enable the button and then refuse the save with a toast,
   * which reads as the system losing the booking rather than as missing setup.
   */
  const blockingReasons = useMemo(() => {
    const missing: string[] = [];
    if (isNewPatient) {
      if (!newPatientName.trim() || !newPatientPhone.trim()) missing.push(txt.needPatient);
    } else if (!selectedPatient) {
      missing.push(txt.needPatient);
    }
    if (!doctor) missing.push(txt.needDentist);
    if (!date) missing.push(txt.needDate);
    if (!time) missing.push(txt.needTime);
    return missing;
  }, [isNewPatient, newPatientName, newPatientPhone, selectedPatient, doctor, date, time, txt]);

  /**
   * The day's appointments, fetched once and filtered in memory.
   *
   * This used to add `where("doctor", "==", name)` to the query. `doctor` is a display string
   * captured at booking time, so renaming a dentist left every appointment they already had
   * unmatchable — the conflict check found nothing and the clinic could double-book them with no
   * warning. Matching now happens in lib/appointmentConflicts, which keys on the stable `doctorId`
   * and falls back to the name only for rows old enough not to have one.
   */
  const fetchDayAppointments = async (checkDate: string): Promise<ConflictCandidate[]> => {
    const snapshot = await getDocs(
      query(getClinicCollection("appointments"), where("date", "==", checkDate))
    );
    return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ConflictCandidate, "id">) }));
  };

  const handleSubmit = async () => {
    if (isChecking) return;
    setIsChecking(true);
    try {
      const isValidNew = isNewPatient && newPatientName.trim().length > 0 && newPatientPhone.trim().length > 0;
      const isValidExisting = !isNewPatient && selectedPatient;
      if (!isValidNew && !isValidExisting) {
        showToast(txt.selectPatient, "error");
        return;
      }
      if (!doctor) {
        showToast(txt.pickDentist, "error");
        return;
      }
      if (!time) {
        showToast(txt.pickTime, "error");
        return;
      }
      if (dateIsClinicClosed(date, sched.offDays)) {
        const proceedClosed = await confirm(txt.confirmClosedDayBody, {
          title: txt.confirmClosedDayTitle,
          confirmLabel: txt.yesProceed,
          cancelLabel: txt.noCancel,
        });
        if (!proceedClosed) return;
      }

      // One fetch of the day serves both checks below.
      const dayAppointments = await fetchDayAppointments(date);

      const hasConflict =
        findDoctorConflicts(dayAppointments, {
          time,
          duration: Number(duration),
          doctorId: resolvedDoctorId,
          doctorName: doctorField,
          excludeAppointmentId: editAppointment?.id,
        }).length > 0;
      if (hasConflict) {
        const proceedConflict = await confirm(txt.confirmSlotTakenBody, {
          title: txt.confirmSlotTakenTitle,
          confirmLabel: txt.yesProceed,
          cancelLabel: txt.noCancel,
        });
        if (!proceedConflict) {
          setIsChecking(false);
          return;
        }
      }

      if (roomId) {
        const roomBusy =
          findRoomConflicts(dayAppointments, {
            time,
            duration: Number(duration),
            roomId,
            excludeAppointmentId: editAppointment?.id,
          }).length > 0;
        if (roomBusy) {
          const proceedRoom = await confirm(txt.confirmRoomTakenBody, {
            title: txt.confirmRoomTakenTitle,
            confirmLabel: txt.yesProceed,
            cancelLabel: txt.noCancel,
          });
          if (!proceedRoom) {
            setIsChecking(false);
            return;
          }
        }
      }

      await onSave(buildPayload());
    } catch (error) {
      console.error(error);
      showToast(txt.error, "error");
    } finally {
      setIsChecking(false);
    }
  };

  /** The form as one payload. Shared so a deliberate save and an autosave can never disagree. */
  function buildPayload() {
    return {
        patientId: isNewPatient ? "NEW_PATIENT" : String(selectedPatient?.id),
        patientName: isNewPatient ? newPatientName.trim() : (selectedPatient?.name || ""),
        isNewPatient,
        newPatientPhone: isNewPatient ? buildE164FromCountryCode(newPatientCountryCode, newPatientPhone) : undefined,
        newPatientDob: isNewPatient ? newPatientDob : undefined,
        newPatientAddress: isNewPatient ? newPatientAddress.trim() : undefined,
        newPatientSource: isNewPatient ? newPatientSource : undefined,
        newPatientGender: isNewPatient ? newPatientGender : undefined,
        treatment: treatment.trim(),
        doctor: doctorField,
        // Resolved from the same list the picker renders, so reports can group on a stable id
        // instead of a display string.
        doctorId: resolvedDoctorId,
        date,
        time,
        duration,
        branchId: branchId || "",
        branchName: selectedBranch?.name || "",
        roomId: roomId || "",
        roomName: selectedRoom?.name || "",
        type: "consult",
        notes: visitNotes.trim(),
        cost: editAppointment ? (editAppointment.cost || 0) : 0,
        clinicalNoteId: editAppointment ? editAppointment.clinicalNoteId : null,
        ...appointmentLinkFields(claimLinks),
        newProcedureName: null,
        listPrice: editAppointment ? (editAppointment.listPrice || 0) : 0,
        // `as const` because this is now a returned object rather than an inline argument — without
        // it the literal widens to `string` and no longer fits AppointmentData's union.
        discountMode: "none" as const,
        discountPercent: null,
        discountFixed: null,
        discountAmount: editAppointment ? (editAppointment.discountAmount || 0) : 0,
        sessionProcedures,
        discountDistribution: "total" as any,

        existingAppointmentId: editAppointment?.id ?? null,
        status: appointmentStatus,
    };
  }

  /**
   * Autosave, for an appointment that already exists.
   *
   * Editing here writes itself once the person stops; a note settles in well under a second while
   * moving the visit waits longer, because that one messages the patient (see
   * lib/appointmentAutosave). Creating a booking is deliberately NOT autosaved — see `onAutosave`.
   */
  const autosaveOn = !!onAutosave && !!editAppointment;
  const [autosaveState, setAutosaveState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const autosaveBusy = useRef(false);
  const autosaveFields = useMemo(
    // `doctorField`, not `doctor`: the comparison is against what is stored, and the General
    // sentinel would otherwise look like an unsaved edit the moment the panel opened.
    () => ({ date, time, doctor: doctorField, treatment: treatment.trim(), duration, notes: visitNotes.trim(), status: appointmentStatus, roomId }),
    [date, time, doctorField, treatment, duration, visitNotes, appointmentStatus, roomId]
  );
  const savedFields = useMemo(
    () =>
      editAppointment
        ? {
            date: editAppointment.date || "",
            time: editAppointment.time || "",
            doctor: editAppointment.doctor || "",
            treatment: editAppointment.treatment || "",
            duration: editAppointment.duration ?? 0,
            notes: editAppointment.notes || "",
            status: editAppointment.status || "",
            roomId: editAppointment.roomId || "",
          }
        : null,
    [editAppointment]
  );

  const autosaveRef = useRef<() => Promise<void>>(async () => {});
  autosaveRef.current = async () => {
    if (!onAutosave || !editAppointment || autosaveBusy.current) return;
    autosaveBusy.current = true;
    setAutosaveState("saving");
    try {
      await onAutosave(buildPayload());
      setAutosaveState("saved");
    } catch (e) {
      console.error("Autosave failed:", e);
      setAutosaveState("error");
    } finally {
      autosaveBusy.current = false;
    }
  };

  useEffect(() => {
    if (!autosaveOn || !savedFields) return;
    const verdict = autosaveVerdict(savedFields, autosaveFields, { fields: AUTOSAVE_FIELDS });
    if (!verdict.save) {
      setAutosaveState((s) => (s === "pending" ? "idle" : s));
      return;
    }
    setAutosaveState("pending");
    const id = setTimeout(() => void autosaveRef.current(), verdict.delayMs);
    return () => clearTimeout(id);
  }, [autosaveOn, savedFields, autosaveFields]);

  useEffect(() => {
    if (autosaveState !== "saved") return;
    const id = setTimeout(() => setAutosaveState("idle"), 2200);
    return () => clearTimeout(id);
  }, [autosaveState]);

  // --- the wide popup ---------------------------------------------------------------------------
  const wideLayout = wide && isDesktop && !inlineDesktop;
  type WideTab = "appointment" | "service" | "payment" | "insurance";
  const [wideTab, setWideTab] = useState<WideTab>("appointment");
  useEffect(() => {
    if (isOpen) setWideTab("appointment");
  }, [isOpen]);
  const headerPatientId = selectedPatient && !isNewPatient ? String(selectedPatient.id) : "";
  const [patientCard, setPatientCard] = useState<{ id: string; fileId: string; phone: string } | null>(null);
  useEffect(() => {
    if (!wideLayout || !headerPatientId) return;
    let live = true;
    getDoc(getClinicDoc("patients", headerPatientId))
      .then((snap) => {
        if (!live) return;
        const d = snap.exists() ? snap.data() : {};
        setPatientCard({ id: headerPatientId, fileId: String(d.fileId || ""), phone: String(d.phone || "") });
      })
      .catch(() => live && setPatientCard({ id: headerPatientId, fileId: "", phone: "" }));
    return () => {
      live = false;
    };
  }, [wideLayout, headerPatientId]);

  /** Edits on screen that a switch to another visit would throw away. */
  const hasUnsavedEdits =
    sessionProcedures.length > 0 ||
    (!!editAppointment &&
      !!savedFields &&
      AUTOSAVE_FIELDS.some((k) => String(autosaveFields[k] ?? "") !== String(savedFields[k] ?? "")));

  const switchVisit = async (next: VisitSwitch) => {
    if (next.kind === "edit" && editAppointment?.id === next.appt.id) return;
    if (next.kind === "new" && !editAppointment) return;
    if (hasUnsavedEdits && !autosaveOn) {
      const leave = await confirm(
        language === "ar" ? "في تعديلات على الزيارة دي لسه مش متحفظة. تسيبها وتفتح التانية؟" : "This visit has changes that are not saved yet. Leave them and open the other one?",
        {
          title: language === "ar" ? "تعديلات مش متحفظة" : "Unsaved changes",
          confirmLabel: language === "ar" ? "أيوه، سيبها" : "Leave them",
          cancelLabel: language === "ar" ? "لأ" : "Stay",
        }
      );
      if (!leave) return;
    }
    setWideTab((t) => (next.kind === "new" && t !== "appointment" && t !== "service" ? "appointment" : t));
    setSwitchedTo(next);
  };

  if (!isOpen) return null;

  const patientSection = (
    <>
          <div className="space-y-3">
            {!editAppointment && (
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">
                  {txt.patient}
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isNewPatient}
                    onChange={(e) => setIsNewPatient(e.target.checked)}
                    className="rounded border-line-strong text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-xs font-bold text-ink-body">
                    {language === "ar" ? "مريض جديد" : "New Patient"}
                  </span>
                </label>
              </div>
            )}
            
            {isNewPatient ? (
              <div className="space-y-3">
                <div className="relative group">
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary-500" />
                  <input
                    type="text"
                    placeholder={language === "ar" ? "اسم المريض *" : "Patient Name *"}
                    value={newPatientName}
                    onChange={(e) => setNewPatientName(e.target.value)}
                    className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-10 pr-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 placeholder:font-medium placeholder:text-slate-400"
                  />
                </div>
                <div className="flex relative group">
                  <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary-500 z-10" />
                  <select
                    value={newPatientCountryCode}
                    onChange={(e) => setNewPatientCountryCode(e.target.value)}
                    className="w-32 rounded-l-xl border-y border-l border-line bg-slate-50/50 py-3 pl-10 pr-2 text-xs font-bold text-slate-700 outline-none transition-all focus:border-primary-500 focus:bg-surface focus:ring-2 focus:ring-primary-500/20"
                  >
                    {COUNTRY_CODE_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.code} {opt.label.split(" ")[0]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    dir="ltr"
                    placeholder={language === "ar" ? "رقم الموبايل *" : "Phone Number *"}
                    value={newPatientPhone}
                    onChange={(e) => setNewPatientPhone(e.target.value)}
                    className="flex-1 rounded-r-xl border border-line bg-slate-50/50 py-3 px-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-primary-500 focus:bg-surface focus:ring-2 focus:ring-primary-500/20 placeholder:font-medium placeholder:text-slate-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative group">
                    <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary-500" />
                    <input
                      type="date"
                      value={newPatientDob}
                      onChange={(e) => setNewPatientDob(e.target.value)}
                      className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-10 pr-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 text-slate-400"
                    />
                  </div>
                  <div className="flex rounded-xl border border-line overflow-hidden bg-slate-50/50">
                    {["Male", "Female"].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setNewPatientGender(g)}
                        className={`flex-1 py-3 text-xs font-bold transition-colors ${
                          newPatientGender === g 
                            ? "bg-primary-50 text-primary-600" 
                            : "text-ink-muted hover:bg-surface-muted"
                        }`}
                      >
                        {language === "ar" ? (g === "Male" ? "ذكر" : "أنثى") : g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative group">
                  <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary-500" />
                  <input
                    type="text"
                    placeholder={language === "ar" ? "العنوان" : "Address"}
                    value={newPatientAddress}
                    onChange={(e) => setNewPatientAddress(e.target.value)}
                    className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-10 pr-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 placeholder:font-medium placeholder:text-slate-400"
                  />
                </div>
                <div className="relative group">
                  <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select
                    value={newPatientSource}
                    onChange={(e) => setNewPatientSource(e.target.value)}
                    className="w-full rounded-xl border border-line bg-slate-50/50 py-3 pl-4 pr-10 text-sm font-bold text-slate-700 outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 appearance-none"
                  >
                    <option value="">{language === "ar" ? "مصدر المريض (اختياري)" : "Patient Source (Optional)"}</option>
                    {sourcesOptions.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <PatientPicker
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                selectedPatient={selectedPatient}
                setSelectedPatient={setSelectedPatient}
                filteredPatients={filteredPatients}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                txt={txt}
              />
            )}
          </div>

          {!editAppointment && !selectedPatient && !isNewPatient && (
            <p className="rounded-2xl border border-dashed border-line bg-slate-50/90 px-4 py-3 text-xs font-semibold leading-relaxed text-ink-body">
              {txt.pickPatientForBilling}
            </p>
          )}
    </>
  );

  const addProcedureSection = (
servicesList.length > 0 && (
  <div className="border-t border-slate-100 bg-slate-50/50 p-6 pt-0">
    <div className="mt-2">
      <button
        onClick={(e) => {
          e.preventDefault();
          if (editingProcId) {
            setEditingProcId(null);
            setProcServiceId("");
            setProcCost("");
          }
          setShowAddProcedure(prev => !prev);
        }}
        className={`w-full text-sm font-extrabold rounded-xl py-3.5 flex items-center justify-center gap-1.5 transition-colors shadow-sm ${
          showAddProcedure
            ? 'text-ink-body bg-surface-muted border border-line hover:bg-slate-200'
            : 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
        }`}
      >
        <Sparkles size={16} className={!showAddProcedure ? 'text-emerald-600' : ''}/> {showAddProcedure ? (language === 'ar' ? 'إلغاء' : 'Cancel') : (language === 'ar' ? 'إضافة إجراء' : 'Add Procedure')}
      </button>

      {showAddProcedure && (
        <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100 mt-2 animate-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col gap-3">
            {/* Price list. Shown above the service, because which list you are on decides what
                the service costs — answering it afterwards would mean repricing what was picked. */}
            <div>
              <label className="text-xs font-black text-ink-muted uppercase tracking-wider block mb-1.5">
                {language === 'ar' ? 'قائمة الأسعار' : 'Price list'}
              </label>
              {activePriceLists.length > 1 ? (
                <select
                  value={effectiveListId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setProcListId(nextId);
                    // Reprice whatever is already picked, so the cost box can never be left
                    // showing the rate from the list you just moved off.
                    const svc = servicesList.find(s => String(s.id) === String(procServiceId));
                    if (svc) setProcCost(resolveListPrice(svc, nextId));
                  }}
                  className="w-full px-3 py-3 text-sm font-bold text-slate-700 border border-line rounded-xl outline-none focus:ring-2 focus:ring-emerald-400 bg-surface"
                >
                  {activePriceLists.map((list) => {
                    // The company behind the list, named in the option itself. A list called "AXA"
                    // that no insurer actually points at charges exactly like the clinic's own —
                    // and looked identical here until this line existed.
                    const owner = payerForPriceList(payers, list.id);
                    return (
                      <option key={list.id} value={list.id}>
                        {language === 'ar' && list.nameAr ? list.nameAr : list.name}
                        {owner.id !== PRIVATE_PAYER_ID ? ` · ${owner.name}` : ""}
                        {list.generalDiscountPercent > 0 ? ` — ${list.generalDiscountPercent}%` : ""}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <p className="w-full px-3 py-3 text-sm font-bold text-ink-body border border-line rounded-xl bg-surface">
                  {selectedPriceList
                    ? (language === 'ar' && selectedPriceList.nameAr ? selectedPriceList.nameAr : selectedPriceList.name)
                    : (language === 'ar' ? 'الأساسي' : 'Standard')}
                </p>
              )}
              {/*
                Who this treatment will count for, said at the moment it is decided.
                The price list IS the payer, but only if a payer points at it — and nothing on
                screen used to distinguish "AXA's list" from a list somebody named AXA. The case
                was then recorded as private and went missing from the insurer's report, with the
                mistake invisible at every step.
              */}
              {activePriceLists.length > 1 && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-ink-muted">
                  {language === 'ar' ? 'هتتحسب على' : 'Charged to'}:
                  {bookingPayer.id === PRIVATE_PAYER_ID ? (
                    <span className="text-ink-body">{language === 'ar' ? 'خاص (العيادة)' : 'Private (the clinic)'}</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-ink-body">
                      <InsurerBadge name={bookingPayer.name} size={14} /> {bookingPayer.name}
                    </span>
                  )}
                </p>
              )}
              {selectedPriceList && selectedPriceList.generalDiscountPercent > 0 && (
                <p className="mt-1 text-xs font-bold text-emerald-700">
                  {language === 'ar'
                    ? `القائمة دي عليها خصم ${selectedPriceList.generalDiscountPercent}% بيتحط عند التسجيل`
                    : `This list runs at ${selectedPriceList.generalDiscountPercent}% off, applied when the treatment is recorded`}
                </p>
              )}
            </div>
            {/* Service selector */}
            <div>
              <label className="text-xs font-black text-ink-muted uppercase tracking-wider block mb-1.5">
                {language === 'ar' ? 'الخدمة' : 'Service'}
              </label>
              <ServiceCombobox
                priceListId={effectiveListId}
                services={offeredServices}
                value={procServiceId}
                onChange={(val, svc) => {
                  setProcServiceId(val);
                  // The list's price, not the standard one. `resolveListPrice` falls back to
                  // `price` where the list has no entry, so this is right for every list.
                  if (svc) setProcCost(resolveListPrice(svc, effectiveListId));
                }}
                valueKey="id"
                placeholder={language === 'ar' ? 'اختر الخدمة...' : 'Select service...'}
                language={language}
                className="w-full text-sm font-bold border border-line rounded-lg bg-surface"
              />
            </div>
            {/* Cost */}
            <div>
              <label className="text-xs font-black text-ink-muted uppercase tracking-wider block mb-1.5">
                {language === 'ar' ? 'التكلفة' : 'Cost'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 start-0 ps-2.5 flex items-center pointer-events-none text-slate-400">
                  <DollarSign size={14}/>
                </div>
                <input
                  type="number"
                  value={procCost}
                  onChange={e => setProcCost(e.target.value ? Number(e.target.value) : "")}
                  className="w-full ps-8 pe-3 py-3 text-sm font-black text-slate-800 border border-line rounded-xl outline-none focus:ring-2 focus:ring-emerald-400 bg-surface"
                  placeholder="0"
                />
              </div>
            </div>
            {/* Add to ledger toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addProcToLedger}
                onChange={e => setAddProcToLedger(e.target.checked)}
                className="w-4 h-4 rounded border-line-strong text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-bold text-ink-body">
                {language === 'ar' ? 'إضافة للسجل المالي' : 'Add to Ledger'}
              </span>
            </label>
            {/* Confirm */}
            <button
              disabled={addingProcedure || !procServiceId || (!procCost && procCost !== 0)}
              onClick={async (e) => {
                e.preventDefault();
                const svc = servicesList.find(s => String(s.id) === String(procServiceId));
                if (!svc) { showToast(language === 'ar' ? 'اختر خدمة' : 'Select a service', 'error'); return; }
                const numCost = Number(procCost) || 0;
                
                setAddingProcedure(true);
                try {
                  const newProcedure = {
                    id: editingProcId || Date.now().toString(),
                    // The catalog entry this came from. Carried through to the ledger row so
                    // reports can group on a stable id instead of parsing the description.
                    serviceId: String(svc.id),
                    name: svc.name,
                    cost: numCost,
                    addToLedger: addProcToLedger,
                    // Recorded so the note and the ledger row can say which rate was quoted,
                    // rather than leaving a number nobody can trace back to a list.
                    priceListId: effectiveListId,
                  };
                  
                  showToast(
                    addProcToLedger
                      ? (language === 'ar' ? 'تمت إضافة الإجراء للسجل المالي والملاحظات' : 'Procedure added to ledger & notes')
                      : (language === 'ar' ? 'تمت إضافة الإجراء للملاحظات السريرية' : 'Procedure added to clinical notes'),
                    'success'
                  );
                  // Reset form but keep add procedure open
                  setProcServiceId("");
                  setProcCost("");
                  setAddProcToLedger(true);
                  if (editingProcId) {
                    setSessionProcedures(prev => prev.map(p => (p.id === editingProcId ? newProcedure : p)));
                    setEditingProcId(null);
                  } else {
                    setSessionProcedures(prev => [...prev, newProcedure]);
                  }
                } catch (err) {
                  console.error('Error adding procedure:', err);
                  showToast(language === 'ar' ? 'خطأ في إضافة الإجراء' : 'Error adding procedure', 'error');
                } finally {
                  setAddingProcedure(false);
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black py-3.5 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 w-full"
            >
              {addingProcedure ? <Loader2 size={16} className="animate-spin"/> : <Check size={16}/>}
              {editingProcId
                ? (language === 'ar' ? 'حفظ التعديل' : 'Update procedure')
                : (language === 'ar' ? 'تأكيد الإجراء' : 'Confirm Procedure')}
            </button>
          </div>
        </div>
      )}

      {sessionProcedures.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs font-black text-ink-muted uppercase tracking-wider block">
            {language === 'ar' ? 'الإجراءات المضافة' : 'Added Procedures'}
          </label>
          <div className="bg-surface rounded-xl border border-line divide-y divide-slate-100 overflow-hidden shadow-sm">
            {sessionProcedures.map((sp, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                  <span className="font-bold text-slate-700">{sp.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-black text-ink">{sp.cost} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                  {/* Back into the form above: change the service, list or price, then "Update procedure". */}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProcId(sp.id);
                      setShowAddProcedure(true);
                      if (sp.priceListId) setProcListId(sp.priceListId);
                      setProcServiceId(sp.serviceId || "");
                      setProcCost(sp.cost);
                      setAddProcToLedger(sp.addToLedger);
                    }}
                    title={language === 'ar' ? 'تعديل' : 'Edit'}
                    aria-label={language === 'ar' ? 'تعديل' : 'Edit'}
                    className={`p-1.5 rounded-lg border transition-colors ${editingProcId === sp.id ? 'border-ink text-ink bg-surface-muted' : 'border-line text-ink-body hover:border-ink hover:text-ink'}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button 
                    type="button"
                    title={language === 'ar' ? 'حذف' : 'Delete'}
                    aria-label={language === 'ar' ? 'حذف' : 'Delete'}
                    onClick={async () => {
                      if (await confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا الإجراء؟' : 'Are you sure you want to delete this procedure?')) {
                        setSessionProcedures(prev => prev.filter(p => p.id !== sp.id));
                        if (editingProcId === sp.id) setEditingProcId(null);
                        showToast(language === 'ar' ? 'تم الحذف بنجاح' : 'Deleted successfully', 'success');
                      }
                    }}
                    className="p-1.5 rounded-lg border border-danger/30 bg-danger-tint text-danger hover:border-danger transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
)
  );

  const content = (
      <div
        className={
          inlineDesktop && isDesktop
            ? `flex flex-col w-full h-full min-h-0 overflow-hidden rounded-[2rem] border border-white/60 bg-white/80 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-3xl transition-all duration-300 ${language === "ar" ? "text-right" : "text-left"}`
            : `flex max-h-[90vh] sm:max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[1.75rem] sm:rounded-b-[1.75rem] border-t sm:border border-slate-200/80 bg-surface shadow-2xl shadow-slate-300/40 ${language === "ar" ? "text-right" : "text-left"}`
        }
      >
        {inlineDesktop && isDesktop ? (
          <div className="shrink-0 px-5 py-4 flex items-center justify-between border-b border-white/40 bg-transparent">
            <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-teal-700 bg-teal-50 text-base shadow-sm border border-teal-100">
                  <Calendar size={20} />
                </div>
                <div>
                  <h2 className="font-extrabold text-slate-800 text-lg leading-tight">{editAppointment ? txt.editTitle : txt.title}</h2>
                  <p className="text-sm font-medium text-ink-muted mt-0.5 line-clamp-1">{txt.subtitle}</p>
                </div>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
          </div>
        ) : (
          <div className="shrink-0 border-b border-slate-100 bg-gradient-to-br from-primary-600 to-primary-800 px-6 py-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">
                  {language === "ar" ? "جدولة" : "Scheduling"}
                </p>
                <h3 className="mt-1 text-xl font-black tracking-tight">{editAppointment ? txt.editTitle : txt.title}</h3>
                <p className="mt-1 max-w-[280px] text-xs font-medium text-white/85">{txt.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        <div className={`custom-scrollbar flex-1 overflow-y-auto py-5 space-y-5 ${inlineDesktop && isDesktop ? "px-5" : "px-6"}`}>
          {patientSection}

          {selectedPatient && (
  <div className="border-t border-slate-100 bg-slate-50/50 p-6">
    {claimLinks.length > 1 ? (
      <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-xs font-bold text-ink-body">
        {language === "ar"
          ? `الزيارة دي مربوطة بـ ${claimLinks.length} خدمات من موافقات التأمين — غيّرها من النافذة المنبثقة.`
          : `This visit covers ${claimLinks.length} approved insurance services — change them in the pop-up booking window.`}
      </p>
    ) : (lineOptions.length > 0 || claimLink) && (
      <div className="mb-4">
        <label className="mb-2 block text-sm font-black uppercase tracking-wider text-indigo-900/40">
          {language === "ar" ? "خدمة موافقة التأمين" : "Approved insurance service"}
        </label>
        <select
          value={claimLink ? `${claimLink.claimId}|${claimLink.claimLine}` : ""}
          onChange={(e) => pickLine(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface py-3 px-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
        >
          <option value="">{language === "ar" ? "— زيارة عادية —" : "— none, a private visit —"}</option>
          {lineOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
          {language === "ar"
            ? "لما الزيارة تتعلّم خلصت، الخدمة دي بتتعلّم خلصت على الموافقة."
            : "When this visit is marked done, the service is marked completed on the approval."}
        </p>
      </div>
    )}
    <label className="mb-2 block text-sm font-black uppercase tracking-wider text-indigo-900/40">
      {language === "ar" ? "السبب الرئيسي للزيارة" : "Primary Reason for Visit"}
    </label>
    <div className="relative group">
      <ClipboardList size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary-500 pointer-events-none" />
      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <select
        value={treatment}
        onChange={(e) => setTreatment(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-10 text-sm font-bold text-slate-700 outline-none transition-all focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 appearance-none"
      >
        <option value="" disabled>{language === "ar" ? "اختر سبب الزيارة" : "Select Reason for Visit"}</option>
        {reasonOptions.map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </div>
  </div>
)}

{addProcedureSection}


          <SlotPicker
            language={language}
            txt={txt}
            date={date}
            setDate={setDate}
            time={time}
            setTime={setTime}
            availableTimes={availableTimes}
            displayTime={displayTime}
            doctor={doctor}
            setDoctor={setDoctor}
            doctors={doctors}
            branches={branches}
            branchId={branchId}
            setBranchId={(id: string) => {
              setBranchId(id);
              setRoomId("");
            }}
            roomId={roomId}
            setRoomId={setRoomId}
            duration={duration}
            setDuration={setDuration}
            durationOptions={durationOptions}
            appointmentStatus={appointmentStatus}
            setAppointmentStatus={setAppointmentStatus}
            visitNotes={visitNotes}
            setVisitNotes={setVisitNotes}
            getLocalDate={getLocalDate}
          />
        </div>

        <div className="flex shrink-0 gap-3 border-t border-slate-100 bg-slate-50/90 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
          {editAppointment && onDelete && (
            <Protect permission="appointments.delete">
              <button
                type="button"
                onClick={async () => {
                  if (await confirm(language === "ar" ? "هل أنت متأكد من حذف هذا الموعد؟" : "Are you sure you want to delete this appointment?")) {
                    onDelete(editAppointment.id);
                  }
                }}
                className="flex-1 rounded-xl border border-rose-200 bg-rose-50 py-3.5 text-xs font-black uppercase tracking-wide text-rose-600 transition hover:bg-rose-100"
              >
                {language === "ar" ? "حذف" : "Delete"}
              </button>
            </Protect>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${autosaveOn ? "flex-1" : "flex-1"} rounded-xl border border-line bg-surface py-3.5 text-xs font-black uppercase tracking-wide text-ink-body transition hover:bg-surface-muted`}
          >
            {autosaveOn ? txt.done : txt.cancel}
          </button>
          {/*
            With autosave on there is nothing left for a Save button to do, so the space carries the
            receipt instead. A booking being CREATED keeps its button: that press is the moment the
            clinic commits, and it is the press that tells the patient.
          */}
          {autosaveOn ? (
            <div className="flex-[2] flex items-center justify-center">
              <BookingAutosaveChip state={autosaveState} isAr={language === "ar"} />
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSubmit} data-tour="booking-confirm"
              disabled={isChecking || blockingReasons.length > 0}
              className="flex-[2] flex items-center justify-center gap-2 rounded-xl bg-primary-600 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-primary-200 transition hover:bg-primary-700 disabled:opacity-50"
            >
              {isChecking ? <Loader2 size={16} className="animate-spin" /> : editAppointment ? txt.saveEdit : txt.confirm}
            </button>
          )}
        </div>

        {/*
          Why the button is grey, said out loud.

          A disabled button with no explanation is unfixable by the person looking at it, and this
          one was worse than most: the fields it objects to are dropdowns, which display their
          first option when their value is empty, so the form could look complete while the button
          refused. Naming the missing field turns "the system is broken" into one obvious tap.
        */}
        {blockingReasons.length > 0 && !isChecking && (
          <p className="px-1 pb-1 text-center text-xs font-bold text-amber-700">
            {txt.stillNeeded} {blockingReasons.join(language === "ar" ? "، " : ", ")}
          </p>
        )}
      </div>
  );

  /** The wide popup: header band with the patient and the tabs, timeline left, tab content right. */
  function renderWide() {
    const isAr = language === "ar";
    const patientName = isNewPatient ? newPatientName.trim() : selectedPatient?.name || "";
    const initials = patientName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    const card = patientCard && patientCard.id === headerPatientId ? patientCard : null;
    const durationLabel = durationOptions.find((o) => o.value === duration)?.label || `${duration}`;
    const doctorLabel = isGeneralDoctorValue(doctor) ? generalDoctorLabel(language) : doctor;
    const startMin = time ? parseApptTimeToMinutes(time) : null;
    const tabs: { id: WideTab; label: string; count?: number }[] = [
      { id: "appointment", label: isAr ? "الموعد" : "Appointment" },
      { id: "service", label: isAr ? "الخدمة" : "Service", count: editAppointment ? undefined : sessionProcedures.length || undefined },
      { id: "payment", label: isAr ? "الدفع" : "Payment" },
      { id: "insurance", label: isAr ? "التأمين" : "Insurance", count: lineOptions.length || undefined },
    ];
    const visitTitle = editAppointment
      ? isAr
        ? `تعديل زيارة ${formatDayLabel(editAppointment.date || date, true)}`
        : `Editing the ${formatDayLabel(editAppointment.date || date, false)} visit`
      : isAr
        ? "حجز زيارة جديدة"
        : "Booking a new visit";
    const panelHead = (title: string, withStatus: boolean) => (
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="font-figure text-[19px] font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-[13px] text-ink-muted">{visitTitle}</p>
        </div>
        {withStatus && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">{isAr ? "الحالة" : "Status"}</span>
            <AppointmentStagePicker value={appointmentStatus} onChange={setAppointmentStatus} language={isAr ? "ar" : "en"} isolateClicks={false} compact />
          </div>
        )}
      </div>
    );
    const fieldRow = "grid grid-cols-1 gap-2 border-t border-line py-4 xl:grid-cols-[132px_minmax(0,1fr)] xl:gap-4";
    const fieldLabel = "pt-2 text-[13px] font-semibold text-ink-muted";
    const input = "w-full rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink";
    // A booking not yet confirmed has no charges in the books: show what it WILL charge, from the
    // Service tab, so adding a treatment there shows up here at once.
    const stagedTotal = sessionProcedures.filter((p) => p.addToLedger).reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
    const needsVisitFirst = (
      <div className="mt-3 space-y-3">
        <div className="rounded-2xl border border-line px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-muted">{isAr ? "هيتحسب على الزيارة" : "To be charged for this visit"}</p>
          <p className="mt-1 font-figure text-4xl font-semibold tabular-nums text-ink">
            {stagedTotal.toLocaleString("en-US")}
            <span className="ms-1 text-base font-medium text-ink-muted">{isAr ? "ج.م" : "EGP"}</span>
          </p>
        </div>
        {sessionProcedures.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {sessionProcedures.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 truncate font-semibold text-ink">
                  {p.name}
                  {!p.addToLedger && <span className="ms-2 text-xs font-normal text-ink-muted">{isAr ? "(من غير حساب)" : "(not charged)"}</span>}
                </span>
                <span className="shrink-0 font-figure font-semibold tabular-nums text-ink">{Number(p.cost).toLocaleString("en-US")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-sm text-ink-muted">
            {isAr ? "مفيش خدمات لسه. ضيفها من تبويب الخدمة." : "No treatments yet. Add them on the Service tab."}
          </p>
        )}
        <p className="text-xs text-ink-muted">
          {isAr
            ? "الخدمات دي بتتسجل لما تدوس تأكيد الحجز، وبعدها تقدر تحصّل الفلوس من هنا."
            : "These are recorded when you press Confirm booking; after that, the payment is taken here."}
        </p>
      </div>
    );

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editAppointment ? txt.editTitle : txt.title}
        // The popup is portalled to <body>, outside any page that sets the direction, so it sets its own.
        dir={isAr ? "rtl" : "ltr"}
        className={`flex h-[min(900px,calc(100vh-2rem))] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] bg-surface shadow-2xl ring-1 ring-line ${isAr ? "text-right" : "text-left"}`}
      >
        {/* Header band: who, then the tabs sitting on its bottom edge like folder tabs */}
        <div className="grid shrink-0 grid-cols-[276px_minmax(0,1fr)_auto] items-end bg-ink-slab ps-6 pe-5 pt-5 text-white">
          <div className="flex min-w-0 items-center gap-3.5 pb-5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 font-figure text-base font-semibold" aria-hidden="true">
              {initials || <User size={20} className="text-white/70" />}
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-figure text-xl font-semibold leading-tight">
                {patientName || (editAppointment ? "" : isAr ? "مريض جديد" : "New booking")}
              </h2>
              {card?.fileId && (
                <p className="text-[12.5px] text-white/60">
                  {isAr ? "رقم الملف" : "File no."} <b className="font-figure font-semibold text-white">{card.fileId}</b>
                </p>
              )}
              {(card?.phone || (isNewPatient && newPatientPhone)) && (
                <p className="text-[12.5px] text-white/60" dir="ltr">
                  {isAr ? "" : "Phone "}
                  <b className="font-figure font-semibold text-white">{card?.phone || `${newPatientCountryCode} ${newPatientPhone}`}</b>
                </p>
              )}
              {!patientName && !editAppointment && (
                <p className="text-[12.5px] text-white/60">{isAr ? "اختار المريض تحت" : "Pick the patient below"}</p>
              )}
            </div>
          </div>
          <div className="flex gap-0.5 overflow-x-auto ps-2.5" role="tablist" aria-label={isAr ? "أقسام الزيارة" : "Visit sections"}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={wideTab === t.id}
                onClick={() => setWideTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-t-2xl px-[18px] pt-3 pb-[13px] text-sm font-semibold transition-colors ${
                  wideTab === t.id ? "bg-surface text-ink" : "text-white/60 hover:text-white"
                }`}
              >
                {t.label}
                {t.count ? (
                  <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-ink-on-accent">{t.count}</span>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isAr ? "إغلاق" : "Close"}
            className="mb-auto grid h-9 w-9 place-items-center rounded-full border border-white/15 text-white/60 transition-colors hover:border-white/40 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-e border-line bg-surface-subtle px-6 pt-5 pb-3" aria-label={isAr ? "سجل الزيارات" : "Patient timeline"}>
            <PatientTimeline
              patientId={headerPatientId}
              activeId={editAppointment?.id ?? null}
              language={language}
              canBookAnother={!!headerPatientId}
              onPick={(a: TimelineAppointment) => void switchVisit({ kind: "edit", appt: a as unknown as BookingEditSnapshot })}
              onNew={() => selectedPatient && void switchVisit({ kind: "new", patient: { id: String(selectedPatient.id), name: selectedPatient.name } })}
            />
          </aside>

          <div className="custom-scrollbar min-h-0 overflow-y-auto px-7 pt-6 pb-8" role="tabpanel">
            {wideTab === "appointment" && (
              <>
                {panelHead(isAr ? "الموعد" : "Appointment", true)}
                {!editAppointment && <div className="border-t border-line py-4">{patientSection}</div>}
                {claimLink && (
                  <button
                    type="button"
                    onClick={() => setWideTab("insurance")}
                    className="mb-2 flex w-full items-center gap-2 rounded-xl bg-accent-tint px-3 py-2 text-start text-xs font-semibold text-accent-ink"
                  >
                    {claimLinks.length > 1
                      ? isAr
                        ? `الزيارة دي مربوطة بـ ${claimLinks.length} خدمات من موافقات التأمين`
                        : `This visit covers ${claimLinks.length} approved insurance services`
                      : isAr
                        ? "الزيارة دي مربوطة بخدمة من موافقة تأمين"
                        : "This visit is booked against an insurance approval"}
                    {claimLinks.length === 1 && treatment ? ` · ${treatment}` : ""}
                  </button>
                )}
                <AvailabilityPicker
                  language={language}
                  sched={sched}
                  date={date}
                  setDate={setDate}
                  time={time}
                  setTime={setTime}
                  duration={duration}
                  setDuration={setDuration}
                  durationOptions={durationOptions}
                  doctor={doctor}
                  setDoctor={setDoctor}
                  doctors={doctors}
                  excludeAppointmentId={editAppointment?.id ?? null}
                  branches={branches}
                  branchId={branchId}
                  setBranchId={(id) => {
                    setBranchId(id);
                    setRoomId("");
                  }}
                  roomId={roomId}
                  setRoomId={setRoomId}
                />
                <div className={fieldRow}>
                  <label className={fieldLabel} htmlFor="booking-reason">
                    {isAr ? "سبب الزيارة" : "Reason"}
                  </label>
                  <select id="booking-reason" value={treatment} onChange={(e) => setTreatment(e.target.value)} className={`${input} max-w-sm`}>
                    <option value="">{isAr ? "اختار سبب الزيارة" : "Select reason for visit"}</option>
                    {reasonOptions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={fieldRow}>
                  <label className={fieldLabel} htmlFor="booking-notes">
                    {txt.notesLabel}
                  </label>
                  <textarea
                    id="booking-notes"
                    value={visitNotes}
                    onChange={(e) => setVisitNotes(e.target.value)}
                    rows={2}
                    className={`${input} max-w-xl resize-none`}
                  />
                </div>
              </>
            )}

            {wideTab === "service" && (
              <>
                {panelHead(isAr ? "الخدمة" : "Service", false)}
                {editAppointment ? (
                  <AppointmentMoneyTab key={`svc-${editAppointment.id}`} appointment={editAppointment} section="service" doctorsList={doctors} servicesList={servicesList} />
                ) : servicesList.length > 0 ? (
                  <div className="-mx-6 [&>div]:border-t-0">{addProcedureSection}</div>
                ) : (
                  <p className="mt-3 text-sm text-ink-muted">{txt.noServices}</p>
                )}
              </>
            )}

            {wideTab === "payment" && (
              <>
                {panelHead(isAr ? "الدفع" : "Payment", false)}
                {claimsLoaded && <InsuranceShareDue claims={patientClaims.claims} language={language} />}
                {editAppointment ? (
                  <AppointmentMoneyTab key={`pay-${editAppointment.id}`} appointment={editAppointment} section="payment" doctorsList={doctors} servicesList={servicesList} />
                ) : (
                  needsVisitFirst
                )}
              </>
            )}

            {wideTab === "insurance" && (
              <>
                {panelHead(isAr ? "التأمين" : "Insurance", false)}
                {headerPatientId ? (
                  <>
                    <InsuranceApprovals language={language} loaded={claimsLoaded} claims={patientClaims.claims} claimLinks={claimLinks} onToggle={toggleLine} />
                    <ApprovalUploadPanel patientId={headerPatientId} patientName={selectedPatient?.name || ""} language={language} />
                  </>
                ) : (
                  <p className="mt-3 text-sm text-ink-muted">{isAr ? "اختار مريض مسجل الأول." : "Pick a saved patient first."}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer: what will be saved, and the buttons */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-line bg-surface px-6 py-4">
          <div className="min-w-0">
            <p className="font-figure text-[15px] font-semibold tabular-nums text-ink">
              {date && startMin !== null
                ? `${formatDayLabel(date, isAr)} · ${formatTimeLabel(time, isAr)} – ${formatTimeLabel(minutesToTimeKey(startMin + Number(duration)), isAr)}`
                : isAr
                  ? "لسه مفيش ميعاد"
                  : "No time picked yet"}
            </p>
            <p className="text-[13px] text-ink-muted">
              {doctorLabel} · {durationLabel} · {getAppointmentStageLabel(appointmentStatus, isAr ? "ar" : "en")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {blockingReasons.length > 0 && !isChecking && (
              <span className="text-xs font-semibold text-ink-muted">
                {txt.stillNeeded} {blockingReasons.join(isAr ? "، " : ", ")}
              </span>
            )}
            {editAppointment && onDelete && (
              <Protect permission="appointments.delete">
                <button
                  type="button"
                  onClick={async () => {
                    if (await confirm(isAr ? "هل أنت متأكد من حذف هذا الموعد؟" : "Are you sure you want to delete this appointment?")) {
                      onDelete(editAppointment.id);
                    }
                  }}
                  className="rounded-xl px-3 py-2.5 text-sm font-semibold text-danger hover:bg-danger-tint"
                >
                  {isAr ? "حذف" : "Delete"}
                </button>
              </Protect>
            )}
            <button type="button" onClick={onClose} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-muted hover:text-ink">
              {autosaveOn ? txt.done : txt.cancel}
            </button>
            {autosaveOn ? (
              <BookingAutosaveChip state={autosaveState} isAr={isAr} />
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                data-tour="booking-confirm"
                disabled={isChecking || blockingReasons.length > 0}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-ink-on-accent transition-colors hover:bg-accent-strong disabled:opacity-40"
              >
                {isChecking && <Loader2 size={16} className="animate-spin" />}
                {editAppointment ? txt.saveEdit : txt.confirm}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (wideLayout) {
    if (!portalTarget) return null;
    return createPortal(
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-md animate-in fade-in">
        {renderWide()}
      </div>,
      portalTarget
    );
  }

  if (inlineDesktop && isDesktop) {
    return content;
  }

  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/55 p-0 sm:p-4 pb-[env(safe-area-inset-bottom,0px)] sm:pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-md animate-in fade-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0">
      {content}
    </div>,
    portalTarget
  );
}

/**
 * The receipt where the Save button used to be, for an appointment that is autosaving.
 *
 * Same vocabulary as the appointment side panel's chip, so the two panels that swap places in the
 * same column do not describe the same event in two different ways.
 */
function BookingAutosaveChip({ state, isAr }: { state: "idle" | "pending" | "saving" | "saved" | "error"; isAr: boolean }) {
  if (state === "idle") {
    return <span className="text-xs font-bold text-ink-faint">{isAr ? "بيتحفظ لوحده" : "Saves by itself"}</span>;
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-danger">
        <CloudOff size={14} /> {isAr ? "مش متحفظ" : "Not saved"}
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ok animate-in fade-in duration-200">
        <Check size={14} /> {isAr ? "اتحفظ" : "Saved"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-faint">
      <Loader2 size={14} className={state === "saving" ? "animate-spin" : "opacity-60"} /> {isAr ? "بيتحفظ…" : "Saving…"}
    </span>
  );
}
