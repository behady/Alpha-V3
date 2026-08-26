"use client";
import { patientAvatarPath, patientMediaPath } from "@/lib/storagePaths";

import { deleteRecord, isOrphanWarning, RecycleBinError } from "@/lib/recycleBinApi";
import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { 
  ArrowLeft, ArrowRight, MapPin, Edit2, X, Loader2, AlertTriangle, 
  Activity, User, CalendarDays, Stethoscope, Trash2, 
  ChevronDown, MessageCircle, AlertCircle, Wallet, LayoutDashboard, Users, History, CreditCard,
  PhoneForwarded, CheckCircle2, UserX, Globe, MessageCircleOff, MessageSquare, MessageSquareOff, ScrollText,
  Star, Printer, Pill, Check, Calendar, Camera, UploadCloud, FilePlus, Eye, Download, StickyNote, ClipboardList
} from "lucide-react";
import { auth, db, storage } from "@/lib/firebase";
import { doc, onSnapshot, updateDoc, deleteDoc, collection, query, where, limit, orderBy, addDoc, serverTimestamp } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { smsPreferenceState, type PatientContactPreferences } from "@/lib/patientMessaging";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { logActivity } from "@/lib/logger";
import PermissionGuard from "@/components/PermissionGuard";
import Protect from "@/components/Protect";
import PatientFinance from "@/components/PatientFinance";
import PatientClinical from "@/components/PatientClinical";
import PatientTimeTrackerWidget from "@/components/patient/PatientTimeTrackerWidget";
import PatientTimelineTab from "@/components/patients/PatientTimelineTab";
import PatientNotesTab from "@/components/patients/PatientNotesTab";
import PatientMediaGallery from "@/components/patients/PatientMediaGallery";
import PatientTreatmentPlanTab from "@/components/patients/PatientTreatmentPlanTab";
import { prescriptionPayloadToPdfBlob, type RxItem } from "@/lib/prescriptionPdfHtml";
import { handleWhatsAppApiResult } from "@/lib/whatsappManual";
import {
  DEFAULT_COUNTRY_CODE,
  COUNTRY_CODE_OPTIONS,
  buildE164FromCountryCode,
  splitE164ToCountryAndLocal,
} from "@/lib/phoneNumber";

// Helper for the CRM Timeline Icons, Colors & Human Titles
function formatWhatsAppLogType(type: string) {
  switch (type) {
    case "new":
      return "New booking";
    case "edit":
      return "Reschedule";
    case "cancel":
      return "Cancel";
    case "invoice":
      return "Invoice";
    case "treatment":
      return "Treatment";
    case "prescription_pdf":
      return "Prescription (PDF)";
    case "treatment_plan_pdf":
      return "Treatment Plan (PDF)";
    case "receipt":
      return "Receipt Summary";
    case "lab_order":
      return "Lab Order";
    case "google_review":
      return "Google review";
    case "appointment_new":
      return "New booking";
    case "appointment_edit":
      return "Reschedule";
    case "appointment_cancel":
      return "Cancel";
    default:
      return type || "—";
  }
}

function messageSnippet(text: unknown, max = 100) {
  const s = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!s) return "—";
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

const WHATSAPP_LOG_PAGE_SIZE = 10;
const PRESCRIPTION_HISTORY_PAGE_SIZE = 10;

function pageRange(current: number, total: number, max = 7): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
  const half = Math.floor(max / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(total, start + max - 1);
  if (end - start < max - 1) start = Math.max(1, end - max + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function whatsappLogTimestampMs(row: { createdAt?: { toMillis?: () => number }; timestamp?: unknown }) {
  const ms = row.createdAt?.toMillis?.();
  if (typeof ms === "number" && !Number.isNaN(ms)) return ms;
  if (typeof row.timestamp === "string") {
    const t = Date.parse(row.timestamp);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function normalizeRxItemsFromRecord(raw: unknown): RxItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x: any, i) => ({
    id: typeof x?.id === "string" ? x.id : `rx_${i}`,
    name: String(x?.name ?? "—"),
    dose: String(x?.dose ?? ""),
    note: String(x?.note ?? ""),
  }));
}

function prescriptionCreatedMs(row: { createdAt?: { toMillis?: () => number } }) {
  const ms = row.createdAt?.toMillis?.();
  return typeof ms === "number" && !Number.isNaN(ms) ? ms : 0;
}

function prescriptionPreviewText(record: any): string {
  const dx = typeof record?.diagnosis === "string" ? record.diagnosis.replace(/\s+/g, " ").trim() : "";
  const items = normalizeRxItemsFromRecord(record?.drugs);
  const names = items.slice(0, 4).map((i) => i.name);
  const suffix = items.length > 4 ? "…" : "";
  const drugPart = names.length ? names.join(" · ") + suffix : "";
  if (dx && drugPart) return `${dx} — ${drugPart}`;
  return dx || drugPart || "—";
}

function formatPrescriptionCardDate(record: any): string {
  const dt = record?.createdAt?.toDate?.() ?? null;
  if (dt) {
    return dt.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (typeof record?.date === "string" && record.date.trim()) {
    return record.date.trim();
  }
  const ms = prescriptionCreatedMs(record);
  if (ms) {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "—";
}

const getTimelineStyle = (status: string) => {
    const s = (status || "").toLowerCase();
    if (s.includes('book') || s.includes('sched')) return { color: 'bg-emerald-500 ring-emerald-100', icon: CalendarDays, title: 'Appointment Scheduled' };
    if (s.includes('contact') || s.includes('call')) return { color: 'bg-amber-500 ring-amber-100', icon: PhoneForwarded, title: 'Patient Contacted' };
    if (s.includes('hot')) return { color: 'bg-rose-500 ring-rose-100', icon: Activity, title: 'High Priority Lead' };
    if (s.includes('cold') || s.includes('lost')) return { color: 'bg-slate-400 ring-slate-100', icon: UserX, title: 'Lead Cooled / Lost' };
    if (s.includes('complete') || s.includes('done')) return { color: 'bg-[#60d297] ring-blue-100', icon: CheckCircle2, title: 'Treatment Completed' };
    return { color: 'bg-[#E8F7F0]0 ring-blue-100', icon: MessageCircle, title: 'Pipeline Update' };
};

export default function PatientProfile() {
  const { showToast, confirm } = useUI();
  const { t, language, isRTL } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, clinicId } = useClinic();
  
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  
  // FIX: Decode the URI component to handle Arabic names correctly when used as document IDs
  const rawId = (params?.id as string) || "";
  const id = rawId ? decodeURIComponent(rawId) : "";

  const [patient, setPatient] = useState<any>(null);
  const [balance, setBalance] = useState<number>(0);
  const [totalBilled, setTotalBilled] = useState<number>(0);
  const [totalPaid, setTotalPaid] = useState<number>(0);
  const [servicesDone, setServicesDone] = useState<number>(0);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [appointmentTimeline, setAppointmentTimeline] = useState<any[]>([]);
  const [whatsappLogs, setWhatsappLogs] = useState<any[]>([]);
  const [whatsappLogPage, setWhatsappLogPage] = useState(1);
  const [whatsappOptOutSaving, setWhatsappOptOutSaving] = useState(false);
  const [smsOptOutSaving, setSmsOptOutSaving] = useState(false);
  const [sendingReviewRequest, setSendingReviewRequest] = useState(false);
  const [selectedPrescription, setSelectedPrescription] = useState<any | null>(null);
  const [sendingPrescriptionPdf, setSendingPrescriptionPdf] = useState(false);
  const [downloadingPrescriptionPdf, setDownloadingPrescriptionPdf] = useState(false);
  const [prescriptionsHistory, setPrescriptionsHistory] = useState<any[]>([]);
  const [prescriptionHistoryPage, setPrescriptionHistoryPage] = useState(1);
  const [clinicRxInfo, setClinicRxInfo] = useState<Record<string, unknown> | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const canViewClinical = isAdmin || user?.role === "Admin" || user?.role === "Dentist" || user?.permissions?.includes("access.clinical");
  const canViewOrtho = isAdmin || user?.role === "Admin" || user?.role === "Dentist" || user?.permissions?.includes("access.ortho");

  // Start empty so we don't flash the wrong tab during auth load
  const [activeTab, setActiveTab] = useState<"overview" | "clinical" | "plan" | "finance" | "timeline" | "xrays" | "prescriptions" | "notes" | "">("");
  const [hasSetInitialTab, setHasSetInitialTab] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // X-Rays & Media State
  const [patientMedia, setPatientMedia] = useState<any[]>([]);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [mediaCategoryFilter, setMediaCategoryFilter] = useState<string>("All");
  const [selectedLightboxMedia, setSelectedLightboxMedia] = useState<any | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>("X-Ray");

  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editCountryCode, setEditCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editReferral, setEditReferral] = useState("");
  const [editAllergies, setEditAllergies] = useState("");
  const [editGender, setEditGender] = useState("Male");
  const [editStatus, setEditStatus] = useState("Active");
  const [historyTags, setHistoryTags] = useState<string[]>([]);
  const [editMedicalHistory, setEditMedicalHistory] = useState("");

  // Set the SMART default tab based on roles
  useEffect(() => {
      if (!authLoading && !hasSetInitialTab) {
          // Every tab id is a valid deep link — the list used to stop at three, so ?tab=notes
          // (or xrays, prescriptions, timeline) silently landed on the default tab instead.
          if (
              tabParam === "finance" || tabParam === "clinical" || tabParam === "overview" ||
              tabParam === "timeline" || tabParam === "xrays" || tabParam === "prescriptions" ||
              tabParam === "notes" || tabParam === "plan"
          ) {
              setActiveTab(tabParam);
          } else {
              setActiveTab(canViewClinical ? "clinical" : "overview");
          }
          setHasSetInitialTab(true);
      }
  }, [authLoading, canViewClinical, hasSetInitialTab, tabParam]);

  const calculateAge = (dob: string) => {
    if (!dob) return "N/A";
    const birthDate = new Date(dob);
    const diff = Date.now() - birthDate.getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  };

  const openWhatsApp = (phone: string) => {
      if (!phone) return;
      let cleaned = phone.replace(/\D/g, '');
      if (cleaned.startsWith('0')) cleaned = '2' + cleaned;
      else if (!cleaned.startsWith('20') && cleaned.length >= 10) cleaned = '20' + cleaned;
      window.open(`https://wa.me/${cleaned}`, '_blank');
  };

  const handleSendGoogleReview = async () => {
    if (!id) return;
    setSendingReviewRequest(true);
    try {
      const u = auth.currentUser;
      if (!u) {
        showToast(language === "ar" ? "سجّل الدخول" : "Sign in required", "error");
        return;
      }
      const token = await u.getIdToken();
      const res = await fetch("/api/whatsapp/send-google-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Request failed");
      }
      if (data.manual) {
        handleWhatsAppApiResult(data, patient?.name);
        showToast(
          language === "ar" ? "افتح واتساب من الرسالة عشان تبعت" : "Open WhatsApp from the prompt to send it",
          "info"
        );
      } else {
        showToast(language === "ar" ? "تم إرسال طلب التقييم" : "Review request sent", "success");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : language === "ar" ? "فشل الإرسال" : "Send failed", "error");
    } finally {
      setSendingReviewRequest(false);
    }
  };

  // Fetch Patient, Balance, Family, and CRM Tickets
  useEffect(() => {
    if (!id) return;
    
    const unsubPatient = onSnapshot(getClinicDoc("patients", id), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPatient({ id: docSnap.id, ...data });
        
        const fullName = data.name || "";
        const parts = fullName.split(" ");
        if (parts.length > 1) {
          setEditFirstName(parts.slice(0, -1).join(" "));
          setEditLastName(parts[parts.length - 1]);
        } else {
          setEditFirstName(fullName);
          setEditLastName("");
        }
        
        const split = splitE164ToCountryAndLocal(String(data.phone || ""));
        setEditCountryCode(split.countryCode);
        setEditPhone(split.localNumber);
        setEditAddress(data.address || "");
        setEditDob(data.dateOfBirth || "");
        setEditReferral(data.referral || "");
        setEditAllergies(data.allergies || "");
        setEditGender(data.gender || "Male");
        setEditStatus(data.status || "Active");
        
        if (data.medicalHistory && data.medicalHistory !== "None (Healthy)") {
          setHistoryTags(data.medicalHistory.split(', ').filter((s: string) => s.trim() !== ""));
          // "None (Healthy)" was written automatically for every patient, so it is not a real
          // clinician statement — show the field as empty rather than carrying it forward.
          setEditMedicalHistory(data.medicalHistory === "None (Healthy)" ? "" : data.medicalHistory);
        } else {
          setHistoryTags([]);
        }
        setError(null);

        if (data.phone) {
            const familyQuery = query(getClinicCollection("patients"), where("phone", "==", data.phone));
            onSnapshot(familyQuery, (familySnap) => {
                const members = familySnap.docs
                    .map(d => ({ id: d.id, ...d.data() } as any))
                    .filter((p: any) => p.id !== id); 
                setFamilyMembers(members);
            });
        }
      } else {
        if (!isDeleting) setError(t('patientNotFound') || "Patient record not found.");
      }
      setLoading(false);
    }, (err: any) => {
      console.error("Patient snapshot error:", err);
      if (err.code === 'permission-denied') {
        setError(language === "ar" ? "يرجى التواصل مع المسؤول للحصول على الصلاحيات" : "Please contact admin for permissions");
      } else {
        setError(err.message);
      }
      setLoading(false);
    });

    const q = query(getClinicCollection("ledger"), where("patientId", "==", id));
    const unsubLedger = onSnapshot(q, (snap) => {
        let tCost = 0;
        let tPaid = 0;
        let sDone = 0;
        const allTrans: any[] = [];

        snap.docs.forEach(doc => {
            const d = doc.data();
            allTrans.push({ id: doc.id, ...d });
            if (d.type === 'procedure') {
                tCost += (Number(d.cost) || 0);
                sDone++;
            }
            if (d.type === 'payment') tPaid += (Number(d.paid) || 0);
        });

        allTrans.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        
        setTotalBilled(tCost);
        setTotalPaid(tPaid);
        setServicesDone(sDone);
        setBalance(tCost - tPaid);
        setRecentTransactions(allTrans.slice(0, 5)); 
    });

    return () => { unsubPatient(); unsubLedger(); };
  }, [id, t, isDeleting]);

  useEffect(() => {
    if (!id) return;
    const logsQuery = query(getClinicCollection("whatsapp_logs"), where("patientId", "==", id), limit(200));
    const unsub = onSnapshot(logsQuery, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      rows.sort((a, b) => whatsappLogTimestampMs(b) - whatsappLogTimestampMs(a));
      setWhatsappLogs(rows);
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(getClinicDoc("settings", "clinic_info"), (snap) => {
      setClinicRxInfo(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const prescQuery = query(getClinicCollection("prescriptions"), where("patientId", "==", id), limit(200));
    const unsub = onSnapshot(prescQuery, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      rows.sort((a, b) => prescriptionCreatedMs(b) - prescriptionCreatedMs(a));
      setPrescriptionsHistory(rows);
    });
    return () => unsub();
  }, [id]);

  // Fetch Patient X-Rays & Clinical Media
  useEffect(() => {
    if (!id) return;
    const q = query(getClinicCollection("patient_media"), where("patientId", "==", id));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      rows.sort((a: any, b: any) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt || 0;
        return bTime - aTime;
      });
      setPatientMedia(rows);
    });
    return () => unsub();
  }, [id]);

  const prescriptionHistoryPageCount = Math.max(
    1,
    Math.ceil(prescriptionsHistory.length / PRESCRIPTION_HISTORY_PAGE_SIZE)
  );

  const paginatedPrescriptions = useMemo(() => {
    const start = (prescriptionHistoryPage - 1) * PRESCRIPTION_HISTORY_PAGE_SIZE;
    return prescriptionsHistory.slice(start, start + PRESCRIPTION_HISTORY_PAGE_SIZE);
  }, [prescriptionsHistory, prescriptionHistoryPage]);

  useEffect(() => {
    setPrescriptionHistoryPage((p) => Math.min(Math.max(1, p), prescriptionHistoryPageCount));
  }, [prescriptionHistoryPageCount]);

  const whatsappLogPageCount = Math.max(1, Math.ceil(whatsappLogs.length / WHATSAPP_LOG_PAGE_SIZE));

  const paginatedWhatsappLogs = useMemo(() => {
    const start = (whatsappLogPage - 1) * WHATSAPP_LOG_PAGE_SIZE;
    return whatsappLogs.slice(start, start + WHATSAPP_LOG_PAGE_SIZE);
  }, [whatsappLogs, whatsappLogPage]);

  useEffect(() => {
    setWhatsappLogPage((p) => Math.min(Math.max(1, p), whatsappLogPageCount));
  }, [whatsappLogPageCount]);

  useEffect(() => {
    if (!id) return;
    const appointmentsQuery = query(
      getClinicCollection("appointments"),
      where("patientId", "==", id),
      orderBy("createdAt", "desc"),
      limit(200)
    );
    const unsub = onSnapshot(appointmentsQuery, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      rows.sort((a, b) => {
        const aMs = a.createdAt?.toMillis?.() ?? 0;
        const bMs = b.createdAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });
      setAppointmentTimeline(rows);
    });
    return () => unsub();
  }, [id]);

  const handleWhatsAppOptOutChange = async (optOut: boolean) => {
    if (!id) return;
    try {
      setWhatsappOptOutSaving(true);
      await updateDoc(getClinicDoc("patients", id), { whatsappOptOut: optOut });
      showToast(
        optOut
          ? (t("whatsappOptOutOn") || "Patient will not receive automated WhatsApp messages.")
          : (t("whatsappOptOutOff") || "Patient can receive automated WhatsApp messages again."),
        "success"
      );
    } catch (e) {
      console.error(e);
      showToast(t("updateError") || "Could not update preference.", "error");
    } finally {
      setWhatsappOptOutSaving(false);
    }
  };

  /**
   * Turn automated SMS on or off for this patient.
   *
   * Always writes an explicit true/false, never clears the field. That is what lets a patient who
   * is opted out of WhatsApp still be marked as reachable by text — the common case being someone
   * who simply does not use WhatsApp.
   */
  const smsState = smsPreferenceState(patient as PatientContactPreferences | null);
  const smsBlocked = smsState !== "allowed";

  const handleSmsOptOutChange = async (optOut: boolean) => {
    if (!id) return;
    try {
      setSmsOptOutSaving(true);
      await updateDoc(getClinicDoc("patients", id), { smsOptOut: optOut });
      showToast(
        optOut
          ? "Patient will not receive automated text messages."
          : "Patient can receive automated text messages.",
        "success"
      );
    } catch (e) {
      console.error(e);
      showToast(t("updateError") || "Could not update preference.", "error");
    } finally {
      setSmsOptOutSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const normalizedPhone = buildE164FromCountryCode(editCountryCode, editPhone);
      if (!normalizedPhone) {
        showToast(
          language === "ar"
            ? "رقم الهاتف لازم يبدأ بكود الدولة (مثال: +201001234567)"
            : "Phone must include country code first (e.g. +201001234567)",
          "error"
        );
        return;
      }
      const combinedName = `${editFirstName} ${editLastName}`.trim();
      // historyTags is only ever populated from the loaded record and no control mutates it, so
      // this previously reset medicalHistory to "None (Healthy)" on every save — overwriting
      // whatever was recorded at intake with a clean bill of health nobody gave.
      const finalHistory = editMedicalHistory.trim();
      // Allergies and history are read as clinical statements, so they need a byline. Stamped only
      // when one of them actually changes — a name or address edit must not reattribute them.
      const medicalChanged =
        finalHistory !== String(patient?.medicalHistory || "").trim() ||
        editAllergies.trim() !== String(patient?.allergies || "").trim();
      const medicalAuthorFields = medicalChanged
        ? {
            medicalNotesBy: user?.name || user?.email || "",
            medicalNotesAt: new Date().toISOString(),
          }
        : {};
      await updateDoc(getClinicDoc("patients", id), {
        ...medicalAuthorFields,
        name: combinedName,
        phone: normalizedPhone,
        address: editAddress,
        dateOfBirth: editDob,
        referral: editReferral,
        medicalHistory: finalHistory,
        allergies: editAllergies,
        gender: editGender,
        status: editStatus
      });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Patient Updated",
        `Updated patient profile: ${combinedName} (${id})`
      );
      setIsEditModalOpen(false);
      showToast(t('updateSuccess') || "Profile Updated", "success");
    } catch (error) {
      showToast(t('updateError') || "Failed to update profile", "error");
    }
  };

  const handleDeletePatient = async () => {
    const isConfirmed = await confirm(
      t('confirmDeletePatient') || "Are you sure you want to permanently delete this patient? All their clinical and financial records will be lost.",
      {
        title: language === "ar" ? "حذف المريض نهائياً" : "Delete patient permanently",
        confirmLabel: language === "ar" ? "احذف" : "Delete",
        tone: "danger",
      }
    );

    if (!isConfirmed) return;

    try {
      setIsDeleting(true);
      const patientName = patient?.name || id;
      // Deleting a patient does not cascade — their charges, images and notes stay behind. The
      // route counts them and refuses the first time so the choice is made with the number in
      // view, rather than discovered later as records belonging to nobody.
      try {
        await deleteRecord(clinicId || "", "patients", id);
      } catch (err) {
        if (isOrphanWarning(err)) {
          const summary = Object.entries(err.counts || {})
            .map(([collection, n]) => `${n} ${collection.replace(/_/g, " ")}`)
            .join(", ");
          const goAhead = await confirm(
            language === "ar"
              ? `سيبقى لهذا المريض: ${summary}. هل تريد المتابعة؟`
              : `This patient still has ${summary}. These will be left behind. Delete anyway?`,
            { confirmLabel: language === "ar" ? "حذف" : "Delete", tone: "danger" }
          );
          if (!goAhead) {
            setIsDeleting(false);
            return;
          }
          await deleteRecord(clinicId || "", "patients", id, { acknowledgeOrphans: true });
        } else {
          throw err;
        }
      }
      showToast(
        language === "ar" ? "تم نقل المريض إلى المحذوفات" : "Patient moved to Recently Deleted.",
        "success"
      );
      router.push("/patients");
    } catch (err) {
      setIsDeleting(false);
      showToast(
        err instanceof RecycleBinError
          ? err.message
          : t('deleteError') || "Failed to delete patient.",
        "error"
      );
    }
  };

  const buildPrescriptionPayloadFromRecord = (record: any) => {
    if (!patient) throw new Error("Patient not loaded");
    const rxItems = normalizeRxItemsFromRecord(record?.drugs);
    const doctor = String(record?.doctor || "");
    const agePart =
      patient.dateOfBirth != null && String(patient.dateOfBirth).trim() !== ""
        ? calculateAge(String(patient.dateOfBirth))
        : patient.age != null && String(patient.age).trim() !== ""
          ? patient.age
          : "?";
    const ageSex = `${agePart} Y / ${String(patient.gender || "U").charAt(0) || "U"}`;
    const ci = clinicRxInfo || {};
    const clinicName =
      (typeof ci.name === "string" && ci.name.trim()) ||
      (typeof ci.clinicName === "string" && ci.clinicName.trim()) ||
      "Dental Clinic";
    const dateLabel =
      typeof record?.date === "string" && record.date.trim()
        ? record.date.trim()
        : prescriptionCreatedMs(record) > 0
          ? new Date(prescriptionCreatedMs(record)).toLocaleDateString("en-GB")
          : new Date().toLocaleDateString("en-GB");
    return {
      clinicName,
      rxHeader:
        (typeof ci.rxHeader === "string" && ci.rxHeader.trim()) || (doctor ? `Dr. ${doctor}` : ""),
      dateLabel,
      patientName: String(record?.patientName || patient.name || "Patient"),
      ageSex,
      diagnosis: String(record?.diagnosis || ""),
      doctor,
      address: typeof ci.address === "string" ? ci.address : "",
      phone: typeof ci.phone === "string" ? ci.phone : "",
      rxItems,
    };
  };

  const handleDownloadPrescriptionPdf = async (record: any) => {
    const rxItems = normalizeRxItemsFromRecord(record?.drugs);
    if (rxItems.length === 0) {
      showToast(
        language === "ar" ? "لا توجد أدوية في هذه الوصفة" : "This prescription has no medications.",
        "error"
      );
      return;
    }
    if (!patient) return;
    setDownloadingPrescriptionPdf(true);
    try {
      const payload = buildPrescriptionPayloadFromRecord(record);
      const blob = await prescriptionPayloadToPdfBlob(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Prescription-${String(record.id).slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(language === "ar" ? "تم تحميل الملف" : "PDF downloaded.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : language === "ar" ? "فشل PDF" : "PDF failed", "error");
    } finally {
      setDownloadingPrescriptionPdf(false);
    }
  };

  const handleSendPrescriptionPdfWhatsApp = async (record: any) => {
    if (!id || !patient) return;
    const u = auth.currentUser;
    if (!u) {
      showToast(language === "ar" ? "سجّل الدخول" : "Sign in required", "error");
      return;
    }
    const rxItems = normalizeRxItemsFromRecord(record?.drugs);
    if (rxItems.length === 0) {
      showToast(
        language === "ar" ? "لا توجد أدوية في هذه الوصفة" : "This prescription has no medications.",
        "error"
      );
      return;
    }
    setSendingPrescriptionPdf(true);
    try {
      const payload = buildPrescriptionPayloadFromRecord(record);
      const blob = await prescriptionPayloadToPdfBlob(payload);
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read PDF"));
        reader.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(",");
      const pdfBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const token = await u.getIdToken();
      const res = await fetch("/api/whatsapp/send-prescription-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: id, pdfBase64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "WhatsApp send failed");
      }
      if (data.manual) {
        handleWhatsAppApiResult(data, patient?.name);
        // Said explicitly, because this is the one case where manual delivers something
        // different from automatic: a download link rather than the PDF as an attachment.
        showToast(
          language === "ar"
            ? "افتح واتساب من الرسالة عشان تبعت — المريض هيستلم رابط الروشتة"
            : "Open WhatsApp from the prompt — the patient will receive a link to the prescription",
          "info"
        );
      } else {
        showToast(
          language === "ar" ? "تم إرسال الوصفة على واتساب" : "Prescription PDF sent on WhatsApp.",
          "success"
        );
      }
      setSelectedPrescription(null);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : language === "ar" ? "فشل الإرسال" : "Send failed",
        "error"
      );
    } finally {
      setSendingPrescriptionPdf(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    if (!file.type.startsWith("image/")) {
      showToast(language === "ar" ? "الرجاء اختيار صورة" : "Please select an image file", "error");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast(language === "ar" ? "حجم الصورة كبير جدا (الحد الأقصى 5 ميجابايت)" : "Image too large (max 5MB)", "error");
      return;
    }

    setIsUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const storageRef = ref(storage, patientAvatarPath(clinicId, id, ext));
      
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await updateDoc(getClinicDoc("patients", id as string), {
        imageUrl: downloadURL
      });
      
      showToast(language === "ar" ? "تم تحديث الصورة بنجاح" : "Profile picture updated", "success");
    } catch (err: any) {
      console.error("Image upload error:", err);
      showToast(language === "ar" ? "فشل تحديث الصورة" : "Failed to update picture", "error");
    } finally {
      setIsUploadingImage(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, cat: string = "X-Ray") => {
    const files = e.target.files;
    if (!files || files.length === 0 || !id) return;

    setIsUploadingMedia(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop() || 'jpg';
        const storageRef = ref(storage, patientMediaPath(clinicId, id, ext));
        
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);

        await addDoc(getClinicCollection("patient_media"), {
          patientId: id,
          patientName: patient?.name || "",
          url: downloadURL,
          filename: file.name,
          category: cat,
          notes: "",
          uploadedBy: user?.name || "Staff",
          createdAt: serverTimestamp(),
        });
      }

      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Media Uploaded",
        `Uploaded ${files.length} X-Ray/Photo(s) for patient ${patient?.name}`
      );

      showToast(language === "ar" ? "تم رفع الصور/الأشعة بنجاح" : "Media uploaded successfully", "success");
    } catch (err: any) {
      console.error("Media upload error:", err);
      showToast(language === "ar" ? "فشل رفع الصور" : "Failed to upload media", "error");
    } finally {
      setIsUploadingMedia(false);
      e.target.value = '';
    }
  };

  const filteredMedia = useMemo(() => {
    if (mediaCategoryFilter === "All") return patientMedia;
    return patientMedia.filter((m) => m.category === mediaCategoryFilter);
  }, [patientMedia, mediaCategoryFilter]);

  if (loading || authLoading || activeTab === "") return <div className="h-screen flex items-center justify-center bg-[#f8fafc]"><Loader2 className="animate-spin text-[#27ae60]" size={40}/></div>;
  if (error) return <div className="p-10 text-center text-slate-500 font-bold">{error}</div>;

  const displayAge = patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : (patient.age || "N/A");
  const hasAlerts = patient.allergies || (patient.medicalHistory && patient.medicalHistory !== "None (Healthy)");
  /**
   * Nothing on file is not the same as nothing wrong. Intake did not ask for allergies or history
   * until recently, so a blank record means "never screened" for most existing patients — showing
   * no banner at all would read as a clean bill of health.
   */
  const medicalNotScreened = !patient.allergies && (!patient.medicalHistory || patient.medicalHistory === "None (Healthy)");
  const initials = (patient.name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p: string) => p.charAt(0).toUpperCase())
    .join("");
  const avatarPalette = [
    "from-blue-500 to-indigo-600",
    "from-emerald-500 to-teal-600",
    "from-rose-500 to-pink-600",
    "from-amber-500 to-orange-600",
    "from-violet-500 to-purple-600",
    "from-sky-500 to-cyan-600",
  ];
  const avatarGradient = avatarPalette[(patient.name || "").length % avatarPalette.length];

  const tabs: Array<{ id: "clinical" | "overview" | "plan" | "finance" | "timeline" | "xrays" | "prescriptions" | "notes"; label: string; icon: any; show: boolean }> = [
    { id: "clinical", label: language === "ar" ? "السجل السريري" : "Clinical", icon: Activity, show: !!canViewClinical },
    { id: "plan", label: language === "ar" ? "خطة العلاج" : "Treatment Plan", icon: ClipboardList, show: !!canViewClinical },
    { id: "finance", label: language === "ar" ? "المالية" : "Finance", icon: Wallet, show: true },
    { id: "timeline", label: language === "ar" ? "سجل الزيارات" : "Timeline", icon: History, show: true },
    { id: "overview", label: language === "ar" ? "نظرة عامة" : "Overview", icon: LayoutDashboard, show: true },
    { id: "xrays", label: language === "ar" ? "الأشعة والصور" : "X-Rays & Photos", icon: Camera, show: true },
    { id: "prescriptions", label: language === "ar" ? "الروشتات والوصفات" : "Prescriptions", icon: Pill, show: true },
    { id: "notes", label: language === "ar" ? "الملاحظات" : "Notes", icon: StickyNote, show: true },
  ];

  return (
    <PermissionGuard permission="access.patients">
      <div className="min-h-screen bg-[#f8fafc] p-4 md:p-8 animate-in fade-in lg:pb-0">
        
        {/* TOP GRID WIDGETS */}
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-6 mb-6">
           
           {/* COL 1: Hero Identity */}
           <div className="lg:col-span-3 flex flex-col gap-3 lg:gap-4">
               <button onClick={() => router.push('/patients')} className="self-start p-2 rounded-xl bg-white/40 hover:bg-white/60 text-slate-700 transition-colors backdrop-blur-md lg:mb-2 -mb-1">
                 {isRTL ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
               </button>
               <div className="flex flex-col lg:relative lg:w-full lg:aspect-auto lg:h-[220px] xl:h-[250px] lg:rounded-[2rem] lg:overflow-hidden lg:shadow-lg lg:group shrink-0">
                  {/* Mobile Row Layout */}
                  <div className="flex flex-col gap-3 bg-gradient-to-br from-[#60d297] to-[#4eb37f] text-white p-4 rounded-[2rem] border border-[#60d297]/50 shadow-lg lg:hidden shrink-0">
                     <div className="flex items-center gap-4">
                         <div className="relative w-[72px] h-[72px] shrink-0 rounded-[1.5rem] overflow-hidden shadow-sm group border-2 border-white/30 bg-white/10">
                             <img 
                                src={patient.imageUrl || (patient.gender === "Female" ? "https://cdn-icons-png.flaticon.com/512/4140/4140047.png" : "https://cdn-icons-png.flaticon.com/512/4140/4140048.png")}
                                alt={patient.name}
                                className="w-full h-full object-cover"
                             />
                             <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploadingImage} />
                                {isUploadingImage ? <Loader2 size={16} className="animate-spin text-white" /> : <Camera size={16} className="text-white" />}
                             </label>
                         </div>
                         <div className="flex flex-col flex-1 min-w-0">
                             <h1 className="text-[1.1rem] font-black text-white leading-tight mb-0.5 truncate">{patient.name}</h1>
                             <div className="flex items-center gap-2 text-white/80 text-[11px] font-bold">
                                 <span>{displayAge} {t('yearSymbol') || 'Y'}</span>
                                 <span className="w-1 h-1 rounded-full bg-white/50"></span>
                                 <span>{patient.gender}</span>
                             </div>
                             <div className="mt-2 flex items-center gap-2">
                                 <div className="px-2.5 py-1 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 flex items-center gap-1.5 text-white text-[10px] font-bold tabular-nums">
                                     <Wallet size={12} className={balance > 0 ? "text-rose-200" : "text-emerald-100"} />
                                     {balance > 0 ? balance.toLocaleString() : '0'} EGP
                                 </div>
                                 <Protect permission="patients.edit">
                                   <button onClick={() => setIsEditModalOpen(true)} className="p-1 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/20 text-white transition-colors">
                                      <Edit2 size={12} />
                                   </button>
                                 </Protect>
                             </div>
                         </div>
                     </div>
                     <div className="flex flex-col gap-2 mt-1 pt-3 border-t border-white/20">
                        <button onClick={() => openWhatsApp(patient.phone)} className="flex items-center gap-3 text-white hover:text-white/80 transition-colors text-[13px] font-extrabold">
                           <div className="w-6 h-6 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0"><MessageCircle size={12} /></div>
                           {patient.phone || '—'}
                        </button>
                        {patient.address && (
                          <div className="flex items-center gap-3 text-white text-[13px] font-extrabold">
                             <div className="w-6 h-6 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0"><MapPin size={12} /></div>
                             <span className="truncate">{patient.address}</span>
                          </div>
                        )}
                     </div>
                  </div>

                  {/* Desktop Cover Layout */}
                  <div className="hidden lg:block relative w-full h-full">
                    <img 
                       src={patient.imageUrl || (patient.gender === "Female" ? "https://cdn-icons-png.flaticon.com/512/4140/4140047.png" : "https://cdn-icons-png.flaticon.com/512/4140/4140048.png")}
                       alt={patient.name}
                       className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    
                    {/* Edit Avatar Overlay */}
                    <label className="absolute top-4 right-4 z-20 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                       <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploadingImage} />
                       <div className="bg-white/20 backdrop-blur-md hover:bg-white/40 border border-white/30 text-white p-2.5 rounded-xl shadow-lg transition-colors flex items-center justify-center">
                          {isUploadingImage ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                       </div>
                    </label>

                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none"></div>
                    <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col">
                        <h1 className="text-2xl font-black text-white leading-tight mb-1">{patient.name}</h1>
                        <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
                            <span>{displayAge} {t('yearSymbol') || 'Y'}</span>
                            <span className="w-1 h-1 rounded-full bg-white/50"></span>
                            <span>{patient.gender}</span>
                        </div>
                        
                        <div className="mt-4 flex items-center gap-2">
                            <div className="px-3 py-1.5 rounded-full bg-white/20 backdrop-blur-md border border-white/10 flex items-center gap-2 text-white text-xs font-bold tabular-nums shadow-inner">
                                <Wallet size={12} className={balance > 0 ? "text-rose-400" : "text-emerald-400"} />
                                {balance > 0 ? balance.toLocaleString() : '0'} EGP
                            </div>
                            <Protect permission="patients.edit">
                              <button onClick={() => setIsEditModalOpen(true)} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white transition-colors">
                                 <Edit2 size={12} />
                              </button>
                            </Protect>
                        </div>
                    </div>
                  </div>
               </div>
               
               {/* Contact details card */}
                <div className="hidden lg:flex bg-white border border-slate-200/60 rounded-2xl lg:rounded-3xl p-3 lg:p-4 flex-col gap-2.5 shadow-sm shrink-0">
                    <button onClick={() => openWhatsApp(patient.phone)} className="flex items-center gap-3 text-slate-800 hover:text-emerald-700 transition-colors text-sm lg:text-[15px] font-extrabold">
                       <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><MessageCircle size={14} /></div>
                       {patient.phone || '—'}
                    </button>
                    {patient.address && (
                      <div className="flex items-center gap-3 text-slate-800 text-sm lg:text-[15px] font-extrabold">
                         <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><MapPin size={14} /></div>
                         <span className="truncate">{patient.address}</span>
                      </div>
                    )}
                </div>
           </div>

           {/* COL 2: Center Tracking & Stats */}
           <div className="lg:col-span-6 flex flex-col gap-3 lg:gap-5 lg:pt-8">
               {/* Top Stats */}
               <div className="flex items-center justify-around bg-white/40 backdrop-blur-xl rounded-2xl lg:rounded-[2rem] p-3 lg:p-4 border border-white/50 shadow-sm shrink-0">
                    <div className="flex flex-col items-center flex-1">
                        <span className="text-[10px] lg:text-sm font-bold text-slate-500 uppercase tracking-widest">{language === 'ar' ? 'الزيارات' : 'Visits'}</span>
                        <span className="text-3xl lg:text-4xl font-light tracking-tighter text-slate-800 leading-none mt-1">{appointmentTimeline.length}</span>
                    </div>
                    <div className="w-px h-10 lg:h-12 bg-slate-200"></div>
                    <div className="flex flex-col items-center flex-1">
                        <span className="text-[10px] lg:text-sm font-bold text-slate-500 uppercase tracking-widest">{language === 'ar' ? 'مكتمل' : 'Completed'}</span>
                        <span className="text-3xl lg:text-4xl font-light tracking-tighter text-slate-800 leading-none mt-1">{servicesDone}</span>
                    </div>
                </div>

               {/* Time Tracker (Hidden on Mobile) */}
               <div className="hidden lg:block">
                 <PatientTimeTrackerWidget appointments={appointmentTimeline} />
               </div>
               
               {/* Quick Actions Toolbar */}
                <div className="bg-white border border-slate-200/60 rounded-2xl lg:rounded-3xl p-3 lg:p-4 shadow-sm flex flex-col gap-2 mt-auto shrink-0">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                        {language === 'ar' ? 'الإجراءات السريعة' : 'Quick Actions'}
                    </span>
                    <div className="flex items-center justify-center gap-2">
                       {/* Gated to match the studio it opens: without clinical.edit this button
                           led straight to an Access Restricted screen. The Diagnosis button
                           beside it has always been gated the same way. */}
                       <Protect permission="clinical.edit">
                         <button onClick={() => router.push(`/patients/${encodeURIComponent(id)}/rx`)} data-tour="rx-open" className="flex-1 py-2 lg:py-2.5 px-2 lg:px-3 bg-slate-50 hover:bg-slate-100 text-blue-600 rounded-xl font-bold text-[11px] lg:text-xs flex items-center justify-center gap-1.5 lg:gap-2 border border-slate-200 transition-all hover:-translate-y-0.5">
                            <Pill size={14} /> <span className="truncate">{language === 'ar' ? 'وصفة طبية' : 'Write Rx'}</span>
                         </button>
                       </Protect>
                       {canViewClinical && (
                         <button onClick={() => router.push(`/patients/${encodeURIComponent(id)}/diagnosis`)} className="flex-1 py-2 lg:py-2.5 px-2 lg:px-3 bg-slate-50 hover:bg-slate-100 text-emerald-600 rounded-xl font-bold text-[11px] lg:text-xs flex items-center justify-center gap-1.5 lg:gap-2 border border-slate-200 transition-all hover:-translate-y-0.5">
                            <Stethoscope size={14} /> <span className="truncate">{language === 'ar' ? 'تشخيص' : 'Diagnosis'}</span>
                         </button>
                       )}
                       {canViewOrtho && (
                         <button onClick={() => router.push(`/ortho/${id}`)} className="flex-1 py-2 lg:py-2.5 px-2 lg:px-3 bg-slate-50 hover:bg-slate-100 text-violet-600 rounded-xl font-bold text-[11px] lg:text-xs flex items-center justify-center gap-1.5 lg:gap-2 border border-slate-200 transition-all hover:-translate-y-0.5">
                            <Activity size={14} /> <span className="truncate">{language === 'ar' ? 'تقويم' : 'Ortho'}</span>
                         </button>
                       )}
                    </div>
                </div>
           </div>

           {/* COL 3: Timeline Summary Dark Card */}
           <div className="hidden lg:flex lg:col-span-3 lg:pt-8 flex-col h-full">
               <div className="bg-[#1A2130] text-white rounded-[1.5rem] lg:rounded-[2rem] p-4 lg:p-6 shadow-[0_12px_40px_rgba(26,33,48,0.2)] flex-1 flex flex-col relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
                   <div className="flex items-center justify-between mb-4 lg:mb-6 relative z-10">
                      <span className="text-sm font-medium text-slate-400">{language === 'ar' ? 'آخر نشاط' : 'Recent Activity'}</span>
                      <span className="text-2xl font-light">{appointmentTimeline.slice(0,3).length}/3</span>
                   </div>
                   
                   <div className="flex flex-col gap-4 relative z-10">
                      {appointmentTimeline.slice(0, 3).map((appt: any, i) => (
                         <div key={i} className="flex items-start gap-3 group">
                            <div className="mt-1 bg-white/10 p-2 rounded-full text-white/50 group-hover:bg-cyan-500/20 group-hover:text-cyan-400 transition-colors shrink-0">
                               {appt.status === 'Completed' ? <Check size={14} /> : <Calendar size={14} />}
                            </div>
                            <div className="flex flex-col min-w-0">
                               <span className="text-sm font-bold truncate">{appt.treatment || appt.serviceName || "Visit"}</span>
                               <span className="text-xs text-slate-400">{new Date(appt.date).toLocaleDateString()} · {appt.time}</span>
                            </div>
                         </div>
                      ))}
                      {appointmentTimeline.length === 0 && (
                          <div className="text-sm text-slate-500 italic">No recent activity.</div>
                      )}
                   </div>
                   
                   <button onClick={() => void handleSendGoogleReview()} disabled={sendingReviewRequest} className="mt-auto pt-6 flex items-center justify-center gap-2 text-sm font-bold text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 shrink-0">
                      {sendingReviewRequest ? <Loader2 size={16} className="animate-spin" /> : <Star size={16} />}
                      {language === 'ar' ? 'طلب تقييم' : 'Request Review'}
                   </button>
               </div>
           </div>

        </div>

        {/* MEDICAL ALERT (If exists) */}
        {hasAlerts && !dismissedAlert && (
          <div className="max-w-[1600px] mx-auto mb-6 bg-rose-500 text-white px-6 py-4 rounded-3xl flex items-start gap-4 shadow-lg shadow-rose-500/20">
              <div className="bg-white/20 p-2 rounded-xl shrink-0">
                <AlertTriangle size={20}/>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                  <h4 className="font-bold text-rose-100 text-[11px] uppercase tracking-wider mb-1">
                    {language === 'ar' ? 'تنبيه طبي' : 'Medical alert'}
                  </h4>
                  <div className="text-sm font-medium leading-relaxed space-y-1">
                      {patient.allergies && <p><strong className="font-bold opacity-80">{language === 'ar' ? 'حساسية:' : 'Allergies:'}</strong> {patient.allergies}</p>}
                      {patient.medicalHistory && patient.medicalHistory !== "None (Healthy)" && <p><strong className="font-bold opacity-80">{language === 'ar' ? 'تاريخ:' : 'History:'}</strong> {patient.medicalHistory}</p>}
                  </div>
              </div>
              <button onClick={() => setDismissedAlert(true)} className="p-1.5 text-rose-200 hover:bg-white/20 rounded-lg transition-colors shrink-0"><X size={16}/></button>
          </div>
        )}

        {/* NOT-SCREENED NOTICE — deliberately distinct from the red alert above: this says we do
            not know, which is a different clinical statement from "no known issues". */}
        {medicalNotScreened && !dismissedAlert && (
          <div className="max-w-[1600px] mx-auto mb-6 bg-amber-50 text-amber-900 border border-amber-200 px-6 py-4 rounded-3xl flex items-start gap-4">
              <div className="bg-amber-100 text-amber-600 p-2 rounded-xl shrink-0">
                <AlertCircle size={20}/>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                  <h4 className="font-bold text-amber-700 text-[11px] uppercase tracking-wider mb-1">
                    {language === 'ar' ? 'لم يتم تسجيل التاريخ الطبي' : 'Medical history not recorded'}
                  </h4>
                  <p className="text-sm font-medium leading-relaxed">
                    {language === 'ar'
                      ? 'لا توجد بيانات حساسية أو تاريخ طبي لهذا المريض. هذا لا يعني عدم وجود حساسية — اسأل المريض وسجّل الإجابة قبل وصف أي دواء.'
                      : 'No allergies or medical history on file for this patient. This does not mean there are none — ask and record the answer before prescribing.'}
                  </p>
              </div>
              <button onClick={() => setDismissedAlert(true)} className="p-1.5 text-amber-400 hover:bg-amber-100 rounded-lg transition-colors shrink-0"><X size={16}/></button>
          </div>
        )}

        {/* MAIN TABS AREA */}
        <div className="max-w-[1600px] mx-auto bg-white/60 backdrop-blur-xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[2rem] p-4 md:p-6 lg:p-8">
            <nav className="flex items-center gap-2 mb-8 overflow-x-auto no-scrollbar pb-2 border-b border-white/50">
              {tabs.filter(tb => tb.show).map(tb => {
                const Icon = tb.icon;
                const active = activeTab === tb.id;
                return (
                  <button
                    key={tb.id}
                    data-tour={`patient-tab-${tb.id}`}
                    onClick={() => setActiveTab(tb.id)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all whitespace-nowrap ${
                      active ? 'bg-white text-slate-900 shadow-sm border border-white' : 'text-slate-500 hover:bg-white/50 border border-transparent'
                    }`}
                  >
                    <Icon size={16} className={active ? 'text-[#27ae60]' : 'text-slate-400'} />
                    {tb.label}
                  </button>
                );
              })}
            </nav>

          {/* --- OVERVIEW DASHBOARD --- */}
          {activeTab === "overview" && (
             <div className="animate-in fade-in duration-300 space-y-6">
                
                {/* Connected Family Members */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] lg:col-span-1">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <MessageCircle size={14} className="text-emerald-500" /> WhatsApp automation
                    </h3>
                    <p className="text-xs font-semibold text-slate-600 leading-relaxed mb-5">
                      {t("whatsappOptOutHint") || "Turn off automated appointment messages from the clinic (reminders and booking alerts)."}
                    </p>
                    <label className="flex items-center justify-between gap-4 cursor-pointer group">
                      <span className="flex items-start gap-3 min-w-0">
                        <MessageCircleOff size={18} className="text-slate-400 shrink-0 mt-0.5 group-hover:text-rose-500 transition-colors" />
                        <span className="text-sm font-bold text-slate-800 leading-snug">
                          {t("whatsappOptOutLabel") || "Opt-out of automated WhatsApp messages"}
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={patient.whatsappOptOut === true}
                        disabled={whatsappOptOutSaving}
                        onClick={() => handleWhatsAppOptOutChange(!(patient.whatsappOptOut === true))}
                        className={`relative w-12 h-7 rounded-full shrink-0 transition-colors border-2 ${
                          patient.whatsappOptOut === true
                            ? "bg-rose-500 border-rose-600"
                            : "bg-emerald-500 border-emerald-600"
                        } ${whatsappOptOutSaving ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
                            patient.whatsappOptOut === true ? "translate-x-0" : "translate-x-[1.35rem]"
                          }`}
                        />
                      </button>
                    </label>
                    <p className="text-[10px] font-bold text-slate-400 mt-3 uppercase tracking-wider">
                      {patient.whatsappOptOut === true
                        ? t("whatsappOptOutStatusOff") || "Status: opted out"
                        : t("whatsappOptOutStatusOn") || "Status: eligible for automation"}
                    </p>
                  </div>

                  {/* SMS automation — a separate switch from WhatsApp, because a patient with no
                      WhatsApp is still reachable by text, and the reverse happens too. */}
                  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] lg:col-span-1">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <MessageSquare size={14} className="text-emerald-500" /> SMS automation
                    </h3>
                    <p className="text-xs font-semibold text-slate-600 leading-relaxed mb-5">
                      Turn off automated text-message reminders for this patient. Texts are charged
                      to the clinic&apos;s SIM.
                    </p>
                    <label className="flex items-center justify-between gap-4 cursor-pointer group">
                      <span className="flex items-start gap-3 min-w-0">
                        <MessageSquareOff size={18} className="text-slate-400 shrink-0 mt-0.5 group-hover:text-rose-500 transition-colors" />
                        <span className="text-sm font-bold text-slate-800 leading-snug">
                          Opt-out of automated SMS
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={smsBlocked}
                        disabled={smsOptOutSaving}
                        onClick={() => handleSmsOptOutChange(!smsBlocked)}
                        className={`relative w-12 h-7 rounded-full shrink-0 transition-colors border-2 ${
                          smsBlocked ? "bg-rose-500 border-rose-600" : "bg-emerald-500 border-emerald-600"
                        } ${smsOptOutSaving ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
                            smsBlocked ? "translate-x-0" : "translate-x-[1.35rem]"
                          }`}
                        />
                      </button>
                    </label>

                    {/* Says WHY it is off. A patient blocked only because of the WhatsApp switch
                        looks identical to one blocked deliberately, and staff would otherwise
                        toggle the wrong control trying to fix it. */}
                    <p className="text-[10px] font-bold text-slate-400 mt-3 uppercase tracking-wider">
                      {smsState === "blocked_explicitly"
                        ? "Status: opted out"
                        : smsState === "blocked_by_whatsapp"
                          ? "Status: off — following the WhatsApp opt-out"
                          : "Status: eligible for automation"}
                    </p>
                    {smsState === "blocked_by_whatsapp" && (
                      <p className="text-[11px] font-semibold text-slate-500 mt-2 leading-relaxed">
                        This patient opted out of WhatsApp, so texts are held too. Switch this on to
                        send them texts anyway.
                      </p>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] overflow-hidden lg:col-span-2 flex flex-col min-h-[280px]">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <ScrollText size={14} className="text-indigo-500" />{" "}
                        {t("whatsappCommLog") || "WhatsApp communication log"}
                      </h3>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {whatsappLogs.length} {t("entries") || "entries"}
                      </span>
                    </div>
                    <div className="flex flex-col flex-1 min-h-0">
                      <div className="overflow-x-auto flex-1 min-h-0">
                        {whatsappLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400 px-6">
                          <MessageCircle size={40} className="mb-2 opacity-40" />
                          <p className="font-bold text-sm text-center">
                            {t("whatsappNoLogs") || "No automated WhatsApp messages logged for this patient yet."}
                          </p>
                        </div>
                      ) : (
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="bg-slate-50/80 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-100">
                              <th className="px-6 py-3">{t("date") || "Date"}</th>
                              <th className="px-4 py-3">{t("type") || "Type"}</th>
                              <th className="px-4 py-3 min-w-[200px]">{t("message") || "Snippet"}</th>
                              <th className="px-6 py-3 text-right">{t("status") || "Status"}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {paginatedWhatsappLogs.map((row: any) => {
                              const dt = row.createdAt?.toDate?.() ?? null;
                              const fallbackMs = whatsappLogTimestampMs(row);
                              const dateStr = dt
                                ? dt.toLocaleString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : fallbackMs
                                  ? new Date(fallbackMs).toLocaleString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "—";
                              const st = String(row.status || "").toLowerCase();
                              const ok = st === "success";
                              return (
                                <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-6 py-3.5 text-xs font-semibold text-slate-600 whitespace-nowrap tabular-nums">
                                    {dateStr}
                                  </td>
                                  <td className="px-4 py-3.5 text-xs font-bold text-slate-800">
                                    {formatWhatsAppLogType(row.type)}
                                  </td>
                                  <td className="px-4 py-3.5 text-xs text-slate-600 max-w-md">
                                    <span className="line-clamp-2" title={typeof row.message === "string" ? row.message : ""}>
                                      {messageSnippet(row.message)}
                                    </span>
                                  </td>
                                  <td className="px-6 py-3.5 text-right">
                                    <span
                                      className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border ${
                                        ok
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                          : "bg-rose-50 text-rose-700 border-rose-100"
                                      }`}
                                    >
                                      {ok ? t("sent") || "Sent" : t("failed") || "Failed"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      </div>

                      {whatsappLogs.length > 0 && whatsappLogPageCount > 1 ? (
                        <div
                          className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0 ${
                            isRTL ? "flex-row-reverse" : ""
                          }`}
                        >
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider tabular-nums">
                            {language === "ar"
                              ? `صفحة ${whatsappLogPage} من ${whatsappLogPageCount}`
                              : `Page ${whatsappLogPage} of ${whatsappLogPageCount}`}
                          </span>
                          <div className={`flex flex-wrap items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                            <button
                              type="button"
                              disabled={whatsappLogPage <= 1}
                              onClick={() => setWhatsappLogPage((p) => Math.max(1, p - 1))}
                              className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                            >
                              {language === "ar" ? "السابق" : "Prev"}
                            </button>
                            <div className={`flex items-center gap-1 ${isRTL ? "flex-row-reverse" : ""}`}>
                              {pageRange(whatsappLogPage, whatsappLogPageCount).map((num) => (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={() => setWhatsappLogPage(num)}
                                  className={`min-w-[2.25rem] px-2 py-1.5 rounded-xl text-[11px] font-black tabular-nums transition-colors ${
                                    num === whatsappLogPage
                                      ? "bg-slate-900 text-white shadow-sm"
                                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  {num}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              disabled={whatsappLogPage >= whatsappLogPageCount}
                              onClick={() => setWhatsappLogPage((p) => Math.min(whatsappLogPageCount, p + 1))}
                              className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                            >
                              {language === "ar" ? "التالي" : "Next"}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="border-t border-slate-100 px-6 py-5 bg-white shrink-0">
                        <div
                          className={`flex flex-wrap items-center justify-between gap-3 mb-1 ${
                            isRTL ? "flex-row-reverse" : ""
                          }`}
                        >
                          <h4
                            className={`text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 ${
                              isRTL ? "flex-row-reverse" : ""
                            }`}
                          >
                            <Pill size={14} className="text-violet-600 shrink-0" />
                            {language === "ar" ? "سجل الوصفات الطبية" : "Prescription history"}
                          </h4>
                          <button
                            type="button"
                            onClick={() => router.push(`/patients/${encodeURIComponent(id)}/rx`)}
                            className="text-[10px] font-black uppercase tracking-widest text-violet-600 hover:text-violet-800 hover:underline"
                          >
                            {language === "ar" ? "استوديو الوصفات ←" : "Prescription studio →"}
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
                          {language === "ar"
                            ? "كل الوصفات المحفوظة من الاستوديو (بما فيها الطباعة فقط أو إرسال واتساب). افتح البطاقة للتفاصيل أو إعادة الإرسال."
                            : "All prescriptions saved from Prescription Studio—including print-only saves and WhatsApp shares. Open a card for details, PDF, or WhatsApp."}
                        </p>
                        {prescriptionsHistory.length === 0 ? (
                          <p className="text-xs font-semibold text-slate-400 py-4 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                            {language === "ar"
                              ? "لا توجد وصفات محفوظة بعد. أنشئ واحدة من استوديو الوصفات."
                              : "No saved prescriptions yet. Create one in Prescription Studio."}
                          </p>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                              {paginatedPrescriptions.map((row: any) => {
                                const sentWa = row.sharedViaWhatsapp === true;
                                return (
                                  <button
                                    key={row.id}
                                    type="button"
                                    onClick={() => setSelectedPrescription(row)}
                                    className="text-left rounded-2xl border border-slate-200 bg-slate-50/40 hover:bg-white hover:border-violet-200/80 hover:shadow-md transition-all p-4 group"
                                  >
                                    <div
                                      className={`flex flex-wrap items-center justify-between gap-2 ${
                                        isRTL ? "flex-row-reverse" : ""
                                      }`}
                                    >
                                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider tabular-nums">
                                        {formatPrescriptionCardDate(row)}
                                      </span>
                                      <span
                                        className={`shrink-0 inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wide border ${
                                          sentWa
                                            ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                                            : "bg-slate-100 text-slate-600 border-slate-200"
                                        }`}
                                      >
                                        {sentWa
                                          ? language === "ar"
                                            ? "واتساب"
                                            : "WhatsApp sent"
                                          : language === "ar"
                                            ? "محفوظ"
                                            : "Saved"}
                                      </span>
                                    </div>
                                    {row.doctor ? (
                                      <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-wide">
                                        {String(row.doctor)}
                                      </p>
                                    ) : null}
                                    <p
                                      className={`text-xs text-slate-800 mt-1.5 line-clamp-3 leading-relaxed ${
                                        isRTL ? "text-right" : ""
                                      }`}
                                    >
                                      {prescriptionPreviewText(row)}
                                    </p>
                                    <span className="inline-flex mt-3 text-[10px] font-black text-violet-700 uppercase tracking-wide group-hover:underline">
                                      {language === "ar" ? "اضغط للفتح" : "Tap to open"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                            {prescriptionHistoryPageCount > 1 ? (
                              <div
                                className={`flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-slate-100 ${
                                  isRTL ? "flex-row-reverse" : ""
                                }`}
                              >
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider tabular-nums">
                                  {language === "ar"
                                    ? `صفحة ${prescriptionHistoryPage} من ${prescriptionHistoryPageCount}`
                                    : `Page ${prescriptionHistoryPage} of ${prescriptionHistoryPageCount}`}
                                </span>
                                <div className={`flex flex-wrap items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                                  <button
                                    type="button"
                                    disabled={prescriptionHistoryPage <= 1}
                                    onClick={() =>
                                      setPrescriptionHistoryPage((p) => Math.max(1, p - 1))
                                    }
                                    className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                                  >
                                    {language === "ar" ? "السابق" : "Prev"}
                                  </button>
                                  <div className={`flex items-center gap-1 ${isRTL ? "flex-row-reverse" : ""}`}>
                                    {pageRange(prescriptionHistoryPage, prescriptionHistoryPageCount).map(
                                      (num) => (
                                        <button
                                          key={num}
                                          type="button"
                                          onClick={() => setPrescriptionHistoryPage(num)}
                                          className={`min-w-[2.25rem] px-2 py-1.5 rounded-xl text-[11px] font-black tabular-nums transition-colors ${
                                            num === prescriptionHistoryPage
                                              ? "bg-violet-700 text-white shadow-sm"
                                              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                          }`}
                                        >
                                          {num}
                                        </button>
                                      )
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={prescriptionHistoryPage >= prescriptionHistoryPageCount}
                                    onClick={() =>
                                      setPrescriptionHistoryPage((p) =>
                                        Math.min(prescriptionHistoryPageCount, p + 1)
                                      )
                                    }
                                    className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                                  >
                                    {language === "ar" ? "التالي" : "Next"}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {familyMembers.length > 0 && (
                   <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)]">
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2"><Users size={14} className="text-blue-500"/> Connected Family Profile</h3>
                      <div className="flex flex-wrap gap-3">
                         {familyMembers.map((member: any) => (
                            <button key={member.id} onClick={() => router.push(`/patients/${member.id}`)} className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 hover:bg-[#E8F7F0] border border-slate-100 hover:border-[#A7E2C3] rounded-xl transition-all duration-200 hover:shadow-sm group">
                               <div className="text-left">
                                  <div className="text-sm font-bold text-slate-900 group-hover:text-[#1E5631] transition-colors">{member.name}</div>
                                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">{calculateAge(member.dateOfBirth)} Y · {member.gender}</div>
                               </div>
                            </button>
                         ))}
                      </div>
                   </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                   {/* Integrated Financial Summary Snapshot */}
                   <div className="bg-white rounded-2xl p-5 md:p-6 border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] flex flex-col h-[480px]">
                       <div className="flex items-center justify-between mb-5 shrink-0">
                           <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Wallet size={14} className="text-emerald-500"/> Financial Snapshot</h3>
                           <button onClick={() => setActiveTab('finance')} className="text-[10px] font-bold text-[#27ae60] uppercase tracking-widest hover:underline">View Full Ledger</button>
                       </div>

                       <div className="grid grid-cols-2 gap-3 mb-6 shrink-0">
                           <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
                               <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Total Billed</p>
                               <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums tracking-tight">{totalBilled.toLocaleString()} <span className="text-xs text-slate-400">EGP</span></p>
                           </div>
                           <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100/50 hover:border-emerald-200 transition-colors">
                               <p className="text-[9px] font-bold text-emerald-600/70 uppercase tracking-widest">Total Paid</p>
                               <p className="text-xl font-bold text-emerald-600 mt-1 tabular-nums tracking-tight">{totalPaid.toLocaleString()} <span className="text-xs text-emerald-400">EGP</span></p>
                           </div>
                       </div>

                       <div className="flex-1 flex flex-col overflow-hidden">
                           <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 pb-2 border-b border-slate-100 shrink-0">Recent Activity</h4>
                           <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                               {recentTransactions.length === 0 ? (
                                   <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                                       <CreditCard size={32} className="mb-2"/>
                                       <p className="font-bold text-xs">No transactions logged yet.</p>
                                   </div>
                               ) : (
                                   recentTransactions.map((t: any) => (
                                       <div key={t.id} className="flex justify-between items-center bg-white border border-slate-100 hover:border-slate-200 p-4 rounded-2xl shadow-sm transition-all group">
                                           <div>
                                               <p className="text-xs font-black text-slate-900 group-hover:text-[#27ae60] transition-colors">{t.description}</p>
                                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{t.createdAt ? new Date(t.createdAt.toMillis()).toLocaleDateString() : ''}</p>
                                           </div>
                                           <div className={`text-sm font-black tabular-nums bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 ${t.type === 'payment' ? 'text-emerald-600' : 'text-slate-900'}`}>
                                               {t.type === 'payment' ? `+${Number(t.paid).toLocaleString()}` : `-${Number(t.cost).toLocaleString()}`} EGP
                                           </div>
                                       </div>
                                   ))
                               )}
                           </div>
                       </div>
                   </div>

                   {/* Appointments Timeline (Visual Stepper with fixed container) */}
                   <div className="bg-white rounded-2xl p-5 md:p-6 border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] flex flex-col h-[480px]">
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-5 flex items-center gap-2 shrink-0"><CalendarDays size={14} className="text-blue-500"/> Appointments Timeline</h3>
                      
                      <div className="flex-1 overflow-y-auto custom-scrollbar pr-4">
                          {appointmentTimeline.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                                  <CalendarDays size={48} className="mb-3"/>
                                  <p className="font-bold text-sm">No appointments found for this patient.</p>
                              </div>
                          ) : (
                              <div className="relative pl-6 border-l-2 border-slate-100 space-y-8 ml-3 py-2">
                                 {appointmentTimeline.map((appt: any) => {
                                     const style = getTimelineStyle(appt.status);
                                     const Icon = style.icon;
                                     const appointmentDate = appt.date || "—";
                                     const appointmentTime = appt.time || "—";
                                     const appointmentDoctor = appt.doctorName || appt.doctor || "Unassigned";
                                     const appointmentReason = appt.treatment || (t("generalConsultation") || "General consultation");
                                     const appointmentNotes = appt.notes || "No extra notes.";
                                     const eventTime = appt.createdAt
                                       ? new Date(appt.createdAt.toMillis()).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
                                       : '';

                                     return (
                                        <div key={appt.id} className="relative group">
                                            {/* Stepper Node */}
                                            <div className={`absolute -left-[37px] top-0 w-8 h-8 rounded-full ring-4 ring-white shadow-sm flex items-center justify-center ${style.color} transition-transform group-hover:scale-110`}>
                                                <Icon size={14} className="text-white" />
                                            </div>
                                            
                                            {/* Content Bubble */}
                                            <div className="bg-white border border-slate-100 shadow-sm rounded-[1.5rem] rounded-tl-sm p-5 hover:shadow-md hover:border-slate-200 transition-all duration-300 relative before:absolute before:top-3 before:-left-[7px] before:w-3 before:h-3 before:bg-white before:border-l before:border-b before:border-slate-100 before:rotate-45">
                                                <div className="flex flex-wrap gap-y-2 justify-between items-center mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border shadow-sm ${style.color.split(' ')[0].replace('bg-', 'text-')} bg-slate-50 border-slate-200/60`}>
                                                            {appt.status || "Scheduled"}
                                                        </span>
                                                        <span className="text-sm font-black text-slate-800">Appointment Update</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 px-2 py-1 rounded-md">
                                                        {eventTime}
                                                    </span>
                                                </div>
                                                
                                                <div className="bg-slate-50 rounded-xl p-4 mb-4 border border-slate-100">
                                                    <p className="text-sm font-semibold text-slate-700 leading-relaxed">
                                                        {appointmentNotes}
                                                    </p>
                                                </div>
                                                
                                                <div className="flex flex-wrap gap-2">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                                        <CalendarDays size={12} className="text-blue-500"/> Date: {appointmentDate} {appointmentTime}
                                                    </span>
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                                        <User size={12} className="text-emerald-500"/> Doctor: {appointmentDoctor}
                                                    </span>
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                                        <Stethoscope size={12} className="text-rose-500"/> {t("reasonForVisit") || "Reason for Visit"}: {appointmentReason}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                     );
                                 })}
                              </div>
                          )}
                      </div>
                   </div>
                </div>
             </div>
          )}

          {activeTab === "clinical" && canViewClinical && (
            <div className="animate-in fade-in duration-300 mt-6">
              <PatientClinical patient={patient} />
            </div>
          )}

          {/* --- TREATMENT PLAN TAB --- */}
          {activeTab === "plan" && canViewClinical && (
            <div className="animate-in fade-in duration-300 mt-6">
              <PatientTreatmentPlanTab patientId={id} patient={patient} clinicInfo={clinicRxInfo} />
            </div>
          )}

          {/* --- TIMELINE TAB --- */}
          {activeTab === "timeline" && (
             <div className="animate-in fade-in duration-300">
                <PatientTimelineTab patientId={patient.id} />
             </div>
          )}
          
          {/* --- FINANCE TAB --- */}
          {activeTab === "finance" && (
            <div className="animate-in fade-in duration-300 mt-6">
                <PatientFinance patientId={id} />
            </div>
          )}

          {/* --- NOTES TAB (every note in the system, one timeline) --- */}
          {activeTab === "notes" && (
            <div className="animate-in fade-in duration-300 mt-6">
              <PatientNotesTab
                patientId={id as string}
                patient={patient}
                appointments={appointmentTimeline}
                media={patientMedia}
                prescriptions={prescriptionsHistory}
                onJumpToTab={(tab) => setActiveTab(tab)}
              />
            </div>
          )}

          {/* --- X-RAYS & CLINICAL PHOTOS TAB --- */}
          {activeTab === "xrays" && (
            <div className="animate-in fade-in duration-300 mt-6">
              <PatientMediaGallery
                patientId={id as string}
                patientName={patient?.name || ""}
                patientMedia={patientMedia}
                language={language}
                isRTL={isRTL}
                user={user}
              />
            </div>
          )}

          {/* --- PRESCRIPTIONS TAB --- */}
          {activeTab === "prescriptions" && (
            <div className="animate-in fade-in duration-300 space-y-6 mt-6">
              <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm ${isRTL ? "text-right" : ""}`}>
                <div>
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <Pill className="text-violet-600" size={22} />
                    {language === "ar" ? "سجل الروشتات والوصفات الطبية" : "Prescriptions & Medications"}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    {language === "ar"
                      ? "عرض كل الوصفات الطبية المسجلة للمريض أو كتابة روشتة جديدة وتحميلها PDF."
                      : "View all prescription records, print PDF copies, or write a new prescription for this patient."}
                  </p>
                </div>
                
                <button
                  onClick={() => router.push(`/patients/${id}/rx`)}
                  className="bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs px-5 py-3 rounded-xl transition-all shadow-md shadow-violet-600/20 flex items-center gap-2 shrink-0 active:scale-95"
                >
                  <FilePlus size={16} />
                  <span>{language === "ar" ? "كتابة روشتة جديدة" : "Write New Prescription"}</span>
                </button>
              </div>

              {/* Prescriptions History Grid */}
              {prescriptionsHistory.length === 0 ? (
                <div className="text-center py-16 px-4 bg-white rounded-3xl border border-dashed border-slate-200 space-y-3">
                  <div className="w-16 h-16 bg-violet-50 text-violet-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                    <Pill size={32} />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">
                    {language === "ar" ? "لا توجد روشتات مسجلة للمريض بعد" : "No saved prescriptions yet"}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    {language === "ar"
                      ? "اضغط على زر كتابة روشتة جديدة بالأعلى لإعداد وتجهيز وصفة طبية قابلة للطباعة والإرسال."
                      : "Click the write prescription button above to generate a print-ready or WhatsApp prescription."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedPrescriptions.map((row: any) => {
                      const sentWa = row.sharedViaWhatsapp === true;
                      return (
                        <div
                          key={row.id}
                          className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md hover:border-violet-200 transition-all flex flex-col justify-between gap-3"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-xs font-black text-slate-400 uppercase tracking-wider tabular-nums">
                                {formatPrescriptionCardDate(row)}
                              </span>
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide border ${
                                  sentWa
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-slate-100 text-slate-600 border-slate-200"
                                }`}
                              >
                                {sentWa
                                  ? language === "ar" ? "تم الإرسال واتساب" : "WhatsApp sent"
                                  : language === "ar" ? "محفوظة" : "Saved"}
                              </span>
                            </div>

                            {row.doctor && (
                              <p className="text-xs font-bold text-slate-700 flex items-center gap-1 mb-2">
                                <Stethoscope size={14} className="text-violet-600" />
                                {String(row.doctor)}
                              </p>
                            )}

                            <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 font-medium">
                              {prescriptionPreviewText(row)}
                            </p>
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t border-slate-100 gap-2">
                            <button
                              onClick={() => setSelectedPrescription(row)}
                              className="text-xs font-bold text-violet-700 hover:text-violet-900 hover:underline flex items-center gap-1"
                            >
                              <Eye size={14} /> {language === "ar" ? "عرض الروشتة والطباعة" : "View PDF & Print"}
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await deleteRecord(clinicId || "", "prescriptions", row.id);
                                  showToast(
                                    language === "ar" ? "تم النقل إلى المحذوفات" : "Moved to Recently Deleted",
                                    "success"
                                  );
                                } catch (e) {
                                  showToast(
                                    e instanceof RecycleBinError
                                      ? e.message
                                      : language === "ar" ? "تعذر الحذف" : "Failed to delete",
                                    "error"
                                  );
                                }
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                              title={language === "ar" ? "حذف" : "Delete"}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {prescriptionHistoryPageCount > 1 && (
                    <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                      <span className="text-xs font-bold text-slate-500">
                        {language === "ar"
                          ? `صفحة ${prescriptionHistoryPage} من ${prescriptionHistoryPageCount}`
                          : `Page ${prescriptionHistoryPage} of ${prescriptionHistoryPageCount}`}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          disabled={prescriptionHistoryPage <= 1}
                          onClick={() => setPrescriptionHistoryPage((p) => p - 1)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-40"
                        >
                          {language === "ar" ? "السابق" : "Prev"}
                        </button>
                        <button
                          disabled={prescriptionHistoryPage >= prescriptionHistoryPageCount}
                          onClick={() => setPrescriptionHistoryPage((p) => p + 1)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-40"
                        >
                          {language === "ar" ? "التالي" : "Next"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Prescription detail (from prescriptions collection) */}
        {selectedPrescription && (
          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[110] p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div
              className={`bg-white rounded-[1.75rem] w-full max-w-lg shadow-2xl border border-slate-100 max-h-[min(90vh,680px)] flex flex-col animate-in zoom-in-95 duration-200 ${
                isRTL ? "text-right" : ""
              }`}
              dir={isRTL ? "rtl" : "ltr"}
            >
              <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                    <Pill size={18} className="text-violet-600 shrink-0" />
                    {language === "ar" ? "تفاصيل الوصفة" : "Prescription"}
                  </h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 tabular-nums">
                    {formatPrescriptionCardDate(selectedPrescription)}
                    {selectedPrescription.sharedViaWhatsapp === true ? (
                      <span className="ms-2 text-emerald-600">
                        {language === "ar" ? "· أُرسل واتساب" : "· WhatsApp sent"}
                      </span>
                    ) : (
                      <span className="ms-2 text-slate-500">
                        {language === "ar" ? "· محفوظ محلياً" : "· Saved locally"}
                      </span>
                    )}
                  </p>
                  {selectedPrescription.doctor ? (
                    <p className="text-xs font-bold text-slate-600 mt-2">
                      {String(selectedPrescription.doctor)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPrescription(null)}
                  className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors shrink-0"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar min-h-0 space-y-4">
                {selectedPrescription.diagnosis ? (
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      {language === "ar" ? "التشخيص" : "Diagnosis"}
                    </p>
                    <p className="text-sm font-semibold text-slate-800 mt-1 leading-relaxed">
                      {String(selectedPrescription.diagnosis)}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    {language === "ar" ? "الأدوية" : "Medications"}
                  </p>
                  <ul className="space-y-3">
                    {normalizeRxItemsFromRecord(selectedPrescription.drugs).map((item, idx) => (
                      <li
                        key={item.id}
                        className="text-sm border border-slate-100 rounded-xl p-3 bg-slate-50/60"
                      >
                        <span className="font-black text-slate-900">
                          {idx + 1}. {item.name}
                        </span>
                        {item.dose ? (
                          <p className="text-xs font-bold text-slate-700 mt-1">• {item.dose}</p>
                        ) : null}
                        {item.note ? (
                          <p className="text-[11px] font-semibold text-slate-500 mt-1">
                            {language === "ar" ? "ملاحظة: " : "Note: "}
                            {item.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {normalizeRxItemsFromRecord(selectedPrescription.drugs).length === 0 ? (
                    <p className="text-xs text-slate-500 font-semibold">
                      {language === "ar" ? "لا توجد أدوية مسجلة." : "No medications on file."}
                    </p>
                  ) : null}
                </div>
              </div>
              <div
                className={`flex flex-wrap gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/60 shrink-0 ${
                  isRTL ? "flex-row-reverse" : ""
                }`}
              >
                <button
                  type="button"
                  disabled={downloadingPrescriptionPdf}
                  onClick={() => void handleDownloadPrescriptionPdf(selectedPrescription)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wide border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {downloadingPrescriptionPdf ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Printer size={16} />
                  )}
                  {language === "ar" ? "PDF / طباعة" : "PDF / print"}
                </button>
                <button
                  type="button"
                  disabled={
                    sendingPrescriptionPdf ||
                    patient?.whatsappOptOut === true ||
                    normalizeRxItemsFromRecord(selectedPrescription.drugs).length === 0
                  }
                  onClick={() => void handleSendPrescriptionPdfWhatsApp(selectedPrescription)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wide bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  title={
                    patient?.whatsappOptOut === true
                      ? language === "ar"
                        ? "المريض خارج أتمتة واتساب"
                        : "Patient opted out of WhatsApp"
                      : undefined
                  }
                >
                  {sendingPrescriptionPdf ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <MessageCircle size={16} />
                  )}
                  {language === "ar" ? "واتساب (PDF)" : "WhatsApp (PDF)"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPrescription(null)}
                  className={`inline-flex items-center justify-center px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-slate-100 transition-colors ${
                    isRTL ? "mr-auto" : "ml-auto"
                  }`}
                >
                  {language === "ar" ? "إغلاق" : "Close"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- EDIT MODAL --- */}
        {isEditModalOpen && (
           <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-in fade-in duration-200">
              <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-lg shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] border border-slate-100 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                 <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                    <div>
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">{t('editProfile') || "Edit Profile"}</h2>
                        <p className="text-xs font-semibold text-slate-500 mt-1">Update patient demographics and history.</p>
                    </div>
                    <button onClick={() => setIsEditModalOpen(false)} className="bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-900 p-2.5 rounded-full transition-colors"><X size={18}/></button>
                 </div>
                 
                 <form onSubmit={handleUpdate} className="space-y-4 overflow-y-auto pr-2 flex-1 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-4">
                       <Input label={t('firstName') || "First Name"} value={editFirstName} onChange={setEditFirstName} />
                       <Input label={t('lastName') || "Last Name"} value={editLastName} onChange={setEditLastName} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('phone') || "Phone"}</label>
                          <div className="flex gap-2">
                            <select
                              value={editCountryCode}
                              onChange={e => setEditCountryCode(e.target.value)}
                              className="w-[45%] px-3 py-3 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-[#60d297]/10 focus:border-blue-400 transition-all appearance-none cursor-pointer"
                            >
                              {COUNTRY_CODE_OPTIONS.map((opt) => (
                                <option key={opt.code} value={opt.code}>{opt.label}</option>
                              ))}
                            </select>
                            <input
                              value={editPhone}
                              onChange={e => setEditPhone(e.target.value)}
                              placeholder="1001234567"
                              className="w-[55%] px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-[#60d297]/10 focus:border-blue-400 transition-all"
                            />
                          </div>
                       </div>
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('age') || "Age"} / {t('dob') || "DOB"}</label>
                          <input type="date" value={editDob} onChange={e => setEditDob(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-[#60d297]/10 focus:border-blue-400 transition-all"/>
                       </div>
                    </div>
                    <Input label={t('address') || "Address"} value={editAddress} onChange={setEditAddress} />
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('gender') || "Gender"}</label>
                          <div className="relative">
                              <select value={editGender} onChange={e => setEditGender(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none appearance-none focus:bg-white focus:ring-4 focus:ring-[#60d297]/10 focus:border-blue-400 transition-all cursor-pointer">
                                 <option value="Male">{t('male') || "Male"}</option>
                                 <option value="Female">{t('female') || "Female"}</option>
                              </select>
                              <ChevronDown size={14} className="absolute top-1/2 -translate-y-1/2 right-4 text-slate-400 pointer-events-none"/>
                          </div>
                       </div>
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('status') || "Status"}</label>
                          <div className="relative">
                              <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none appearance-none focus:bg-white focus:ring-4 focus:ring-[#60d297]/10 focus:border-blue-400 transition-all cursor-pointer">
                                 <option value="Active">{t('statusActive') || "Active"}</option>
                                 <option value="Archived">{t('statusArchived') || "Archived"}</option>
                              </select>
                              <ChevronDown size={14} className="absolute top-1/2 -translate-y-1/2 right-4 text-slate-400 pointer-events-none"/>
                          </div>
                       </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('referralSource') || "Referral"}</label>
                        <div className="relative">
                            <select value={editReferral} onChange={e => setEditReferral(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none appearance-none focus:bg-white focus:ring-4 focus:ring-[#60d297]/10 focus:border-blue-400 transition-all cursor-pointer">
                               <option value="">{t('select') || "Select..."}</option>
                               <option value="Walk-in">{t('walkIn') || "Walk-in"}</option>
                               <option value="Social Media">{t('socialMedia') || "Social Media"}</option>
                               <option value="Friend/Family">{t('friendFamily') || "Friend/Family"}</option>
                               <option value="Other Doctor">{t('otherDoctor') || "Other Doctor"}</option>
                            </select>
                            <ChevronDown size={14} className="absolute top-1/2 -translate-y-1/2 right-4 text-slate-400 pointer-events-none"/>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><AlertCircle size={12}/> {t('allergies') || "Allergies"}</label>
                        <input value={editAllergies} onChange={e => setEditAllergies(e.target.value)} placeholder={language === 'ar' ? 'مثال: بنسلين — اتركه فارغاً إن لم يُسأل' : 'e.g. Penicillin — leave blank if not asked'} className="w-full px-4 py-3 bg-rose-50/50 border border-rose-200 rounded-xl font-bold text-rose-900 outline-none focus:bg-white focus:ring-4 focus:ring-rose-500/10 focus:border-rose-400 transition-all placeholder:font-medium placeholder:text-rose-300"/>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{language === 'ar' ? 'التاريخ الطبي' : 'Medical history'}</label>
                        <input value={editMedicalHistory} onChange={e => setEditMedicalHistory(e.target.value)} placeholder={language === 'ar' ? 'مثال: سكري، ضغط — اتركه فارغاً إن لم يُسأل' : 'e.g. Diabetes, hypertension — leave blank if not asked'} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-primary-500/10 focus:border-primary-400 transition-all placeholder:font-medium placeholder:text-slate-300"/>
                    </div>
                    
                    <div className="flex gap-4 pt-6 border-t border-slate-100 mt-6">
                       <Protect permission="patients.delete">
                         <button 
                             type="button" 
                             onClick={handleDeletePatient} 
                             disabled={isDeleting}
                             title="Delete Patient"
                             className="px-5 py-4 bg-rose-50 text-rose-600 rounded-2xl font-black shadow-sm border border-rose-100 hover:-translate-y-0.5 active:scale-95 transition-all flex items-center justify-center hover:bg-rose-100 disabled:opacity-50 shrink-0"
                         >
                             {isDeleting ? <Loader2 size={20} className="animate-spin" /> : <Trash2 size={20} />}
                         </button>
                       </Protect>
                       <button type="submit" className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:scale-95 transition-all hover:bg-slate-800">
                          {t('updateProfile') || "Save Changes"}
                       </button>
                    </div>
                 </form>
              </div>
           </div>
        )}
        {/* LIGHTBOX PREVIEW MODAL FOR X-RAYS & PHOTOS */}
        {selectedLightboxMedia && (
          <div className="fixed inset-0 bg-slate-955/90 z-[120] flex flex-col items-center justify-between p-4 sm:p-8 backdrop-blur-md animate-in fade-in duration-200">
            <div className="w-full max-w-5xl flex items-center justify-between text-white shrink-0 mb-4">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Camera size={18} className="text-[#27ae60]" />
                  {selectedLightboxMedia.filename || "Radiograph Preview"}
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedLightboxMedia.category} • {selectedLightboxMedia.uploadedBy || "Staff"}
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                <a
                  href={selectedLightboxMedia.url}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="bg-white/10 hover:bg-white/20 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5"
                >
                  <Download size={16} /> {language === "ar" ? "تحميل" : "Download"}
                </a>
                <button
                  onClick={() => setSelectedLightboxMedia(null)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={22} />
                </button>
              </div>
            </div>

            <div className="flex-1 w-full max-w-5xl flex items-center justify-center overflow-hidden">
              <img
                src={selectedLightboxMedia.url}
                alt="Fullsize preview"
                className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl border border-white/10"
              />
            </div>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}

const Input = ({ label, value, onChange }: any) => (
  <div>
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{label}</label>
    <input value={value} onChange={e => onChange(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-[#60d297]/10 focus:border-blue-400 transition-all"/>
  </div>
);