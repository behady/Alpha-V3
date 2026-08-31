"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ServiceCombobox from "./shared/ServiceCombobox";
import { usePricingPolicy } from "@/lib/usePricingPolicy";
import { listsForBranch, resolveActiveListId } from "@/lib/priceLists";
import { resolveListPrice } from "@/lib/discountMath";
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
} from "lucide-react";
import {
  DEFAULT_COUNTRY_CODE,
  COUNTRY_CODE_OPTIONS,
  buildE164FromCountryCode,
} from "@/lib/phoneNumber";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
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
import PatientPicker from "./appointments/booking/PatientPicker";

import SlotPicker from "./appointments/booking/SlotPicker";

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
  sessionProcedures?: { id?: string; serviceId?: string | null; name: string; cost: number; addToLedger: boolean }[];
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
}

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
  patients,
  doctors,
  onDelete,
  preSelectedDate,
  preSelectedTime,
  preSelectedDoctor,
  settingsConfig,
  editAppointment = null,
  preSelectedPatient = null,
  inlineDesktop = false,
  servicesList = [],
  preSelectedBranchId = "",
}: Props) {
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();

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
  const [sessionProcedures, setSessionProcedures] = useState<{ id: string; serviceId: string | null; name: string; cost: number; addToLedger: boolean; priceListId?: string | null }[]>([]);

  /**
   * Which price list the desk is booking against.
   *
   * Booking read `service.price` and nothing else, so a clinic could set up an insurer list in
   * Settings and still have reception quote the walk-in rate — the lists existed but only the
   * chair ever saw them. Reception is where a patient's rate is usually known ("she's on the
   * family list"), so the choice belongs here too.
   */
  const { priceLists } = usePricingPolicy();
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
      setDoctor(editAppointment.doctor || (doctors.length > 0 ? doctors[0].name : ""));
      setBranchId(editAppointment.branchId || "");
      setRoomId(editAppointment.roomId || "");
      setDate(editAppointment.date || getLocalDate());
      setTime(editAppointment.time || "");
      setDuration(editAppointment.duration || sched.slotDuration);
      setTreatment(editAppointment.treatment || "");
      setVisitNotes(editAppointment.notes || "");
      setAppointmentStatus(editAppointment.status || "Scheduled");
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
    }
  }, [isOpen, editAppointment, doctors, sched.slotDuration, preSelectedDoctor, preSelectedPatient, preSelectedDate, preSelectedTime]);

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
      const resolvedDoctorId = doctors.find((d) => d.name === doctor)?.id || editAppointment?.doctorId || null;

      const hasConflict =
        findDoctorConflicts(dayAppointments, {
          time,
          duration: Number(duration),
          doctorId: resolvedDoctorId,
          doctorName: doctor,
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

      await onSave({
        patientId: isNewPatient ? "NEW_PATIENT" : String(selectedPatient?.id),
        patientName: isNewPatient ? newPatientName.trim() : (selectedPatient?.name || ""),
        isNewPatient,
        newPatientPhone: isNewPatient ? buildE164FromCountryCode(newPatientCountryCode, newPatientPhone) : undefined,
        newPatientDob: isNewPatient ? newPatientDob : undefined,
        newPatientAddress: isNewPatient ? newPatientAddress.trim() : undefined,
        newPatientSource: isNewPatient ? newPatientSource : undefined,
        newPatientGender: isNewPatient ? newPatientGender : undefined,
        treatment: treatment.trim(),
        doctor,
        // Resolved from the same list the picker renders, so reports can group on a stable id
        // instead of a display string.
        doctorId: doctors.find((d) => d.name === doctor)?.id || editAppointment?.doctorId || null,
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
        newProcedureName: null,
        listPrice: editAppointment ? (editAppointment.listPrice || 0) : 0,
        discountMode: "none",
        discountPercent: null,
        discountFixed: null,
        discountAmount: editAppointment ? (editAppointment.discountAmount || 0) : 0,
        sessionProcedures,
        discountDistribution: "total" as any,

        existingAppointmentId: editAppointment?.id ?? null,
        status: appointmentStatus,
      });
    } catch (error) {
      console.error(error);
      showToast(txt.error, "error");
    } finally {
      setIsChecking(false);
    }
  };

  if (!isOpen) return null;

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
            <p className="rounded-2xl border border-dashed border-line bg-slate-50/90 px-4 py-3 text-[11px] font-semibold leading-relaxed text-ink-body">
              {txt.pickPatientForBilling}
            </p>
          )}

          {selectedPatient && (
  <div className="border-t border-slate-100 bg-slate-50/50 p-6">
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
        {visitReasonsOptions.map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </div>
  </div>
)}

{/* Add Procedure Section */}
{servicesList.length > 0 && (
  <div className="border-t border-slate-100 bg-slate-50/50 p-6 pt-0">
    <div className="mt-2">
      <button
        onClick={(e) => {
          e.preventDefault();
          setShowAddProcedure(prev => !prev);
        }}
        className={`w-full text-xs font-bold rounded-xl py-2.5 flex items-center justify-center gap-1.5 transition-colors shadow-sm ${
          showAddProcedure
            ? 'text-ink-body bg-surface-muted border border-line hover:bg-slate-200'
            : 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
        }`}
      >
        <Sparkles size={14} className={!showAddProcedure ? 'text-emerald-600' : ''}/> {showAddProcedure ? (language === 'ar' ? 'إلغاء' : 'Cancel') : (language === 'ar' ? 'إضافة إجراء' : 'Add Procedure')}
      </button>

      {showAddProcedure && (
        <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100 mt-2 animate-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col gap-3">
            {/* Price list. Shown above the service, because which list you are on decides what
                the service costs — answering it afterwards would mean repricing what was picked. */}
            <div>
              <label className="text-[10px] font-extrabold text-ink-muted uppercase tracking-wider block mb-1">
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
                  className="w-full px-3 py-2 text-sm font-bold text-slate-700 border border-line rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 bg-surface"
                >
                  {activePriceLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {language === 'ar' && list.nameAr ? list.nameAr : list.name}
                      {list.generalDiscountPercent > 0 ? ` — ${list.generalDiscountPercent}%` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="w-full px-3 py-2 text-sm font-bold text-ink-body border border-line rounded-lg bg-surface">
                  {selectedPriceList
                    ? (language === 'ar' && selectedPriceList.nameAr ? selectedPriceList.nameAr : selectedPriceList.name)
                    : (language === 'ar' ? 'الأساسي' : 'Standard')}
                </p>
              )}
              {selectedPriceList && selectedPriceList.generalDiscountPercent > 0 && (
                <p className="mt-1 text-[10px] font-bold text-emerald-700">
                  {language === 'ar'
                    ? `القائمة دي عليها خصم ${selectedPriceList.generalDiscountPercent}% بيتحط عند التسجيل`
                    : `This list runs at ${selectedPriceList.generalDiscountPercent}% off, applied when the treatment is recorded`}
                </p>
              )}
            </div>
            {/* Service selector */}
            <div>
              <label className="text-[10px] font-extrabold text-ink-muted uppercase tracking-wider block mb-1">
                {language === 'ar' ? 'الخدمة' : 'Service'}
              </label>
              <ServiceCombobox
                services={servicesList}
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
              <label className="text-[10px] font-extrabold text-ink-muted uppercase tracking-wider block mb-1">
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
                  className="w-full ps-8 pe-3 py-2 text-sm font-black text-slate-800 border border-line rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 bg-surface"
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
              <span className="text-xs font-bold text-ink-body">
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
                    id: Date.now().toString(),
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
                  setSessionProcedures(prev => [...prev, newProcedure]);
                } catch (err) {
                  console.error('Error adding procedure:', err);
                  showToast(language === 'ar' ? 'خطأ في إضافة الإجراء' : 'Error adding procedure', 'error');
                } finally {
                  setAddingProcedure(false);
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-[38px] px-4 rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 w-full"
            >
              {addingProcedure ? <Loader2 size={16} className="animate-spin"/> : <Check size={16}/>}
              {language === 'ar' ? 'تأكيد الإجراء' : 'Confirm Procedure'}
            </button>
          </div>
        </div>
      )}

      {sessionProcedures.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-[10px] font-extrabold text-ink-muted uppercase tracking-wider block">
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
                  <button 
                    onClick={async () => {
                      if (await confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا الإجراء؟' : 'Are you sure you want to delete this procedure?')) {
                        setSessionProcedures(prev => prev.filter(p => p.id !== sp.id));
                        showToast(language === 'ar' ? 'تم الحذف بنجاح' : 'Deleted successfully', 'success');
                      }
                    }}
                    className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors"
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
)}

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
            className="flex-1 rounded-xl border border-line bg-surface py-3.5 text-xs font-black uppercase tracking-wide text-ink-body transition hover:bg-surface-muted"
          >
            {txt.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit} data-tour="booking-confirm"
            disabled={isChecking || blockingReasons.length > 0}
            className="flex-[2] flex items-center justify-center gap-2 rounded-xl bg-primary-600 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-primary-200 transition hover:bg-primary-700 disabled:opacity-50"
          >
            {isChecking ? <Loader2 size={16} className="animate-spin" /> : editAppointment ? txt.saveEdit : txt.confirm}
          </button>
        </div>

        {/*
          Why the button is grey, said out loud.

          A disabled button with no explanation is unfixable by the person looking at it, and this
          one was worse than most: the fields it objects to are dropdowns, which display their
          first option when their value is empty, so the form could look complete while the button
          refused. Naming the missing field turns "the system is broken" into one obvious tap.
        */}
        {blockingReasons.length > 0 && !isChecking && (
          <p className="px-1 pb-1 text-center text-[11px] font-bold text-amber-700">
            {txt.stillNeeded} {blockingReasons.join(language === "ar" ? "، " : ", ")}
          </p>
        )}
      </div>
  );

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
