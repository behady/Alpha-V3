"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Calendar, Plus, ChevronRight, ChevronLeft, Wallet, User, Clock, Check,
  Loader2, Edit, Printer, UserX, MessageCircle, Pill, Receipt,
  X, Save, Trash2, FileText, ChevronDown, Bell, UserPlus, AlertCircle
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
import {
  parseApptTimeToMinutes,
  normalizeDateKey,
  saveBooking,
  normalizeTimeKey,
} from "@/lib/bookingService";
import LateAppointmentPrompt from "@/components/appointments/LateAppointmentPrompt";
import NewPatientModal from "@/components/NewPatientModal";
import QuickPaymentModal from "@/components/QuickPaymentModal";
import AppointmentSidePanel from "@/components/appointments/AppointmentSidePanel";
import AppointmentStagePicker from "@/components/appointments/AppointmentStagePicker";
import PrescriptionPrintFinderModal from "@/components/PrescriptionPrintFinderModal";
import WaitingMoodPicker from "@/components/appointments/WaitingMoodPicker";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import ServiceEditorDrawer from "@/components/clinical-notes/ServiceEditorDrawer";
import { logActivity } from "@/lib/logger";
import { MoneyApiError, deleteAppointment } from "@/lib/moneyApi";
import { isDentistStaff } from "@/lib/staffRoles";
import { parseClinicSchedule, clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { useActiveBranch } from "@/lib/useActiveBranch";
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

import { getAppointmentStatusStyles, getAppointmentStageLabel } from "@/lib/appointmentStages";
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
  delayedPromptUntil?: number;
};

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
  const { user } = useAuth();
  const { showToast, confirm, appointmentEditorMode, latePatientTrackerEnabled } = useUI();
  const router = useRouter();

  const [allAppointments, setAllAppointments] = useState<any[]>([]);
  // The same working branch the desktop dashboard uses — one answer to "where am I today?",
  // remembered per clinic, so a phone and a desktop signed in as the same person agree.
  const {
    branches,
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
  const [activeModal, setActiveModal] = useState<'patient' | 'booking' | 'payment' | null>(null);
  const [pendingCheckoutPayload, setPendingCheckoutPayload] = useState<any | null>(null);
  const [paymentPatient, setPaymentPatient] = useState<{ id: string, name: string } | null>(null);
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
    // "Rescheduled" is a resolved marker left on the original slot — never late, since the real
    // visit is a different document now.
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

  // Removed 1000ms timer to prevent 60fps re-rendering of entire dashboard

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

  const handleSelectAppointmentWrapper = async (apt: DashboardAppointment | null) => {
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
  };

  // Fetch only appointments for the current view date to prevent severe performance degradation
  // and browser freezes when saving.
  useEffect(() => {
    setLoading(true);
    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
    const q = query(getClinicCollection("appointments"), where("date", "==", viewKey));

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
  }, [scheduleViewDate]);

  const appointments = useMemo(() => {
    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
    return allAppointments
      .filter((a) => branchMatches(a.branchId))
      .filter((a) => normalizeDateKey(a.date) === viewKey)
      .sort((a, b) => normalizeTimeKey(a.time).localeCompare(normalizeTimeKey(b.time)));
  }, [allAppointments, scheduleViewDate, branchMatches]);

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
          async () => { }
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
    <div className={`min-h-screen lg:min-h-0 lg:h-full relative overflow-hidden pb-24 lg:pb-0 font-sans text-ink-slab lg:text-white bg-gradient-to-br from-accent-tint/60 to-accent-tint lg:from-transparent lg:to-transparent ${isRTL ? 'text-right' : 'text-left'}`}>
      <div className="relative z-10 w-full max-w-[1920px] mx-auto p-4 md:p-6 md:pt-8 lg:p-4 lg:pt-3 space-y-3 md:space-y-4 lg:space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500 lg:h-full lg:flex lg:flex-col">

        {/* === DESKTOP: High Contrast Greeting Bar === */}
        <div className="hidden lg:flex items-end justify-between shrink-0 pt-4 pb-2">
          <div className="flex flex-col min-w-0">
            <h1 className="text-4xl font-light text-slate-800 tracking-tight">
              {language === 'ar' ? 'أهلاً بك،' : 'Welcome in,'} <span className="font-normal text-slate-900">{getWelcomeName(user?.name)}</span>
            </h1>
            <p className="flex items-center gap-3 text-sm font-medium text-slate-500 mt-2">
              <DashboardClockWidget language={language} showTime={true} />
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => setActiveModal('patient')} className="group flex items-center gap-2 bg-white/80 backdrop-blur-md text-slate-700 font-bold text-sm px-6 py-3 rounded-full hover:-translate-y-0.5 transition-all duration-300 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white">
              <div className="text-slate-900 group-hover:scale-110 transition-transform"><Plus size={18} strokeWidth={2.5} /></div>
              {language === 'ar' ? 'مريض جديد' : 'New Patient'}
            </button>
            <button onClick={() => { setPaymentPatient(null); setActiveModal('payment'); }} className="group flex items-center gap-2 bg-ink-slab text-white font-bold text-sm px-6 py-3 rounded-full hover:-translate-y-0.5 transition-all duration-300 shadow-[0_8px_20px_rgba(26,33,48,0.2)] border border-ink-slab">
              <div className="text-white group-hover:scale-110 transition-transform"><Wallet size={18} strokeWidth={2.5} /></div>
              {language === 'ar' ? 'دفع سريع' : 'Quick Pay'}
            </button>
          </div>
        </div>

        {/* === DESKTOP: Floating High-Contrast Stats === */}
        <div className="hidden lg:flex items-center gap-12 shrink-0 py-4 px-2">
          {/* Daily Income - Dark Contrast Card */}
          <div className="bg-ink-slab text-white p-5 rounded-[2rem] shadow-[0_12px_40px_rgba(26,33,48,0.2)] flex flex-col min-w-[200px] hover:-translate-y-1 hover:shadow-2xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-slate-400">{language === 'ar' ? 'دخل اليوم' : 'Daily Income'}</span>
              <Wallet size={18} className="text-slate-400" />
            </div>
            <span className="text-3xl font-light tracking-tight">
              {dailyIncome === null ? <Loader2 className="w-6 h-6 animate-spin text-slate-500" /> : <><span className="font-normal">{dailyIncome?.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</span> <span className="text-lg text-slate-400">{language === 'ar' ? 'ج.م' : 'EGP'}</span></>}
            </span>
          </div>

          {/* Total Appointments - Floating Huge Number */}
          <div className="flex flex-col justify-center px-4">
            <span className="text-sm font-medium text-slate-500 mb-1">{language === 'ar' ? 'المواعيد' : 'Appointments'}</span>
            <span className="text-5xl font-light text-slate-800 tracking-tighter leading-none">{activeAppointmentsCount}</span>
          </div>

          {/* Status Distribution - Abstract Chart */}
          <div className="flex flex-col justify-center px-4 flex-1 max-w-sm">
            <div className="flex items-center justify-between text-sm font-medium text-slate-500 mb-3">
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
          
          {/* 1. Floating Header with Profile Pic */}
          <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-full p-1.5 mx-1 mt-1">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-400 to-teal-400 p-[1.5px] shadow-sm shrink-0">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden border-2 border-white">
                  {/* Fallback to initials if no avatar */}
                  <span className="text-emerald-600 font-black text-sm">
                    {getWelcomeName(user?.name).charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="flex flex-col min-w-0 pr-2 justify-center">
                <h1 className="text-[15px] font-black text-slate-800 tracking-tight leading-none truncate">
                  {getWelcomeName(user?.name)}
                </h1>
              </div>
            </div>
            {/* Minimal Time display */}
            <div className="text-right shrink-0 px-3 border-l border-slate-100 flex flex-col justify-center">
                <div className="text-[11px] font-black text-slate-700 leading-none">
                   <DashboardClockWidget language={language} showTime={false} />
                </div>
            </div>
          </div>

          {/* 2. Daily Overview (Stats + Income) */}
          <div className="flex flex-col gap-2 mx-1">
             <div className="flex items-center justify-between px-2">
                 <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{language === 'ar' ? 'نظرة عامة' : 'Daily Overview'}</h3>
             </div>
             
             <div className="grid grid-cols-2 gap-2">
                {/* Income Card (Spans half) */}
                <div className="bg-ink-slab rounded-[1.5rem] p-4 text-white shadow-lg flex flex-col relative overflow-hidden">
                    <div className="flex justify-between items-start w-full relative z-10">
                       <span className="text-[10px] font-bold text-white uppercase tracking-widest">{language === 'ar' ? 'دخل اليوم' : 'Today\'s Income'}</span>
                       <Wallet size={14} className="text-white" />
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center relative z-10 min-h-[80px]">
                        {dailyIncome === null ? (
                            <Loader2 className="w-5 h-5 animate-spin text-white" />
                        ) : (
                            <div className="flex items-baseline justify-center gap-1.5 w-full">
                                <span className="text-4xl font-black tracking-tighter leading-none truncate text-center text-white">{dailyIncome.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</span>
                                <span className="text-[10px] font-bold text-white uppercase tracking-widest shrink-0">{language === 'ar' ? 'ج.م' : 'EGP'}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Status Cards (2x2 grid inside the other half) - Cleaner palette with icons */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Check size={12} strokeWidth={3} className="text-sky-500" /> {language === 'ar' ? 'مؤكد' : 'Confirm'}</span>
                        <span className="text-2xl font-black text-slate-900 leading-none mt-0.5">{summaryStats.confirmed}</span>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Clock size={12} strokeWidth={3} className="text-amber-500" /> {language === 'ar' ? 'متأخر' : 'Delay'}</span>
                        <span className="text-2xl font-black text-slate-900 leading-none mt-0.5">{summaryStats.delayed}</span>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Check size={12} strokeWidth={3} className="text-emerald-500" /> {language === 'ar' ? 'تمت' : 'Done'}</span>
                        <span className="text-2xl font-black text-slate-900 leading-none mt-0.5">{summaryStats.completed}</span>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl border border-white rounded-[1.2rem] p-3 flex flex-col justify-center items-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-1 flex items-center gap-1.5"><X size={12} strokeWidth={3} className="text-rose-500" /> {language === 'ar' ? 'ملغي' : 'Cancel'}</span>
                        <span className="text-2xl font-black text-slate-900 leading-none mt-0.5">{summaryStats.canceled}</span>
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
              className="w-full flex items-center py-3 px-4 rounded-[1.2rem] bg-white/60 backdrop-blur-xl border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] active:scale-[0.98] transition-transform"
            >
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0"><User size={16} strokeWidth={2.5} className="text-slate-800" /></div>
              <span className="text-lg font-black text-slate-800 flex-1 text-center">{language === 'ar' ? 'مريض جديد' : 'New Patient'}</span>
              <div className="w-8 h-8 shrink-0"></div>
            </button>

            <button
              onClick={() => { setAppointmentToEdit(null); setActiveModal('booking'); }}
              className="w-full flex items-center py-3 px-4 rounded-[1.2rem] bg-white/60 backdrop-blur-xl border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] active:scale-[0.98] transition-transform"
            >
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0"><Calendar size={16} strokeWidth={2.5} className="text-slate-800" /></div>
              <span className="text-lg font-black text-slate-800 flex-1 text-center">{language === 'ar' ? 'حجز موعد' : 'New Visit'}</span>
              <div className="w-8 h-8 shrink-0"></div>
            </button>

            <button
              onClick={() => { setPaymentPatient(null); setActiveModal('payment'); }}
              className="w-full flex items-center py-3 px-4 rounded-[1.2rem] bg-white/60 backdrop-blur-xl border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] active:scale-[0.98] transition-transform"
            >
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0"><Wallet size={16} strokeWidth={2.5} className="text-slate-800" /></div>
              <span className="text-lg font-black text-slate-800 flex-1 text-center">{language === 'ar' ? 'دفع سريع' : 'Quick Pay'}</span>
              <div className="w-8 h-8 shrink-0"></div>
            </button>
          </div>
        </div>

        {/* === MAIN DASHBOARD CONTENT: Schedule + Detail === */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 mt-4 lg:mt-0">

          {/* 5. SCHEDULE LIST WIDGET */}
          <div className="flex-1 flex flex-col bg-white/30 backdrop-blur-[40px] border border-white/50 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] h-[600px] lg:h-full lg:min-h-0 overflow-hidden">
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
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all"
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
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all"
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
                    <span className="text-xs font-bold text-ink-muted lg:text-slate-600 mt-0.5">
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
              <div className="flex lg:hidden items-center justify-between w-full">
                <div className="flex items-center gap-2 min-w-0">
                  <BranchSelector
                    branches={branches}
                    value={activeBranchId}
                    onChange={setActiveBranchId}
                    compact
                  />
                  <span className="text-sm font-black text-slate-800 truncate">
                    {isScheduleToday ? (language === 'ar' ? 'اليوم، ' : 'Today, ') : ''}
                    {new Date(`${scheduleViewDate}T12:00:00`).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}
                  </span>
                  <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 shadow-inner">
                    <button
                      onClick={() => {
                        const d = new Date(`${scheduleViewDate}T12:00:00`);
                        d.setDate(d.getDate() - 1);
                        setScheduleViewDate(d.toISOString().split("T")[0]);
                      }}
                      className="p-1 rounded-md text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all"
                    >
                      <ChevronLeft size={14} className={isRTL ? "rotate-180" : ""} />
                    </button>
                    <button
                      onClick={() => {
                        const d = new Date(`${scheduleViewDate}T12:00:00`);
                        d.setDate(d.getDate() + 1);
                        setScheduleViewDate(d.toISOString().split("T")[0]);
                      }}
                      className="p-1 rounded-md text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm transition-all"
                    >
                      <ChevronRight size={14} className={isRTL ? "rotate-180" : ""} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
                    className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-500"
                  >
                    <Calendar size={16} />
                  </button>
                  <button
                    onClick={() => setScheduleViewDate(getLocalDateKey())}
                    className="text-[10px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100"
                  >
                    {language === 'ar' ? 'اليوم' : 'Today'}
                  </button>
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
                  value={activeBranchId}
                  onChange={setActiveBranchId}
                />
                <button
                  type="button"
                  onClick={() => setPrescriptionFinderOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-ink-slab px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 hover:shadow-md"
                >
                  <Pill size={14} />
                  {language === "ar" ? "طباعة وصفة" : "Print Rx"}
                </button>
                <Link href="/appointments" className="flex items-center gap-1 rounded-full bg-white border border-slate-200 px-3 lg:px-4 py-1.5 lg:py-2 text-[10px] lg:text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:shadow-sm">
                  {language === "ar" ? "عرض الكل" : "View All"}
                  <ChevronRight size={12} className={`lg:w-3.5 lg:h-3.5 ${isRTL ? "rotate-180" : ""}`} />
                </Link>
              </div>
            </div>

            {/* Horizontal Weekly Stripe (Mobile Only) */}
            <div className="flex px-3 py-3 bg-white border-b border-slate-100 lg:hidden shrink-0 select-none overflow-x-auto no-scrollbar gap-2 scroll-smooth">
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
                    onClick={() => setScheduleViewDate(dateKey)}
                    className={`flex-shrink-0 w-12 h-14 flex flex-col items-center justify-center gap-1 rounded-2xl transition-all ${isSelected
                        ? 'bg-slate-900 text-white font-extrabold shadow-md shadow-slate-900/20 scale-[1.03]'
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
            <div className="flex flex-col flex-1 min-h-[400px] overflow-hidden relative">
              {loading ? (
                <div className="py-32 flex justify-center"><Loader2 className="animate-spin text-primary-500" size={32} /></div>
              ) : (
                <div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar relative pb-48">
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

                        <div className="flex flex-col gap-3 px-1">
                          {activeMobileAppts.length === 0 ? (
                            <div className="text-center py-10 text-slate-400 font-bold text-sm">
                              {language === 'ar' ? 'لا توجد مواعيد' : 'No appointments'}
                            </div>
                          ) : activeMobileAppts.map(apt => {
                            const aptStyles = getAppointmentStatusStyles(apt.status);
                            const isLate = isAppointmentLate(apt);
                            return (
                              <div
                                key={apt.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLate) {
                                    setLateApptToPrompt(apt);
                                    return;
                                  }
                                  handleSelectAppointmentWrapper(apt);
                                }}
                                className={`flex bg-white rounded-3xl border border-slate-100 shadow-sm p-4 gap-4 items-center transition-transform active:scale-[0.98] ${selectedAppointment?.id === apt.id ? 'ring-2 ring-emerald-500 shadow-md' : ''}`}
                              >
                                <div className="flex flex-col items-center justify-center shrink-0 w-16">
                                  <span className="text-sm font-black text-slate-800 leading-none mb-1">{apt.time?.split(" ")[0]}</span>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">{apt.time?.split(" ")[1]}</span>
                                </div>
                                <div className={`w-1 h-12 rounded-full shrink-0 ${aptStyles.accent}`}></div>
                                <div className="flex-1 flex justify-between items-center min-w-0 gap-2">
                                  <div className="flex flex-col min-w-0">
                                    <h4 className="text-base font-black text-slate-800 truncate mb-1">{apt.patientName}</h4>
                                    <span className="text-[11px] font-bold text-slate-500 truncate">{apt.treatment || '-'}</span>
                                  </div>
                                  <div className="flex flex-col items-end shrink-0 gap-1.5">
                                     <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest bg-slate-50 border border-slate-100 px-2 py-1 rounded-full whitespace-nowrap">
                                       {getAppointmentStageLabel(apt.status, language)}
                                     </span>
                                     {isLate && <AlertCircle size={14} className="text-rose-500 animate-pulse" />}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
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
                                  handleSelectAppointmentWrapper(null);
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
                                      if (isAppointmentLate(apt)) {
                                        setLateApptToPrompt(apt);
                                        return;
                                      }
                                      handleSelectAppointmentWrapper(apt);
                                    }}
                                    className={`w-full h-full rounded-2xl bg-white border border-slate-100 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md cursor-pointer overflow-hidden flex relative ${selectedAppointment?.id === apt.id ? 'ring-2 ring-emerald-500 scale-[1.01] z-10 shadow-md' : ''}`}
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
                                      <div className="flex items-center gap-1.5 shrink-0 bg-slate-50 border border-slate-100 rounded-full px-2.5 py-1">
                                        <span className={`w-1.5 h-1.5 rounded-full ${aptStyles.dot}`} />
                                        <span className="text-[9px] font-black text-slate-600 uppercase tracking-wide">
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

          {/* 6. PATIENT LEDGER / EDIT PANEL */}
          <div className="hidden lg:flex w-full lg:w-[400px] xl:w-[450px] shrink-0 flex-col gap-4 z-20">
            {selectedAppointment ? (
              <AppointmentSidePanel
                selectedAppointment={selectedAppointment}
                onClose={() => handleSelectAppointmentWrapper(null)}
                onEditFull={(appt) => {
                  setAppointmentToEdit(appt);
                  setActiveModal("booking");
                }}
                onDelete={(id) => handleDeleteAppointment(null, id)}
                onSaveBooking={handleSaveBooking}
                onQuickPay={(pid, pname) => {
                  setPaymentPatient({ id: pid, name: pname });
                  setActiveModal("payment");
                }}
                doctorsList={doctorsList}
              />
            ) : activeModal === 'booking' && appointmentEditorMode === 'drawer' ? (
              <BookingModal
                isOpen={activeModal === 'booking'}
                inlineDesktop={true}
                onClose={() => { setActiveModal(null); setAppointmentToEdit(null); setPreSelectedTime(''); setPreSelectedPatient(null); setPreSelectedDoctor(''); }}
                onSave={handleSaveBooking}
                patients={patientsList}
                doctors={doctorsList}

                settingsConfig={config}
                editAppointment={appointmentToEdit}
                preSelectedDate={normalizeDateKey(scheduleViewDate)}
                preSelectedTime={preSelectedTime}
                preSelectedDoctor={preSelectedDoctor}
                preSelectedPatient={preSelectedPatient}
                preSelectedBranchId={scopeBranchId}
                servicesList={servicesList}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-white/60 lg:text-indigo-900/40 p-6 text-center">
                <FileText size={48} className="mb-4 opacity-40 lg:opacity-30 lg:text-indigo-400" />
                <p className="text-lg font-bold text-white lg:text-indigo-950 mb-1">Select an Appointment</p>
                <p className="text-sm font-medium opacity-80 lg:text-slate-500 lg:opacity-100 max-w-[250px]">Click on any appointment in the schedule to view finances and edit details.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeModal === 'booking' && (
        <BookingModal
          isOpen={true}
          inlineDesktop={false}
          onClose={() => { setActiveModal(null); setAppointmentToEdit(null); setPreSelectedTime(''); setPreSelectedPatient(null); setPreSelectedDoctor(''); }}
          onSave={handleSaveBooking}
          patients={patientsList}
          doctors={doctorsList}

          settingsConfig={config}
          editAppointment={appointmentToEdit}
          preSelectedDate={normalizeDateKey(scheduleViewDate)}
          preSelectedTime={preSelectedTime}
          preSelectedDoctor={preSelectedDoctor}
          preSelectedPatient={preSelectedPatient}
          preSelectedBranchId={scopeBranchId}
          servicesList={servicesList}
        />
      )}

      <NewPatientModal isOpen={activeModal === 'patient'} onClose={() => setActiveModal(null)} onSuccess={() => { }} preSelectedBranchId={scopeBranchId} />
      <QuickPaymentModal isOpen={activeModal === 'payment'} onClose={() => setActiveModal(null)} onSave={() => { }} patients={patientsList} preSelectedPatient={paymentPatient} />
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
            <p className="text-sm font-medium text-slate-600 mb-6 leading-relaxed">
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
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-xl transition-colors text-sm"
              >
                {language === 'ar' ? 'غير محدد بعد' : 'Not Set Yet'}
              </button>
              <button
                onClick={() => setShowDelayPrompt(false)}
                className="w-full bg-white hover:bg-slate-50 text-slate-500 font-bold py-2.5 rounded-xl border border-slate-200 transition-colors text-sm mt-2"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Mobile Appointment Details Sheet */}
      {selectedAppointment && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm lg:hidden flex flex-col justify-end">
          <div className="bg-white rounded-t-[2.5rem] w-full max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Header bar to pull down or close */}
            <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto my-3 shrink-0" />
            <div className="flex justify-between items-center px-6 pb-2 shrink-0">
              <h3 className="text-lg font-black text-slate-900">{language === 'ar' ? 'تفاصيل الموعد' : 'Appointment Details'}</h3>
              <button
                onClick={() => handleSelectAppointmentWrapper(null)}
                className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-400"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-8 custom-scrollbar">
              <AppointmentSidePanel
                selectedAppointment={selectedAppointment}
                onClose={() => handleSelectAppointmentWrapper(null)}
                onEditFull={(appt) => {
                  setAppointmentToEdit(appt);
                  setActiveModal("booking");
                  handleSelectAppointmentWrapper(null);
                }}
                onDelete={(id) => {
                  handleDeleteAppointment(null, id);
                  handleSelectAppointmentWrapper(null);
                }}
                onSaveBooking={handleSaveBooking}
                onQuickPay={(pid, pname) => {
                  setPaymentPatient({ id: pid, name: pname });
                  setActiveModal("payment");
                  handleSelectAppointmentWrapper(null);
                }}
                doctorsList={doctorsList}
                servicesList={servicesList}
              />
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