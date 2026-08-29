"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, Clock,
  Check, Calendar as CalendarIcon, User, Stethoscope, BriefcaseMedical, Phone, Trash2, Edit, Wallet, FileText, UserPlus, Globe, Building2, DoorOpen
} from "lucide-react";
import BookingModal from "@/components/BookingModal";
import NewPatientModal from "@/components/NewPatientModal";
import AppointmentDetailsModal from "@/components/AppointmentDetailsModal";
import AppointmentSidePanel from "@/components/appointments/AppointmentSidePanel";
import AppointmentAvatarPanel from "@/components/appointments/AppointmentAvatarPanel";
import LateAppointmentPrompt from "@/components/appointments/LateAppointmentPrompt";
import PatientHistoryDrawer from "@/components/appointments/PatientHistoryDrawer";
import { db, auth } from "@/lib/firebase";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, addDoc, serverTimestamp, where, getDocs, limit } from "firebase/firestore";
import { saveBooking, normalizeDateKey, normalizeTimeKey, parseApptTimeToMinutes } from "@/lib/bookingService";
import { MoneyApiError, deleteAppointment } from "@/lib/moneyApi";
import DeleteAppointmentDialog from "@/components/appointments/DeleteAppointmentDialog";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { parseClinicSchedule, clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import Protect from "@/components/Protect";
import StarRating from "@/components/StarRating";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext"; 
import { useClinic } from "@/context/ClinicContext";
import PermissionGuard from "@/components/PermissionGuard"; 
import { isDentistStaff } from "@/lib/staffRoles";
import { getAppointmentStatusStyles, getAppointmentStageLabel } from "@/lib/appointmentStages";
import { LOCATIONS_DOC, parseClinicBranches, flattenRooms, type ClinicBranch } from "@/lib/clinicLocations";
import { findDoctorConflicts, type ConflictCandidate } from "@/lib/appointmentConflicts";

interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  treatment: string;
  date: string; 
  time: string; 
  duration: number;
  doctor: string;
  /** Stable staff id. `doctor` is a display string and goes stale when a dentist is renamed. */
  doctorId?: string | null;
  status: string;
  notes?: string;
  cost?: number;
  rating?: number;
  delayedPromptUntil?: number;
  source?: string;
  branchId?: string | null;
  branchName?: string | null;
  roomId?: string | null;
  roomName?: string | null;
  serviceName?: string | null;
}

export default function AppointmentsPage() {
  const { language } = useLanguage();
  const { showToast, confirm, latePatientTrackerEnabled, appointmentPanelMode, setAppointmentPanelMode } = useUI();
  const { user } = useAuth();
  const { isAdmin } = useClinic();
  const router = useRouter();

  const canAddAppointment = isAdmin || user?.permissions?.includes("appointments.add");
  
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientsList, setPatientsList] = useState<any[]>([]);
  const [doctorsList, setDoctorsList] = useState<any[]>([]);
  const [servicesList, setServicesList] = useState<any[]>([]);
  
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [selectedDateForBooking, setSelectedDateForBooking] = useState("");
  const [selectedTimeForBooking, setSelectedTimeForBooking] = useState("");

  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  /** The appointment awaiting the "what about its treatments?" dialog. */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; patientName?: string } | null>(null);

  // Filters State
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  // Branches & Rooms
  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");

  // History Drawer State
  const [historyDrawerPatientId, setHistoryDrawerPatientId] = useState("");
  const [historyDrawerPatientName, setHistoryDrawerPatientName] = useState("");
  const [scheduleConfig, setScheduleConfig] = useState<any>(() => parseClinicSchedule(null));
  const [latestNotes, setLatestNotes] = useState<Record<string, any>>({});

  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [pendingCheckoutPayload, setPendingCheckoutPayload] = useState<any>(null);

  // Inline Editing State (Now handled by AppointmentSidePanel)
  const [showDelayPrompt, setShowDelayPrompt] = useState(false);
  const [delayedApptData, setDelayedApptData] = useState<any>(null);
  const [preSelectedPatient, setPreSelectedPatient] = useState<{ id: string; name: string } | null>(null);
  const [preSelectedDoctor, setPreSelectedDoctor] = useState<string>("");

  // Navigation State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [miniCalendarDate, setMiniCalendarDate] = useState(new Date());

  // Drag and Drop State
  const [activeDragTarget, setActiveDragTarget] = useState<{ colKey: string; time: string } | null>(null);

  // Mobile Editor State
  const [appointmentToEdit, setAppointmentToEdit] = useState<any>(null);
  const lastTapRef = useRef<{ time: number, id: string } | null>(null);

  // Late Appointment Tracker
  const [realTime, setRealTime] = useState(new Date());
  const [lateApptToPrompt, setLateApptToPrompt] = useState<Appointment | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setRealTime(new Date()), 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  const isAppointmentLate = (appt: Appointment) => {
    if (!latePatientTrackerEnabled) return false;
    // "Rescheduled" is a resolved marker left on the original slot — never late, since the real
    // visit is a different document now.
    const activeStatuses = ["Checked In", "In Chair", "Completed", "Checking Out", "Cancelled", "No Show", "Delayed", "Rescheduled"];
    if (activeStatuses.includes(appt.status || '')) return false;
    
    // Parse appointment date/time
    if (!appt.date || !appt.time) return false;
    const minutes = parseApptTimeToMinutes(appt.time);
    const apptDate = new Date(`${appt.date}T00:00:00`);
    apptDate.setMinutes(minutes);

    const diffMins = (realTime.getTime() - apptDate.getTime()) / 60000;
    
    // Check if snooze is active
    if (appt.delayedPromptUntil && realTime.getTime() < appt.delayedPromptUntil) {
      return false;
    }
    
    return diffMins >= 15;
  };

  // View Mode & Sizing
  // "week"/"day": calendar by date. "doctor": one day, one column per dentist.
  // "list": one day as a readable agenda, groupable by time, dentist, or service.
  const [viewMode, setViewMode] = useState<"week" | "day" | "doctor" | "list">("week");
  const [listGroupBy, setListGroupBy] = useState<"time" | "doctor" | "service">("time");
  
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setViewMode("day");
    }
  }, []);
  
  const [HOUR_HEIGHT, setHourHeight] = useState(240);

  useEffect(() => {
    const updateHeight = () => {
      const w = window.innerWidth;
      if (w >= 1280) setHourHeight(296);      // xl+
      else if (w >= 1024) setHourHeight(296);  // lg
      else if (w >= 768) setHourHeight(296);   // md
      else setHourHeight(296);                 // mobile
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // Search synchronization
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams?.get("search") || "";
  const [searchQuery, setSearchQuery] = useState(searchFromUrl);
  
  useEffect(() => {
    setSearchQuery(searchFromUrl);
  }, [searchFromUrl]);

  // /appointments?book=<patientId> — how the Leads screen hands a fresh convert straight to
  // booking. Waits for the patients list so the picker shows the name, then clears the param
  // so refresh/back doesn't reopen the form.
  const bookPatientId = searchParams?.get("book") || "";
  useEffect(() => {
    if (!bookPatientId || patientsList.length === 0) return;
    const patient = patientsList.find(p => String(p.id) === bookPatientId);
    if (patient) {
      setPreSelectedPatient({ id: String(patient.id), name: patient.name });
      setAppointmentToEdit(null);
      setSelectedTimeForBooking("");
      setIsBookingModalOpen(true);
    }
    router.replace("/appointments");
  }, [bookPatientId, patientsList, router]);

  // Fetch Appointments
  useEffect(() => {
    if (!user) return;
    
    // Fetch a 4-month window around the currently viewed month to avoid performance issues
    const d = new Date(currentDate);
    const startD = new Date(d.getFullYear(), d.getMonth() - 2, 1);
    const endD = new Date(d.getFullYear(), d.getMonth() + 2, 0);
    
    const startStr = new Date(startD.getTime() - startD.getTimezoneOffset() * 60000).toISOString().split("T")[0];
    const endStr = new Date(endD.getTime() - endD.getTimezoneOffset() * 60000).toISOString().split("T")[0];

    const q = query(
      getClinicCollection("appointments"),
      where("date", ">=", startStr),
      where("date", "<=", endStr),
      orderBy("date", "asc")
    );
    
    const unsub = onSnapshot(q, (snapshot) => {
      const appts: Appointment[] = [];
      snapshot.forEach((docSnap) => {
        appts.push({ id: docSnap.id, ...docSnap.data() } as Appointment);
      });
      setAppointments(appts);
      
      // Update selected appt if it was changed by someone else
      setSelectedAppt(prev => {
         if (!prev) return null;
         return appts.find(a => a.id === prev.id) || null;
      });
    });
    return () => unsub();
  }, [user, currentDate.getFullYear(), currentDate.getMonth()]);

  // Fetch Patients, Doctors, Services for BookingModal
  useEffect(() => {
    if (!user) return;
    const unsubPatients = onSnapshot(getClinicCollection("patients"), (snap) => {
      setPatientsList(snap.docs.map((d) => ({ id: d.id, name: d.data().name, phone: d.data().phone })));
    });
    const unsubDoctors = onSnapshot(getClinicCollection("staff"), (snap) => {
      setDoctorsList(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as { id: string; name?: string; role?: string; isActive?: boolean }))
          .filter((s) => isDentistStaff(s))
          .map((s) => ({ id: s.id, name: s.name as string }))
      );
    });
    const unsubServices = onSnapshot(getClinicCollection("services"), (snap) => {
      setServicesList(snap.docs.map((d) => ({ id: d.id, name: d.data().name, price: d.data().price })));
    });

    return () => {
      unsubPatients();
      unsubDoctors();
      unsubServices();
    };
  }, [user]);

  // Fetch Clinic Schedule from Settings
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(getClinicDoc("settings", "clinic_info"), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      setScheduleConfig(parseClinicSchedule(data));
    });
    return () => unsub();
  }, [user]);

  // Fetch Branches & Rooms
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(getClinicDoc("settings", LOCATIONS_DOC), (snap) => {
      setBranches(parseClinicBranches(snap.exists() ? snap.data() : null));
    });
    return () => unsub();
  }, [user]);

  // Fetch Latest Clinical Notes for visible patients
  useEffect(() => {
    if (!user || appointments.length === 0) return;

    const fetchLatestNotes = async () => {
      const uniquePatientIds = Array.from(new Set(appointments.map(a => a.patientId).filter(Boolean)));
      // Filter out patients we already have notes for, so we don't re-fetch unnecessrily
      const patientsToFetch = uniquePatientIds.filter(id => latestNotes[id] === undefined);
      
      if (patientsToFetch.length === 0) return;

      const newNotes: Record<string, any> = { ...latestNotes };
      
      // Fetch in parallel
      await Promise.all(patientsToFetch.map(async (pId) => {
        try {
          const q = query(
            getClinicCollection("clinical_notes"),
            where("patientId", "==", pId),
            orderBy("createdAt", "desc"),
            limit(1)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            newNotes[pId] = { id: snap.docs[0].id, ...snap.docs[0].data() };
          } else {
            newNotes[pId] = null; // Mark as fetched but no note
          }
        } catch (err) {
          console.error("Error fetching note for patient:", pId, err);
        }
      }));

      setLatestNotes(newNotes);
    };

    fetchLatestNotes();
  }, [appointments, user, latestNotes]);

  // Drag & Drop Handlers
  const handleDragStart = (e: React.DragEvent, appointmentId: string) => {
    e.dataTransfer.setData("text/plain", appointmentId);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: string, targetTime: string, targetDoctor?: string) => {
    e.preventDefault();
    const apptId = e.dataTransfer.getData("text/plain");
    if (!apptId) return;

    const movingAppt = appointments.find((a) => a.id === apptId);
    if (!movingAppt) return;

    // In doctor view, dropping on another dentist's column hands the visit to that dentist.
    const nextDoctor = targetDoctor && targetDoctor !== "__unassigned__" ? targetDoctor : movingAppt.doctor;

    // Optional: Conflict checking
    try {
      // Fetch the target day and match in memory. Adding `where("doctor", "==", …)` to the query
      // meant a renamed dentist's existing appointments no longer matched, so dragging on top of
      // one raised no conflict at all — see lib/appointmentConflicts.
      const snap = await getDocs(
        query(getClinicCollection("appointments"), where("date", "==", targetDate))
      );
      const dayAppointments = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as ConflictCandidate
      );
      const nextDoctorId =
        doctorsList.find((d) => d.name === nextDoctor)?.id || movingAppt.doctorId || null;

      const conflict =
        findDoctorConflicts(dayAppointments, {
          time: targetTime,
          duration: movingAppt.duration || 30,
          doctorId: nextDoctorId,
          doctorName: nextDoctor,
          excludeAppointmentId: apptId,
        }).length > 0;

      if (conflict) {
        if (!(await confirm("This slot conflicts with another appointment. Continue?"))) {
          return;
        }
      }

      await saveBooking(
        {
          ...movingAppt,
          existingAppointmentId: apptId,
          date: targetDate,
          time: targetTime,
          doctor: nextDoctor,
        } as Parameters<typeof saveBooking>[0],
        {
          uid: user?.uid || "",
          name: user?.name || "System",
          role: user?.role || "",
          language: language as "en" | "ar",
        },
        async (key: string, msg: string) => {
          const u = auth.currentUser;
          if (!u) return;
          try {
            const idToken = await u.getIdToken();
            await fetch("/api/whatsapp/owner-alert", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
              body: JSON.stringify({ alertKey: key, message: msg }),
            });
          } catch (err) {}
        }
      );
      showToast(language === "ar" ? "تم إعادة جدولة الموعد بنجاح" : "Appointment rescheduled successfully", "success");
    } catch (error) {
      console.error("Drop save error:", error);
      showToast(language === "ar" ? "حدث خطأ أثناء نقل الموعد" : "Error rescheduling appointment", "error");
    }
  };

  // Booking handlers
  const handleOpenBooking = (dateStr?: string, timeStr?: string, doctorName?: string) => {
    // If no date passed, use the first day of the currently viewed week
    setAppointmentToEdit(null);
    setSelectedDateForBooking(dateStr || weekDays[0].dateStr);
    setSelectedTimeForBooking(timeStr || "");
    if (doctorName) setPreSelectedDoctor(doctorName);
    setIsBookingModalOpen(true);
  };

  const handleSaveBooking = async (data: Parameters<typeof saveBooking>[0]) => {
    await executeSaveBooking(data);
  };

  const executeSaveBooking = async (data: Parameters<typeof saveBooking>[0]) => {
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
          const u = auth.currentUser;
          if (!u) return;
          try {
            const idToken = await u.getIdToken();
            await fetch("/api/whatsapp/owner-alert", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
              body: JSON.stringify({ alertKey: key, message: msg }),
            });
          } catch (err) {}
        }
      );
      setIsBookingModalOpen(false);
      setPreSelectedPatient(null);
      setPreSelectedDoctor("");
      setAppointmentToEdit(null);
      showToast(language === "ar" ? "تم الحفظ بنجاح" : "Saved Successfully", "success");
    } catch (error: any) {
      console.error("Booking save error:", error);
      if (error?.message === "HAS_PAYMENTS") {
          showToast(language === "ar" ? "لا يمكن إلغاء رسوم هذا الموعد لوجود مدفوعات مسجلة له. يرجى حذف المدفوعات أولاً." : "Cannot remove charge because payments exist. Delete payments first.", "error");
      } else {
          showToast(language === "ar" ? "حدث خطأ" : "Error saving appointment", "error");
      }
    }
  };

  /**
   * Deleting a booking now asks what to do with the treatments recorded against it, rather than
   * silently stranding them — see DeleteAppointmentDialog. Every entry point (the calendar card,
   * the booking modal, the side panel) opens the same dialog.
   */
  const handleDeleteBooking = async (id: string) => {
    const appt = appointments.find((a) => a.id === id) || null;
    setPendingDelete({ id, patientName: appt?.patientName });
  };

  const performDelete = async (servicesAction: "keep" | "delete") => {
    if (!pendingDelete) return;
    try {
      const result = await deleteAppointment(pendingDelete.id, servicesAction);
      setPendingDelete(null);
      setAppointmentToEdit(null);
      setIsBookingModalOpen(false);
      setSelectedAppt(null);
      showToast(
        result.detachedNotes > 0
          ? language === "ar"
            ? `تم حذف الموعد، واتحفظ ${result.detachedNotes} علاج في سجل المريض`
            : `Appointment deleted; ${result.detachedNotes} treatment(s) kept in the patient's record`
          : language === "ar"
            ? "تم الحذف بنجاح"
            : "Deleted Successfully",
        "success"
      );
    } catch (error) {
      console.error("Booking delete error:", error);
      showToast(
        error instanceof MoneyApiError
          ? error.message
          : language === "ar"
            ? "حدث خطأ أثناء الحذف"
            : "Error deleting appointment",
        "error"
      );
    }
  };

  const handleLateAction = async (action: "check_in" | "wait" | "cancel" | "delay", newDate?: string, newTime?: string) => {
    if (!lateApptToPrompt) return;
    const appt = lateApptToPrompt;
    try {
      if (action === "wait") {
        const waitTime = Date.now() + 15 * 60000;
        await updateDoc(getClinicDoc("appointments", appt.id), {
          delayedPromptUntil: waitTime
        });
        showToast(language === 'ar' ? 'تم تأجيل التنبيه' : 'Prompt snoozed for 15 mins', 'success');
      } else if (action === "check_in") {
        await handleSaveBooking({ ...appt, existingAppointmentId: appt.id, status: "Checked In" } as any);
      } else if (action === "cancel") {
        await handleSaveBooking({ ...appt, existingAppointmentId: appt.id, status: "Cancelled" } as any);
      } else if (action === "delay") {
        const payload: any = { ...appt, existingAppointmentId: appt.id, status: "Delayed" };
        if (newDate && newTime) {
          payload.date = newDate;
          payload.time = newTime;
        }
        await handleSaveBooking(payload);
      }
    } catch (e) {
      console.error("Error updating late appt:", e);
      showToast(language === 'ar' ? 'خطأ' : 'Error updating appointment', 'error');
    }
    setLateApptToPrompt(null);
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

  // Calendar Logic
  const handleNavigate = (direction: number) => {
     const amount = viewMode === "week" ? direction * 7 : direction * 1;
     const newDate = new Date(currentDate);
     newDate.setDate(newDate.getDate() + amount);
     setCurrentDate(newDate);
     setMiniCalendarDate(newDate);
  };

  const changeMonth = (months: number) => {
     const newDate = new Date(miniCalendarDate);
     newDate.setMonth(newDate.getMonth() + months);
     setMiniCalendarDate(newDate);
  };

  // Dynamically calculate week days based on schedule offDays config & viewMode
  const weekDays = useMemo(() => {
    const days: Array<{ name: string; dateNum: number; dateStr: string; isOffDay?: boolean }> = [];
    const base = new Date(currentDate);
    const locale = language === 'ar' ? 'ar-EG' : 'en-US';
    
    if (viewMode !== "week") {
      const dayNameDisplay = base.toLocaleDateString(locale, { weekday: 'long' });
      const localDate = new Date(base.getTime() - (base.getTimezoneOffset() * 60000));
      const dayNameEn = base.toLocaleDateString('en-US', { weekday: 'long' });
      const isOffDay = scheduleConfig.offDays.map((od: string) => od.toLowerCase()).includes(dayNameEn.toLowerCase());
      return [{
        name: dayNameDisplay,
        dateNum: base.getDate(),
        dateStr: localDate.toISOString().split('T')[0],
        isOffDay
      }];
    }

    // Week mode: Show 7 consecutive days starting from currentDate
    const tempDate = new Date(base);
    
    for (let i = 0; i < 7; i++) {
      const dayNameEn = tempDate.toLocaleDateString('en-US', { weekday: 'long' });
      const dayNameDisplay = tempDate.toLocaleDateString(locale, { weekday: 'long' });
      const isOffDay = scheduleConfig.offDays.map((od: string) => od.toLowerCase()).includes(dayNameEn.toLowerCase());
      
      const localDate = new Date(tempDate.getTime() - (tempDate.getTimezoneOffset() * 60000));
      days.push({
        name: dayNameDisplay,
        dateNum: tempDate.getDate(),
        dateStr: localDate.toISOString().split('T')[0],
        isOffDay
      });
      tempDate.setDate(tempDate.getDate() + 1);
    }
    
    // Fallback if all days are off days
    if (days.length === 0) {
      const weekdaysList = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      return weekdaysList.map((dayName, index) => {
        const d = new Date(base);
        d.setDate(base.getDate() + index);
        const localDate = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
        return {
          name: d.toLocaleDateString(locale, { weekday: 'long' }),
          dateNum: d.getDate(),
          dateStr: localDate.toISOString().split('T')[0],
          isOffDay: false
        };
      });
    }
    
    return days;
  }, [currentDate, scheduleConfig.offDays, viewMode, language]);

  const weekTitle = useMemo(() => {
    if (weekDays.length === 0) return "";
    const firstDate = new Date(weekDays[0].dateStr);
    const locale = language === 'ar' ? 'ar-EG' : 'en-US';
    
    if (viewMode !== "week") {
      return firstDate.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    
    const lastDate = new Date(weekDays[weekDays.length - 1].dateStr);
    const monthStr = firstDate.toLocaleDateString(locale, { month: 'long' });
    const yearStr = firstDate.getFullYear();
    
    const startMonth = firstDate.toLocaleDateString(locale, { month: 'short' });
    const endMonth = lastDate.toLocaleDateString(locale, { month: 'short' });
    
    if (startMonth !== endMonth) {
      return `${startMonth} ${firstDate.getDate()} - ${endMonth} ${lastDate.getDate()}, ${yearStr}`;
    }
    
    return `${monthStr}, ${firstDate.getDate()} - ${lastDate.getDate()} ${yearStr}`;
  }, [weekDays, viewMode, language]);

  const timeSlots = useMemo(() => {
    const slots = [];
    const bounds = clinicDayBoundsMinutes(scheduleConfig);
    const duration = scheduleConfig.slotDuration ?? 30;

    let currentMinutes = bounds.start;
    while (currentMinutes < bounds.end) {
      const normalizedMins = currentMinutes % (24 * 60);
      const h = Math.floor(normalizedMins / 60);
      const m = normalizedMins % 60;
      
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      const timeLabel = `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
      
      slots.push({
        h,
        m,
        timeLabel,
        totalMinutes: currentMinutes
      });
      
      currentMinutes += duration;
    }
    return slots;
  }, [scheduleConfig, language]);

  const SLOT_HEIGHT = useMemo(() => {
    const duration = scheduleConfig.slotDuration ?? 30;
    return (duration / 60) * HOUR_HEIGHT;
  }, [scheduleConfig.slotDuration, HOUR_HEIGHT]);
  
  // Mini Calendar Logic
  const miniYear = miniCalendarDate.getFullYear();
  const miniMonth = miniCalendarDate.getMonth();
  const firstDayOfMonth = new Date(miniYear, miniMonth, 1).getDay();
  const daysInMonth = new Date(miniYear, miniMonth + 1, 0).getDate();
  const blanks = Array.from({length: firstDayOfMonth}, () => null);
  const days = Array.from({length: daysInMonth}, (_, i) => i + 1);
  const totalSlots = [...blanks, ...days];



  const toggleDoctorFilter = (doctorName: string) => {
     setSelectedDoctors(prev => prev.includes(doctorName) ? prev.filter(d => d !== doctorName) : [...prev, doctorName]);
  };

  const toggleStatusFilter = (statusName: string) => {
     setSelectedStatuses(prev => prev.includes(statusName) ? prev.filter(s => s !== statusName) : [...prev, statusName]);
  };

  const toggleRoomFilter = (roomId: string) => {
     setSelectedRooms(prev => prev.includes(roomId) ? prev.filter(r => r !== roomId) : [...prev, roomId]);
  };

  const toggleServiceFilter = (serviceName: string) => {
     setSelectedServices(prev => prev.includes(serviceName) ? prev.filter(s => s !== serviceName) : [...prev, serviceName]);
  };

  const allRooms = useMemo(() => flattenRooms(branches), [branches]);

  // What an appointment "is" for the service filter/grouping: the billed service when one was
  // picked, otherwise the visit reason typed at booking.
  const apptServiceKey = (appt: Appointment) => appt.serviceName || appt.treatment || "";

  const serviceOptions = useMemo(() => {
    const set = new Set<string>();
    appointments.forEach(a => {
      const key = apptServiceKey(a);
      if (key) set.add(key);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [appointments]);

  const patientMap = useMemo(() => {
    const map = new Map();
    patientsList.forEach(p => {
      if (p.id) map.set(p.id, p);
      if (p.name) map.set(p.name, p);
    });
    return map;
  }, [patientsList]);

  const filteredAppointments = useMemo(() => {
     return appointments.filter(appt => {
        if (selectedDoctors.length > 0 && !selectedDoctors.includes(appt.doctor)) return false;
        if (selectedStatuses.length > 0 && !selectedStatuses.includes(appt.status || "Scheduled")) return false;
        // Appointments booked before branches existed have no branchId; hiding them in every
        // branch view would make them disappear entirely, so they show everywhere instead.
        if (selectedBranchId && appt.branchId && appt.branchId !== selectedBranchId) return false;
        if (selectedRooms.length > 0 && !selectedRooms.includes(appt.roomId || "")) return false;
        if (selectedServices.length > 0 && !selectedServices.includes(apptServiceKey(appt))) return false;

        if (searchQuery) {
           const q = searchQuery.toLowerCase().trim();
           const nameMatch = appt.patientName?.toLowerCase().includes(q);
           
           // Look up phone number dynamically from patientMap
           const pObj = patientMap.get(appt.patientId) || patientMap.get(appt.patientName);
           const phone = pObj?.phone || appt.patientPhone || '';
           const phoneMatch = phone.includes(q);
           
           if (!nameMatch && !phoneMatch) return false;
        }
        
        return true;
     });
  }, [appointments, selectedDoctors, selectedStatuses, selectedBranchId, selectedRooms, selectedServices, searchQuery, patientMap]);

  /**
   * The calendar's columns. By date they are the visible days; in doctor view they are one day's
   * dentists side by side, plus an "Unassigned" column when that day holds appointments whose
   * dentist isn't on staff (e.g. online requests booked as "Any").
   */
  const gridColumns = useMemo(() => {
    if (viewMode !== "doctor") {
      return weekDays.map(d => ({
        key: d.dateStr,
        dateStr: d.dateStr,
        isOffDay: d.isOffDay,
        label: d.name,
        sublabel: String(d.dateNum),
        doctorName: undefined as string | undefined,
      }));
    }
    const day = weekDays[0];
    const base = selectedDoctors.length > 0
      ? doctorsList.filter((d: any) => selectedDoctors.includes(d.name))
      : doctorsList;
    const knownNames = new Set(base.map((d: any) => d.name));
    const cols = base.map((d: any) => ({
      key: d.id,
      dateStr: day?.dateStr || "",
      isOffDay: day?.isOffDay,
      label: d.name as string,
      sublabel: "",
      doctorName: d.name as string | undefined,
    }));
    const hasUnassigned = filteredAppointments.some(a => a.date === day?.dateStr && !knownNames.has(a.doctor));
    if (hasUnassigned) {
      cols.push({
        key: "__unassigned__",
        dateStr: day?.dateStr || "",
        isOffDay: day?.isOffDay,
        label: language === "ar" ? "غير محدد" : "Unassigned",
        sublabel: "",
        doctorName: "__unassigned__",
      });
    }
    return cols;
  }, [viewMode, weekDays, doctorsList, selectedDoctors, filteredAppointments, language]);

  const knownDoctorNames = useMemo(() => new Set(doctorsList.map((d: any) => d.name)), [doctorsList]);

  /** List view: the selected day's appointments in time order, grouped by the chosen key. */
  const listGroups = useMemo(() => {
    if (viewMode !== "list") return [] as Array<{ key: string; label: string; appts: Appointment[] }>;
    const dayStr = weekDays[0]?.dateStr;
    const dayAppts = filteredAppointments
      .filter(a => a.date === dayStr)
      .sort((a, b) => parseApptTimeToMinutes(a.time || "") - parseApptTimeToMinutes(b.time || ""));

    if (dayAppts.length === 0) return [];
    if (listGroupBy === "time") return [{ key: "all", label: "", appts: dayAppts }];

    const map = new Map<string, Appointment[]>();
    for (const a of dayAppts) {
      const key = listGroupBy === "doctor"
        ? (a.doctor || (language === "ar" ? "غير محدد" : "Unassigned"))
        : (apptServiceKey(a) || (language === "ar" ? "بدون خدمة" : "No service"));
      const bucket = map.get(key);
      if (bucket) bucket.push(a);
      else map.set(key, [a]);
    }
    return Array.from(map.entries()).map(([key, appts]) => ({ key, label: key, appts }));
  }, [viewMode, listGroupBy, filteredAppointments, weekDays, language]);

  const columnAppointments = (col: { dateStr: string; doctorName?: string }) => {
    return filteredAppointments.filter(a => {
      if (a.date !== col.dateStr) return false;
      if (!col.doctorName) return true;
      if (col.doctorName === "__unassigned__") return !knownDoctorNames.has(a.doctor);
      return a.doctor === col.doctorName;
    });
  };


  const gridBlocks = useMemo(() => {
    const bounds = clinicDayBoundsMinutes(scheduleConfig);
    return gridColumns.map((colObj, colIndex) => {
      const dayAppts = columnAppointments(colObj);

      return dayAppts.map(appt => {
        const timeMatch = appt.time?.match(/^(\d{1,2}):(\d{2})\s?(AM|PM|ص|م)?/i);
        let h = scheduleConfig.startHour ?? 9; let m = 0;
        if (timeMatch) {
            h = parseInt(timeMatch[1], 10);
            m = parseInt(timeMatch[2], 10);
            if (timeMatch[3]?.toUpperCase().includes('P') && h < 12) h += 12;
            if (timeMatch[3]?.toUpperCase().includes('A') && h === 12) h = 0;
        }
        
        let startMin = h * 60 + m;
        if (bounds.end > 1440 && startMin < bounds.start) {
          startMin += 24 * 60;
        }
        const durationMins = appt.duration || 30;
        startMin = Math.max(bounds.start, Math.min(bounds.end - durationMins, startMin));
        
        const topPx = ((startMin - bounds.start) / 60) * HOUR_HEIGHT;
        const height = (durationMins / 60) * HOUR_HEIGHT;

        // Dynamic font sizes based on card size (duration)
        let nameFontSize = "text-xs md:text-sm lg:text-base";
        let timeFontSize = "text-[10px] md:text-xs lg:text-xs";
        let infoFontSize = "text-[10px] md:text-xs lg:text-sm";

        if (durationMins > 30 && durationMins <= 60) {
          nameFontSize = "text-sm md:text-base lg:text-base";
          timeFontSize = "text-xs md:text-sm lg:text-xs";
          infoFontSize = "text-xs md:text-sm lg:text-sm";
        } else if (durationMins > 60) {
          nameFontSize = "text-base md:text-lg lg:text-base";
          timeFontSize = "text-sm md:text-base lg:text-xs";
          infoFontSize = "text-sm md:text-base lg:text-sm";
        }

        const aptStyles = getAppointmentStatusStyles(appt.status);

        return (
          <div 
            key={appt.id}
            className="absolute group pointer-events-auto p-0.5"
            style={{ 
              top: `${topPx}px`, 
              height: `${Math.max(height, 120)}px`,
              insetInlineStart: `calc(${(colIndex * 100) / gridColumns.length}% + 6px)`,
              width: `calc(${100 / gridColumns.length}% - 12px)`,
              zIndex: 10
            }}
          >
          <div 
            draggable={true}
            onDragStart={(e) => handleDragStart(e, appt.id)}
            onClick={(e) => {
              e.stopPropagation();
              const isLate = isAppointmentLate(appt);
              if (isLate) {
                setLateApptToPrompt(appt);
                return;
              }
              const currentTime = new Date().getTime();
              const tapDelay = 300;
              if (lastTapRef.current && (currentTime - lastTapRef.current.time) < tapDelay && lastTapRef.current.id === appt.id) {
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                   setAppointmentToEdit(appt);
                   setIsBookingModalOpen(true);
                } else {
                   document.getElementById('edit-panel-scroll-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                lastTapRef.current = null;
              } else {
                lastTapRef.current = { time: currentTime, id: appt.id };
                setSelectedAppt(appt);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                 setAppointmentToEdit(appt);
                 setIsBookingModalOpen(true);
              } else {
                 document.getElementById('edit-panel-scroll-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            className={`w-full h-full rounded-2xl border transition-all hover:scale-[1.01] hover:shadow-md hover:z-10 cursor-pointer overflow-hidden flex flex-col relative ps-3 shadow-sm lg:shadow-md lg:border-s-4 ${selectedAppt?.id === appt.id ? 'ring-2 ring-primary-500 scale-[1.01] z-10 shadow-md' : ''} ${aptStyles.card.replace('opacity-80', '')} ${isAppointmentLate(appt) ? 'animate-pulse ring-4 ring-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)] z-30' : ''}`}
            style={{ zIndex: selectedAppt?.id === appt.id ? 20 : 1 }}
          >
            <div className={`absolute start-0 top-2 bottom-2 w-1 rounded-e-full ${aptStyles.accent}`}></div>
            <div className={`absolute start-0 top-2 bottom-2 w-1 rounded-e-full ${aptStyles.accent}`}></div>
            <div className="flex flex-col h-full p-1.5 lg:p-2 relative justify-between gap-0.5">
              {/* TOP ROW: Name + Actions */}
              <div className="flex justify-between items-start w-full gap-2 shrink-0">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {(appt.source === 'online' || appt.source === 'Online Booking Request' || appt.source === 'Online Booking') && (
                      <div className="bg-indigo-100 text-indigo-600 rounded-full p-0.5 shrink-0" title="Online Booking">
                        <Globe className="w-3 h-3" />
                      </div>
                    )}
                    <h4 className={`font-extrabold text-slate-900 truncate drop-shadow-sm ${nameFontSize}`}>
                      {appt.patientName}
                    </h4>
                  </div>
                  {patientMap.get(String(appt.patientId))?.phone && (
                    <span className="text-[10px] text-slate-500 font-medium truncate mt-0.5" dir="ltr">
                      {patientMap.get(String(appt.patientId))?.phone}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0 z-20">
                  <button onClick={(e) => { 
                    e.stopPropagation(); 
                    setHistoryDrawerPatientId(appt.patientId);
                    setHistoryDrawerPatientName(appt.patientName);
                  }} className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors" title={language === 'ar' ? 'سجل الزيارات' : 'Visit History'}><Clock className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                  <button onClick={(e) => { e.stopPropagation(); router.push(`/patients/${appt.patientId}`); }} className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title={language === 'ar' ? 'الملف الشخصي' : 'Profile'}><User className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                  <button onClick={(e) => {
                    e.stopPropagation();
                    setAppointmentToEdit(appt);
                    setIsBookingModalOpen(true);
                  }} className="p-1 text-orange-500 hover:bg-orange-50 rounded-md transition-colors" title={language === 'ar' ? 'تعديل' : 'Edit'}><Edit className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا الموعد؟' : 'Are you sure you want to delete this appointment?')) {
                      handleDeleteBooking(appt.id);
                    }
                  }} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title={language === 'ar' ? 'حذف' : 'Delete'}><Trash2 className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                </div>
              </div>

              {/* BOTTOM ROW: Treatment + Time */}
              <div className="flex justify-between items-end w-full gap-2 mt-auto min-h-0 shrink-0">
                <div className="flex flex-col gap-1 min-w-0">
                  <p className={`text-slate-800 truncate font-bold bg-white/60 lg:bg-white/80 backdrop-blur-sm px-1.5 py-0.5 rounded-md shadow-sm min-w-0 ${infoFontSize}`}>
                    {appt.treatment || 'Consultation'} <span className="text-slate-400 mx-1 font-normal">•</span> Dr. {appt.doctor?.split(' ')[1] || appt.doctor}
                  </p>
                  {(appt.roomName || (!selectedBranchId && branches.length > 1 && appt.branchName)) && (
                    <span className="inline-flex items-center gap-1 text-[9px] lg:text-[10px] font-bold text-teal-700 bg-teal-50/90 border border-teal-100 px-1.5 py-0.5 rounded-md w-fit max-w-full truncate">
                      <DoorOpen size={10} className="shrink-0" />
                      {[!selectedBranchId && branches.length > 1 ? appt.branchName : null, appt.roomName].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <div className="ps-1 mt-0.5">
                    <StarRating rating={appt.rating || 0} onRatingChange={(r) => handleRatingChange(appt.id, r)} size={14} />
                  </div>
                </div>
                <span className={`font-black text-slate-600 lg:text-indigo-950 opacity-80 whitespace-nowrap shrink-0 bg-white/40 px-1.5 py-0.5 rounded-md ${timeFontSize}`}>
                  {language === 'ar' ? appt.time?.replace('AM', 'ص').replace('PM', 'م') : appt.time} ({durationMins}m)
                </span>
              </div>

              {/* LATEST NOTE SNIPPET */}
              {latestNotes[appt.patientId] && durationMins >= 30 && (
                <div className="w-full mt-0.5 pt-0.5 border-t border-slate-200/50 flex items-center gap-1 overflow-hidden min-w-0 shrink-0">
                  <FileText size={10} className="shrink-0 text-slate-400" />
                  <p className="text-[9px] lg:text-[10px] text-slate-500 truncate italic min-w-0 flex-1">
                    <span className="font-semibold">{latestNotes[appt.patientId].procedure}:</span> {latestNotes[appt.patientId].note}
                  </p>
                </div>
              )}
            </div>
          </div>
          </div>
        );
      });
    });
  }, [gridColumns, filteredAppointments, knownDoctorNames, branches, selectedBranchId, scheduleConfig, patientMap, selectedAppt?.id, HOUR_HEIGHT, viewMode, latestNotes, language, router]);

  return (
    <PermissionGuard permission="access.appointments">
      <div className="flex flex-col lg:flex-row h-full w-full gap-4 md:gap-5 lg:gap-5 p-4 lg:p-4 xl:p-5 bg-[#EEF2F6] min-h-0 overflow-hidden">
         
         {/* --- LEFT PANEL --- */}
         <div id="left-panel-container" className={`w-full ${(selectedAppt || isBookingModalOpen) ? 'lg:w-[400px] xl:w-[450px]' : 'lg:w-[260px]'} shrink-0 flex flex-col gap-4 md:gap-5 overflow-y-auto no-scrollbar pt-2 ${!selectedAppt ? 'order-2 lg:order-1' : 'order-1'} transition-all duration-300`}>
            <div id="edit-panel-scroll-anchor" className="h-0 w-0"></div>
            {/* Mini Calendar Header - Hidden on mobile to save space unless explicitly needed */}
            <div className="hidden lg:block">
               <div className="flex items-center justify-between mb-2">
                  <h2 className="font-black text-slate-800 text-base">
                     {miniCalendarDate.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' })}
                  </h2>
                  <div className="flex gap-2 text-slate-400">
                     <button onClick={() => changeMonth(-1)} className="hover:text-slate-800 transition-colors"><ChevronLeft size={16}/></button>
                     <button onClick={() => changeMonth(1)} className="hover:text-slate-800 transition-colors"><ChevronRight size={16}/></button>
                  </div>
               </div>
               {/* Mini Calendar Grid */}
               <div className="grid grid-cols-7 gap-y-1.5 text-center text-[10px] font-bold text-slate-400 mb-1">
                   {(language === 'ar' ? ['ح','ن','ث','ر','خ','ج','س'] : ['S','M','T','W','T','F','S']).map((d, i)=><div key={`${d}-${i}`}>{d}</div>)}
               </div>
               <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs font-semibold text-slate-700">
                   {totalSlots.map((dNum, i) => {
                      if (dNum === null) return <div key={`blank-${i}`}></div>;
                      
                      const cellDate = new Date(miniYear, miniMonth, dNum);
                      const isToday = cellDate.toDateString() === new Date().toDateString();
                      
                      const localCellDate = new Date(cellDate.getTime() - (cellDate.getTimezoneOffset() * 60000));
                      const cellDateStr = localCellDate.toISOString().split('T')[0];
                      const isSelectedDay = weekDays.some(wd => wd.dateStr === cellDateStr);

                      return (
                        <div key={i} 
                             onClick={() => {
                                setCurrentDate(cellDate);
                                setSelectedAppt(null); // Clear selection on navigate
                             }}
                             className={`flex justify-center items-center h-7 w-7 mx-auto rounded-full cursor-pointer transition-colors ${isToday ? 'bg-teal-600 text-white shadow-md' : isSelectedDay ? 'bg-slate-200 text-slate-800 font-bold' : 'hover:bg-slate-50'}`}>
                          {dNum}
                        </div>
                      )
                   })}
               </div>
            </div>

            {/* Appointment Editor / Details Panel */}
            <div className="hidden lg:block w-full h-full min-h-[500px]">
               {isBookingModalOpen ? (
                 <div className="bg-white/80 backdrop-blur-3xl border border-white/60 shadow-[0_8px_40px_rgba(0,0,0,0.04)] rounded-[2rem] flex flex-col h-full min-h-0 overflow-hidden lg:text-slate-800 transition-all duration-300">
                    <BookingModal
                       inlineDesktop={true}
                       isOpen={isBookingModalOpen}
                       onClose={() => {
                          setIsBookingModalOpen(false);
                          setPreSelectedPatient(null);
                          setPreSelectedDoctor("");
                          setAppointmentToEdit(null);
                       }}
                       onSave={handleSaveBooking}
                       onDelete={handleDeleteBooking}
                       settingsConfig={scheduleConfig}
                       preSelectedDate={selectedDateForBooking}
                       preSelectedTime={selectedTimeForBooking}
                       preSelectedPatient={preSelectedPatient}
                       preSelectedDoctor={preSelectedDoctor}
                       editAppointment={appointmentToEdit}
                       patients={patientsList}
                       doctors={doctorsList}
                       servicesList={servicesList}
                    />
                 </div>
               ) : appointmentPanelMode === 'avatar' ? (
                  <AppointmentAvatarPanel
                     selectedAppointment={selectedAppt}
                     onClose={() => setSelectedAppt(null)}
                     onEditFull={(appt) => {
                        setAppointmentToEdit(appt);
                        setIsBookingModalOpen(true);
                     }}
                     onDelete={handleDeleteBooking}
                     onSaveBooking={handleSaveBooking}
                     doctorsList={doctorsList}
                     onSwitchToEditor={() => setAppointmentPanelMode('editor')}
                     onAppointmentReplaced={(newAppt) => setSelectedAppt(newAppt)}
                  />
               ) : (
                  <AppointmentSidePanel
                     selectedAppointment={selectedAppt}
                     onSwitchToAvatar={() => setAppointmentPanelMode('avatar')}
                     onClose={() => setSelectedAppt(null)}
                     onEditFull={(appt) => {
                        setAppointmentToEdit(appt);
                        setIsBookingModalOpen(true);
                     }}
                     onDelete={handleDeleteBooking}
                     onSaveBooking={handleSaveBooking}
                     doctorsList={doctorsList}
                  />
               )}
            </div>

            {/* Filters */}
            <details className="group bg-slate-50/50 lg:bg-transparent p-3 lg:p-0 rounded-2xl lg:rounded-none">
               <summary className="font-black text-slate-800 lg:mb-2 text-sm lg:text-base cursor-pointer list-none flex justify-between items-center py-1 lg:py-2 hover:bg-slate-50 lg:px-3 lg:-mx-3 rounded-xl transition-colors [&::-webkit-details-marker]:hidden">
                  {language === 'ar' ? 'تصفية' : 'Filters'}
                  <ChevronDown size={18} className="text-slate-400 group-open:rotate-180 transition-transform" />
               </summary>
               <div className="pt-2 px-1">
                 <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Status</p>
                 <div className="space-y-3 mb-6">
                     {['Scheduled', 'Checked In', 'In Chair', 'Completed', 'Cancelled', 'Delayed', 'No Show', 'Rescheduled'].map(status => {
                        const isSelected = selectedStatuses.includes(status);
                        return (
                          <label key={status} className="flex items-center gap-3 text-sm font-bold text-slate-600 cursor-pointer group hover:text-slate-800 transition-colors" onClick={() => toggleStatusFilter(status)}>
                             <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shadow-sm ${isSelected ? 'bg-teal-600 text-white' : 'border-2 border-slate-200 bg-white'}`}>
                                {isSelected && <Check size={14} strokeWidth={3}/>}
                             </div>
                             {status}
                          </label>
                        );
                     })}
                 </div>

                 <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Doctors</p>
                 <div className="space-y-3 pb-4">
                     {doctorsList.map(doc => {
                        const isSelected = selectedDoctors.includes(doc.name);
                        return (
                          <label key={doc.id} className="flex items-center gap-3 text-sm font-bold text-slate-600 cursor-pointer group hover:text-slate-800 transition-colors" onClick={() => toggleDoctorFilter(doc.name)}>
                             <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shadow-sm ${isSelected ? 'bg-teal-600 text-white' : 'border-2 border-slate-200 bg-white'}`}>
                                {isSelected && <Check size={14} strokeWidth={3}/>}
                             </div>
                             {doc.name}
                          </label>
                        );
                     })}
                 </div>

                 {allRooms.length > 0 && (
                   <>
                     <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{language === 'ar' ? 'الغرف' : 'Rooms'}</p>
                     <div className="space-y-3 pb-4">
                        {allRooms
                          .filter(room => !selectedBranchId || room.branchId === selectedBranchId)
                          .map(room => {
                            const isSelected = selectedRooms.includes(room.id);
                            return (
                              <label key={room.id} className="flex items-center gap-3 text-sm font-bold text-slate-600 cursor-pointer group hover:text-slate-800 transition-colors" onClick={() => toggleRoomFilter(room.id)}>
                                 <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shadow-sm ${isSelected ? 'bg-teal-600 text-white' : 'border-2 border-slate-200 bg-white'}`}>
                                    {isSelected && <Check size={14} strokeWidth={3}/>}
                                 </div>
                                 <span className="min-w-0 truncate">
                                    {room.name}
                                    {branches.length > 1 && !selectedBranchId && (
                                      <span className="text-slate-400 font-medium"> — {room.branchName}</span>
                                    )}
                                 </span>
                              </label>
                            );
                        })}
                     </div>
                   </>
                 )}

                 {serviceOptions.length > 0 && (
                   <>
                     <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{language === 'ar' ? 'الخدمات' : 'Services'}</p>
                     <div className="space-y-3 pb-4">
                        {serviceOptions.map(svc => {
                           const isSelected = selectedServices.includes(svc);
                           return (
                             <label key={svc} className="flex items-center gap-3 text-sm font-bold text-slate-600 cursor-pointer group hover:text-slate-800 transition-colors" onClick={() => toggleServiceFilter(svc)}>
                                <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shadow-sm ${isSelected ? 'bg-teal-600 text-white' : 'border-2 border-slate-200 bg-white'}`}>
                                   {isSelected && <Check size={14} strokeWidth={3}/>}
                                </div>
                                <span className="min-w-0 truncate">{svc}</span>
                             </label>
                           );
                        })}
                     </div>
                   </>
                 )}
               </div>
            </details>
         </div>

         {/* --- RIGHT PANEL (Main Grid) --- */}
         <div className={`flex-1 flex flex-col min-w-0 bg-white border border-slate-100 rounded-2xl lg:rounded-2xl overflow-hidden shadow-sm ${!selectedAppt ? 'order-1 lg:order-2' : 'order-2 lg:order-2'} min-h-[500px]`}>
             {/* Header */}
             <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between p-3 sm:p-4 border-b border-slate-50 gap-2 sm:gap-3">
                  <div className="flex items-center gap-2 sm:gap-3 w-full xl:w-auto min-w-0">
                      <button onClick={() => handleNavigate(-1)} className="text-slate-400 hover:text-slate-800 transition-colors bg-slate-50 p-1.5 rounded-xl shrink-0"><ChevronLeft size={20}/></button>
                      <h1 className="text-base sm:text-xl font-black text-slate-800 truncate min-w-0 flex-1 xl:flex-none text-center xl:text-start">{weekTitle}</h1>
                      <button onClick={() => handleNavigate(1)} className="text-slate-400 hover:text-slate-800 transition-colors bg-slate-50 p-1.5 rounded-xl shrink-0"><ChevronRight size={20}/></button>
                      <button onClick={() => { setCurrentDate(new Date()); setMiniCalendarDate(new Date()); }} className="text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors shrink-0">{language === 'ar' ? 'اليوم' : 'Today'}</button>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 w-full xl:w-auto justify-between xl:justify-end flex-wrap">
                     {/* Branch switcher — only exists once branches are configured */}
                     {branches.length > 0 && (
                        <div className="relative flex items-center min-w-0">
                           <Building2 size={14} className="absolute start-2.5 text-teal-600 pointer-events-none" />
                           <select
                              value={selectedBranchId}
                              onChange={(e) => setSelectedBranchId(e.target.value)}
                              className="appearance-none bg-teal-50 border border-teal-100 text-teal-800 text-xs font-bold rounded-xl ps-8 pe-8 py-2 outline-none focus:border-teal-400 cursor-pointer max-w-[180px] truncate"
                           >
                              <option value="">{language === 'ar' ? 'كل الفروع' : 'All branches'}</option>
                              {branches.map(b => (
                                 <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                           </select>
                           <ChevronDown size={14} className="absolute end-2.5 text-teal-600 pointer-events-none" />
                        </div>
                     )}

                     {/* View Toggle: Week / Day / Doctors / List */}
                     <div className="flex bg-slate-100 p-1 rounded-xl gap-1 overflow-x-auto no-scrollbar max-w-full">
                        {([
                           { id: "week", label: language === "ar" ? "أسبوع" : "Week" },
                           { id: "day", label: language === "ar" ? "يوم" : "Day" },
                           { id: "doctor", label: language === "ar" ? "الدكاترة" : "Doctors" },
                           { id: "list", label: language === "ar" ? "قائمة" : "List" },
                        ] as const).map(v => (
                           <button
                              key={v.id}
                              onClick={() => setViewMode(v.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${viewMode === v.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                           >
                              {v.label}
                           </button>
                        ))}
                     </div>

                     <div className="hidden lg:flex gap-2">
                        <button 
                           onClick={() => setIsNewPatientModalOpen(true)}
                           className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl transition-all"
                        >
                           {language === 'ar' ? 'إضافة مريض' : 'Add Patient'}
                        </button>
                        <Protect permission="appointments.add">
                          <button 
                             onClick={() => handleOpenBooking()}
                             data-tour="appointment-add" className="bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 font-black px-5 py-2.5 rounded-xl shadow-sm shadow-yellow-200 flex items-center gap-2 transition-all active:scale-95"
                          >
                             <Plus size={18} strokeWidth={3}/> {language === 'ar' ? 'إضافة موعد' : 'Add Appointment'}
                          </button>
                        </Protect>
                     </div>
                  </div>
             </div>

             {/* The Grid Area (calendar views) or the Agenda (list view) */}
             {viewMode === 'list' ? (
               <div className="flex-1 overflow-y-auto custom-scrollbar bg-white p-3 sm:p-4">
                  {/* Group-by control: the same day's appointments, arranged by time, dentist, or service */}
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                     <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {language === 'ar' ? 'عرض حسب' : 'Group by'}
                     </span>
                     <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                        {([
                           { id: "time", label: language === 'ar' ? 'الوقت' : 'Time' },
                           { id: "doctor", label: language === 'ar' ? 'الدكتور' : 'Doctor' },
                           { id: "service", label: language === 'ar' ? 'الخدمة' : 'Service' },
                        ] as const).map(g => (
                           <button
                              key={g.id}
                              onClick={() => setListGroupBy(g.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${listGroupBy === g.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                           >
                              {g.label}
                           </button>
                        ))}
                     </div>
                  </div>

                  {listGroups.length === 0 ? (
                     <div className="text-center py-16 text-slate-400 font-bold text-sm">
                        {language === 'ar' ? 'مفيش مواعيد في اليوم ده.' : 'No appointments on this day.'}
                     </div>
                  ) : (
                     <div className="space-y-6 pb-24">
                        {listGroups.map(group => (
                           <div key={group.key}>
                              {listGroupBy !== 'time' && (
                                 <h3 className="flex items-center gap-2 text-sm font-black text-slate-700 mb-2 px-1">
                                    {listGroupBy === 'doctor' ? <Stethoscope size={14} className="text-teal-600" /> : <BriefcaseMedical size={14} className="text-indigo-500" />}
                                    {group.label}
                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">{group.appts.length}</span>
                                 </h3>
                              )}
                              <div className="space-y-2">
                                 {group.appts.map(appt => {
                                    const styles = getAppointmentStatusStyles(appt.status);
                                    return (
                                       <button
                                          key={appt.id}
                                          onClick={() => setSelectedAppt(appt)}
                                          className={`w-full text-start rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-all p-3 flex items-center gap-3 ${selectedAppt?.id === appt.id ? 'ring-2 ring-primary-500' : ''} ${isAppointmentLate(appt) ? 'ring-2 ring-rose-500 animate-pulse' : ''}`}
                                       >
                                          <div className="flex flex-col items-center justify-center bg-slate-50 rounded-xl px-2.5 py-2 shrink-0 min-w-[64px]">
                                             <span className="text-xs font-black text-slate-800 whitespace-nowrap" dir="ltr">
                                                {language === 'ar' ? appt.time?.replace('AM', 'ص').replace('PM', 'م') : appt.time}
                                             </span>
                                             <span className="text-[9px] font-bold text-slate-400">{appt.duration || 30}m</span>
                                          </div>
                                          <div className="flex-1 min-w-0">
                                             <div className="flex items-center gap-1.5 min-w-0">
                                                {(appt.source === 'online' || appt.source === 'Online Booking Request' || appt.source === 'Online Booking') && (
                                                   <Globe className="w-3 h-3 text-indigo-500 shrink-0" />
                                                )}
                                                <span className="font-extrabold text-sm text-slate-900 truncate">{appt.patientName}</span>
                                             </div>
                                             <p className="text-xs text-slate-500 font-bold truncate mt-0.5">
                                                {appt.treatment || 'Consultation'} <span className="text-slate-300 mx-0.5">•</span> Dr. {appt.doctor?.split(' ')[1] || appt.doctor}
                                             </p>
                                             {(appt.roomName || appt.branchName) && (
                                                <p className="text-[10px] text-teal-700 font-bold truncate mt-0.5 flex items-center gap-1">
                                                   <DoorOpen size={10} className="shrink-0" />
                                                   {[branches.length > 1 || !appt.roomName ? appt.branchName : null, appt.roomName].filter(Boolean).join(' · ')}
                                                </p>
                                             )}
                                          </div>
                                          <span className={`text-[10px] px-2 py-1 rounded-full whitespace-nowrap shrink-0 ${styles.pill}`}>
                                             {getAppointmentStageLabel(appt.status, language === 'ar' ? 'ar' : 'en')}
                                          </span>
                                       </button>
                                    );
                                 })}
                              </div>
                           </div>
                        ))}
                     </div>
                  )}
               </div>
             ) : (
             <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar bg-white flex flex-col relative">
                <div className={`${viewMode === 'week' ? '' : 'min-w-full'} lg:min-w-0 flex-1 flex flex-col relative`} style={viewMode === 'week' || (viewMode === 'doctor' && gridColumns.length > 2) ? { minWidth: `${gridColumns.length * (viewMode === 'doctor' ? 260 : 308) + 64}px` } : undefined}>
                  {/* Column Headers: days of the week, or one day's dentists */}
                  <div className="flex shrink-0 sticky top-0 bg-white z-30 border-b border-slate-50">
                     <div className="w-12 md:w-16 shrink-0 sticky start-0 bg-white z-40 border-b border-slate-50"></div>
                     <div className="flex flex-1">
                        {gridColumns.map(colObj => (
                            <div key={colObj.key}
                                 onClick={() => { if(canAddAppointment) handleOpenBooking(colObj.dateStr, undefined, colObj.doctorName && colObj.doctorName !== "__unassigned__" ? colObj.doctorName : undefined) }}
                                 className={`flex-1 text-center py-2 backdrop-blur-md transition-colors border-e border-transparent min-w-0 ${canAddAppointment ? 'cursor-pointer' : 'cursor-default'} ${colObj.isOffDay ? 'bg-red-50/80 hover:bg-red-100 hover:border-red-200' : 'bg-white/90 hover:bg-slate-50 hover:border-slate-100'}`}>
                               {colObj.doctorName ? (
                                  <>
                                     <span className={`font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 ${colObj.isOffDay ? 'text-red-400' : 'text-slate-400'}`}>
                                        <Stethoscope size={11} /> {language === 'ar' ? 'دكتور' : 'Dentist'}
                                     </span>
                                     <h3 className={`text-sm sm:text-base font-black mt-0.5 truncate px-1 ${colObj.isOffDay ? 'text-red-600' : 'text-slate-800'}`}>{colObj.label}</h3>
                                  </>
                               ) : (
                                  <>
                                     <span className={`font-bold text-xs uppercase tracking-wider ${colObj.isOffDay ? 'text-red-400' : 'text-slate-400'}`}>{colObj.label}</span>
                                     <h3 className={`text-xl font-black mt-0.5 ${colObj.isOffDay ? 'text-red-600' : 'text-slate-800'}`}>{colObj.sublabel}</h3>
                                  </>
                               )}
                            </div>
                        ))}
                     </div>
                  </div>

                  {/* Time grid */}
                  <div className="relative flex-1" style={{ minHeight: `${timeSlots.length * SLOT_HEIGHT}px` }}>
                     {/* Time labels & horizontal lines */}
                     {timeSlots.map((slot, i) => {
                       return (
                          <div key={i} className="absolute w-full flex" style={{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px` }}>
                             <div className="w-12 md:w-16 shrink-0 text-end pe-2 md:pe-4 pt-1 sticky start-0 bg-white z-20">
                                <span className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider">{language === 'ar' ? slot.timeLabel.replace('AM', 'ص').replace('PM', 'م') : slot.timeLabel}</span>
                             </div>
                            <div className="flex-1 border-t border-slate-200/80"></div>
                         </div>
                       )
                     })}
                     
                     {/* Vertical grid lines & clickable background slots */}
                     <div className="absolute inset-0 ms-12 md:ms-16 flex z-0">
                        {gridColumns.map((colObj) => (
                           <div key={colObj.key} className={`flex-1 flex flex-col border-e border-slate-200/80 relative group min-w-0 ${colObj.isOffDay ? 'bg-red-50/30' : ''}`}>
                              {timeSlots.map((slot) => {
                                 const isDraggedOver = activeDragTarget?.colKey === colObj.key && activeDragTarget?.time === slot.timeLabel;
                                 const colDoctor = colObj.doctorName && colObj.doctorName !== "__unassigned__" ? colObj.doctorName : undefined;
                                 return (
                                    <div
                                       key={`${slot.h}-${slot.m}`}
                                       style={{ height: `${SLOT_HEIGHT}px` }}
                                       className={`w-full transition-all ${isDraggedOver ? 'bg-teal-50 border-2 border-dashed border-teal-400 scale-[0.97] rounded-2xl shadow-inner z-10' : (colObj.isOffDay ? 'hover:bg-red-100/50 cursor-pointer border-b border-transparent hover:border-red-200' : 'hover:bg-accent-tint/30 cursor-pointer border-b border-transparent hover:border-primary-100')}`}
                                       onClick={() => { if (canAddAppointment) handleOpenBooking(colObj.dateStr, slot.timeLabel, colDoctor) }}
                                       onDragOver={(e) => e.preventDefault()}
                                       onDragEnter={() => setActiveDragTarget({ colKey: colObj.key, time: slot.timeLabel })}
                                       onDragLeave={() => setActiveDragTarget(null)}
                                       onDrop={(e) => {
                                         setActiveDragTarget(null);
                                         handleDrop(e, colObj.dateStr, slot.timeLabel, colDoctor);
                                       }}
                                    />
                                 )
                              })}
                           </div>
                        ))}
                     </div>

                     {/* Render Appointments Absolute Positioned */}
                     <div className="absolute inset-0 ms-12 md:ms-16 pointer-events-none">
                        {gridBlocks}
                     </div>
                  </div>
                </div>
             </div>
             )}
         </div>

         {isBookingModalOpen && typeof window !== 'undefined' && window.innerWidth < 1024 && (
        <BookingModal
          isOpen={isBookingModalOpen}
          onClose={() => {
            setIsBookingModalOpen(false);
            setPreSelectedPatient(null);
            setPreSelectedDoctor("");
          }}
          onSave={handleSaveBooking}
          onDelete={handleDeleteBooking}
          settingsConfig={scheduleConfig}
          preSelectedDate={selectedDateForBooking}
          preSelectedTime={selectedTimeForBooking}
          preSelectedPatient={preSelectedPatient}
          preSelectedDoctor={preSelectedDoctor}
          editAppointment={appointmentToEdit}
          patients={patientsList}
          doctors={doctorsList}
          servicesList={servicesList}
        />
      )}

      {/* Delay Prompt Modal */}
      {showDelayPrompt && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center">
            <h3 className="text-xl font-extrabold text-slate-800 mb-2">
              {language === 'ar' ? 'تأجيل الموعد' : 'Delay Appointment'}
            </h3>
            <p className="text-sm text-slate-500 mb-6 font-medium">
              {language === 'ar' 
                ? 'هل تريد تحديد موعد جديد الآن أم تركه غير محدد؟' 
                : 'Do you want to schedule a new appointment now or leave it unspecified?'}
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={async () => {
                  try {
                    if (delayedApptData) {
                      await handleSaveBooking({
                        ...delayedApptData,
                        existingAppointmentId: delayedApptData.id,
                        status: 'Delayed',
                        treatment: delayedApptData.treatment || '',
                        doctor: delayedApptData.doctor || '',
                        date: delayedApptData.date || '',
                        time: delayedApptData.time || '',
                        duration: delayedApptData.duration || 30
                      });
                      
                      setPreSelectedPatient({
                         id: delayedApptData.patientId,
                         name: delayedApptData.patientName
                      });
                      setPreSelectedDoctor(delayedApptData.doctor || "");
                      
                      setShowDelayPrompt(false);
                      setIsBookingModalOpen(true); // Open booking modal for new appt
                      showToast(language === "ar" ? "يرجى تحديد الموعد الجديد" : "Please select the new appointment time", "success");
                    }
                  } catch (e) {
                    console.error("Error updating delayed status:", e);
                    showToast("Error updating status", "error");
                  }
                }}
                className="w-full bg-accent-soft hover:bg-[#4eb37f] text-white font-bold py-3 px-4 rounded-xl transition-colors"
              >
                {language === 'ar' ? 'تحديد موعد جديد' : 'Schedule New Appointment'}
              </button>
              
              <button
                onClick={async () => {
                  try {
                    if (delayedApptData) {
                      await handleSaveBooking({
                        ...delayedApptData,
                        existingAppointmentId: delayedApptData.id,
                        status: 'Delayed',
                        treatment: delayedApptData.treatment || '',
                        doctor: delayedApptData.doctor || '',
                        date: delayedApptData.date || '',
                        time: delayedApptData.time || '',
                        duration: delayedApptData.duration || 30
                      });
                      setShowDelayPrompt(false);
                      showToast(language === "ar" ? "تم تأجيل الموعد" : "Appointment delayed", "success");
                    }
                  } catch (e) {
                    console.error("Error delaying appt:", e);
                    showToast("Error updating status", "error");
                  }
                }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl transition-colors"
              >
                {language === 'ar' ? 'غير محدد بعد' : 'Not Set Yet'}
              </button>

              <button
                onClick={() => setShowDelayPrompt(false)}
                className="w-full text-slate-400 hover:text-slate-600 font-bold py-2 px-4 rounded-xl mt-2 transition-colors text-sm"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Details Modal */}
      {selectedAppt && typeof window !== 'undefined' && window.innerWidth < 1024 && !isBookingModalOpen && (
         <AppointmentDetailsModal
            appointment={selectedAppt}
            patients={patientsList}
            doctors={doctorsList}
            onClose={() => setSelectedAppt(null)}
            onUpdateStatus={async (id, status) => {
               await handleSaveBooking({ ...selectedAppt, existingAppointmentId: id, status } as any);
            }}
            onUpdateWaitingMood={async (id, mood) => {
               await handleSaveBooking({ ...selectedAppt, existingAppointmentId: id, waitingMood: mood } as any);
            }}
            onDelete={async (id) => {
               await handleDeleteBooking(id);
            }}
            onEdit={() => {
               setSelectedAppt(null);
               setAppointmentToEdit(selectedAppt);
               setIsBookingModalOpen(true);
            }}
            onViewProfile={(id) => {
               window.location.href = `/patients/${id}`;
            }}
         />
      )}

      {isNewPatientModalOpen && (
         <NewPatientModal
            isOpen={isNewPatientModalOpen}
            onClose={() => setIsNewPatientModalOpen(false)}
            onSuccess={() => showToast(language === "ar" ? "تمت إضافة المريض بنجاح" : "Patient added successfully", "success")}
         />
      )}

      <LateAppointmentPrompt
         isOpen={!!lateApptToPrompt}
         appointment={lateApptToPrompt}
         onClose={() => setLateApptToPrompt(null)}
         onAction={handleLateAction}
         config={scheduleConfig}
      />



      </div>



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

      {/* Mobile FAB */}
      <button 
        onClick={() => handleOpenBooking()}
        data-tour="appointment-add" className="lg:hidden fixed bottom-6 end-6 z-50 bg-[#FACC15] text-slate-900 p-4 rounded-full shadow-xl hover:bg-[#EAB308] transition active:scale-95"
      >
        <Plus size={24} />
      </button>

      {pendingDelete && (
        <DeleteAppointmentDialog
          appointmentId={pendingDelete.id}
          patientName={pendingDelete.patientName}
          onCancel={() => setPendingDelete(null)}
          onConfirm={performDelete}
        />
      )}
    </PermissionGuard>
  );
}