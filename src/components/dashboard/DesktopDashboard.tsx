"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { 
    Calendar, Plus, ChevronRight, ChevronLeft, Wallet, User, Clock, Check,
    Loader2, Edit, Printer, UserX, MessageCircle, Pill, Receipt,
    X, Save, Trash2, ChevronDown, Bell, UserPlus, AlertCircle, Building2
} from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { 
    collection, query, where, getDocs, orderBy, 
    doc, updateDoc, deleteDoc, onSnapshot, limit, addDoc, serverTimestamp, getDoc, arrayUnion
} from "firebase/firestore";
import PatientHistoryDrawer from "@/components/appointments/PatientHistoryDrawer";
import StarRating from "@/components/StarRating";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import BookingModal, { type BookingEditSnapshot } from "@/components/BookingModal";
import WeeklyScheduleView from "@/components/dashboard/WeeklyScheduleView";
import {
  parseApptTimeToMinutes,
  normalizeDateKey,
  saveBooking,
  normalizeTimeKey,
  updateBookingTime,
} from "@/lib/bookingService";
import LateAppointmentPrompt from "@/components/appointments/LateAppointmentPrompt";
import NewPatientModal from "@/components/NewPatientModal";
import QuickPaymentModal from "@/components/QuickPaymentModal";
import AppointmentSidePanel from "@/components/appointments/AppointmentSidePanel";
import AppointmentAvatarPanel from "@/components/appointments/AppointmentAvatarPanel";
import AppointmentStagePicker from "@/components/appointments/AppointmentStagePicker";
import PrescriptionPrintFinderModal from "@/components/PrescriptionPrintFinderModal";
import WaitingMoodPicker from "@/components/appointments/WaitingMoodPicker";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import ServiceEditorDrawer from "@/components/clinical-notes/ServiceEditorDrawer";
import { logActivity } from "@/lib/logger";
import { MoneyApiError, deleteAppointment } from "@/lib/moneyApi";
import { isDentistStaff } from "@/lib/staffRoles";
import { parseClinicSchedule, clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { useActiveBranch, ALL_BRANCHES } from "@/lib/useActiveBranch";
import BranchSelector from "@/components/shared/BranchSelector";
import type { OwnerAlertKey } from "@/types/whatsapp";
import { sendPatientAppointmentWhatsApp } from "@/lib/sendPatientAppointmentWhatsAppClient";
import { prescriptionPayloadToPdfBlob } from "@/lib/prescriptionPdfHtml";
import {
  buildPrescriptionPayloadFromRecord,
  normalizeRxItemsFromRecord,
  openPrescriptionPdf,
  prescriptionCreatedMs,
} from "@/lib/prescriptionRecord";
import { printPatientReceipt } from "@/lib/printPatientReceipt";
import ReceptionSummonPanel from "@/components/summon/ReceptionSummonPanel";
import { getAppointmentStatusStyles } from "@/lib/appointmentStages";
import UserClockWidget from "@/components/dashboard/UserClockWidget";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
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
  delayedPromptUntil?: number;
};

export default function DesktopDashboard() {
  const { language, isRTL, t } = useLanguage();
  const { user } = useAuth(); 
  const { showToast, confirm, appointmentEditorMode, appointmentPanelMode, setAppointmentPanelMode, latePatientTrackerEnabled } = useUI();
  const router = useRouter();

  const [allAppointments, setAllAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  
  const [patientsList, setPatientsList] = useState<any[]>([]);
  const [doctorsList, setDoctorsList] = useState<any[]>([]);
  const [servicesList, setServicesList] = useState<any[]>([]); // NEW: Added services state
  

  // Modal State
  const [activeModal, setActiveModal] = useState<'patient' | 'booking' | 'payment' | null>(null);
  const [pendingCheckoutPayload, setPendingCheckoutPayload] = useState<any | null>(null);
  const [paymentPatient, setPaymentPatient] = useState<{id: string, name: string} | null>(null);
  const [preSelectedTime, setPreSelectedTime] = useState<string>("");
  const [preSelectedPatient, setPreSelectedPatient] = useState<{ id: string; name: string } | null>(null);
  const [preSelectedDoctor, setPreSelectedDoctor] = useState<string>("");
  const [showDelayPrompt, setShowDelayPrompt] = useState(false);
  const [delayedAppointmentData, setDelayedAppointmentData] = useState<any>(null);
  
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
  const [selectedAppointment, setSelectedAppointment] = useState<DashboardAppointment | null>(null);
  const [appointmentToEdit, setAppointmentToEdit] = useState<BookingEditSnapshot | null>(null);
  const [scheduleViewDate, setScheduleViewDate] = useState(getLocalDateKey);
  // Where this desk is working today. Shared with booking below, so an appointment created from
  // the dashboard is stamped with the branch whose schedule you were looking at.
  const {
    branches,
    activeBranchId,
    setActiveBranchId,
    scopeBranchId,
    matches: branchMatches,
  } = useActiveBranch();
  const scheduleDateInputRef = useRef<HTMLInputElement>(null);
  const lastTapRef = useRef<{ time: number; id: string } | null>(null);
  const [printingRxPatientId, setPrintingRxPatientId] = useState<string | null>(null);
  const [printingReceiptPatientId, setPrintingReceiptPatientId] = useState<string | null>(null);
  const [prescriptionFinderOpen, setPrescriptionFinderOpen] = useState(false);

  // Late Appointment Tracker
  const [realTime, setRealTime] = useState(new Date());
  const [lateApptToPrompt, setLateApptToPrompt] = useState<any>(null);

  useEffect(() => {
    const timer = setInterval(() => setRealTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const isAppointmentLate = (appt: any) => {
    if (!latePatientTrackerEnabled) return false;
    // "Rescheduled" is a resolved marker left on the original slot — the visit that was actually
    // going to happen is a different document now, so this one is never late.
    const activeStatuses = ["Checked In", "In Chair", "Completed", "Checking Out", "Cancelled", "No Show", "Delayed", "Rescheduled"];
    if (activeStatuses.includes(appt.status)) return false;
    if (!appt.date || !appt.time) return false;
    
    const minutes = parseApptTimeToMinutes(appt.time);
    const apptDate = new Date(`${appt.date}T00:00:00`);
    apptDate.setMinutes(minutes);

    const diffMins = (realTime.getTime() - apptDate.getTime()) / 60000;
    if (appt.delayedPromptUntil && realTime.getTime() < appt.delayedPromptUntil) return false;
    
    return diffMins >= 15;
  };

  // Inline editor state
  const [inlineEdit, setInlineEdit] = useState<Record<string, any>>({});

  const [inlineSaving, setInlineSaving] = useState(false);
  const [patientLedger, setPatientLedger] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Inline payment state
  const [showInlinePayment, setShowInlinePayment] = useState(false);
  const [unpaidProcedures, setUnpaidProcedures] = useState<any[]>([]);
  const [selectedProcedure, setSelectedProcedure] = useState<any>(null);
  const [inlinePayAmount, setInlinePayAmount] = useState<number | "">("");
  const [inlinePayLoading, setInlinePayLoading] = useState(false);
  const [unpaidLoading, setUnpaidLoading] = useState(false);

  const [dailyIncome, setDailyIncome] = useState<number | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Fetch Daily Income (Cash-basis)
  useEffect(() => {
    const today = getLocalDateKey();
    const q = query(
      getClinicCollection("ledger"),
      where("date", "==", today)
    );
    const unsub = onSnapshot(q, (snap) => {
      let income = 0;
      snap.forEach((docSnap) => {
        const d = docSnap.data();
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
  }, []);

  const fireOwnerWhatsAppAlert = async (alertKey: OwnerAlertKey, message: string) => {
    try {
      const u = auth.currentUser;
      if (!u) return;
      const idToken = await u.getIdToken();
      await fetch("/api/whatsapp/owner-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ alertKey, message }),
      });
    } catch (e) {
      console.warn("Owner WhatsApp alert", e);
    }
  };

  // 1. Clock Timer
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Fetch ledger entries when selected appointment changes
  useEffect(() => {
    if (!selectedAppointment?.patientId) {
      setPatientLedger([]);
      return;
    }
    setLedgerLoading(true);
    const q = query(
      getClinicCollection("ledger"),
      where("patientId", "==", selectedAppointment.patientId)
    );
    const unsub = onSnapshot(q, (snap) => {
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Client-side sort by createdAt descending
      records.sort((a: any, b: any) => {
        const tA = a.createdAt?.toMillis?.() || 0;
        const tB = b.createdAt?.toMillis?.() || 0;
        return tB - tA;
      });
      setPatientLedger(records);
      setLedgerLoading(false);
    }, (error) => {
      console.error("Ledger query error:", error);
      setLedgerLoading(false);
    });
    return () => unsub();
  }, [selectedAppointment?.patientId]);

  // Initialize inline edit form when appointment is selected
  useEffect(() => {
    if (selectedAppointment) {
      setInlineEdit({
        patientName: selectedAppointment.patientName || '',
        treatment: selectedAppointment.treatment || '',
        doctor: selectedAppointment.doctor || '',
        date: selectedAppointment.date || '',
        time: selectedAppointment.time || '',
        duration: selectedAppointment.duration || 30,
        status: selectedAppointment.status || 'Scheduled',
        notes: selectedAppointment.notes || '',
        cost: selectedAppointment.cost || 0,
        serviceId: selectedAppointment.serviceId || '',
        serviceName: selectedAppointment.serviceName || '',
      });
    }
  }, [selectedAppointment?.id]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedAppointment) return false;
    const fields = ['patientName', 'treatment', 'doctor', 'date', 'time', 'duration', 'status', 'notes', 'cost', 'serviceId'];
    for (const key of fields) {
      let oldVal = (selectedAppointment as any)[key];
      let newVal = inlineEdit[key];
      if (oldVal == null) oldVal = '';
      if (newVal == null) newVal = '';
      if (String(oldVal) !== String(newVal)) return true;
    }
    return false;
  }, [selectedAppointment, inlineEdit]);

  const saveInlineEdit = async (): Promise<boolean> => {
    if (!selectedAppointment) return false;
    if (inlineEdit.status === "Delayed" && selectedAppointment.status !== "Delayed") {
      setDelayedAppointmentData({ ...inlineEdit, id: selectedAppointment.id });
      setShowDelayPrompt(true);
      return false;
    }
    setInlineSaving(true);
    try {
      const updatePayload: any = {
        patientName: inlineEdit.patientName,
        treatment: inlineEdit.treatment,
        doctor: inlineEdit.doctor,
        date: inlineEdit.date,
        time: inlineEdit.time,
        duration: Number(inlineEdit.duration) || 30,
        status: inlineEdit.status,
        notes: inlineEdit.notes,
        cost: Number(inlineEdit.cost) || 0,
        serviceId: inlineEdit.serviceId || null,
        serviceName: inlineEdit.serviceName || null,
        modifiedBy: user?.name || 'System',
        updatedAt: serverTimestamp(),
      };
      
      Object.keys(updatePayload).forEach(key => {
        if (updatePayload[key] === undefined) delete updatePayload[key];
      });

      await updateDoc(getClinicDoc("appointments", selectedAppointment.id), updatePayload);
      showToast(language === 'ar' ? 'تم الحفظ' : 'Saved!', 'success');
      return true;
    } catch (e) {
      console.error(e);
      showToast(language === 'ar' ? 'خطأ' : 'Error saving', 'error');
      return false;
    } finally {
      setInlineSaving(false);
    }
  };

  const handleSelectAppointmentWrapper = async (apt: DashboardAppointment | null, time?: string, date?: string) => {
    if (hasUnsavedChanges && selectedAppointment && apt?.id !== selectedAppointment.id) {
      const wantToSave = await confirm(
        language === "ar" 
          ? "لديك تغييرات غير محفوظة. هل تريد حفظها قبل المتابعة؟" 
          : "You have unsaved changes. Do you want to save them before proceeding?",
        { confirmLabel: language === "ar" ? "حفظ" : "Save", cancelLabel: language === "ar" ? "تجاهل" : "Discard" }
      );
      if (wantToSave) {
        const success = await saveInlineEdit();
        if (!success) return; // if save failed or hit delay prompt, abort switch
      }
    }
    setSelectedAppointment(apt);
    if (!apt && (time || date)) {
      setAppointmentToEdit(null);
      if (time) setPreSelectedTime(time);
      if (date) setScheduleViewDate(date);
      setPreSelectedPatient(null);
      setPreSelectedDoctor("");
      setActiveModal("booking");
    }
  };

  // Fetch only appointments for the current view date (or week range) to prevent severe performance degradation
  // and browser freezes when saving.
  useEffect(() => {
    setLoading(true);
    
    let q;
    if (viewMode === 'day') {
      const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
      q = query(getClinicCollection("appointments"), where("date", "==", viewKey));
    } else {
      const parts = scheduleViewDate.split("-");
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const diffToSat = (d.getDay() + 1) % 7;
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - diffToSat);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      const formatLocalDate = (date: Date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      };
      
      const startOfWeekKey = formatLocalDate(startOfWeek);
      const endOfWeekKey = formatLocalDate(endOfWeek);
      q = query(
        getClinicCollection("appointments"),
        where("date", ">=", startOfWeekKey),
        where("date", "<=", endOfWeekKey)
      );
    }

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
  }, [scheduleViewDate, viewMode]);

  const appointments = useMemo(() => {
    // Branch first: a receptionist at one desk should not be reading the names of people booked
    // across town. `branchMatches` passes everything through when the clinic has no branches, and
    // always passes rows booked before branches existed, which carry no branchId to judge.
    const inBranch = allAppointments.filter((a) => branchMatches(a.branchId));
    if (viewMode === 'day') {
      const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
      return inBranch
        .filter((a) => normalizeDateKey(a.date) === viewKey)
        .sort((a, b) => normalizeTimeKey(a.time).localeCompare(normalizeTimeKey(b.time)));
    } else {
      return inBranch.sort((a, b) => normalizeTimeKey(a.time).localeCompare(normalizeTimeKey(b.time)));
    }
  }, [allAppointments, scheduleViewDate, viewMode, branchMatches]);

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
          .map((s) => ({ id: s.id, name: s.name as string }))
      );
    });
    const unsubServices = onSnapshot(
      getClinicCollection("services"),
      (snap) => setServicesList(snap.docs.map((d) => ({ id: d.id, name: d.data().name, price: d.data().price })))
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
    let confirmed = 0, delayed = 0, canceled = 0, checkedIn = 0, inChair = 0, checkingOut = 0, completed = 0, unconfirmed = 0, rescheduled = 0;
    appointments.forEach(app => {
      const s = app.status?.toLowerCase();
      if (s === 'confirmed') confirmed++;
      else if (s === 'delayed') delayed++;
      else if (s === 'canceled' || s === 'cancelled') canceled++;
      else if (s === 'checked in') checkedIn++;
      else if (s === 'in chair') inChair++;
      else if (s === 'checking out') checkingOut++;
      else if (s === 'completed') completed++;
      // A "Rescheduled" marker is kept visible on its original day on purpose (so the slot doesn't
      // look like it was never booked), but it is not a real visit anymore — the catch-all
      // "unconfirmed" bucket exists to flag bookings that still need action, and this one doesn't.
      else if (s === 'rescheduled') rescheduled++;
      else unconfirmed++;
    });
    return { confirmed, delayed, canceled, checkedIn, inChair, checkingOut, completed, unconfirmed, rescheduled };
  }, [appointments]);

  // "Appointments today" and the status breakdown should count real visits, not a moved-away
  // booking's leftover marker — otherwise a reschedule inflates today's count right after the
  // whole point was to make the schedule honest about what's actually happening.
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



  const handleWaitingMoodChange = async (id: string, waitingMood: string) => {
    try {
      await updateDoc(getClinicDoc("appointments", id), {
        waitingMood,
        updatedAt: serverTimestamp(),
      });
      setAllAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, waitingMood } : a))
      );
      setSelectedAppointment((prev) =>
        prev?.id === id ? { ...prev, waitingMood } : prev
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
      setSelectedAppointment((prev) =>
        prev?.id === id
          ? {
              ...prev,
              status: nextStatus,
              ...(nextStatus === "Checked In" && !prev.waitingMood ? { waitingMood: "neutral" } : {}),
            }
          : prev
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

  const handleLateAction = async (action: "check_in" | "wait" | "cancel" | "delay", newDate?: string, newTime?: string) => {
    if (!lateApptToPrompt) return;
    const appt = lateApptToPrompt;
    try {
      if (action === "wait") {
        const waitTime = Date.now() + 15 * 60000;
        await updateDoc(getClinicDoc("appointments", appt.id), { delayedPromptUntil: waitTime });
        showToast(language === 'ar' ? 'تم تأجيل التنبيه' : 'Prompt snoozed for 15 mins', 'success');
      } else if (action === "check_in" || action === "cancel" || action === "delay") {
        const statusMap = { check_in: "Checked In", cancel: "Cancelled", delay: "Delayed" };
        const dataToSave: any = {
          ...appt,
          existingAppointmentId: appt.id,
          status: statusMap[action],
        };
        if (action === "delay" && newDate && newTime) {
          dataToSave.date = newDate;
          dataToSave.time = newTime;
        }
        await saveBooking(
           dataToSave,
           { uid: user?.uid || 'system', name: user?.name || 'System', role: user?.role || 'staff', language: (language as "en" | "ar") || 'en' },
           async () => {}
        );
      }
    } catch (e) {
      console.error(e);
      showToast(language === 'ar' ? 'خطأ' : 'Error updating appointment', 'error');
    }
    setLateApptToPrompt(null);
  };

  const handleDeleteAppointment = async (e: React.MouseEvent | null | string, id?: string) => {
    const appointmentId = typeof e === 'string' ? e : id;
    if (typeof e !== 'string' && e?.stopPropagation) e.stopPropagation();
    
    if (!appointmentId) return;

    const msg = language === "ar" ? "هل أنت متأكد من الحذف؟" : "Are you sure you want to delete?";
    const confirmed = await confirm(msg, {
      title: language === "ar" ? "حذف الموعد" : "Delete appointment",
      confirmLabel: language === "ar" ? "احذف" : "Delete",
      tone: "danger",
    });
    if (confirmed) {
      try {
        // "keep" is the safe default from a dashboard card: the confirm here is a plain yes/no,
        // with no room to show what would be lost, so a visit's recorded treatments are detached
        // into the patient's history rather than deleted. The calendar's own delete offers the
        // full choice — see DeleteAppointmentDialog.
        await deleteAppointment(appointmentId, "keep");
        setAllAppointments((prev) => prev.filter((appt) => appt.id !== appointmentId));
        showToast(language === "ar" ? "تم الحذف" : "Deleted", "success");
        
        if (selectedAppointment?.id === appointmentId) {
          setSelectedAppointment(null);
        }
        if (appointmentToEdit?.id === appointmentId) {
          setAppointmentToEdit(null);
          setActiveModal(null);
        }
      } catch (error) {
        // This used to swallow the error entirely, so a refused delete looked to the user like
        // nothing had happened at all — the exact silent failure worth never shipping again.
        console.error(error);
        showToast(
          error instanceof MoneyApiError
            ? error.message
            : language === "ar" ? "حدث خطأ أثناء الحذف" : "Could not delete that appointment",
          "error"
        );
      }
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
  /**
   * Whether the right-hand column has anything to hold. Three things can fill it, and the column
   * has to stay open for all of them, not just a selected appointment:
   *   - an appointment is selected (the editor or the assistant is showing it)
   *   - the assistant is the chosen panel, which stays available with nothing selected precisely
   *     so it can be asked to find something
   *   - a booking is being made in drawer mode, which renders the form in this column
   * Anything else and it closes, handing the width to the schedule.
   */
  const sidePanelOpen =
    !!selectedAppointment ||
    (appointmentPanelMode === "avatar" && activeModal !== "booking") ||
    (activeModal === "booking" && appointmentEditorMode === "drawer");


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
    <div className={`min-h-screen lg:min-h-0 lg:h-full relative overflow-hidden pb-24 lg:pb-0 font-sans text-ink-slab lg:text-white ${isRTL ? 'text-right' : 'text-left'}`}>
      <div className="relative z-10 w-full max-w-[1920px] mx-auto p-4 md:p-6 md:pt-8 lg:p-4 lg:pt-3 space-y-3 md:space-y-4 lg:space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500 lg:h-full lg:flex lg:flex-col">
        
        {/* === DESKTOP: Compact Command Bar (greeting + stats + actions in one strip) === */}
        {!isFullScreen && (
          <div className="hidden lg:flex items-center gap-3 shrink-0 py-1">

            {/* Greeting */}
            <div className="flex flex-col min-w-0 shrink">
              <h1 className="text-2xl xl:text-[1.75rem] font-light text-slate-800 tracking-tight leading-tight truncate">
                {language === 'ar' ? 'أهلاً بك،' : 'Welcome in,'} <span className="font-semibold text-ink">{getWelcomeName(user?.name)}</span>
              </h1>
              <p className="flex items-center gap-2 text-xs font-medium text-ink-muted mt-0.5 whitespace-nowrap">
                <span className="flex items-center gap-1"><Calendar size={13} className="text-slate-400" /> {currentTime.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                <span className="flex items-center gap-1"><Clock size={13} className="text-slate-400" /> {currentTime.toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
              </p>
            </div>

            {/* Stat strip */}
            <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
              <div className="flex items-center gap-1 min-w-0 bg-white/90 backdrop-blur-xl border border-white/60 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] px-3 py-2">

                {/* Daily Income */}
                <div className="flex flex-col justify-center px-2 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-none">{language === 'ar' ? 'دخل اليوم' : 'Income'}</span>
                  <span className="flex items-center text-lg font-semibold text-slate-800 leading-none mt-1.5">
                    {dailyIncome === null
                      ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                      : <>{dailyIncome.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}<span className="text-[11px] font-normal text-slate-400 ms-1">{language === 'ar' ? 'ج.م' : 'EGP'}</span></>}
                  </span>
                </div>

                <span className="w-px h-8 bg-slate-200/70 shrink-0" />

                {/* Appointments */}
                <div className="flex flex-col justify-center px-2 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-none">{language === 'ar' ? 'المواعيد' : 'Appts'}</span>
                  <span className="text-lg font-semibold text-ink-strong leading-none mt-1.5">{activeAppointmentsCount}</span>
                </div>

                <span className="w-px h-8 bg-slate-200/70 shrink-0" />

                {/* Appointment status chips */}
                <div className="flex items-center gap-1.5 px-1 shrink-0">
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-100/70 px-2.5 py-1.5" title={language === 'ar' ? 'مؤكد' : 'Confirmed'}>
                    <span className="w-1.5 h-1.5 rounded-full bg-ink-slab shrink-0" />
                    <span className="hidden 2xl:inline text-[10px] font-bold uppercase tracking-wide text-slate-500">{language === 'ar' ? 'مؤكد' : 'Confirmed'}</span>
                    <span className="text-sm font-extrabold text-ink-slab leading-none">{summaryStats.confirmed}</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-2.5 py-1.5" title={language === 'ar' ? 'غير مؤكد' : 'Unconfirmed'}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="hidden 2xl:inline text-[10px] font-bold uppercase tracking-wide text-amber-700/70">{language === 'ar' ? 'غير مؤكد' : 'Unconfirmed'}</span>
                    <span className="text-sm font-extrabold text-amber-600 leading-none">{summaryStats.unconfirmed}</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-2.5 py-1.5" title={language === 'ar' ? 'مكتمل' : 'Completed'}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="hidden 2xl:inline text-[10px] font-bold uppercase tracking-wide text-emerald-700/70">{language === 'ar' ? 'مكتمل' : 'Completed'}</span>
                    <span className="text-sm font-extrabold text-emerald-600 leading-none">{summaryStats.completed}</span>
                  </div>
                </div>

                {/* Long-wait alert (only shown when someone has actually been waiting) */}
                {(() => {
                  let waitingTooLongCount = 0;
                  const now = new Date();
                  appointments.forEach(app => {
                    if (app.status?.toLowerCase() === 'checked in' && app.checkInTime) {
                      const checkInDate = typeof app.checkInTime.toDate === 'function'
                        ? app.checkInTime.toDate()
                        : new Date(app.checkInTime);
                      const diffMins = (now.getTime() - checkInDate.getTime()) / (1000 * 60);
                      if (diffMins > 20) {
                        waitingTooLongCount++;
                      }
                    }
                  });

                  if (waitingTooLongCount === 0) return null;

                  return (
                    <div
                      className="flex items-center gap-1.5 bg-rose-50 border border-rose-100 text-rose-700 px-2.5 py-1.5 rounded-xl text-xs font-bold animate-pulse shrink-0 ms-1"
                      title={language === 'ar'
                        ? waitingTooLongCount + ' مريض ينتظر لأكثر من ٢٠ دقيقة!'
                        : waitingTooLongCount + ' patient(s) waiting > 20m!'}
                    >
                      <AlertCircle size={14} className="shrink-0 text-rose-500" />
                      <span>{waitingTooLongCount}</span>
                      <span className="hidden 2xl:inline">{language === 'ar' ? 'ينتظر +٢٠ د' : 'waiting > 20m'}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Attendance / shift clock */}
              <UserClockWidget compact />
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setActiveModal('patient')}
                title={language === 'ar' ? 'مريض جديد' : 'New Patient'}
                className="group flex items-center gap-2 bg-white/90 backdrop-blur-md text-slate-700 font-bold text-sm px-4 py-2.5 rounded-2xl hover:-translate-y-0.5 transition-all duration-300 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50"
              >
                <Plus size={18} strokeWidth={2.5} className="text-ink-muted group-hover:text-ink-strong transition-colors shrink-0" />
                <span className="hidden xl:inline whitespace-nowrap">{language === 'ar' ? 'مريض جديد' : 'New Patient'}</span>
              </button>
              <button
                onClick={() => { setPaymentPatient(null); setActiveModal('payment'); }}
                title={language === 'ar' ? 'دفع سريع' : 'Quick Pay'}
                className="group flex items-center gap-2 bg-ink-strong text-white font-bold text-sm px-4 py-2.5 rounded-2xl hover:-translate-y-0.5 transition-all duration-300 shadow-[0_8px_20px_rgba(45,55,72,0.2)] border border-ink-strong"
              >
                <Wallet size={18} strokeWidth={2.5} className="shrink-0" />
                <span className="hidden xl:inline whitespace-nowrap">{language === 'ar' ? 'دفع سريع' : 'Quick Pay'}</span>
              </button>
            </div>
          </div>
        )}


        {/* === MOBILE: Widget Cards Grid (hidden on desktop) === */}
        {!isFullScreen && (
          <div className="grid grid-cols-2 gap-4 lg:hidden">
            {/* 1. LIVE DATE WIDGET (1x1, Top Left) */}
            {/* 1. LIVE DATE WIDGET (1x1, Top Left) */}
            <div className="col-span-1 row-span-1 bg-surface text-slate-800 rounded-2xl p-4 shadow-[0_8px_20px_rgb(0,0,0,0.08)] flex flex-col justify-center items-center text-center">
                <span className="text-4xl md:text-5xl lg:text-7xl font-black tracking-tighter leading-none">
                    {currentTime.getDate()}
                </span>
                <div className="flex flex-col mt-2">
                    <span className="text-[10px] md:text-xs lg:text-sm font-extrabold text-ink-muted lg:text-ink-body uppercase tracking-widest">
                        {currentTime.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'short' })}
                    </span>
                    <span className="text-[10px] md:text-xs lg:text-sm font-extrabold text-ink-muted lg:text-ink-body">
                        {currentTime.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long' })}
                    </span>
                </div>
            </div>

            {/* 2. QUICK ACTIONS WIDGET (1x2, Top Right) */}
            <div className="col-span-1 row-span-2 bg-white text-slate-800 rounded-2xl p-4 shadow-[0_8px_20px_rgb(0,0,0,0.05)] border border-slate-100 flex flex-col justify-center">
                <div className="grid grid-cols-2 gap-3 h-full">
                    <button onClick={() => setActiveModal('patient')} className="flex flex-col items-center justify-center gap-1.5 lg:gap-2 hover:scale-[1.05] transition-transform group">
                        <div className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full bg-accent-tint text-accent flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-colors shadow-sm">
                            <User size={28} className="scale-75 lg:scale-100" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] md:text-xs lg:text-sm font-extrabold text-slate-600 lg:text-slate-700">{language === 'ar' ? 'مريض' : 'Patient'}</span>
                    </button>
                    <button onClick={() => { setAppointmentToEdit(null); setActiveModal('booking'); }} className="flex flex-col items-center justify-center gap-1.5 lg:gap-2 hover:scale-[1.05] transition-transform group">
                        <div className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full bg-accent-tint text-accent flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-colors shadow-sm">
                            <Calendar size={28} className="scale-75 lg:scale-100" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] md:text-xs lg:text-sm font-extrabold text-slate-600 lg:text-slate-700">{language === 'ar' ? 'زيارة' : 'Visit'}</span>
                    </button>
                    <button onClick={() => { setPaymentPatient(null); setActiveModal('payment'); }} className="flex flex-col items-center justify-center gap-1.5 lg:gap-2 hover:scale-[1.05] transition-transform group">
                        <div className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full bg-accent-tint text-accent flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-colors shadow-sm">
                            <Wallet size={28} className="scale-75 lg:scale-100" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] md:text-xs lg:text-sm font-extrabold text-slate-600 lg:text-slate-700">{language === 'ar' ? 'دفع' : 'Pay'}</span>
                    </button>
                    <div className="flex flex-col items-center justify-center gap-1.5 lg:gap-2 hover:scale-[1.05] transition-transform group relative">
                        <div className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full bg-warn-tint text-warn flex items-center justify-center group-hover:bg-warn group-hover:text-white transition-colors shadow-sm relative z-10">
                            <div className="opacity-0 absolute inset-0"><ReceptionSummonPanel /></div>
                            <Bell size={28} className="scale-75 lg:scale-100" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] md:text-xs lg:text-sm font-extrabold text-slate-600 lg:text-slate-700">
                            {language === 'ar' ? 'استدعاء' : 'Summon'}
                        </span>
                    </div>
                </div>
            </div>

            {/* 3. DAILY INCOME WIDGET (1x2, Middle Left) */}
            <div className="col-span-1 row-span-2 bg-gradient-to-br from-accent-soft to-accent text-white rounded-2xl p-5 shadow-lg flex flex-col justify-between relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/20 rounded-full blur-[20px]"></div>
                
                <div className="flex flex-col h-full z-10 relative">
                    <div className="flex items-center gap-1.5 opacity-90">
                        <Wallet size={16} />
                        <span className="text-[10px] lg:text-xs font-extrabold uppercase tracking-widest">{language === 'ar' ? 'دخل اليوم' : 'Daily Income'}</span>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight drop-shadow-sm">
                                {dailyIncome === null ? <Loader2 className="w-8 h-8 animate-spin inline-block" /> : `$${dailyIncome.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}`}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 4. QUICK SUMMARY WIDGET (1x1, Middle Right) */}
            <div className="col-span-1 row-span-1 bg-info-tint text-info rounded-2xl p-4 shadow-[0_8px_20px_rgb(0,0,0,0.08)] flex items-center">
                <div className="w-full flex flex-col gap-3 justify-center h-full">
                    <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-emerald-100 lg:bg-emerald-50 lg:border lg:border-emerald-100 flex items-center justify-center"><div className="w-3 h-3 lg:w-4 lg:h-4 rounded-full bg-emerald-500"></div></div>
                            <span className="text-[10px] lg:text-xs font-extrabold text-ink-muted lg:text-ink-body uppercase tracking-wide">{language === 'ar' ? 'مؤكد' : 'Confirmed'}</span>
                        </div>
                        <span className="text-lg lg:text-2xl font-black">{summaryStats.confirmed}</span>
                    </div>
                    <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-amber-100 lg:bg-amber-50 lg:border lg:border-amber-100 flex items-center justify-center"><div className="w-3 h-3 lg:w-4 lg:h-4 rounded-full bg-amber-500"></div></div>
                            <span className="text-[10px] lg:text-xs font-extrabold text-ink-muted lg:text-ink-body uppercase tracking-wide">{language === 'ar' ? 'متأخر' : 'Delayed'}</span>
                        </div>
                        <span className="text-lg lg:text-2xl font-black">{summaryStats.delayed}</span>
                    </div>
                    <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-rose-100 lg:bg-rose-50 lg:border lg:border-rose-100 flex items-center justify-center"><div className="w-3 h-3 lg:w-4 lg:h-4 rounded-full bg-rose-500"></div></div>
                            <span className="text-[10px] lg:text-xs font-extrabold text-ink-muted lg:text-ink-body uppercase tracking-wide">{language === 'ar' ? 'ملغي' : 'Canceled'}</span>
                        </div>
                        <span className="text-lg lg:text-2xl font-black">{summaryStats.canceled}</span>
                    </div>
                </div>
            </div>
        </div>
        )}

        {/* === MAIN DASHBOARD CONTENT: Schedule + Detail === */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-0 mt-4 lg:mt-0">
            
            {/* 5. SCHEDULE LIST WIDGET */}
            <div className="flex-1 flex flex-col bg-white/80 backdrop-blur-3xl border border-white rounded-[2.5rem] shadow-[0_8px_40px_rgb(0,0,0,0.05)] h-[600px] lg:h-full lg:min-h-0 overflow-hidden">
                <div className="flex justify-between items-center gap-3 px-6 py-5 border-b border-slate-100/50 bg-transparent shrink-0">
                    <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-ink-slab text-white flex items-center justify-center shrink-0 shadow-md">
                        <Calendar size={20} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0 bg-slate-100/80 rounded-xl p-1 shadow-inner mr-1">
                        <button 
                          type="button"
                          onClick={() => {
                            const d = new Date(`${scheduleViewDate}T12:00:00`);
                            d.setDate(d.getDate() - (viewMode === 'week' ? 7 : 1));
                            setScheduleViewDate(d.toISOString().split("T")[0]);
                          }}
                          className="p-1.5 rounded-lg text-ink-muted hover:bg-surface hover:text-slate-800 hover:shadow-sm transition-all"
                          aria-label={viewMode === 'week' ? (language === 'ar' ? 'الأسبوع السابق' : 'Previous Week') : (language === 'ar' ? 'اليوم السابق' : 'Previous Day')}
                        >
                          <ChevronLeft size={16} className={isRTL ? "rotate-180" : ""} />
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            const d = new Date(`${scheduleViewDate}T12:00:00`);
                            d.setDate(d.getDate() + (viewMode === 'week' ? 7 : 1));
                            setScheduleViewDate(d.toISOString().split("T")[0]);
                          }}
                          className="p-1.5 rounded-lg text-ink-muted hover:bg-surface hover:text-slate-800 hover:shadow-sm transition-all"
                          aria-label={viewMode === 'week' ? (language === 'ar' ? 'الأسبوع التالي' : 'Next Week') : (language === 'ar' ? 'اليوم التالي' : 'Next Day')}
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
                      {!isScheduleToday && (
                        <button
                          type="button"
                          onClick={() => setScheduleViewDate(getLocalDateKey())}
                          className="shrink-0 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-primary-700 transition hover:bg-primary-100 ml-2"
                        >
                          {language === "ar" ? "اليوم" : "Today"}
                        </button>
                      )}
                      <div className="flex items-center gap-1 shrink-0 bg-slate-100/80 rounded-xl p-1 shadow-inner ml-2">
                        <button
                          type="button"
                          onClick={() => setViewMode("day")}
                          className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${viewMode === 'day' ? 'bg-surface text-slate-800 shadow-sm' : 'text-ink-muted hover:text-slate-800'}`}
                        >
                          {language === 'ar' ? 'يومي' : 'Day'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode("week")}
                          className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${viewMode === 'week' ? 'bg-surface text-slate-800 shadow-sm' : 'text-ink-muted hover:text-slate-800'}`}
                        >
                          {language === 'ar' ? 'أسبوعي' : 'Week'}
                        </button>
                      </div>
                      
                      {/* Full Screen Toggle */}
                      <button
                        type="button"
                        onClick={() => setIsFullScreen(!isFullScreen)}
                        className={`ml-2 p-1.5 rounded-lg transition-all ${isFullScreen ? 'bg-primary-100 text-primary-700 shadow-inner' : 'bg-slate-100/80 text-ink-muted hover:text-slate-800 hover:bg-slate-200'}`}
                        aria-label="Toggle Full Screen"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           {isFullScreen ? (
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                           ) : (
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                           )}
                        </svg>
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-center">
                      {/* Which branch's day this is. Renders nothing for a single-site clinic. */}
                      <BranchSelector
                        branches={branches}
                        value={activeBranchId}
                        onChange={setActiveBranchId}
                      />
                      <button
                        type="button"
                        onClick={() => setPrescriptionFinderOpen(true)}
                        className="flex items-center gap-1.5 rounded-full bg-ink-strong px-5 py-2 text-xs font-bold text-white transition hover:bg-ink-slab shadow-sm hover:shadow-md"
                      >
                        <Pill size={14} />
                        {language === "ar" ? "طباعة وصفة" : "Print Rx"}
                      </button>
                      <Link href="/appointments" className="flex items-center gap-1 rounded-full bg-surface border border-line px-3 lg:px-4 py-1.5 lg:py-2 text-[10px] lg:text-xs font-bold text-ink-body transition hover:bg-surface-subtle hover:shadow-sm">
                        {language === "ar" ? "عرض الكل" : "View All"}
                        <ChevronRight size={12} className={`lg:w-3.5 lg:h-3.5 ${isRTL ? "rotate-180" : ""}`} />
                      </Link>
                    </div>
                </div>
                <div className="flex flex-col flex-1 min-h-[400px] overflow-hidden relative">
                    {loading ? (
                        <div className="py-32 flex justify-center"><Loader2 className="animate-spin text-primary-500" size={32} /></div>
                    ) : (
                        <div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar relative">
                            {viewMode === "week" ? (
                                <WeeklyScheduleView
                                    appointments={appointments}
                                    currentDate={scheduleViewDate}
                                    language={language === "ar" ? "ar" : "en"}
                                    config={config}
                                    patientsList={patientsList}
                                    onSelectAppointment={handleSelectAppointmentWrapper}
                                />
                            ) : (() => {
                                const sched = config;
                                const bounds = clinicDayBoundsMinutes(sched);
                                const slotDuration = sched.slotDuration || 30;
                                const rowHeight = 148;
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

                                return (
                                    <div 
                                        className="relative min-w-0 lg:min-w-[600px] bg-white/40 backdrop-blur-xl rounded-[2rem] border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden" 
                                        style={{ height: `${containerHeight}px` }}
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const dataStr = e.dataTransfer.getData("text/plain");
                                            if (!dataStr) return;
                                            try {
                                                const data = JSON.parse(dataStr);
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const y = e.clientY - rect.top;
                                                
                                                const minsFromStart = Math.round((y / pixelsPerMinute) / 5) * 5;
                                                const m = bounds.start + minsFromStart;
                                                const h = Math.floor(m / 60);
                                                const mins = m % 60;
                                                const newTime = `${h.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
                                                
                                                void updateBookingTime(data.id, scheduleViewDate, newTime);
                                            } catch(err) { console.error(err); }
                                        }}
                                    >
                                        <div className="absolute inset-0 flex flex-col pointer-events-none">
                                            {timeSlots.map((slot, idx) => (
                                                <div 
                                                    key={idx} 
                                                    className="border-b border-dashed border-slate-300/60 flex-1 relative pointer-events-auto cursor-pointer hover:bg-white/50 transition-colors group/slot"
                                                    style={{ height: `${rowHeight}px` }}
                                                    onClick={() => {
                                                        handleSelectAppointmentWrapper(null);
                                                        setAppointmentToEdit(null);
                                                        setPreSelectedTime(slot.label);
                                                        setActiveModal('booking');
                                                    }}
                                                >
                                                    <div className="absolute left-2 md:left-4 top-0 -translate-y-1/2 bg-white/40 backdrop-blur-md px-3 py-0.5 text-xs font-medium text-ink-muted group-hover/slot:text-ink transition-colors z-0 w-[84px] text-center rounded-full border border-white shadow-sm">
                                                        {slot.label}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="absolute inset-0 left-[88px] md:left-[104px] right-2 md:right-4 pointer-events-none">
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
                                                    const height = Math.max(durationMinutes * pixelsPerMinute, 120);
                                                    const aptStyles = getAppointmentStatusStyles(apt.status);
                                                    
                                                    const leftPercent = (apt.colIndex / apt.totalCols) * 100;
                                                    const widthPercent = (100 / apt.totalCols);

                                                    // Dynamic font sizes based on card size (duration)
                                                    let nameFontSize = "text-xs md:text-sm lg:text-base";
                                                    let timeFontSize = "text-[10px] md:text-xs lg:text-xs";
                                                    let infoFontSize = "text-[10px] md:text-xs lg:text-sm";

                                                    if (durationMinutes > 30 && durationMinutes <= 60) {
                                                        nameFontSize = "text-sm md:text-base lg:text-base";
                                                        timeFontSize = "text-xs md:text-sm lg:text-xs";
                                                        infoFontSize = "text-xs md:text-sm lg:text-sm";
                                                    } else if (durationMinutes > 60) {
                                                        nameFontSize = "text-base md:text-lg lg:text-base";
                                                        timeFontSize = "text-sm md:text-base lg:text-xs";
                                                        infoFontSize = "text-sm md:text-base lg:text-sm";
                                                    }
                                                    
                                                    const phone = patientsList.find(p => p.id === apt.patientId)?.phone;

                                                    return (
                                                        <div 
                                                            key={apt.id}
                                                            className="absolute group pointer-events-auto p-0.5 hover:!z-[60]"
                                                            style={{ top: `${topOffset}px`, height: `${height}px`, left: `${leftPercent}%`, width: `${widthPercent}%`, zIndex: 10 + apt.colIndex }}
                                                        >
                                                            <div 
                                                                draggable={true}
                                                                onDragStart={(e) => {
                                                                    e.dataTransfer.setData("text/plain", JSON.stringify({ id: apt.id }));
                                                                    setTimeout(() => { if (e.target instanceof HTMLElement) e.target.style.opacity = '0.5'; }, 0);
                                                                }}
                                                                onDragEnd={(e) => {
                                                                    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1';
                                                                }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (isAppointmentLate(apt)) {
                                                                       setLateApptToPrompt(apt);
                                                                       return;
                                                                    }
                                                                    const currentTime = new Date().getTime();
                                                                    const tapDelay = 300;
                                                                    if (lastTapRef.current && (currentTime - lastTapRef.current.time) < tapDelay && lastTapRef.current.id === apt.id) {
                                                                        setAppointmentToEdit({
                                                                            id: apt.id, patientId: String(apt.patientId), patientName: apt.patientName!,
                                                                            treatment: apt.treatment!, doctor: apt.doctor!, date: apt.date!,
                                                                            time: apt.time!, duration: apt.duration!, clinicalNoteId: apt.clinicalNoteId ?? null,
                                                                            cost: apt.cost!,
                                                                            listPrice: apt.listPrice ?? undefined, discountMode: apt.discountMode ?? undefined,
                                                                            discountPercent: apt.discountPercent ?? undefined, discountFixed: apt.discountFixed ?? undefined,
                                                                            discountAmount: apt.discountAmount ?? undefined, notes: apt.notes!, status: apt.status || "Scheduled",
                                                                        });
                                                                        setActiveModal("booking");
                                                                        lastTapRef.current = null;
                                                                    } else {
                                                                        lastTapRef.current = { time: currentTime, id: apt.id };
                                                                        handleSelectAppointmentWrapper(apt);
                                                                    }
                                                                }}
                                                                className={`w-full h-full rounded-2xl transition-all hover:shadow-2xl hover:-translate-y-1 hover:z-[60] cursor-grab active:cursor-grabbing flex flex-col relative pl-4 shadow-sm hover:ring-2 hover:ring-white/50 ${selectedAppointment?.id === apt.id ? 'ring-4 ring-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-20 -translate-y-1' : ''} ${aptStyles.card.replace(/opacity-\d+/, '')} ${isAppointmentLate(apt) ? 'animate-pulse ring-4 ring-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)] z-30' : ''}`}
                                                                style={{ zIndex: selectedAppointment?.id === apt.id ? 20 : 1 }}
                                                            >
                                                            <div className={`absolute left-0 top-0 bottom-0 w-2 ${aptStyles.accent}`}></div>
                                                            <div className="flex flex-col h-full p-2 lg:p-3 relative justify-between gap-1">
                                                                {/* TOP ROW: Name + Actions */}
                                                                <div className="flex justify-between items-start w-full gap-2">
                                                                    <div className="flex flex-col min-w-0">
                                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                                            <h4 className={`font-medium truncate drop-shadow-sm ${nameFontSize}`}>
                                                                                {apt.patientName}
                                                                            </h4>
                                                                            {/* Only while looking at every branch at once — inside a single
                                                                                branch the chip would repeat the same word on every card. */}
                                                                            {activeBranchId === ALL_BRANCHES && apt.branchName && (
                                                                                <span className="shrink-0 inline-flex items-center gap-1 rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-bold text-ink-body">
                                                                                    <Building2 size={9} />
                                                                                    {apt.branchName}
                                                                                </span>
                                                                            )}
                                                                            {(apt.status === "Checked In" || apt.waitingMood) && (
                                                                                <span onClick={(e) => e.stopPropagation()} className="shrink-0 scale-75 lg:scale-100 origin-left">
                                                                                    <WaitingMoodPicker
                                                                                        value={apt.waitingMood || "neutral"}
                                                                                        onChange={(m) => void handleWaitingMoodChange(apt.id, m)}
                                                                                        language={language === "ar" ? "ar" : "en"}
                                                                                    />
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        {patientsList.find(p => p.id === apt.patientId)?.phone && (
                                                                            <span className="text-[10px] text-ink-muted font-medium truncate mt-0.5" dir="ltr">
                                                                                {patientsList.find(p => p.id === apt.patientId)?.phone}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-0.5 shrink-0 z-20">
                                                                        {(() => {
                                                                           const getAction = () => {
                                                                               // Must be the canonical stage values: handleStatusChange keys the checkInTime stamp
                                                                               // and the attendance record off the exact string "Checked In", so the old
                                                                               // "Arrived"/"Seated" pair silently skipped both.
                                                                               if (apt.status === "Scheduled" || apt.status === "Confirmed") return { label: language === 'ar' ? 'وصول' : 'Arrive', next: "Checked In" };
                                                                               if (apt.status === "Checked In") return { label: language === 'ar' ? 'دخول' : 'Seat', next: "In Chair" };
                                                                               if (apt.status === "In Chair") return { label: language === 'ar' ? 'خروج' : 'Check Out', next: "Checking Out" };
                                                                               return null;
                                                                           };
                                                                           const action = getAction();
                                                                           if (!action) return null;
                                                                           return (
                                                                               <button 
                                                                                   onClick={(e) => { e.stopPropagation(); handleStatusChange(apt.id, action.next); }} 
                                                                                   className={`px-4 py-1.5 text-[11px] font-extrabold rounded-full mr-2 transition-all shadow-md hover:-translate-y-0.5 bg-ink-strong text-white hover:shadow-lg hover:bg-slate-800 border border-white/20`}
                                                                               >
                                                                                   {action.label}
                                                                               </button>
                                                                           );
                                                                        })()}
                                                                        <button onClick={(e) => { 
                                                                          e.stopPropagation(); 
                                                                          setHistoryDrawerPatientId(String(apt.patientId));
                                                                          setHistoryDrawerPatientName(apt.patientName!);
                                                                        }} className="p-1 text-amber-600 bg-surface shadow-sm ring-1 ring-amber-600/20 hover:text-amber-700 hover:bg-amber-50 hover:ring-amber-600/40 hover:shadow rounded-lg transition-all" title={language === 'ar' ? 'سجل الزيارات' : 'Visit History'}><Clock strokeWidth={2.5} className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => { e.stopPropagation(); router.push(`/patients/${apt.patientId}`); }} className="p-1 text-blue-600 bg-surface shadow-sm ring-1 ring-blue-600/20 hover:text-blue-700 hover:bg-blue-50 hover:ring-blue-600/40 hover:shadow rounded-lg transition-all" title={language === 'ar' ? 'الملف الشخصي' : 'Profile'}><User strokeWidth={2.5} className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => { e.stopPropagation(); setPaymentPatient({ id: apt.patientId!, name: apt.patientName! }); setActiveModal('payment'); }} className="p-1 text-emerald-600 bg-surface shadow-sm ring-1 ring-emerald-600/20 hover:text-emerald-700 hover:bg-emerald-50 hover:ring-emerald-600/40 hover:shadow rounded-lg transition-all" title={language === 'ar' ? 'دفع' : 'Pay'}><Wallet strokeWidth={2.5} className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setAppointmentToEdit({
                                                                                id: apt.id, patientId: String(apt.patientId), patientName: apt.patientName!,
                                                                                treatment: apt.treatment!, doctor: apt.doctor!, date: apt.date!,
                                                                                time: apt.time!, duration: apt.duration!, clinicalNoteId: apt.clinicalNoteId ?? null,
                                                                                cost: apt.cost!,
                                                                                listPrice: apt.listPrice ?? undefined, discountMode: apt.discountMode ?? undefined,
                                                                                discountPercent: apt.discountPercent ?? undefined, discountFixed: apt.discountFixed ?? undefined,
                                                                                discountAmount: apt.discountAmount ?? undefined, notes: apt.notes!, status: apt.status || "Scheduled",
                                                                            });
                                                                            setActiveModal("booking");
                                                                        }} className="p-1 text-indigo-600 bg-surface shadow-sm ring-1 ring-indigo-600/20 hover:text-indigo-700 hover:bg-indigo-50 hover:ring-indigo-600/40 hover:shadow rounded-lg transition-all" title={language === 'ar' ? 'تعديل' : 'Edit'}><Edit strokeWidth={2.5} className="w-4 h-4 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => handleDeleteAppointment(e, apt.id)} className="p-1 text-rose-600 bg-surface shadow-sm ring-1 ring-rose-600/20 hover:text-rose-700 hover:bg-rose-50 hover:ring-rose-600/40 hover:shadow rounded-lg transition-all" title={language === 'ar' ? 'حذف' : 'Delete'}><Trash2 strokeWidth={2.5} className="w-4 h-4 lg:w-4 lg:h-4" /></button>
                                                                    </div>
                                                                </div>

                                                                {/* BOTTOM ROW: Treatment + Time */}
                                                                <div className="flex justify-between items-end w-full gap-2 mt-1.5 min-h-0">
                                                                    <div className="flex flex-col gap-1 min-w-0">
                                                                       <p className={`text-slate-800 truncate font-bold bg-white/60 lg:bg-white/80 backdrop-blur-sm px-2 py-0.5 rounded-md shadow-sm min-w-0 ${infoFontSize}`}>
                                                                           {apt.treatment || "Consultation"} <span className="text-slate-400 mx-1 font-normal">•</span> Dr. {apt.doctor?.split(" ")[1] || apt.doctor}
                                                                       </p>
                                                                       <div className="pl-1 mt-0.5">
                                                                         <StarRating rating={apt.rating || 0} onRatingChange={(r) => handleRatingChange(apt.id, r)} size={14} />
                                                                       </div>
                                                                    </div>
                                                                    <span className={`font-black text-ink-body lg:text-indigo-950 opacity-80 whitespace-nowrap shrink-0 bg-white/40 px-1.5 py-0.5 rounded-md ${timeFontSize}`}>
                                                                        {apt.time} ({durationMinutes}m)
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
                                );
                            })()}
                        </div>
                    )}
                </div>
            </div>

            {/* 6. PATIENT LEDGER / EDIT PANEL */}
            {/*
              The column collapses to nothing when there is nothing to put in it, so the schedule
              gets the width back instead of staring at a placeholder. It animates rather than
              snapping, because in Week view an instant change re-flows seven day columns and reads
              as a glitch; the slide makes it legible as one thing giving way to another.

              The gap lives on this element rather than on the row, so a collapsed panel leaves no
              orphaned 16px between the schedule and the edge. The inner shell keeps its full width
              throughout, so the panel slides out of view instead of squashing on the way.
            */}
            <div
              className={`hidden lg:flex shrink-0 min-w-0 flex-col z-20 overflow-hidden transition-[width,margin,opacity] duration-300 ease-out motion-reduce:transition-none ${
                sidePanelOpen
                  ? "lg:w-[400px] xl:w-[450px] lg:ms-4 opacity-100"
                  : "lg:w-[0px] lg:ms-[0px] opacity-0 pointer-events-none"
              }`}
              aria-hidden={!sidePanelOpen}
            >
             <div className="w-[400px] xl:w-[450px] h-full flex flex-col gap-4">
               {/* The assistant stays available with nothing selected — that is when you ask it to
                   find an appointment. The editor has nothing to show without one, so the column
                   simply closes. */}
               {selectedAppointment || (appointmentPanelMode === 'avatar' && activeModal !== 'booking') ? (
                   (() => {
                       // Both panels take the same props and fill the same column, so which one
                       // renders is purely the user's preference — nothing else shifts.
                       const panelProps = {
                           selectedAppointment,
                           onClose: () => handleSelectAppointmentWrapper(null),
                           onEditFull: (appt: any) => {
                               setAppointmentToEdit(appt);
                               setActiveModal("booking");
                           },
                           onDelete: (id: string) => handleDeleteAppointment(null, id),
                           onSaveBooking: handleSaveBooking,
                           onQuickPay: (pid: string, pname: string) => {
                               setPaymentPatient({ id: pid, name: pname });
                               setActiveModal("payment");
                           },
                           doctorsList,
                           servicesList,
                       };
                       return appointmentPanelMode === 'avatar' ? (
                           <AppointmentAvatarPanel
                               {...panelProps}
                               onSwitchToEditor={() => setAppointmentPanelMode('editor')}
                               onAppointmentReplaced={(newAppt) => setSelectedAppointment(newAppt)}
                           />
                       ) : (
                           <AppointmentSidePanel
                               {...panelProps}
                               onSwitchToAvatar={() => setAppointmentPanelMode('avatar')}
                           />
                       );
                   })()
               ) : activeModal === 'booking' && appointmentEditorMode === 'drawer' ? (
                        <BookingModal 
                            isOpen={activeModal === 'booking'} 
                            inlineDesktop={true}
                            onClose={() => { setActiveModal(null); setAppointmentToEdit(null); setPreSelectedTime(''); setPreSelectedPatient(null); setPreSelectedDoctor(''); }} 
                            onSave={handleSaveBooking} 
                            patients={patientsList} 
                            doctors={doctorsList} 
                            servicesList={servicesList} 

                            settingsConfig={config}
                            editAppointment={appointmentToEdit}
                            preSelectedDate={normalizeDateKey(scheduleViewDate)}
                            preSelectedTime={preSelectedTime}
                            preSelectedDoctor={preSelectedDoctor}
                            preSelectedPatient={preSelectedPatient}
                            preSelectedBranchId={scopeBranchId}
                        />
                    ) : null}
             </div>
            </div>
        </div>
      </div>

      {activeModal === 'booking' && appointmentEditorMode === 'modal' && (
        <BookingModal 
          isOpen={true} 
          inlineDesktop={false}
          onClose={() => { setActiveModal(null); setAppointmentToEdit(null); setPreSelectedTime(''); setPreSelectedPatient(null); setPreSelectedDoctor(''); }} 
          onSave={handleSaveBooking} 
          patients={patientsList} 
          doctors={doctorsList} 
          servicesList={servicesList} 

          settingsConfig={config}
          editAppointment={appointmentToEdit}
          preSelectedDate={normalizeDateKey(scheduleViewDate)}
          preSelectedTime={preSelectedTime}
          preSelectedDoctor={preSelectedDoctor}
          preSelectedPatient={preSelectedPatient}
          preSelectedBranchId={scopeBranchId}
        />
      )}

      <NewPatientModal
        isOpen={activeModal === 'patient'}
        onClose={() => setActiveModal(null)}
        onSuccess={() => {}}
        preSelectedBranchId={scopeBranchId}
      />
      <QuickPaymentModal isOpen={activeModal === 'payment'} onClose={() => setActiveModal(null)} onSave={() => {}} patients={patientsList} preSelectedPatient={paymentPatient} />
      <PrescriptionPrintFinderModal
        isOpen={prescriptionFinderOpen}
        onClose={() => setPrescriptionFinderOpen(false)}
        patients={patientsList}
        language={language === "ar" ? "ar" : "en"}
      />

      <LateAppointmentPrompt
         isOpen={!!lateApptToPrompt}
         appointment={lateApptToPrompt}
         onClose={() => setLateApptToPrompt(null)}
         onAction={handleLateAction}
         config={config}
      />



      {showDelayPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-[32px] p-6 max-w-md w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-2">
              {language === 'ar' ? 'تأجيل الموعد' : 'Delay Appointment'}
            </h3>
            <p className="text-sm font-medium text-ink-body mb-6 leading-relaxed">
              {language === 'ar' 
                ? 'هل تريد جدولة موعد جديد لهذا المريض الآن، أم تركه غير محدد بعد؟' 
                : 'Would you like to schedule a new appointment for this patient now, or leave it as not set yet?'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  setShowDelayPrompt(false);
                  setInlineSaving(true);
                  try {
                    await updateDoc(getClinicDoc("appointments", delayedAppointmentData.id), {
                      patientName: delayedAppointmentData.patientName,
                      treatment: delayedAppointmentData.treatment,
                      doctor: delayedAppointmentData.doctor,
                      date: delayedAppointmentData.date,
                      time: delayedAppointmentData.time,
                      duration: Number(delayedAppointmentData.duration) || 30,
                      status: "Delayed",
                      notes: delayedAppointmentData.notes,
                      cost: Number(delayedAppointmentData.cost) || 0,
                      serviceId: delayedAppointmentData.serviceId || null,
                      serviceName: delayedAppointmentData.serviceName || null,
                      modifiedBy: user?.name || 'System',
                      updatedAt: serverTimestamp(),
                    });
                    
                    setAppointmentToEdit(null);
                    setPreSelectedPatient({
                      id: selectedAppointment!.patientId!,
                      name: selectedAppointment!.patientName!
                    });
                    setPreSelectedDoctor(selectedAppointment!.doctor || "");
                    setActiveModal("booking");
                    
                    showToast(language === 'ar' ? 'تم تأجيل الموعد، افتح حجز جديد' : 'Appointment delayed, opening new booking...', 'success');
                    handleSelectAppointmentWrapper(null);
                  } catch (e) {
                    console.error(e);
                    showToast('Error saving', 'error');
                  } finally {
                    setInlineSaving(false);
                  }
                }}
                className="w-full bg-accent-soft hover:bg-accent text-white font-black py-3 rounded-xl transition-colors text-sm shadow-sm shadow-accent-soft/30"
              >
                {language === 'ar' ? 'جدولة موعد جديد' : 'Schedule New Appointment'}
              </button>
              <button
                onClick={async () => {
                  setShowDelayPrompt(false);
                  setInlineSaving(true);
                  try {
                    await updateDoc(getClinicDoc("appointments", delayedAppointmentData.id), {
                      patientName: delayedAppointmentData.patientName,
                      treatment: delayedAppointmentData.treatment,
                      doctor: delayedAppointmentData.doctor,
                      date: delayedAppointmentData.date,
                      time: delayedAppointmentData.time,
                      duration: Number(delayedAppointmentData.duration) || 30,
                      status: "Delayed",
                      notes: delayedAppointmentData.notes,
                      cost: Number(delayedAppointmentData.cost) || 0,
                      serviceId: delayedAppointmentData.serviceId || null,
                      serviceName: delayedAppointmentData.serviceName || null,
                      modifiedBy: user?.name || 'System',
                      updatedAt: serverTimestamp(),
                    });
                    showToast(language === 'ar' ? 'تم التأجيل' : 'Appointment delayed', 'success');
                    handleSelectAppointmentWrapper(null);
                  } catch (e) {
                    console.error(e);
                    showToast('Error saving', 'error');
                  } finally {
                    setInlineSaving(false);
                  }
                }}
                className="w-full bg-surface-muted hover:bg-slate-200 text-slate-700 font-black py-3 rounded-xl transition-colors text-sm"
              >
                {language === 'ar' ? 'غير محدد بعد' : 'Not Set Yet'}
              </button>
              <button
                onClick={() => setShowDelayPrompt(false)}
                className="w-full bg-surface hover:bg-surface-subtle text-ink-muted font-bold py-2.5 rounded-xl border border-line transition-colors text-sm mt-2"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
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