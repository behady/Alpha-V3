"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Calendar, Plus, ChevronRight, ChevronLeft, Wallet, User, Clock, Check,
  Loader2, Edit, Printer, UserX, MessageCircle, Pill, Receipt,
  X, Save, Trash2, ChevronDown, Bell, UserPlus, AlertCircle, ScanLine
} from "lucide-react";
import ApprovalReadSheet from "@/components/insurance/ApprovalReadSheet";
import { useClinic } from "@/context/ClinicContext";
import { holdsPermission } from "@/lib/permissions";
import { isAnyUnlocked } from "@/lib/featureCatalog";
import { db, auth } from "@/lib/firebase";
import {
  collection, query, where, getDocs, orderBy,
  doc, updateDoc, deleteDoc, onSnapshot, limit, addDoc, serverTimestamp, getDoc, arrayUnion
} from "firebase/firestore";
import PatientHistoryDrawer from "@/components/appointments/PatientHistoryDrawer";
import StarRating from "@/components/StarRating";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import BookingModal, { type BookingEditSnapshot } from "@/components/BookingModal";
import {
  parseApptTimeToMinutes,
  normalizeDateKey,
  saveBooking,
  normalizeTimeKey,
} from "@/lib/bookingService";
import NewPatientModal from "@/components/NewPatientModal";
import AppointmentStagePicker from "@/components/appointments/AppointmentStagePicker";
import PrescriptionPrintFinderModal from "@/components/PrescriptionPrintFinderModal";
import WaitingMoodPicker from "@/components/appointments/WaitingMoodPicker";
import DeleteAppointmentDialog from "@/components/appointments/DeleteAppointmentDialog";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import ServiceEditorDrawer from "@/components/clinical-notes/ServiceEditorDrawer";
import { logActivity } from "@/lib/logger";
import { MoneyApiError, deleteAppointment } from "@/lib/moneyApi";
import { isDentistStaff } from "@/lib/staffRoles";
import { parseClinicSchedule, clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { rowInScope } from "@/lib/branchAccess";
import { useActiveBranch } from "@/lib/useActiveBranch";
import BranchSelector from "@/components/shared/BranchSelector";
import type { OwnerAlertKey } from "@/types/whatsapp";
import type { ClaimLink } from "@/lib/insurance/appointments";
import { sendPatientAppointmentWhatsApp } from "@/lib/sendPatientAppointmentWhatsAppClient";
import { prescriptionPayloadToPdfBlob } from "@/lib/prescriptionPdfHtml";
import {
  buildPrescriptionPayloadFromRecord,
  normalizeRxItemsFromRecord,
  openPrescriptionPdf,
  prescriptionCreatedMs,
} from "@/lib/prescriptionRecord";
import { printPatientReceipt } from "@/lib/printPatientReceipt";

import { getAppointmentStatusStyles, getAppointmentStageLabel } from "@/lib/appointmentStages";
import UserClockWidget from "@/components/dashboard/UserClockWidget";
import { currentClinicId, getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { syncClaimLineFromAppointment } from "@/lib/insurance/appointmentSync";
import PageHeader, { headerButtonPrimary, headerButtonGhost } from "@/components/dashboard/PageHeader";
import HomeViewTabs from "@/components/dashboard/HomeViewTabs";
import { weekDaysFrom, daySummary, isOffDay } from "@/lib/weekSchedule";
import { NO_DOCTOR, NO_ROOM, doctorColumns, roomColumns } from "@/lib/roomSchedule";
import { generalDoctorLabel } from "@/lib/generalDentist";

/**
 * How the phone draws its calendar. The desk's switch (Timeline / Week / Rooms / Doctors / List)
 * folded to what a phone can show: Day is the card list, Week a seven-day agenda of the same
 * cards, Dentists and Rooms the day grouped into sections instead of side-by-side columns.
 */
type PhoneView = "day" | "week" | "dentists" | "rooms";

function getLocalDateKey(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
}

function getWelcomeName(name?: string): string {
  if (!name) return "";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length > 1) {
    const firstLower = parts[0].toLowerCase().replace(/\.$/, ""); // remove trailing dot
    if (["dr", "د", "دكتور", "doctor", "prof", "أستاذ", "استاذ"].includes(firstLower)) {
      return `${parts[0]} ${parts[1]}`;
    }
  }
  return parts[0] || "";
}

function getEndTimeStr(timeStr: string, durationMin: number): string {
  try {
    const [timePart, ampm] = timeStr.split(" ");
    let [hours, minutes] = timePart.split(":").map(Number);
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    date.setMinutes(date.getMinutes() + durationMin);

    let endHours = date.getHours();
    const endMinutes = date.getMinutes();
    const endAmpm = endHours >= 12 ? "PM" : "AM";
    endHours = endHours % 12 || 12;

    return `${endHours.toString().padStart(2, "0")}:${endMinutes.toString().padStart(2, "0")} ${endAmpm}`;
  } catch {
    return timeStr;
  }
}



type DashboardAppointment = {
  id: string;
  patientId?: string;
  patientName?: string;
  treatment?: string;
  doctor?: string;
  date?: string;
  time?: string;
  duration?: number;
  status?: string;
  waitingMood?: string | null;
  clinicalNoteId?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  cost?: number;
  listPrice?: number;
  discountMode?: string;
  discountPercent?: number;
  discountFixed?: number;
  discountAmount?: number;
  notes?: string;
};

/**
 * What the booking popup needs from a schedule card — the desk dashboard's builder, field for field.
 * The popup saves what it was given, so leaving out the dentist id, branch, room or insurance link
 * here would quietly clear them on the next save.
 */
function editSnapshotOf(apt: DashboardAppointment): BookingEditSnapshot {
  const raw = apt as DashboardAppointment & {
    doctorId?: string | null;
    branchId?: string | null;
    roomId?: string | null;
    claimId?: string | null;
    claimLine?: number | null;
    claimLinks?: unknown;
  };
  return {
    id: apt.id, patientId: String(apt.patientId), patientName: apt.patientName!,
    treatment: apt.treatment!, doctor: apt.doctor!, doctorId: raw.doctorId ?? null, date: apt.date!,
    time: apt.time!, duration: apt.duration!, clinicalNoteId: apt.clinicalNoteId ?? null,
    branchId: raw.branchId ?? null, roomId: raw.roomId ?? null,
    claimId: raw.claimId ?? null, claimLine: raw.claimLine ?? null, claimLinks: raw.claimLinks,
    cost: apt.cost!,
    listPrice: apt.listPrice ?? undefined, discountMode: apt.discountMode ?? undefined,
    discountPercent: apt.discountPercent ?? undefined, discountFixed: apt.discountFixed ?? undefined,
    discountAmount: apt.discountAmount ?? undefined, notes: apt.notes!, status: apt.status || "Scheduled",
  };
}

function DashboardClockWidget({ language, showTime = true }: { language: string, showTime?: boolean }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    // Update once a minute since we don't display seconds
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (!showTime) {
    return (
      <>{time.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })}</>
    );
  }

  return (
    <>
      <span className="flex items-center gap-1.5"><Calendar size={14} className="text-slate-400" /> {time.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <span className="w-1 h-1 rounded-full bg-slate-300"></span>
      <span className="flex items-center gap-1.5"><Clock size={14} className="text-slate-400" /> {time.toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
    </>
  );
}

export default function MobileDashboard() {
  const { language, isRTL, t } = useLanguage();
  const { clinic, role, isAdmin } = useClinic();
  /** "Read an approval" sits where Quick Pay was; it needs the insurance add-on. */
  const insuranceOn = !!clinic && isAnyUnlocked(clinic, "insurance");
  const [readApproval, setReadApproval] = useState(false);
  const { user } = useAuth();
  // A dentist reaches this calendar from their menu now (it is the only calendar). The clinic's
  // takings for the day are not theirs to read unless they hold the finance permission.
  const hideIncome = role === "Dentist" && !(isAdmin || holdsPermission(role, user?.permissions, "access.finance"));
  const { showToast } = useUI();
  const router = useRouter();

  const [allAppointments, setAllAppointments] = useState<any[]>([]);
  // The same working branch the desktop dashboard uses — one answer to "where am I today?",
  // remembered per clinic, so a phone and a desktop signed in as the same person agree.
  const {
    branches,
    allowedBranches,
    canChooseAll,
    activeBranchId,
    setActiveBranchId,
    scopeBranchId,
    matches: branchMatches,
  } = useActiveBranch();
  const [loading, setLoading] = useState(true);

  const [patientsList, setPatientsList] = useState<any[]>([]);
  const [doctorsList, setDoctorsList] = useState<any[]>([]);
  const [servicesList, setServicesList] = useState<any[]>([]); // NEW: Added services state


  // Modal State
  const [activeModal, setActiveModal] = useState<'patient' | 'booking' | null>(null);
  const [pendingCheckoutPayload, setPendingCheckoutPayload] = useState<any | null>(null);
  /** The booking popup in Quick Pay mode: one patient's whole account, no visit (its "Pay on account"). */
  const [quickPayMode, setQuickPayMode] = useState(false);
  const [preSelectedTime, setPreSelectedTime] = useState<string>("");
  const [preSelectedPatient, setPreSelectedPatient] = useState<{ id: string; name: string } | null>(null);
  const [preSelectedDoctor, setPreSelectedDoctor] = useState<string>("");
  /** The approved service a "book this patient" link asked for, and the popup tab it opens on. */
  const [preSelectedClaimLine, setPreSelectedClaimLine] = useState<ClaimLink | null>(null);
  const [bookingTab, setBookingTab] = useState<"appointment" | "service" | "payment" | "insurance">("appointment");
  // ?book=<patientId>[&claim=<claimId>&line=<n>] — the Leads screen and the patient file booking a
  // patient (one approved service, from the Insurance tab). Read once, then the address is cleared
  // so a refresh does not reopen it. The desk dashboard reads the same link.
  const bookRequest = useRef<{ patientId: string; claim: ClaimLink | null } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const patientId = q.get("book");
    if (!patientId) return;
    const claimId = q.get("claim") || "";
    const line = Number(q.get("line"));
    bookRequest.current = { patientId, claim: claimId && Number.isInteger(line) && line >= 0 ? { claimId, claimLine: line } : null };
    router.replace(window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const req = bookRequest.current;
    if (!req || patientsList.length === 0) return;
    bookRequest.current = null;
    const open = (name: string) => {
      setAppointmentToEdit(null);
      setPreSelectedTime("");
      setPreSelectedDoctor("");
      setPreSelectedPatient({ id: req.patientId, name });
      setPreSelectedClaimLine(req.claim);
      setBookingTab(req.claim ? "insurance" : "appointment");
      setActiveModal("booking");
    };
    const known = patientsList.find((p) => String(p.id) === req.patientId);
    if (known) {
      open(String(known.name || ""));
      return;
    }
    getDoc(getClinicDoc("patients", req.patientId))
      .then((snap) => {
        if (snap.exists()) open(String(snap.data().name || ""));
      })
      .catch((err) => console.error("Book from link: patient read failed", err));
  }, [patientsList]); // eslint-disable-line react-hooks/exhaustive-deps

  const [historyDrawerPatientId, setHistoryDrawerPatientId] = useState("");
  const [historyDrawerPatientName, setHistoryDrawerPatientName] = useState("");
  const [config, setConfig] = useState<ClinicScheduleConfig>({
    startHour: 9,
    startMinute: 0,
    endHour: 21,
    endMinute: 0,
    slotDuration: 30,
    offDays: [],
    // Placeholder until the clinic's own settings load.
    isConfigured: false,
  });
  const [appointmentToEdit, setAppointmentToEdit] = useState<BookingEditSnapshot | null>(null);
  const [scheduleViewDate, setScheduleViewDate] = useState(getLocalDateKey);
  const daysOfWeek = useMemo(() => {
    try {
      const selected = new Date(`${scheduleViewDate}T12:00:00`);
      const days = [];
      for (let i = -7; i <= 7; i++) {
        const d = new Date(selected);
        d.setDate(selected.getDate() + i);
        days.push(d);
      }
      return days;
    } catch {
      return [];
    }
  }, [scheduleViewDate]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const timeoutId = setTimeout(() => {
        const el = document.getElementById(`day-btn-${scheduleViewDate}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }, 100); // Short delay to ensure DOM is fully laid out before scrolling
      return () => clearTimeout(timeoutId);
    }
  }, [scheduleViewDate]);

  const scheduleDateInputRef = useRef<HTMLInputElement>(null);
  const [printingRxPatientId, setPrintingRxPatientId] = useState<string | null>(null);
  const [printingReceiptPatientId, setPrintingReceiptPatientId] = useState<string | null>(null);
  const [prescriptionFinderOpen, setPrescriptionFinderOpen] = useState(false);

  const [realTime, setRealTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setRealTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const [dailyIncome, setDailyIncome] = useState<number | null>(null);

  // Fetch Daily Income (Cash-basis)
  useEffect(() => {
    if (hideIncome) return;
    const today = getLocalDateKey();
    const q = query(
      getClinicCollection("ledger"),
      where("date", "==", today)
    );
    const unsub = onSnapshot(q, (snap) => {
      let income = 0;
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (!rowInScope(d, scopeBranchId)) return; // only the branch on screen
        const typ = String(d.type || "");

        let val = 0;
        if (typ === "expense") val = Number(d.cost ?? d.amount ?? 0) || 0;
        else val = Number(d.paid ?? d.amount ?? 0) || 0;

        if (typ === "procedure") return; // Ignore procedures
        if (val <= 0) return; // Ignore zero value transactions

        if (typ !== "expense") {
          income += val;
        }
      });
      setDailyIncome(income);
    });
    return () => unsub();
  }, [hideIncome, scopeBranchId]);

  const fireOwnerWhatsAppAlert = async (alertKey: OwnerAlertKey, message: string) => {
    try {
      const u = auth.currentUser;
      if (!u) return;
      const idToken = await u.getIdToken();
      await fetch("/api/whatsapp/owner-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ alertKey, message, clinicId: currentClinicId() }),
      });
    } catch (e) {
      console.warn("Owner WhatsApp alert", e);
    }
  };

  // Removed 1000ms timer to prevent 60fps re-rendering of entire dashboard

  /** Day / Week / Dentists / Rooms. The desk keeps its own switch in plain component state too. */
  const [phoneView, setPhoneView] = useState<PhoneView>("day");
  /** One dentist's visits only, on Day and Week: a doctorColumns() column id, "" = everyone. */
  const [dentistFilter, setDentistFilter] = useState("");
  /** Dentists / Rooms sections the person folded away. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const isWeekView = phoneView === "week";
  // Keyed on the week itself, so picking another day of the same week keeps the listener (and
  // the scroll position) instead of re-reading the same seven days.
  const weekKey = weekDaysFrom(scheduleViewDate).join(",");
  const weekDays = useMemo(() => weekKey.split(","), [weekKey]);

  // Fetch only appointments for the current view date to prevent severe performance degradation
  // and browser freezes when saving. The week view reads its seven days with the desk week view's
  // own range query, over the same weekDaysFrom() days, so the two can never disagree.
  useEffect(() => {
    setLoading(true);
    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
    const q = isWeekView
      ? query(getClinicCollection("appointments"), where("date", ">=", weekDays[0]), where("date", "<=", weekDays[6]))
      : query(getClinicCollection("appointments"), where("date", "==", viewKey));

    const unsubAppts = onSnapshot(
      q,
      (snap) => {
        setAllAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.warn("Dashboard appointments listener failed:", err);
        setLoading(false);
      }
    );
    return () => unsubAppts();
  }, [scheduleViewDate, isWeekView, weekDays]);

  const appointments = useMemo(() => {
    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
    return allAppointments
      .filter((a) => branchMatches(a.branchId))
      .filter((a) => normalizeDateKey(a.date) === viewKey)
      .sort((a, b) => normalizeTimeKey(a.time).localeCompare(normalizeTimeKey(b.time)));
  }, [allAppointments, scheduleViewDate, branchMatches]);

  /** The week on screen, branch first — the desk week view's filter — then by day and time. */
  const weekAppointments = useMemo(() => {
    if (!isWeekView) return [];
    const inWeek = new Set(weekDays);
    return allAppointments
      .filter((a) => branchMatches(a.branchId))
      .filter((a) => inWeek.has(normalizeDateKey(a.date) || String(a.date || "")))
      .sort((a, b) =>
        String(normalizeDateKey(a.date)).localeCompare(String(normalizeDateKey(b.date))) ||
        normalizeTimeKey(a.time).localeCompare(normalizeTimeKey(b.time)),
      );
  }, [allAppointments, isWeekView, weekDays, branchMatches]);

  /** What the phone lists: a "Rescheduled" marker is not a visit any more, so no card for it. */
  const listedAppointments = useMemo(
    () => (isWeekView ? weekAppointments : appointments).filter((a) => a.status !== "Rescheduled"),
    [isWeekView, weekAppointments, appointments],
  );

  /**
   * Which dentist each listed visit belongs to — the desk's Doctors view rule (id, else name, else
   * General), from the same helper, so a chip's count and the Dentists sections always agree.
   */
  const dentistGrouping = useMemo(
    () => doctorColumns(doctorsList, listedAppointments, generalDoctorLabel(language)),
    [doctorsList, listedAppointments, language],
  );

  /**
   * The dentist chips: everyone who works on the branch on screen (no ticked branches = every
   * branch), plus anyone who has a visit here anyway, so a count is never hidden. General only
   * when something is booked under it.
   */
  const dentistChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const col of dentistGrouping.columnOf.values()) counts.set(col, (counts.get(col) || 0) + 1);
    const worksHere = (id: string) => {
      if (!scopeBranchId) return true;
      const ids = (doctorsList.find((d) => d.id === id) as { branchIds?: unknown } | undefined)?.branchIds;
      return !Array.isArray(ids) || ids.length === 0 || ids.includes(scopeBranchId);
    };
    return dentistGrouping.columns
      .filter((c) => (c.id === NO_DOCTOR ? (counts.get(c.id) || 0) > 0 : worksHere(c.id) || (counts.get(c.id) || 0) > 0))
      .map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id) || 0 }));
  }, [dentistGrouping, doctorsList, scopeBranchId]);

  // A filter on a dentist who is no longer on screen (another branch, another week) lets go.
  useEffect(() => {
    if (dentistFilter && !dentistChips.some((c) => c.id === dentistFilter)) setDentistFilter("");
  }, [dentistChips, dentistFilter]);

  /** Day and Week list these: the listed visits, narrowed to the chosen dentist. */
  const filteredAppointments = useMemo(
    () => (dentistFilter ? listedAppointments.filter((a) => dentistGrouping.columnOf.get(a.id) === dentistFilter) : listedAppointments),
    [listedAppointments, dentistFilter, dentistGrouping],
  );

  /** Rooms appear in the switch only when the clinic has any, as on the desk. */
  const clinicHasRooms = branches.some((b) => (b.rooms?.length ?? 0) > 0);
  useEffect(() => {
    if (phoneView === "rooms" && !clinicHasRooms) setPhoneView("day");
  }, [phoneView, clinicHasRooms]);

  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A day tapped on the strip while the week is on screen brings that day's section up (the page
  // scrolls on a phone). Only on that tap: opening the week or stepping weeks stays put.
  const [weekScrollTarget, setWeekScrollTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!isWeekView || loading || !weekScrollTarget) return;
    // After the strip has re-centred itself (its own smooth scroll, 100ms after a date change):
    // started together, one smooth scroll cancels the other.
    const key = weekScrollTarget;
    const id = setTimeout(() => {
      document.getElementById(`week-day-${key}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      setWeekScrollTarget(null);
    }, 450);
    return () => clearTimeout(id);
  }, [isWeekView, loading, weekScrollTarget]);

  /** Back or forward one step: a week in the week view, a day everywhere else. */
  const stepSchedule = (dir: 1 | -1) => {
    const d = new Date(`${scheduleViewDate}T12:00:00`);
    d.setDate(d.getDate() + dir * (isWeekView ? 7 : 1));
    setScheduleViewDate(d.toISOString().split("T")[0]);
  };

  // 2. Live lists (patients, doctors, services) so dashboard actions sync without refresh.
  useEffect(() => {
    const unsubPatients = onSnapshot(
      query(getClinicCollection("patients"), orderBy("name")),
      (snap) => setPatientsList(snap.docs.map((d) => ({ id: d.id, name: d.data().name, phone: d.data().phone })))
    );
    const unsubDoctors = onSnapshot(getClinicCollection("staff"), (snap) => {
      setDoctorsList(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as { id: string; name?: string; role?: string; isDentist?: boolean }))
          .filter((s) => isDentistStaff(s))
          // branchIds: which branches the dentist works in, for the phone's dentist chips
          // (absent = every branch). The booking popup reads id and name only.
          .map((s) => ({ id: s.id, name: s.name as string, branchIds: (s as { branchIds?: unknown }).branchIds }))
      );
    });
    const unsubServices = onSnapshot(
      getClinicCollection("services"),
      (snap) => setServicesList(snap.docs.map((d) => ({ id: d.id, name: d.data().name, nameAr: d.data().nameAr, price: d.data().price, /* the per-list overrides — without them an insurer's tariff can never reach this screen */ prices: d.data().prices, category: d.data().category, icon: d.data().icon, /* which list owns it, if one does — the menu filter hides it everywhere else */ listId: d.data().listId, /* per tooth / flat / per arch — without it every treatment multiplies by the teeth picked */ pricingMode: d.data().pricingMode })))
    );
    return () => {
      unsubPatients();
      unsubDoctors();
      unsubServices();
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(getClinicDoc("settings", "clinic_info"), (snap) => {
      if (snap.exists()) setConfig(parseClinicSchedule(snap.data() as Record<string, unknown>));
    });
    return () => unsub();
  }, []);


  const summaryStats = useMemo(() => {
    let confirmed = 0, delayed = 0, canceled = 0, checkedIn = 0, inChair = 0, checkingOut = 0, completed = 0, rescheduled = 0;
    appointments.forEach(app => {
      const s = app.status?.toLowerCase();
      if (s === 'confirmed') confirmed++;
      else if (s === 'delayed') delayed++;
      else if (s === 'canceled' || s === 'cancelled') canceled++;
      else if (s === 'checked in') checkedIn++;
      else if (s === 'in chair') inChair++;
      else if (s === 'checking out') checkingOut++;
      else if (s === 'completed') completed++;
      else if (s === 'rescheduled') rescheduled++;
    });
    return { confirmed, delayed, canceled, checkedIn, inChair, checkingOut, completed, rescheduled };
  }, [appointments]);

  // A "Rescheduled" marker stays visible on its original day but isn't a real visit anymore, so
  // it must not inflate the headline count or the progress-bar percentages below.
  const activeAppointmentsCount = appointments.length - summaryStats.rescheduled;

  const handleSaveBooking = async (data: any) => {
    await executeSaveBooking(data);
  };

  const executeSaveBooking = async (data: any) => {
    try {
      await saveBooking(
        data,
        {
          uid: user?.uid || "",
          name: user?.name || "System",
          role: user?.role || "",
          language: language as "en" | "ar",
        },
        async (key: string, msg: string) => {
          // This calls the global function defined outside, wait it's inside `DashboardContent`? Let me pass the alert sender.
          // Wait, `fireOwnerWhatsAppAlert` is defined locally in the component!
          void fireOwnerWhatsAppAlert(key as OwnerAlertKey, msg);
        }
      );
      setAppointmentToEdit(null);
      setActiveModal(null);
      showToast(language === "ar" ? "تم الحفظ بنجاح" : "Saved Successfully", "success");
    } catch (error) {
      console.error("Booking save error:", error);
      showToast(language === "ar" ? "حدث خطأ" : "Error saving appointment", "error");
    }
  };

  /**
   * A new booking confirmed from the popup's Payment tab: saved with its services, and the popup
   * stays open on the saved visit's Payment tab so the money is taken at once. The desk
   * dashboard's handler, line for line.
   */
  const handleSaveBookingAndStay = async (data: any) => {
    try {
      const saved = await saveBooking(
        data,
        { uid: user?.uid || "", name: user?.name || "System", role: user?.role || "", language: language as "en" | "ar" },
        async (key: string, msg: string) => {
          void fireOwnerWhatsAppAlert(key as OwnerAlertKey, msg);
        },
      );
      setAppointmentToEdit({
        id: saved.appointmentId,
        patientId: saved.patientId,
        patientName: String(data.patientName || ""),
        treatment: String(data.treatment || ""),
        doctor: String(data.doctor || ""),
        doctorId: data.doctorId ?? null,
        date: String(data.date || ""),
        time: String(data.time || ""),
        duration: Number(data.duration) || 30,
        clinicalNoteId: null,
        branchId: data.branchId ?? null,
        roomId: data.roomId ?? null,
        claimId: data.claimId ?? null,
        claimLine: data.claimLine ?? null,
        claimLinks: data.claimLinks,
        cost: Number(data.cost) || 0,
        notes: String(data.notes || ""),
        status: String(data.status || "Scheduled"),
      } as BookingEditSnapshot);
      setBookingTab("payment");
      showToast(language === "ar" ? "الحجز اتسجّل — حصّل من هنا" : "Booked — take the payment here", "success");
    } catch (error) {
      console.error("Booking save error:", error);
      showToast(language === "ar" ? "حدث خطأ" : "Error saving appointment", "error");
    }
  };

  /** A schedule card opens the booking popup on that visit — the same window a new booking uses. */
  const openAppointment = (apt: DashboardAppointment) => {
    setAppointmentToEdit(editSnapshotOf(apt));
    setBookingTab("appointment");
    setActiveModal("booking");
  };

  /** Everything the booking popup's own Close resets. Shared so every way out leaves the same state. */
  const closeBooking = () => {
    setActiveModal(null);
    setAppointmentToEdit(null);
    setPreSelectedTime("");
    setPreSelectedPatient(null);
    setPreSelectedDoctor("");
    setPreSelectedClaimLine(null);
    setBookingTab("appointment");
    setQuickPayMode(false);
  };



  const handleWaitingMoodChange = async (id: string, waitingMood: string) => {
    try {
      await updateDoc(getClinicDoc("appointments", id), {
        waitingMood,
        updatedAt: serverTimestamp(),
      });
      setAllAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, waitingMood } : a))
      );
    } catch (error) {
      console.error(error);
      showToast(language === "ar" ? "تعذّر تحديث المزاج" : "Could not update mood", "error");
    }
  };

  const handleStatusChange = async (id: string, nextStatus: string) => {
    const appt = allAppointments.find((a) => a.id === id);
    if (!appt) return;
    const prevStatus = appt.status || "Scheduled";
    if (prevStatus === nextStatus) return;



    try {
      const updatePayload: any = {
        status: nextStatus,
        modifiedBy: user?.name || "System",
        updatedAt: serverTimestamp(),
        ...(nextStatus === "Checked In" && !appt.waitingMood ? { waitingMood: "neutral" } : {}),
        statusHistory: arrayUnion({
          status: nextStatus,
          timestamp: new Date(),
          modifiedBy: user?.name || "System",
        })
      };

      if (nextStatus === "Checked In" && prevStatus !== "Checked In" && !appt.checkInTime) {
        updatePayload.checkInTime = serverTimestamp();
      }
      if ((nextStatus === "Checking Out" || nextStatus === "Completed") && prevStatus !== nextStatus && !appt.checkOutTime) {
        updatePayload.checkOutTime = serverTimestamp();
      }

      await updateDoc(getClinicDoc("appointments", id), updatePayload);
      // A finished visit for an insurance service marks that service done on its approval.
      void syncClaimLineFromAppointment(currentClinicId(), { ...appt, status: nextStatus });

      // The flow alerts. Same keys the booking service sends; the server maps them to the catalogue.
      if (nextStatus === "No Show") {
        void fireOwnerWhatsAppAlert("appointment_no_show" as OwnerAlertKey, `No-show: ${appt.patientName || ""} — ${appt.time || ""} — ${appt.doctor || ""}`);
      }
      if (nextStatus === "Cancelled" && String(appt.date || "") === new Intl.DateTimeFormat("en-CA").format(new Date())) {
        void fireOwnerWhatsAppAlert("appointment_same_day_cancel" as OwnerAlertKey, `Cancelled today: ${appt.patientName || ""} — ${appt.time || ""} — ${appt.doctor || ""}`);
      }

      // Cancelling is the one status change the patient has to hear about — everything else is
      // clinic-side bookkeeping, but a cancelled patient is still expecting to be seen. It lives
      // here rather than in bookingService because a cancellation is a status change on the
      // appointment, not a deletion of it, so it never passed through the booking helpers that
      // send the "booked" and "moved" messages.
      if (nextStatus === "Cancelled" && prevStatus !== "Cancelled" && appt.patientId) {
        void sendPatientAppointmentWhatsApp({
          template: "cancel",
          patientId: String(appt.patientId),
          date: String(appt.date || ""),
          time: String(appt.time || ""),
          doctor: String(appt.doctor || ""),
          patientName: appt.patientName,
        });
      }

      if (nextStatus === "Checked In" && prevStatus !== "Checked In") {
        await addDoc(getClinicCollection("attendance"), {
          patientId: appt.patientId,
          patientName: appt.patientName,
          appointmentId: id,
          checkInTime: serverTimestamp(),
          doctor: appt.doctor,
          status: "waiting",
        });
      }
      setAllAppointments((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
              ...a,
              status: nextStatus,
              ...(nextStatus === "Checked In" && !a.waitingMood ? { waitingMood: "neutral" } : {}),
              checkInTime: updatePayload.checkInTime ? new Date() : a.checkInTime,
              checkOutTime: updatePayload.checkOutTime ? new Date() : a.checkOutTime,
            }
            : a
        )
      );
      showToast(language === "ar" ? "تم تحديث المرحلة" : "Stage updated", "success");
    } catch (error) {
      console.error(error);
      showToast(language === "ar" ? "حدث خطأ" : "Error", "error");
    }
  };

  const handleRatingChange = async (appointmentId: string, newRating: number) => {
    try {
      await updateDoc(getClinicDoc("appointments", appointmentId), { rating: newRating });
      showToast(language === "ar" ? "تم حفظ التقييم" : "Rating saved", "success");
    } catch (e) {
      console.error("Error saving rating", e);
      showToast(language === "ar" ? "حدث خطأ" : "Error", "error");
    }
  };


  /**
   * Deleting a visit asks what happens to the treatments recorded on it (keep them in the
   * patient's history, or delete them too while nothing is paid) — see DeleteAppointmentDialog.
   * The booking popup's Delete opens it (a card opens the popup).
   */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; patientName?: string; fromPopup?: boolean } | null>(null);
  const handleDeleteAppointment = async (
    e: React.MouseEvent | null | string,
    id?: string,
    /** From the booking popup: the visit's own name (it may be on another day than the one on screen). */
    from?: { patientName?: string; fromPopup?: boolean },
  ) => {
    const appointmentId = typeof e === 'string' ? e : id;
    if (typeof e !== 'string' && e?.stopPropagation) e.stopPropagation();
    if (!appointmentId) return;
    const appt = allAppointments.find((a) => a.id === appointmentId);
    setPendingDelete({ id: appointmentId, patientName: from?.patientName || appt?.patientName, fromPopup: from?.fromPopup });
  };

  const performDelete = async (servicesAction: "keep" | "delete") => {
    if (!pendingDelete) return;
    const appointmentId = pendingDelete.id;
    try {
      const result = await deleteAppointment(appointmentId, servicesAction);
      setPendingDelete(null);
      setAllAppointments((prev) => prev.filter((appt) => appt.id !== appointmentId));
      showToast(
        result.detachedNotes > 0
          ? language === "ar"
            ? `تم حذف الموعد، واتحفظ ${result.detachedNotes} علاج في سجل المريض`
            : `Appointment deleted; ${result.detachedNotes} treatment(s) kept in the patient's record`
          : language === "ar" ? "تم الحذف" : "Deleted",
        "success"
      );
      // The popup can be showing a different visit than the one it was opened on (its History tab
      // switches visits), so a delete started from it always closes it — never leave it open on a
      // visit that no longer exists, where a later Save would write to a deleted document.
      if (pendingDelete.fromPopup || appointmentToEdit?.id === appointmentId) {
        closeBooking();
      }
    } catch (error) {
      // A refused delete must say so; swallowing it looked like nothing had happened at all.
      console.error(error);
      showToast(
        error instanceof MoneyApiError
          ? error.message
          : language === "ar" ? "حدث خطأ أثناء الحذف" : "Could not delete that appointment",
        "error"
      );
    }
  };


  const handlePrintReceipt = async (
    e: React.MouseEvent,
    appt: { patientId?: string; patientName?: string }
  ) => {
    e.stopPropagation();
    const patientId = appt.patientId ? String(appt.patientId) : "";
    if (!patientId) {
      showToast(language === "ar" ? "معرّف المريض غير متوفر" : "Patient ID missing", "error");
      return;
    }

    setPrintingReceiptPatientId(patientId);
    try {
      const result = await printPatientReceipt(patientId, {
        fallbackName: appt.patientName,
        language: language === "ar" ? "ar" : "en",
      });
      if (!result.ok) {
        showToast(result.message, result.reason === "no_records" ? "info" : "error");
        return;
      }
      showToast(
        language === "ar" ? "جاري فتح الإيصال للطباعة" : "Opening receipt to print",
        "success"
      );
    } catch (err) {
      console.error(err);
      showToast(
        language === "ar"
          ? "تعذّر طباعة الإيصال. حاول مرة أخرى."
          : "Could not print receipt. Please try again.",
        "error"
      );
    } finally {
      setPrintingReceiptPatientId(null);
    }
  };

  const handlePrintLastPrescription = async (
    e: React.MouseEvent,
    appt: { patientId?: string; patientName?: string }
  ) => {
    e.stopPropagation();
    const patientId = appt.patientId ? String(appt.patientId) : "";
    if (!patientId) {
      showToast(language === "ar" ? "معرّف المريض غير متوفر" : "Patient ID missing", "error");
      return;
    }

    setPrintingRxPatientId(patientId);
    try {
      const prescSnap = await getDocs(
        query(getClinicCollection("prescriptions"), where("patientId", "==", patientId), limit(50))
      );
      const records = prescSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }))
        .sort((a, b) => prescriptionCreatedMs(b) - prescriptionCreatedMs(a));

      const latest = records[0];
      if (!latest) {
        showToast(
          language === "ar"
            ? "لا توجد وصفة محفوظة لهذا المريض"
            : "No saved prescription for this patient",
          "error"
        );
        return;
      }

      const rxItems = normalizeRxItemsFromRecord(latest.drugs);
      if (rxItems.length === 0) {
        showToast(
          language === "ar" ? "الوصفة الأخيرة لا تحتوي على أدوية" : "Last prescription has no medications",
          "error"
        );
        return;
      }

      const [patientSnap, clinicSnap] = await Promise.all([
        getDoc(getClinicDoc("patients", patientId)),
        getDoc(getClinicDoc("settings", "clinic_info")),
      ]);
      const patient = patientSnap.exists()
        ? (patientSnap.data() as { name?: string; dateOfBirth?: string; age?: string | number; gender?: string })
        : { name: appt.patientName || "Patient" };
      const clinicInfo = clinicSnap.exists() ? clinicSnap.data() : {};

      const payload = buildPrescriptionPayloadFromRecord(latest, patient, clinicInfo);
      const blob = await prescriptionPayloadToPdfBlob(payload);
      openPrescriptionPdf(blob, `Prescription-${patientId.slice(0, 8)}.pdf`);
      showToast(language === "ar" ? "جاري فتح الوصفة للطباعة" : "Opening prescription to print", "success");
    } catch (err) {
      console.error(err);
      showToast(
        language === "ar" ? "تعذّر طباعة الوصفة" : "Could not print prescription",
        "error"
      );
    } finally {
      setPrintingRxPatientId(null);
    }
  };

  // (Removed handleEditAppointment as it is dead code and contained buggy sync logic)

  const formatTime = (ts: any) => {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return language === 'ar' ? "صباح الخير" : "Good Morning";
    return language === 'ar' ? "مساء الخير" : "Good Evening";
  }, [language]);

  const isScheduleToday = scheduleViewDate === getLocalDateKey();

  const summaryHeading = useMemo(() => {
    if (isScheduleToday) {
      return language === "ar" ? "ملخص اليوم" : "Daily Summary";
    }
    const d = new Date(`${scheduleViewDate}T12:00:00`);
    const formatted = d.toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return language === "ar" ? `ملخص ${formatted}` : `Summary · ${formatted}`;
  }, [isScheduleToday, scheduleViewDate, language]);

  const scheduleDateSubtitle = useMemo(() => {
    const d = new Date(`${scheduleViewDate}T12:00:00`);
    return d.toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [scheduleViewDate, language]);

  return (
    <div className={`min-h-full lg:min-h-0 lg:h-full relative overflow-clip lg:overflow-hidden pb-24 lg:pb-0 font-sans text-ink-slab lg:text-white ${isRTL ? 'text-right' : 'text-left'}`}>
      <div className="relative z-10 w-full max-w-[1920px] mx-auto p-4 md:p-6 md:pt-8 lg:p-4 lg:pt-3 space-y-3 md:space-y-4 lg:space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500 lg:h-full lg:flex lg:flex-col">

        {/* The greeting and the two quick actions now sit in the layout's black band, so they
            are there on a phone too — this bar used to be `hidden lg:flex` inside a component
            that only ever renders below `lg`, which meant nobody had ever seen it. */}
        <PageHeader
          title={<><span className="font-light">{language === 'ar' ? 'أهلاً بك،' : 'Welcome in,'}</span> {getWelcomeName(user?.name)}</>}
          eyebrow={<span className="inline-flex items-center gap-2"><DashboardClockWidget language={language} /></span>}
        >
          <HomeViewTabs />
          <button onClick={() => setActiveModal('patient')} className={headerButtonPrimary}>
            <Plus size={17} strokeWidth={3} />
            <span className="hidden sm:inline">{language === 'ar' ? 'مريض جديد' : 'New Patient'}</span>
          </button>
          {insuranceOn && (
            <button onClick={() => setReadApproval(true)} className={headerButtonGhost}>
              <ScanLine size={17} strokeWidth={2.5} />
              <span className="hidden sm:inline">{language === 'ar' ? 'اقرأ موافقة' : 'Read approval'}</span>
            </button>
          )}
        </PageHeader>

        {/* === DESKTOP: Floating High-Contrast Stats === */}
        <div className="hidden lg:flex items-center gap-12 shrink-0 py-4 px-2">
          {/* Daily Income - Clean Card */}
          <div className="bg-surface text-ink p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col min-w-[220px] transition-all">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{language === 'ar' ? 'دخل اليوم' : 'Daily Income'}</span>
              <div className="p-2 bg-emerald-50 rounded-full"><Wallet size={16} className="text-emerald-600" /></div>
            </div>
            <span className="text-4xl font-black tracking-tighter drop-shadow-sm text-ink">
              {hideIncome ? "—" : dailyIncome === null ? <Loader2 className="w-6 h-6 animate-spin text-slate-500" /> : <>{dailyIncome?.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')} <span className="text-lg font-medium text-slate-500 uppercase tracking-widest ml-1">{language === 'ar' ? 'ج.م' : 'EGP'}</span></>}
            </span>
          </div>

          {/* Total Appointments - Floating Huge Number */}
          <div className="flex flex-col justify-center px-6">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">{language === 'ar' ? 'المواعيد' : 'Appointments'}</span>
            <span className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-slate-800 to-slate-500 tracking-tighter leading-none drop-shadow-sm">{activeAppointmentsCount}</span>
          </div>

          {/* Status Distribution - Abstract Chart */}
          <div className="flex flex-col justify-center px-4 flex-1 max-w-sm">
            <div className="flex items-center justify-between text-sm font-medium text-ink-muted mb-3">
              <span>{language === 'ar' ? 'حالة المواعيد' : 'Status Distribution'}</span>
              <span>{Math.round(((summaryStats.confirmed + summaryStats.checkedIn + summaryStats.inChair + summaryStats.completed) / (activeAppointmentsCount || 1)) * 100)}%</span>
            </div>
            <div className="w-full h-3 bg-white/60 backdrop-blur-md rounded-full overflow-hidden flex shadow-inner">
              <div style={{ width: `${(summaryStats.confirmed / (activeAppointmentsCount || 1)) * 100}%` }} className="h-full bg-slate-800" title="Confirmed" />
              <div style={{ width: `${((summaryStats.checkedIn + summaryStats.inChair + summaryStats.checkingOut) / (activeAppointmentsCount || 1)) * 100}%` }} className="h-full bg-cyan-400" title="In Progress" />
              <div style={{ width: `${(summaryStats.completed / (activeAppointmentsCount || 1)) * 100}%` }} className="h-full bg-emerald-400" title="Completed" />
              <div style={{ width: `${(summaryStats.delayed / (activeAppointmentsCount || 1)) * 100}%` }} className="h-full bg-amber-400" title="Delayed" />
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-800" /> {language === 'ar' ? 'مؤكد' : 'Confirmed'}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-cyan-400" /> {language === 'ar' ? 'بالعيادة' : 'In Clinic'}</span>
            </div>
          </div>

          {/* User Clock & Income Widget */}
          <UserClockWidget />
        </div>


        {/* === MOBILE: Compact Header Layout === */}
        <div className="flex flex-col gap-4 lg:hidden shrink-0">
          
          {/* The name-and-time pill that used to open this column is gone: the black band at
              the top of every screen already carries both, and two of them stacked read as a
              mistake. */}

          {/* 2. Daily Overview (Stats + Income) */}
          <div className="flex flex-col gap-2 mx-1">
             <div className="flex items-center justify-between px-2">
                 <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{language === 'ar' ? 'نظرة عامة' : 'Daily Overview'}</h3>
             </div>
             
             <div className="grid grid-cols-2 gap-2">
                {/* Income Card (Spans half) */}
                <div className="bg-surface rounded-2xl p-5 border border-slate-100 shadow-sm flex flex-col relative overflow-hidden">
                    <div className="flex justify-between items-start w-full relative z-10 mb-2">
                       <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{language === 'ar' ? 'دخل اليوم' : 'Today\'s Income'}</span>
                       <div className="p-1.5 bg-emerald-50 rounded-full"><Wallet size={14} className="text-emerald-600" /></div>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center relative z-10 min-h-[80px]">
                        {hideIncome ? "—" : dailyIncome === null ? (
                            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                        ) : (
                            <div className="flex items-baseline justify-center gap-1 w-full">
                                <span className="text-4xl font-black tracking-tighter leading-none truncate text-center text-ink drop-shadow-sm">{dailyIncome.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</span>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest shrink-0">{language === 'ar' ? 'ج.م' : 'EGP'}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Status Cards (2x2 grid inside the other half) - Cleaner palette with icons */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-ink uppercase tracking-widest mb-1 flex items-center gap-1.5"><Check size={12} strokeWidth={3} className="text-sky-500" /> {language === 'ar' ? 'مؤكد' : 'Confirm'}</span>
                        <span className="text-2xl font-black text-ink leading-none mt-0.5">{summaryStats.confirmed}</span>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-ink uppercase tracking-widest mb-1 flex items-center gap-1.5"><Clock size={12} strokeWidth={3} className="text-amber-500" /> {language === 'ar' ? 'متأخر' : 'Delay'}</span>
                        <span className="text-2xl font-black text-ink leading-none mt-0.5">{summaryStats.delayed}</span>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-ink uppercase tracking-widest mb-1 flex items-center gap-1.5"><Check size={12} strokeWidth={3} className="text-emerald-500" /> {language === 'ar' ? 'تمت' : 'Done'}</span>
                        <span className="text-2xl font-black text-ink leading-none mt-0.5">{summaryStats.completed}</span>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-ink uppercase tracking-widest mb-1 flex items-center gap-1.5"><X size={12} strokeWidth={3} className="text-rose-500" /> {language === 'ar' ? 'ملغي' : 'Cancel'}</span>
                        <span className="text-2xl font-black text-ink leading-none mt-0.5">{summaryStats.canceled}</span>
                    </div>
                </div>
             </div>
          </div>

          {/* Clock In / Attendance widget (Hidden on Mobile for now) */}
          {/* <div className="mt-1 mx-1">
            <UserClockWidget mobileVariant={true} />
          </div> */}

          {/* 3. Vertical Quick Actions Stack (Moved down) */}
          <div className="flex flex-col gap-2 px-1 pb-1 mt-2">
            <button
              onClick={() => setActiveModal('patient')}
              className="w-full flex items-center py-3 px-4 rounded-[1.2rem] bg-[#FACC15] hover:bg-[#EAB308] shadow-sm active:scale-[0.98] transition-transform"
            >
              <div className="w-8 h-8 rounded-full bg-white/40 shadow-sm flex items-center justify-center shrink-0"><User size={16} strokeWidth={2.5} className="text-ink" /></div>
              <span className="text-lg font-black text-ink flex-1 text-center">{language === 'ar' ? 'مريض جديد' : 'New Patient'}</span>
              <div className="w-8 h-8 shrink-0"></div>
            </button>

            <button
              onClick={() => { setAppointmentToEdit(null); setActiveModal('booking'); }}
              className="w-full flex items-center py-3 px-4 rounded-[1.2rem] bg-white/60 backdrop-blur-xl border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] active:scale-[0.98] transition-transform"
            >
              <div className="w-8 h-8 rounded-full bg-surface shadow-sm flex items-center justify-center shrink-0"><Calendar size={16} strokeWidth={2.5} className="text-slate-800" /></div>
              <span className="text-lg font-black text-slate-800 flex-1 text-center">{language === 'ar' ? 'حجز موعد' : 'New Visit'}</span>
              <div className="w-8 h-8 shrink-0"></div>
            </button>

            {insuranceOn && (
            <button
              onClick={() => setReadApproval(true)}
              className="w-full flex items-center py-3 px-4 rounded-[1.2rem] bg-white/60 backdrop-blur-xl border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] active:scale-[0.98] transition-transform"
            >
              <div className="w-8 h-8 rounded-full bg-surface shadow-sm flex items-center justify-center shrink-0"><ScanLine size={16} strokeWidth={2.5} className="text-slate-800" /></div>
              <span className="text-lg font-black text-slate-800 flex-1 text-center">{language === 'ar' ? 'اقرأ موافقة' : 'Read approval'}</span>
              <div className="w-8 h-8 shrink-0"></div>
            </button>
            )}
          </div>
        </div>

        {/* === MAIN DASHBOARD CONTENT: Schedule + Detail === */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 mt-4 lg:mt-0">

          {/* 5. SCHEDULE LIST WIDGET */}
          <div className="flex-1 flex flex-col bg-white/30 backdrop-blur-[40px] border border-white/50 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] h-[600px] lg:h-full lg:min-h-0 overflow-clip lg:overflow-hidden">
            {/* Header (Desktop: Original, Mobile: Calendar Header like reference image) */}
            <div className="flex justify-between items-center gap-3 px-4 md:px-6 py-4 border-b border-white/40 bg-transparent shrink-0">
              {/* Desktop Date switcher (Hidden on Mobile) */}
              <div className="hidden lg:flex relative min-w-0 flex-1 flex-wrap items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ink-slab text-white flex items-center justify-center shrink-0 shadow-md">
                  <Calendar size={20} />
                </div>
                <div className="flex items-center gap-1 shrink-0 bg-slate-100/80 rounded-xl p-1 shadow-inner mr-1">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(`${scheduleViewDate}T12:00:00`);
                      d.setDate(d.getDate() - 1);
                      setScheduleViewDate(d.toISOString().split("T")[0]);
                    }}
                    className="p-1.5 rounded-lg text-ink-muted hover:bg-surface hover:text-slate-800 hover:shadow-sm transition-all"
                    aria-label={language === "ar" ? "اليوم السابق" : "Previous Day"}
                  >
                    <ChevronLeft size={16} className={isRTL ? "rotate-180" : ""} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(`${scheduleViewDate}T12:00:00`);
                      d.setDate(d.getDate() + 1);
                      setScheduleViewDate(d.toISOString().split("T")[0]);
                    }}
                    className="p-1.5 rounded-lg text-ink-muted hover:bg-surface hover:text-slate-800 hover:shadow-sm transition-all"
                    aria-label={language === "ar" ? "اليوم التالي" : "Next Day"}
                  >
                    <ChevronRight size={16} className={isRTL ? "rotate-180" : ""} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const el = scheduleDateInputRef.current;
                    if (!el) return;
                    try {
                      const sp = (el as HTMLInputElement & { showPicker?: () => void }).showPicker;
                      if (typeof sp === "function") sp.call(el);
                      else el.click();
                    } catch {
                      el.click();
                    }
                  }}
                  className="flex min-w-0 max-w-full items-center gap-2 rounded-xl py-1 text-start transition hover:opacity-80 focus:outline-none"
                  aria-label={language === "ar" ? "اختر يوماً لعرض المواعيد" : "Pick a day to view appointments"}
                >
                  <span className="flex min-w-0 flex-col justify-center leading-tight">
                    <span className="text-lg font-light tracking-widest text-slate-800">
                      {language === 'ar' ? 'جدول المواعيد' : 'Schedule'}
                    </span>
                    <span className="text-xs font-bold text-ink-muted lg:text-ink-body mt-0.5">
                      {scheduleViewDate}
                      {scheduleViewDate === getLocalDateKey()
                        ? language === "ar"
                          ? " · اليوم"
                          : " · Today"
                        : ""}
                    </span>
                  </span>
                </button>
              </div>

              {/* Mobile Compact Date switcher (Visible on Mobile) */}
              {/* Two rows on a phone. As one row the branch picker, the date, the arrows, the
                  calendar and Today did not fit in 375px, and the date — the only flexible part —
                  was squeezed down to a single letter. The branch picker gets its own row (and
                  collapses away for a single-site clinic, where it renders nothing). */}
              <div className="flex lg:hidden flex-col gap-2 w-full min-w-0">
                <div className="flex items-center min-w-0 empty:hidden">
                  <BranchSelector
                    branches={branches}
                    allowed={allowedBranches}
                    value={activeBranchId}
                    onChange={setActiveBranchId}
                    allowAll={canChooseAll}
                  />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  {/* Just the date: the Today pill beside it, filled while today is on screen,
                      says the rest — and leaves the date room to be read in full. */}
                  <span className="flex-1 min-w-0 text-sm font-black text-slate-800 truncate">
                    {isWeekView
                      ? `${new Date(`${weekDays[0]}T12:00:00`).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })} – ${new Date(`${weekDays[6]}T12:00:00`).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}`
                      : new Date(`${scheduleViewDate}T12:00:00`).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}
                  </span>
                  <div className="flex items-center gap-0.5 bg-surface-muted rounded-xl p-0.5 shadow-inner shrink-0">
                    <button
                      onClick={() => stepSchedule(-1)}
                      className="size-10 flex items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-slate-800 hover:shadow-sm transition-all"
                      aria-label={isWeekView ? (language === "ar" ? "الأسبوع السابق" : "Previous Week") : (language === "ar" ? "اليوم السابق" : "Previous Day")}
                    >
                      <ChevronLeft size={16} className={isRTL ? "rotate-180" : ""} />
                    </button>
                    <button
                      onClick={() => stepSchedule(1)}
                      className="size-10 flex items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-slate-800 hover:shadow-sm transition-all"
                      aria-label={isWeekView ? (language === "ar" ? "الأسبوع التالي" : "Next Week") : (language === "ar" ? "اليوم التالي" : "Next Day")}
                    >
                      <ChevronRight size={16} className={isRTL ? "rotate-180" : ""} />
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      const el = scheduleDateInputRef.current;
                      if (!el) return;
                      try {
                        (el as any).showPicker();
                      } catch {
                        el.click();
                      }
                    }}
                    className="size-10 shrink-0 flex items-center justify-center bg-surface-subtle hover:bg-surface-muted rounded-xl text-ink-muted"
                    aria-label={language === "ar" ? "اختر يوماً لعرض المواعيد" : "Pick a day to view appointments"}
                  >
                    <Calendar size={18} />
                  </button>
                  {/* Always rendered: Sara's tour points at it by its text. */}
                  <button
                    onClick={() => setScheduleViewDate(getLocalDateKey())}
                    aria-pressed={isWeekView ? weekDays.includes(getLocalDateKey()) : isScheduleToday}
                    className={`h-10 shrink-0 text-[11px] font-black uppercase tracking-wider px-3.5 rounded-full border ${
                      (isWeekView ? weekDays.includes(getLocalDateKey()) : isScheduleToday)
                        ? "text-white bg-emerald-600 border-emerald-600"
                        : "text-emerald-600 bg-emerald-50 border-emerald-100"
                    }`}
                  >
                    {language === 'ar' ? 'اليوم' : 'Today'}
                  </button>
                </div>
                {/* The desk's view switch, phone-sized. Rooms only when the clinic has rooms. */}
                <div role="tablist" aria-label={language === "ar" ? "طريقة العرض" : "Calendar view"} className="flex items-center gap-0.5 bg-surface-muted rounded-xl p-0.5 shadow-inner">
                  {([
                    { id: "day", en: "Day", ar: "يومي" },
                    { id: "week", en: "Week", ar: "أسبوعي" },
                    { id: "dentists", en: "Dentists", ar: "الأطباء" },
                    ...(clinicHasRooms ? [{ id: "rooms", en: "Rooms", ar: "الغرف" }] : []),
                  ] as { id: PhoneView; en: string; ar: string }[]).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      aria-selected={phoneView === v.id}
                      onClick={() => setPhoneView(v.id)}
                      className={`flex-1 min-w-0 h-9 rounded-lg text-xs font-black truncate transition-all ${
                        phoneView === v.id ? "bg-surface text-slate-800 shadow-sm" : "text-ink-muted"
                      }`}
                    >
                      {language === "ar" ? v.ar : v.en}
                    </button>
                  ))}
                </div>
              </div>

              <input
                ref={scheduleDateInputRef}
                type="date"
                value={scheduleViewDate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setScheduleViewDate(v);
                }}
                className="pointer-events-none absolute h-0 w-0 opacity-0"
                tabIndex={-1}
                aria-hidden
              />

              {/* Desktop Right Side Buttons */}
              <div className="hidden lg:flex shrink-0 items-center gap-2 self-center">
                <BranchSelector
                  branches={branches}
                  allowed={allowedBranches}
                  value={activeBranchId}
                  onChange={setActiveBranchId}
                  allowAll={canChooseAll}
                />
                <button
                  type="button"
                  onClick={() => setPrescriptionFinderOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-ink-slab px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 hover:shadow-md"
                >
                  <Pill size={14} />
                  {language === "ar" ? "طباعة وصفة" : "Print Rx"}
                </button>
              </div>
            </div>

            {/* Horizontal Weekly Stripe (Mobile Only) */}
            <div className="flex px-3 py-3 bg-surface border-b border-slate-100 lg:hidden shrink-0 select-none overflow-x-auto no-scrollbar gap-2 scroll-smooth">
              {daysOfWeek.map((day, idx) => {
                const dateKey = day.toISOString().split("T")[0];
                const isSelected = dateKey === scheduleViewDate;
                const isToday = dateKey === getLocalDateKey();
                const dayName = day.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short' }).toUpperCase();
                const dayNum = day.getDate();

                return (
                  <button
                    key={idx}
                    id={`day-btn-${dateKey}`}
                    onClick={() => {
                      if (isWeekView) setWeekScrollTarget(dateKey);
                      setScheduleViewDate(dateKey);
                    }}
                    className={`flex-shrink-0 w-12 h-14 flex flex-col items-center justify-center gap-1 rounded-2xl transition-all ${isSelected
                        ? 'bg-slate-900 text-white font-extrabold shadow-md shadow-slate-900/20 scale-[1.03]'
                        : isWeekView && weekDays.includes(dateKey)
                          // The rest of the week on screen, so the strip shows which seven days the agenda holds.
                          ? 'text-slate-900 bg-slate-200/70 border border-slate-300/60'
                          : 'text-slate-500 hover:text-slate-900 bg-slate-50/50 hover:bg-slate-50 border border-slate-100/50'
                      }`}
                  >
                    <span className="text-[8px] tracking-wide font-black uppercase opacity-85 leading-none">
                      {isSelected && isToday ? (language === 'ar' ? 'اليوم' : 'TODAY') : dayName}
                    </span>
                    <span className="text-xs font-black mt-0.5 leading-none">{dayNum}</span>
                    {isToday && !isSelected && <span className="w-1 h-1 rounded-full bg-emerald-500 mt-0.5"></span>}
                  </button>
                );
              })}
            </div>
            {/* One dentist at a time, on Day and Week. Counts are for what is on screen: the day,
                or the whole week. Only when there is more than one name to choose between. */}
            {(phoneView === "day" || phoneView === "week") && dentistChips.length > 1 && (
              <div className="flex lg:hidden px-3 py-2 bg-surface border-b border-slate-100 shrink-0 overflow-x-auto no-scrollbar gap-1.5" role="group" aria-label={language === "ar" ? "فلتر الأطباء" : "Dentist filter"}>
                {[{ id: "", label: language === "ar" ? "الكل" : "All", count: listedAppointments.length }, ...dentistChips].map((c) => {
                  const on = dentistFilter === c.id;
                  return (
                    <button
                      key={c.id || "__all__"}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDentistFilter(c.id)}
                      className={`shrink-0 h-8 flex items-center gap-1.5 rounded-full border px-3 text-xs font-black whitespace-nowrap transition-colors ${
                        on ? "bg-ink-slab text-white border-ink-slab" : "bg-surface text-slate-700 border-line"
                      }`}
                    >
                      <span className="max-w-[9rem] truncate">{c.label}</span>
                      <span className={`text-[10px] font-black ${on ? "text-white/70" : "text-ink-muted"}`}>
                        {c.count.toLocaleString(language === "ar" ? "ar-EG" : "en-US")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Below lg the schedule grows with its content and the page scrolls, so these clip
                (overflow: clip) instead of becoming scroll boxes: a scroll box that never scrolls
                would pin the week's sticky day headers to itself, where they never stick. */}
            <div className="flex flex-col flex-1 min-h-[400px] overflow-clip lg:overflow-hidden relative">
              {loading ? (
                <div className="py-32 flex justify-center"><Loader2 className="animate-spin text-primary-500" size={32} /></div>
              ) : (
                <div className="flex-1 overflow-visible lg:overflow-y-auto lg:overflow-x-auto custom-scrollbar relative pb-48">
                  {(() => {
                    const sched = config;
                    const bounds = clinicDayBoundsMinutes(sched);
                    const slotDuration = sched.slotDuration || 30;
                    const rowHeight = 90; // Optimized, compact mobile slot height
                    const pixelsPerMinute = rowHeight / slotDuration;
                    const totalMinutes = bounds.end - bounds.start;
                    const containerHeight = totalMinutes * pixelsPerMinute;

                    const timeSlots = [];
                    for (let m = bounds.start; m < bounds.end; m += slotDuration) {
                      const h = Math.floor(m / 60);
                      const mins = m % 60;
                      const ampm = h >= 12 ? 'PM' : 'AM';
                      const h12 = h % 12 || 12;
                      const label = `${h12.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${ampm}`;
                      timeSlots.push({ minutes: m, label });
                    }

                    const isToday = scheduleViewDate === getLocalDateKey();
                    const currentMinutes = realTime.getHours() * 60 + realTime.getMinutes();
                    const showRedLine = isToday && currentMinutes >= bounds.start && currentMinutes <= bounds.end;
                    const redLineTop = showRedLine ? (currentMinutes - bounds.start) * pixelsPerMinute : 0;

                    const activeMobileAppts = appointments.filter(a => !["Rescheduled"].includes(a.status || ""));
                    const upNextAppt = isToday ? activeMobileAppts.find(a => (a.status === "In Chair" || a.status === "Checked In") || (parseApptTimeToMinutes(a.time) >= currentMinutes && !["Completed", "Canceled", "Cancelled"].includes(a.status || ""))) : null;

                    return (
                      <>
                      {/* === MOBILE: Chronological List View === */}
                      <div className="lg:hidden flex flex-col gap-4 p-2 pb-24">
                        {(() => {
                          const ar = language === "ar";
                          const locale = ar ? "ar-EG" : "en-US";
                          const emptyNote = (text: string) => (
                            <div className="text-center py-10 px-4 text-slate-400 font-bold text-sm">{text}</div>
                          );
                          const chosenDentist = dentistChips.find((c) => c.id === dentistFilter)?.label;

                          /** One visit. Every view uses this card, and a tap opens the booking pop-up on it. */
                          const card = (apt: any) => {
                            const aptStyles = getAppointmentStatusStyles(apt.status);
                            // What the visit is for and who sees the patient, from the fields the
                            // appointment already carries. Neither known: the line shows the
                            // status alone, never a bare "-".
                            const aptWhat = String(apt.treatment || apt.serviceName || "").trim();
                            const aptWho = String(apt.doctor || "").trim();
                            const aptDetail = [aptWhat, aptWho].filter(Boolean).join(" · ");
                            return (
                              <div
                                key={apt.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAppointment(apt);
                                }}
                                className={`flex bg-surface rounded-3xl border border-slate-100 shadow-sm p-4 gap-4 items-center transition-transform active:scale-[0.98]`}
                              >
                                <div className="flex flex-col items-center justify-center shrink-0 w-16">
                                  <span className="text-sm font-black text-slate-800 leading-none mb-1">{apt.time?.split(" ")[0]}</span>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">{apt.time?.split(" ")[1]}</span>
                                </div>
                                <div className={`w-1 h-12 rounded-full shrink-0 ${aptStyles.accent}`}></div>
                                {/* The name takes the whole width; the status moved to the second
                                    line, where it used to push "Iris mila" down to "Iris …". */}
                                <div className="flex-1 flex flex-col min-w-0 gap-1">
                                  <h4 className="text-base font-black text-slate-800 leading-snug line-clamp-2 break-words">{apt.patientName}</h4>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="shrink-0 text-[9px] font-black text-ink-body uppercase tracking-widest bg-surface-subtle border border-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                                      {getAppointmentStageLabel(apt.status, language)}
                                    </span>
                                    {aptDetail && (
                                      <span className="min-w-0 text-[11px] font-bold text-ink-muted truncate">{aptDetail}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          };

                          /** A folding section header for the Dentists and Rooms views. */
                          const group = (id: string, title: string, items: any[], summary: string) => {
                            const folded = collapsedGroups.has(id);
                            return (
                              <section key={id} className="flex flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(id)}
                                  aria-expanded={!folded}
                                  className="sticky top-0 z-10 flex items-center gap-2 w-full rounded-2xl bg-surface-muted/95 backdrop-blur px-3 py-2.5 text-start"
                                >
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-black text-slate-800 truncate">{title}</span>
                                    <span className="block text-[11px] font-bold text-ink-muted truncate">{summary}</span>
                                  </span>
                                  <span className="shrink-0 min-w-7 h-7 px-2 rounded-full bg-ink-slab text-white text-xs font-black flex items-center justify-center">
                                    {items.length.toLocaleString(locale)}
                                  </span>
                                  <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform ${folded ? (isRTL ? "rotate-90" : "-rotate-90") : ""}`} />
                                </button>
                                {/* An empty section is its header alone: the summary line already says so. */}
                                {!folded && items.length > 0 && <div className="flex flex-col gap-3">{items.map(card)}</div>}
                              </section>
                            );
                          };

                          /** "3 visits · 12 free slots" — the desk week view's free-slot count, for one dentist's day. */
                          const busySummary = (items: any[]) => {
                            const s = daySummary(items, config, scheduleViewDate);
                            if (s.isOffDay) {
                              if (s.visits === 0) return ar ? "يوم إجازة" : "Day off";
                              return ar ? `${s.visits.toLocaleString(locale)} زيارة في يوم إجازة` : `${s.visits} visit${s.visits === 1 ? "" : "s"} on a day off`;
                            }
                            if (s.visits === 0) return ar ? "مفيش مواعيد، فاضي طول اليوم" : "Nothing booked, free all day";
                            // An Arabic comma, not "·": beside Arabic digits a middle dot reads as a zero (٠).
                            return ar
                              ? `${s.visits.toLocaleString(locale)} زيارة، ${s.freeSlots.toLocaleString(locale)} من ${s.totalSlots.toLocaleString(locale)} ميعاد فاضي`
                              : `${s.visits} visit${s.visits === 1 ? "" : "s"} · ${s.freeSlots} of ${s.totalSlots} slots free`;
                          };

                          if (phoneView === "week") {
                            return (
                              <div className="flex flex-col gap-4 px-1">
                                {weekDays.map((key) => {
                                  const items = filteredAppointments.filter((a) => normalizeDateKey(a.date) === key);
                                  const d = new Date(`${key}T12:00:00`);
                                  const isTodayKey = key === getLocalDateKey();
                                  return (
                                    <section key={key} id={`week-day-${key}`} className="flex flex-col gap-2">
                                      <div className="sticky top-0 z-10 flex items-center gap-2 rounded-2xl bg-surface-muted/95 backdrop-blur px-3 py-2">
                                        <span className="flex-1 min-w-0 text-sm font-black text-slate-800 truncate">
                                          {d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" })}
                                          {isTodayKey && <span className="ms-2 text-[10px] font-black uppercase text-emerald-600">{ar ? "اليوم" : "Today"}</span>}
                                        </span>
                                        {isOffDay(key, config) && items.length === 0 ? (
                                          <span className="shrink-0 text-[11px] font-bold text-ink-muted">{ar ? "إجازة" : "Day off"}</span>
                                        ) : (
                                          <span className={`shrink-0 min-w-7 h-7 px-2 rounded-full text-xs font-black flex items-center justify-center ${items.length ? "bg-ink-slab text-white" : "bg-surface text-ink-muted"}`}>
                                            {items.length.toLocaleString(locale)}
                                          </span>
                                        )}
                                      </div>
                                      {items.length > 0 && <div className="flex flex-col gap-3">{items.map(card)}</div>}
                                    </section>
                                  );
                                })}
                                {filteredAppointments.length === 0 && emptyNote(
                                  chosenDentist
                                    ? (ar ? `مفيش مواعيد لـ ${chosenDentist} الأسبوع ده` : `No appointments for ${chosenDentist} this week`)
                                    : (ar ? "مفيش مواعيد الأسبوع ده" : "No appointments this week"),
                                )}
                              </div>
                            );
                          }

                          if (phoneView === "dentists") {
                            const sections = dentistChips.map((c) => ({
                              ...c,
                              items: listedAppointments.filter((a) => dentistGrouping.columnOf.get(a.id) === c.id),
                            }));
                            if (sections.length === 0) {
                              return emptyNote(ar ? "مفيش أطباء في الفريق لسه. ضيفهم من صفحة الفريق." : "No dentists on the team yet. Add them on the Team page.");
                            }
                            return (
                              <div className="flex flex-col gap-4 px-1">
                                {sections.map((s) => group(`doc:${s.id}`, s.label, s.items, busySummary(s.items)))}
                              </div>
                            );
                          }

                          if (phoneView === "rooms") {
                            const { columns, columnOf } = roomColumns(branches, scopeBranchId, listedAppointments);
                            if (columns.length === 0) {
                              return emptyNote(ar ? "مفيش غرف متسجلة للفرع ده. ضيف الغرف من الإعدادات ← الفروع والغرف." : "No rooms are set up for this branch. Add them under Settings → Branches & rooms.");
                            }
                            return (
                              <div className="flex flex-col gap-4 px-1">
                                {columns.map((col) => {
                                  const items = listedAppointments.filter((a) => columnOf.get(a.id) === col.id);
                                  const title = col.id === NO_ROOM ? (ar ? "من غير غرفة" : "No room") : col.label;
                                  return group(`room:${col.id}`, title, items, col.id === NO_ROOM ? (ar ? "مواعيد من غير غرفة" : "Visits with no room") : busySummary(items));
                                })}
                              </div>
                            );
                          }

                          // Day
                          return (
                            <div className="flex flex-col gap-3 px-1">
                              {filteredAppointments.length === 0
                                ? emptyNote(
                                    chosenDentist
                                      ? (ar ? `مفيش مواعيد لـ ${chosenDentist} في اليوم ده` : `No appointments for ${chosenDentist} on this day`)
                                      : (ar ? "لا توجد مواعيد" : "No appointments"),
                                  )
                                : filteredAppointments.map(card)}
                            </div>
                          );
                        })()}
                      </div>

                      {/* === DESKTOP: Timeline Grid === */}
                      <div className="hidden lg:block relative min-w-0 lg:min-w-[600px] bg-white/40 backdrop-blur-xl rounded-[2rem] border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden" style={{ height: `${containerHeight + 40}px` }}>
                        <div className="absolute top-[20px] bottom-[20px] left-0 right-0 flex flex-col pointer-events-none">
                          {timeSlots.map((slot, idx) => {
                            const isHourSlot = slot.minutes % 60 === 0;
                            const [timePart, ampm] = slot.label.split(" ");
                            const [hours] = timePart.split(":");
                            const labelText = isHourSlot ? `${Number(hours)} ${ampm}` : "";

                            return (
                              <div
                                key={idx}
                                className={`border-b ${isHourSlot ? 'border-accent-soft/40' : 'border-dashed border-accent-soft/20'} flex-1 relative pointer-events-auto cursor-pointer hover:bg-emerald-50/30 transition-colors group/slot`}
                                style={{ height: `${rowHeight}px` }}
                                onClick={() => {
                                  setAppointmentToEdit(null);
                                  setPreSelectedTime(slot.label);
                                  setActiveModal('booking');
                                }}
                              >
                                {labelText && (
                                  <div className="absolute left-4 top-0 -translate-y-1/2 text-[10px] font-bold text-accent select-none z-10 bg-white/40 px-1 rounded">
                                    {labelText}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="absolute top-[20px] bottom-[20px] left-[80px] right-2 md:right-4 pointer-events-none">
                          {/* Red Time Indicator Line (Renders on current day) */}
                          {showRedLine && (
                            <div
                              className="absolute left-0 right-0 border-t-2 border-red-500 z-40 pointer-events-none flex items-center"
                              style={{ top: `${redLineTop}px` }}
                            >
                              <span className="bg-red-500 text-white font-black text-[9px] rounded px-1.5 py-0.5 shadow-sm transform -translate-y-1/2 -ml-2 select-none">
                                {realTime.toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                            </div>
                          )}

                          {(() => {
                            const visibleAppts = appointments.filter(apt => {
                              const startMin = parseApptTimeToMinutes(apt.time);
                              return startMin >= bounds.start && startMin < bounds.end;
                            }).map(apt => ({
                              ...apt,
                              startMin: parseApptTimeToMinutes(apt.time),
                              endMin: parseApptTimeToMinutes(apt.time) + (apt.duration || 30)
                            })).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

                            const blocks: (typeof visibleAppts)[] = [];
                            let currentBlock: typeof visibleAppts = [];
                            let currentBlockEnd = 0;

                            visibleAppts.forEach(apt => {
                              if (currentBlock.length > 0 && apt.startMin >= currentBlockEnd) {
                                blocks.push(currentBlock);
                                currentBlock = [];
                                currentBlockEnd = 0;
                              }
                              currentBlock.push(apt);
                              currentBlockEnd = Math.max(currentBlockEnd, apt.endMin);
                            });
                            if (currentBlock.length > 0) blocks.push(currentBlock);

                            const positionedAppts: (typeof visibleAppts[0] & { colIndex: number, totalCols: number })[] = [];
                            blocks.forEach(block => {
                              const columns: typeof visibleAppts[] = [];
                              block.forEach(apt => {
                                let placed = false;
                                for (let i = 0; i < columns.length; i++) {
                                  const lastInCol = columns[i][columns[i].length - 1];
                                  if (lastInCol.endMin <= apt.startMin) {
                                    columns[i].push(apt);
                                    positionedAppts.push({ ...apt, colIndex: i, totalCols: 0 });
                                    placed = true;
                                    break;
                                  }
                                }
                                if (!placed) {
                                  columns.push([apt]);
                                  positionedAppts.push({ ...apt, colIndex: columns.length - 1, totalCols: 0 });
                                }
                              });
                              const numCols = columns.length;
                              block.forEach(apt => {
                                const pApt = positionedAppts.find(p => p.id === apt.id);
                                if (pApt) pApt.totalCols = numCols;
                              });
                            });

                            return positionedAppts.map((apt) => {
                              const topOffset = (apt.startMin - bounds.start) * pixelsPerMinute;
                              const durationMinutes = apt.endMin - apt.startMin;
                              const height = Math.max(durationMinutes * pixelsPerMinute, 72); // Compact mobile appointment height
                              const aptStyles = getAppointmentStatusStyles(apt.status);

                              const leftPercent = (apt.colIndex / apt.totalCols) * 100;
                              const widthPercent = (100 / apt.totalCols);

                              return (
                                <div
                                  key={apt.id}
                                  className="absolute group pointer-events-auto p-0.5"
                                  style={{ top: `${topOffset}px`, height: `${height}px`, left: `${leftPercent}%`, width: `${widthPercent}%`, zIndex: 10 + apt.colIndex }}
                                >
                                  {/* Styled exactly like reference image */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAppointment(apt);
                                    }}
                                    className={`w-full h-full rounded-2xl bg-surface border border-slate-100 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md cursor-pointer overflow-hidden flex relative`}
                                  >
                                    {/* Accent color bar on the left */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${aptStyles.accent}`}></div>
                                    <div className="flex-1 flex justify-between items-center px-4 py-2">
                                      {/* Left: Patient Name & Time Range */}
                                      <div className="flex flex-col min-w-0 gap-0.5">
                                        <h4 className="text-xs font-black text-slate-800 truncate">
                                          {apt.patientName}
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-400">
                                          {apt.time} — {getEndTimeStr(apt.time, apt.duration || 30)}
                                        </span>
                                      </div>
                                      {/* Right: Status dot + Label */}
                                      <div className="flex items-center gap-1.5 shrink-0 bg-surface-subtle border border-slate-100 rounded-full px-2.5 py-1">
                                        <span className={`w-1.5 h-1.5 rounded-full ${aptStyles.dot}`} />
                                        <span className="text-[9px] font-black text-ink-body uppercase tracking-wide">
                                          {getAppointmentStageLabel(apt.status, language)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          })()}
                        </div>
                      </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {activeModal === 'booking' && (
        <BookingModal
          // A fresh popup when it turns into Quick Pay, so nothing of the visit it came from carries over.
          key={quickPayMode ? `quickpay-${preSelectedPatient?.id ?? ""}` : "booking"}
          isOpen={true}
          inlineDesktop={false}
          // The new booking pop-up (tabs, timeline, every time of the day), in its phone layout.
          wide
          quickPay={quickPayMode}
          onSaveAndStay={handleSaveBookingAndStay}
          // Delete stays reachable from the visit itself now that a card opens the popup directly.
          // Its dialog asks (once) and closes the popup after a delete — whichever visit it was showing.
          onDelete={(id, visit) => handleDeleteAppointment(id, undefined, { patientName: visit?.patientName, fromPopup: true })}
          // The old appointment sheet's Quick Pay: the patient's whole account. The popup itself
          // turns into Quick Pay for that patient — its payment view is the branch-aware one.
          onPayAccount={(p) => {
            setAppointmentToEdit(null);
            setPreSelectedTime("");
            setPreSelectedDoctor("");
            setPreSelectedClaimLine(null);
            setPreSelectedPatient(p);
            setBookingTab("payment");
            setQuickPayMode(true);
          }}
          onClose={closeBooking}
          onSave={handleSaveBooking}
          patients={patientsList}
          doctors={doctorsList}

          settingsConfig={config}
          editAppointment={appointmentToEdit}
          preSelectedDate={normalizeDateKey(scheduleViewDate)}
          preSelectedTime={preSelectedTime}
          preSelectedDoctor={preSelectedDoctor}
          preSelectedPatient={preSelectedPatient}
          preSelectedClaimLine={preSelectedClaimLine}
          initialTab={bookingTab}
          preSelectedBranchId={scopeBranchId}
          servicesList={servicesList}
        />
      )}

      {pendingDelete && (
        <DeleteAppointmentDialog
          appointmentId={pendingDelete.id}
          patientName={pendingDelete.patientName}
          onCancel={() => setPendingDelete(null)}
          onConfirm={performDelete}
          // Opened from the booking popup (z-[200]); it has to sit above it.
          layerClass="z-[260]"
        />
      )}

      <NewPatientModal isOpen={activeModal === 'patient'} onClose={() => setActiveModal(null)} onSuccess={() => { }} preSelectedBranchId={scopeBranchId} />
      <ApprovalReadSheet
        isOpen={readApproval}
        onClose={() => setReadApproval(false)}
        onPatient={(p) => {
          // The paper found or registered this patient: book them.
          setReadApproval(false);
          setAppointmentToEdit(null);
          setPreSelectedPatient(p);
          setActiveModal('booking');
        }}
      />
      <PrescriptionPrintFinderModal
        isOpen={prescriptionFinderOpen}
        onClose={() => setPrescriptionFinderOpen(false)}
        patients={patientsList}
        language={language === "ar" ? "ar" : "en"}
      />




      {/* The old "Appointment Details" bottom sheet is gone: a card now opens the booking popup on
          that visit, which carries the same edit, the Payment tab (Quick Pay's job) and Delete. */}
      {/* Patient History Drawer */}
      <PatientHistoryDrawer
        isOpen={!!historyDrawerPatientId}
        onClose={() => {
          setHistoryDrawerPatientId("");
          setHistoryDrawerPatientName("");
        }}
        patientId={historyDrawerPatientId}
        patientName={historyDrawerPatientName}
      />


    </div>
  );
}