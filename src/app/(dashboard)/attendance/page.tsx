"use client";

import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { useState, useEffect, useMemo } from "react";
import { Clock, CalendarDays, Loader2, Users } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, query, where, addDoc, updateDoc, doc, serverTimestamp, orderBy, limit, Timestamp, getDoc, getDocs, deleteDoc, onSnapshot } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { logActivity } from "@/lib/logger";
import { hasFeature } from "@/lib/subscriptions";
import { UpgradeRequired } from "@/components/UpgradeRequired";

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getFirstDay, getToday } from "@/lib/reportHelpers";
import { htmlToPdfBlob, buildReportHtmlBase } from "@/components/reports/reportPdfHtmlUtils";

// IMPORTING OUR NEW SPLIT COMPONENTS
import { PersonalWorksheet, TeamOverview, StaffSettingsModal, StaffLogsModal } from "./components";
import {
  firstPaymentIdByProcedure,
  resolvePaymentLabFee,
  procedureServiceLabel,
  recalcCommissionFromPayment,
  commissionPctForPayment,
  type ProcedureLedgerInfo,
  type PaymentLedgerRow,
} from "@/lib/ledgerCommission";
import { getStoredDeviceId, persistDeviceId } from "@/lib/attendanceDeviceId";
import {
  acquireBestPosition,
  isUsableGeofence,
  judgeGeofence,
  locationFailureMessage,
} from "@/lib/attendanceLocation";
import { localYmd } from "@/lib/clinicDate";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { MoneyApiError, setPaymentCommission } from "@/lib/moneyApi";

// --- HELPERS ---
// Distance is now measured by metresBetween() in lib/attendanceLocation, alongside the accuracy
// handling it has to be judged with. Kept together so nobody compares a raw distance to the
// geofence again without accounting for how uncertain the reading is.

function timeToMins(timeStr: string) {
    if (!timeStr) return 0; const [h, m] = timeStr.split(':').map(Number); return (h * 60) + m;
}

const formatDuration = (mins: number) => {
    if (!mins) return "0h 0m";
    return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
};

const getDefaultSchedule = () => {
    const s: any = {};
    for(let i=0; i<7; i++) { s[i] = { active: i >= 0 && i <= 4, start: "13:00", end: "21:00" }; }
    return s;
};

function normalizeStaffName(s: string) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
}

type CommissionLedgerRow = {
    id: string;
    date?: string;
    patientName?: string;
    description?: string;
    procedureId?: string | null;
    procedureDescription?: string;
    doctorId?: string | null;
    doctorName?: string | null;
    doctor?: string | null;
    paid?: number;
    amount?: number;
    labFee?: number;
    doctorCommissionAmount?: number;
    clinicProfit?: number;
    doctorCommissionPercentage?: number | null;
};

function cleanProcedureServiceLabel(raw: unknown): string {
    const input = typeof raw === "string" ? raw : "";
    if (!input) return "—";
    return input
        .replace(/^Payment for:\s*/i, "")
        .replace(/^تسديد دفعة لـ:\s*/i, "")
        .split("|")[0]
        .split("(T:")[0]
        .trim() || "—";
}

/** Map ledger payment row to staff id for payroll commission totals (matches TeamOverview keys). */
function ledgerPaymentCommissionStaffId(
    staffList: { id: string; name?: string }[],
    data: { doctorId?: string | null; doctorName?: string | null; doctor?: string | null }
): string | null {
    const rawId = data.doctorId != null ? String(data.doctorId).trim() : "";
    if (rawId) return rawId;
    const nameRaw = (data.doctorName || data.doctor || "").trim();
    if (!nameRaw) return null;
    const n = normalizeStaffName(nameRaw);
    const match = staffList.find((s) => normalizeStaffName(s.name || "") === n);
    return match?.id ?? null;
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { isAdmin, clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const { language } = useLanguage();

  const { clinic } = useClinic();

  const canAdmin = isAdmin || user?.permissions?.includes('attendance.admin') || user?.permissions?.includes('access.settings');

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'personal' | 'team'>('personal');
  
  const [clinicGeofence, setClinicGeofence] = useState<{lat: number, lng: number, radius: number} | null>(null);
  /** Distinguishes "settings have not arrived yet" from "the admin never set a location". */
  const [geofenceLoaded, setGeofenceLoaded] = useState(false);
  
  // PERSONAL STATE
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [personalLogs, setPersonalLogs] = useState<any[]>([]);
  const [myProfile, setMyProfile] = useState<any | null>(null);
  const [liveDuration, setLiveDuration] = useState("");

  // ADMIN STATE
  const [allStaff, setAllStaff] = useState<any[]>([]);
  const [allLogs, setAllLogs] = useState<any[]>([]);
  /** Payment ledger rows in the selected period that carry doctor commission (re-aggregated when staff roster loads). */
  const [ledgerCommissionPaymentRows, setLedgerCommissionPaymentRows] = useState<CommissionLedgerRow[]>([]);
  const [procedureLedgerMap, setProcedureLedgerMap] = useState<Map<string, ProcedureLedgerInfo>>(new Map());
  const [firstPaymentByProcedure, setFirstPaymentByProcedure] = useState<Map<string, string>>(new Map());
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");

  const [now, setNow] = useState(Date.now());
  const today = getToday();
  const [startDate, setStartDate] = useState(getFirstDay());
  const [endDate, setEndDate] = useState(today);
  const [dateRangeType, setDateRangeType] = useState('month');

  // MODALS STATE
  const [settingsModal, setSettingsModal] = useState<any>({ isOpen: false, staffId: "", name: "", baseSalary: 0, commissionPercentage: 0, overtimeMultiplier: 1.5, registeredDeviceId: null, schedule: getDefaultSchedule() });
  const [logsModal, setLogsModal] = useState<{isOpen: boolean, staffId: string, name: string, logs: any[]}>({ isOpen: false, staffId: "", name: "", logs: [] });

  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(interval); }, []);

  // PERSONAL DATA LISTENER
  useEffect(() => {
    if (!user?.uid) return;
    let unsubStaff: any; let unsubLogs: any;

    const fetchGeofence = async () => {
        try {
            const settingsSnap = await getDoc(getClinicDoc("settings", "clinic_info"));
            if (settingsSnap.exists()) {
                const data = settingsSnap.data();
                if (data.attendanceLat && data.attendanceLng) {
                    setClinicGeofence({
                        lat: parseFloat(data.attendanceLat),
                        lng: parseFloat(data.attendanceLng),
                        radius: parseInt(data.attendanceRadius) || 50,
                    });
                }
            }
        } finally {
            // Set even on failure: a punch attempt should then report "location not set" rather
            // than sit forever behind a loading flag that never clears.
            setGeofenceLoaded(true);
        }
    };
    fetchGeofence();

    const setupProfileListener = async () => {
        let staffDocId = null;
        try {
            const uidQ = query(getClinicCollection("staff"), where("uid", "==", user.uid));
            const uidSnap = await getDocs(uidQ);
            
            if (!uidSnap.empty) staffDocId = uidSnap.docs[0].id;
            else {
                const docSnap = await getDoc(getClinicDoc("staff", user.uid));
                if (docSnap.exists()) staffDocId = docSnap.id;
                else if (user.email) {
                    const emailQ = query(getClinicCollection("staff"), where("email", "==", user.email));
                    const emailSnap = await getDocs(emailQ);
                    if (!emailSnap.empty) { staffDocId = emailSnap.docs[0].id; await updateDoc(getClinicDoc("staff", staffDocId), { uid: user.uid }); }
                }
            }

            if (staffDocId) {
                unsubStaff = onSnapshot(getClinicDoc("staff", staffDocId), (snap) => {
                    if (snap.exists()) setMyProfile({ id: snap.id, ...snap.data() }); else setMyProfile(null);
                });
            } else setMyProfile(null);
        } catch (error) { setMyProfile(null); }
    };
    setupProfileListener();

    const logsQuery = query(getClinicCollection("attendance"), where("userId", "==", user.uid), orderBy("checkIn", "desc"));
    unsubLogs = onSnapshot(logsQuery, (snap) => {
        const myLogs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        setPersonalLogs(myLogs.slice(0, 50)); 
        const active = myLogs.find((log: any) => log.status === 'active');
        setActiveSession(active || null);
        if (!active) setLiveDuration("");
        setLoading(false);
    });

    return () => { if (unsubStaff) unsubStaff(); if (unsubLogs) unsubLogs(); };
  }, [user]);

  useEffect(() => {
      if (!canAdmin) setLedgerCommissionPaymentRows([]);
  }, [canAdmin]);

  // ADMIN DATA LISTENER
  useEffect(() => {
      if (!canAdmin) return;
      const unsubAllStaff = onSnapshot(getClinicCollection("staff"), (snap) => setAllStaff(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T23:59:59');
      
      const allLogsQuery = query(getClinicCollection("attendance"), where("checkIn", ">=", Timestamp.fromDate(start)), where("checkIn", "<=", Timestamp.fromDate(end)), orderBy("checkIn", "desc"));
      const unsubAllLogs = onSnapshot(allLogsQuery, (snap) => {
          const logs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
          setAllLogs(logs);
          if (logsModal.isOpen) {
              setLogsModal((prev: any) => ({ ...prev, logs: logs.filter((l: any) => l.userId === prev.staffId) }));
          }
      });

      const ledgerQuery = query(getClinicCollection("ledger"), where("date", ">=", startDate), where("date", "<=", endDate));
      const unsubLedger = onSnapshot(ledgerQuery, (snap) => {
          const procedureMap = new Map<string, ProcedureLedgerInfo>();
          const periodPayments: PaymentLedgerRow[] = [];

          snap.docs.forEach((docSnap) => {
              const data = docSnap.data();
              if (data.type === "procedure") {
                  procedureMap.set(docSnap.id, {
                      description: typeof data.description === "string" ? data.description : "",
                      labFee: Number(data.labFee) || 0,
                      labOrderService:
                          typeof data.labOrderService === "string" ? data.labOrderService : undefined,
                      cost: Number(data.cost) || 0,
                      doctorCommissionPercentage:
                          typeof data.doctorCommissionPercentage === "number"
                              ? Number(data.doctorCommissionPercentage)
                              : undefined,
                  });
                  return;
              }
              if (data.type === "payment") {
                  periodPayments.push({
                      id: docSnap.id,
                      date: typeof data.date === "string" ? data.date : "",
                      procedureId: typeof data.procedureId === "string" ? data.procedureId : null,
                      labFee: Number(data.labFee) || 0,
                      paid: Number(data.paid) || 0,
                      amount: Number(data.amount) || 0,
                      doctorCommissionAmount: Number(data.doctorCommissionAmount) || 0,
                      clinicProfit: Number(data.clinicProfit) || 0,
                      doctorCommissionPercentage:
                          typeof data.doctorCommissionPercentage === "number"
                              ? Number(data.doctorCommissionPercentage)
                              : null,
                  });
              }
          });

          setProcedureLedgerMap(procedureMap);
          setFirstPaymentByProcedure(firstPaymentIdByProcedure(periodPayments));

          const rows: CommissionLedgerRow[] = [];
          snap.docs.forEach((docSnap) => {
              const data = docSnap.data();
              if (data.type !== "payment") return;
              const comm = Number(data.doctorCommissionAmount) || 0;
              if (comm <= 0) return;

              const procId = typeof data.procedureId === "string" ? data.procedureId : null;
              const proc = procId ? procedureMap.get(procId) : undefined;
              const linkedProcedureDescription = proc?.description || "";
              const paymentRow: PaymentLedgerRow = {
                  id: docSnap.id,
                  date: typeof data.date === "string" ? data.date : "",
                  procedureId: procId,
                  labFee: Number(data.labFee) || 0,
                  paid: Number(data.paid) || 0,
                  amount: Number(data.amount) || 0,
                  doctorCommissionAmount: comm,
                  clinicProfit: Number(data.clinicProfit) || 0,
                  doctorCommissionPercentage:
                      typeof data.doctorCommissionPercentage === "number"
                          ? Number(data.doctorCommissionPercentage)
                          : null,
              };
              const resolvedLabFee = resolvePaymentLabFee(
                  paymentRow,
                  procedureMap,
                  firstPaymentIdByProcedure(periodPayments)
              );
              const serviceLabel = procedureServiceLabel(
                  proc,
                  cleanProcedureServiceLabel(linkedProcedureDescription || data.description)
              );

              rows.push({
                  id: docSnap.id,
                  date: paymentRow.date,
                  patientName: typeof data.patientName === "string" ? data.patientName : "",
                  description: typeof data.description === "string" ? data.description : "",
                  procedureId: procId,
                  procedureDescription: serviceLabel,
                  doctorId: data.doctorId != null ? String(data.doctorId) : null,
                  doctorName: data.doctorName != null ? String(data.doctorName) : null,
                  doctor: data.doctor != null ? String(data.doctor) : null,
                  paid: paymentRow.paid,
                  amount: paymentRow.amount,
                  labFee: resolvedLabFee,
                  doctorCommissionAmount: comm,
                  clinicProfit: Number(data.clinicProfit) || 0,
                  doctorCommissionPercentage: paymentRow.doctorCommissionPercentage,
              });
          });
          setLedgerCommissionPaymentRows(rows);
      });

      return () => { unsubAllStaff(); unsubAllLogs(); unsubLedger(); };
  }, [canAdmin, startDate, endDate, logsModal.isOpen, logsModal.staffId]);

  /** Procedure rows may fall outside the attendance date filter; load linked procedures by id. */
  useEffect(() => {
      if (!canAdmin) return;
      const procIds = Array.from(
          new Set(
              ledgerCommissionPaymentRows
                  .map((r) => r.procedureId)
                  .filter((id): id is string => typeof id === "string" && id.length > 0)
          )
      );
      const missing = procIds.filter((id) => !procedureLedgerMap.has(id));
      if (missing.length === 0) return;

      let cancelled = false;
      (async () => {
          const additions = new Map<string, ProcedureLedgerInfo>();
          await Promise.all(
              missing.map(async (id) => {
                  const snap = await getDoc(getClinicDoc("ledger", id));
                  if (!snap.exists()) return;
                  const data = snap.data();
                  if (data?.type !== "procedure") return;
                  additions.set(id, {
                      description: typeof data.description === "string" ? data.description : "",
                      labFee: Number(data.labFee) || 0,
                      labOrderService:
                          typeof data.labOrderService === "string" ? data.labOrderService : undefined,
                      cost: Number(data.cost) || 0,
                      doctorCommissionPercentage:
                          typeof data.doctorCommissionPercentage === "number"
                              ? Number(data.doctorCommissionPercentage)
                              : undefined,
                  });
              })
          );
          if (cancelled || additions.size === 0) return;
          setProcedureLedgerMap((prev) => {
              const next = new Map(prev);
              additions.forEach((v, k) => next.set(k, v));
              return next;
          });
      })();

      return () => {
          cancelled = true;
      };
  }, [canAdmin, ledgerCommissionPaymentRows, procedureLedgerMap]);

  /** First payment per procedure (all time) so lab fee applies only once, even across months. */
  useEffect(() => {
      if (!canAdmin) return;
      const procIds = Array.from(
          new Set(
              ledgerCommissionPaymentRows
                  .map((r) => r.procedureId)
                  .filter((id): id is string => typeof id === "string" && id.length > 0)
          )
      );
      if (procIds.length === 0) return;

      let cancelled = false;
      (async () => {
          const allPayments: PaymentLedgerRow[] = [];
          for (const procId of procIds) {
              const snap = await getDocs(
                  query(
                      getClinicCollection("ledger"),
                      where("procedureId", "==", procId),
                      where("type", "==", "payment")
                  )
              );
              snap.docs.forEach((d) => {
                  const data = d.data();
                  allPayments.push({
                      id: d.id,
                      date: typeof data.date === "string" ? data.date : "",
                      procedureId: procId,
                      labFee: Number(data.labFee) || 0,
                      paid: Number(data.paid) || 0,
                      amount: Number(data.amount) || 0,
                      doctorCommissionAmount: Number(data.doctorCommissionAmount) || 0,
                      clinicProfit: Number(data.clinicProfit) || 0,
                      doctorCommissionPercentage:
                          typeof data.doctorCommissionPercentage === "number"
                              ? Number(data.doctorCommissionPercentage)
                              : null,
                  });
              });
          }
          if (cancelled) return;
          setFirstPaymentByProcedure(firstPaymentIdByProcedure(allPayments));
      })();

      return () => {
          cancelled = true;
      };
  }, [canAdmin, ledgerCommissionPaymentRows]);

  const ledgerCommissions = useMemo(() => {
      const comms: Record<string, number> = {};
      ledgerCommissionPaymentRows.forEach((data) => {
          const paidAmount = Number(data.paid || data.amount || 0);
          const paymentRow: PaymentLedgerRow = {
              id: data.id,
              date: data.date,
              procedureId: data.procedureId,
              labFee: data.labFee,
              paid: data.paid,
              amount: data.amount,
              doctorCommissionAmount: data.doctorCommissionAmount,
              clinicProfit: data.clinicProfit,
              doctorCommissionPercentage: data.doctorCommissionPercentage,
          };
          const labFee = resolvePaymentLabFee(paymentRow, procedureLedgerMap, firstPaymentByProcedure);
          const pct = commissionPctForPayment(paymentRow, paidAmount, labFee);
          const { doctorCommissionAmount } = recalcCommissionFromPayment(paidAmount, labFee, pct);
          if (doctorCommissionAmount <= 0) return;
          const staffId = ledgerPaymentCommissionStaffId(allStaff, data as { doctorId?: string | null; doctorName?: string | null; doctor?: string | null });
          if (!staffId) return;
          comms[staffId] = (comms[staffId] || 0) + doctorCommissionAmount;
      });
      return comms;
  }, [ledgerCommissionPaymentRows, allStaff, procedureLedgerMap, firstPaymentByProcedure]);

  const commissionBreakdownRows = useMemo(() => {
      const staffById = new Map(allStaff.map((s: any) => [s.id, s]));
      const out = ledgerCommissionPaymentRows
          .map((row) => {
              const staffId = ledgerPaymentCommissionStaffId(allStaff, row);
              if (!staffId) return null;
              const staff = staffById.get(staffId);
              if (!staff) return null;
              if (filterRole !== "all" && staff.role !== filterRole) return null;

              const filterUserMatch =
                  filterUser === "all" ||
                  staffId === filterUser ||
                  String(staff.uid || "") === filterUser;
              if (!filterUserMatch) return null;

              const paidAmount = Number(row.paid || row.amount || 0);
              const paymentRow: PaymentLedgerRow = {
                  id: row.id,
                  date: row.date,
                  procedureId: row.procedureId,
                  labFee: row.labFee,
                  paid: row.paid,
                  amount: row.amount,
                  doctorCommissionAmount: row.doctorCommissionAmount,
                  clinicProfit: row.clinicProfit,
                  doctorCommissionPercentage: row.doctorCommissionPercentage,
              };
              const labFee = resolvePaymentLabFee(
                  paymentRow,
                  procedureLedgerMap,
                  firstPaymentByProcedure
              );
              const commissionPct = commissionPctForPayment(paymentRow, paidAmount, labFee);
              const { netAmount, doctorCommissionAmount, clinicProfit } =
                  recalcCommissionFromPayment(paidAmount, labFee, commissionPct);
              const proc = row.procedureId ? procedureLedgerMap.get(row.procedureId) : undefined;
              const serviceSource = procedureServiceLabel(
                  proc,
                  row.procedureDescription || cleanProcedureServiceLabel(row.description)
              );

              return {
                  ...row,
                  staffId,
                  staffName: staff.name || row.doctorName || row.doctor || "Unknown",
                  staffRole: staff.role || "Unknown",
                  paidAmount,
                  labFee,
                  netAmount,
                  commissionPct,
                  doctorCommissionAmount,
                  clinicProfit,
                  serviceSource,
              };
          })
          .filter(Boolean) as Array<CommissionLedgerRow & {
              staffId: string;
              staffName: string;
              staffRole: string;
              paidAmount: number;
              labFee: number;
              netAmount: number;
              commissionPct: number;
          }>;

      out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      return out;
  }, [ledgerCommissionPaymentRows, allStaff, filterRole, filterUser, procedureLedgerMap, firstPaymentByProcedure]);

  const handleUpdateCommissionEntry = async (entryId: string, newPctRaw: number) => {
      const row = ledgerCommissionPaymentRows.find((r) => r.id === entryId);
      if (!row) {
          showToast("Commission entry not found", "error");
          return;
      }

      const newPct = Math.max(0, Math.min(100, Number(newPctRaw) || 0));
      const paidAmount = Number(row.paid || row.amount || 0);
      const paymentRow: PaymentLedgerRow = {
          id: row.id,
          date: row.date,
          procedureId: row.procedureId,
          labFee: row.labFee,
          paid: row.paid,
          amount: row.amount,
          doctorCommissionAmount: row.doctorCommissionAmount,
          clinicProfit: row.clinicProfit,
          doctorCommissionPercentage: row.doctorCommissionPercentage,
      };
      const labFee = resolvePaymentLabFee(
          paymentRow,
          procedureLedgerMap,
          firstPaymentByProcedure
      );
      const { doctorCommissionAmount: nextCommission, clinicProfit: nextProfit } =
          recalcCommissionFromPayment(paidAmount, labFee, newPct);

      try {
          // Recomputed and logged server-side, and — importantly — stamped as set by hand. Without
          // that stamp a later repair pass cannot tell a deliberate override from a row that was
          // never computed properly, and would quietly put it back to the standing rate.
          await setPaymentCommission(entryId, newPct);
          showToast("Commission split updated", "success");
      } catch (error) {
          console.error(error);
          showToast("Failed to update commission split", "error");
      }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeSession && activeSession.checkIn) {
      interval = setInterval(() => {
        const diff = new Date().getTime() - activeSession.checkIn.toDate().getTime();
        setLiveDuration(`${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeSession]);

  // --- ACTIONS ---

  const handlePunch = async (type: 'in' | 'out') => {
      const isAr = language === 'ar';
      if (!myProfile?.id || !user?.uid) {
          showToast(
              isAr
                  ? "ملفك الوظيفي مش موجود. اطلب من المدير يتأكد من بريدك الإلكتروني في إعدادات المستخدمين."
                  : "Your staff profile was not found. Ask an Admin to check your account email in User settings.",
              "error"
          );
          return;
      }
      setActionLoading(true);

      const finish = () => setActionLoading(false);

      try {
          const staffRef = getClinicDoc("staff", myProfile.id);
          const staffSnap = await getDoc(staffRef);
          const liveProfile = staffSnap.data();
          const currentDeviceId = getStoredDeviceId();

          let sessionForOut: { id: string; checkIn: Timestamp | { toDate?: () => Date } | Date | string } | null = null;

          if (type === 'out') {
              let session = activeSession;
              if (!session) {
                  const activeQ = query(
                      getClinicCollection("attendance"),
                      where("userId", "==", user.uid),
                      where("status", "==", "active"),
                      limit(1)
                  );
                  const activeSnap = await getDocs(activeQ);
                  if (!activeSnap.empty) {
                      const d = activeSnap.docs[0];
                      session = { id: d.id, ...d.data() };
                  }
              }

              if (!session?.id || !session.checkIn) {
                  showToast(isAr ? "مفيش وردية شغالة عشان تقفلها." : "No active shift to clock out.", "info");
                  finish();
                  return;
              }
              sessionForOut = session;
          } else {
              if (activeSession) {
                  showToast(
                      isAr ? "إنت مسجل دخول بالفعل. اعمل تسجيل خروج الأول." : "You are already clocked in. Clock out first.",
                      "info"
                  );
                  finish();
                  return;
              }

              if (liveProfile?.registeredDeviceId && liveProfile.registeredDeviceId !== currentDeviceId) {
                  showToast(
                      isAr
                          ? "الجهاز ده مش المسجّل باسمك. اطلب من المدير يفك ارتباط جهازك من الحضور ← الفريق ← الإعدادات، وبعدين سجّل من الموبايل ده."
                          : "This is not the device registered to you. Ask an Admin to unlink your device in Attendance → Team → Settings, then clock in again on this phone.",
                      "error"
                  );
                  finish();
                  return;
              }
          }

          // "Still loading" and "never configured" are different problems with different fixes,
          // and telling a receptionist the admin has not set GPS when the settings simply had not
          // arrived yet sends them to bother someone for no reason.
          if (!geofenceLoaded) {
              showToast(
                  isAr ? "لسه بنحمّل إعدادات العيادة. ثانية وجرّب تاني." : "Still loading clinic settings — try again in a moment.",
                  "info"
              );
              finish();
              return;
          }
          if (!isUsableGeofence(clinicGeofence)) {
              showToast(
                  isAr
                      ? "موقع العيادة مش متسجّل. المدير لازم يحدده من الإعدادات ← الحضور."
                      : "The clinic's location is not set. An Admin needs to set it in Settings → Attendance.",
                  "error"
              );
              finish();
              return;
          }

          // Takes a few seconds: it keeps improving the fix rather than trusting the first,
          // coarse one. That wait is the whole reason this stopped failing at random.
          const located = await acquireBestPosition();
          if (!located.ok) {
              showToast(locationFailureMessage(located.failure, isAr), "error");
              finish();
              return;
          }

          const verdict = judgeGeofence({ reading: located.reading, clinic: clinicGeofence });
          if (!verdict.inside) {
              showToast(
                  isAr
                      ? `إنت بعيد عن العيادة بحوالي ${verdict.effectiveDistance} متر (المسموح ${clinicGeofence.radius} متر). لو إنت جوه العيادة فعلاً، قرّب من شباك وجرّب تاني.`
                      : `You appear to be about ${verdict.effectiveDistance}m from the clinic (limit ${clinicGeofence.radius}m). If you are inside, move near a window and try again.`,
                  "error"
              );
              finish();
              return;
          }

          try {
              if (type === 'out' && sessionForOut) {
                  const checkInDate =
                      sessionForOut.checkIn &&
                      typeof (sessionForOut.checkIn as Timestamp).toDate === "function"
                          ? (sessionForOut.checkIn as Timestamp).toDate()
                          : new Date(sessionForOut.checkIn as string | Date);
                  const diffMins = Math.max(0, Math.round((Date.now() - checkInDate.getTime()) / 60000));

                  await updateDoc(getClinicDoc("attendance", sessionForOut.id), {
                      checkOut: serverTimestamp(),
                      durationMinutes: diffMins,
                      status: 'completed',
                      // Kept so a disputed shift can be examined rather than argued about.
                      checkOutDistanceM: verdict.distance,
                      checkOutAccuracyM: verdict.accuracy,
                  });
                  showToast(isAr ? "تم تسجيل الخروج!" : "Clocked out!", "success");
              } else {
                  if (!liveProfile?.registeredDeviceId) {
                      persistDeviceId(currentDeviceId);
                      await updateDoc(staffRef, { registeredDeviceId: currentDeviceId });
                  }

                  await addDoc(getClinicCollection("attendance"), {
                      userId: user.uid,
                      userName: user?.name,
                      staffId: myProfile.id,
                      // Local date, not UTC: a shift punched after midnight in Egypt was being
                      // filed under the previous day.
                      date: localYmd(),
                      checkIn: serverTimestamp(),
                      checkOut: null,
                      durationMinutes: 0,
                      status: 'active',
                      checkInDistanceM: verdict.distance,
                      checkInAccuracyM: verdict.accuracy,
                  });
                  showToast(isAr ? "تم تسجيل الدخول!" : "Clocked in!", "success");
              }
          } catch (error) {
              console.error(error);
              showToast(
                  isAr ? "معرفناش نحفظ التسجيل. اتأكد من الإنترنت وجرّب تاني." : "Could not save. Check your connection and try again.",
                  "error"
              );
          } finally {
              finish();
          }
      } catch (error) {
          console.error(error);
          showToast(
              isAr ? "حصلت مشكلة أثناء التسجيل. جرّب تاني." : "Something went wrong while recording your punch. Try again.",
              "error"
          );
          finish();
      }
  };

  const handleDeleteLog = async (logId: string) => {
      if (await confirm("Delete this time log? It will affect payroll.")) {
          try {
            await deleteRecord(clinicId || "", "attendance", logId);
          } catch (err) {
            showToast(err instanceof RecycleBinError ? err.message : "Could not delete the log.", "error");
            return;
          }
          await logActivity(
            { uid: user?.uid, name: user?.name, role: user?.role },
            "Attendance Log Deleted",
            `Deleted attendance log ${logId}`,
            "system_logs",
            { severity: "HIGH", module: "attendance" }
          );
          showToast("Moved to Recently Deleted.", "info");
      }
  };

  const handleUpdateLog = async (logId: string, checkInStr: string, checkOutStr: string) => {
      try {
          const inDate = new Date(checkInStr);
          // Local date, matching how a punch is filed — otherwise correcting a late-evening shift
          // silently moves it to another day.
          const updates: any = { checkIn: Timestamp.fromDate(inDate), date: localYmd(inDate) };

          if (checkOutStr) {
              const outDate = new Date(checkOutStr);
              updates.checkOut = Timestamp.fromDate(outDate);
              updates.durationMinutes = Math.max(0, Math.round((outDate.getTime() - inDate.getTime()) / 60000));
              updates.status = 'completed';
          } else {
              updates.checkOut = null;
              updates.durationMinutes = 0;
              updates.status = 'active';
          }

          await updateDoc(getClinicDoc("attendance", logId), updates);
          await logActivity(
            { uid: user?.uid, name: user?.name, role: user?.role },
            "Attendance Log Updated",
            `Updated attendance log ${logId}`
          );
          showToast("Log updated successfully", "success");
      } catch (e) {
          showToast("Failed to update log", "error");
      }
  };

  const handleOvertimeDecision = async (logId: string, decision: 'approved' | 'rejected') => {
      try {
          await updateDoc(getClinicDoc("attendance", logId), { overtimeStatus: decision });
          await logActivity(
            { uid: user?.uid, name: user?.name, role: user?.role },
            "Overtime Decision",
            `Overtime for log ${logId} was ${decision}`
          );
          showToast(`Overtime ${decision}`, "success");
      } catch (e) {
          showToast("Failed to update overtime status", "error");
      }
  };

  const openSettingsModal = (staff: any) => {
      const rawStaffProfile = allStaff.find(s => s.id === staff.id) || staff;
      setSettingsModal({
          isOpen: true, staffId: rawStaffProfile.id, name: rawStaffProfile.name,
          registeredDeviceId: rawStaffProfile.registeredDeviceId || null,
          baseSalary: Number(rawStaffProfile.baseSalary) || 0,
          commissionPercentage: Number(rawStaffProfile.commissionPercentage) || 0,
          overtimeMultiplier: rawStaffProfile.overtimeMultiplier || 1.5,
          schedule: rawStaffProfile.attendanceSchedule || getDefaultSchedule()
      });
  };

  const openLogsModal = (staff: any) => {
      // FIX: Ensure we are using the Auth UID, or fallback to doc ID safely
      const targetId = staff.uid || staff.id;
      setLogsModal({ 
          isOpen: true, 
          staffId: targetId, 
          name: staff.name, 
          logs: allLogs.filter(l => l.userId === staff.uid || l.userId === staff.id) 
      });
  };

  const handleUpdateStaffSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          await updateDoc(getClinicDoc("staff", settingsModal.staffId), { 
              attendanceSchedule: settingsModal.schedule, overtimeMultiplier: settingsModal.overtimeMultiplier,
              baseSalary: settingsModal.baseSalary, commissionPercentage: settingsModal.commissionPercentage
          });
          await logActivity(
            { uid: user?.uid, name: user?.name, role: user?.role },
            "Staff Attendance Settings Updated",
            `Updated attendance/payroll settings for ${settingsModal.name}`
          );
          setSettingsModal((prev: any) => ({ ...prev, isOpen: false }));
          showToast("Shift & Pay settings saved!", "success");
      } catch (err: any) {
          // "Failed to save." with no reason sent the owner hunting through Firebase rules when the
          // actual cause could be three different things. The code names which: permission-denied
          // is a rules refusal (wrong role, or the clinic is expired/suspended — the rules freeze
          // writes for an inactive clinic on purpose); not-found means the staff row is gone.
          console.error("Shift & Pay save failed", err);
          showToast(`Failed to save: ${err?.code || err?.message || "unknown error"}`, "error");
      }
  };

  const handleUnlinkDevice = async () => {
      if (await confirm(`Are you sure you want to unlink ${settingsModal.name}'s device?`)) {
          try {
              await updateDoc(getClinicDoc("staff", settingsModal.staffId), { registeredDeviceId: null });
              await logActivity(
                { uid: user?.uid, name: user?.name, role: user?.role },
                "Staff Device Unlinked",
                `Unlinked attendance device for ${settingsModal.name}`,
                "system_logs",
                { severity: "CRITICAL", module: "attendance" }
              );
              setSettingsModal((prev: any) => ({ ...prev, registeredDeviceId: null }));
              showToast("Device unlinked successfully.", "success");
          } catch (err) { showToast("Failed to unlink device.", "error"); }
      }
  };

  const handleGeneratePayrollPDF = () => {
      const doc = new jsPDF();
      doc.setFontSize(22); doc.text("Alpha Dental - Payroll & Commission Invoice", 14, 20);
      doc.setFontSize(11); doc.setTextColor(100);
      doc.text(`Pay Period: ${startDate} to ${endDate}`, 14, 28);
      doc.text(`Generated By: ${user?.name || 'Admin'} on ${new Date().toLocaleDateString()}`, 14, 34);

      const tableData = payrollData.map((staff: any) => [
          staff.name, staff.role, formatDuration(staff.regularMinutes + staff.overtimeMinutes),
          `${Math.floor(staff.estimatedBasePay).toLocaleString()} EGP`, `${Math.floor(staff.earnedCommissions).toLocaleString()} EGP`,
          `${Math.floor(staff.finalTotalPay).toLocaleString()} EGP`
      ]);

      const grandTotal = payrollData.reduce((sum: number, s: any) => sum + s.finalTotalPay, 0);

      autoTable(doc, {
          startY: 45,
          head: [['Staff Member', 'Role', 'Total Hrs', 'Base Pay (from Hrs)', 'Earned Commissions', 'Net Payout']],
          body: tableData, theme: 'grid', headStyles: { fillColor: [15, 23, 42] }, styles: { fontSize: 10 },
          foot: [['', '', '', '', 'TOTAL PAYROLL:', `${Math.floor(grandTotal).toLocaleString()} EGP`]],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
      });
      doc.save(`Alpha_Payroll_${startDate}_to_${endDate}.pdf`);
      showToast("Payroll Invoice Downloaded!", "success");
  };

  const handleGenerateCommissionPDF = async () => {
      if (commissionBreakdownRows.length === 0) {
          showToast("No commission data to export", "error");
          return;
      }
      setActionLoading(true);
      try {
          // Group by staff
          const grouped: Record<string, any[]> = {};
          commissionBreakdownRows.forEach(row => {
              const name = row.staffName || "Unknown Staff";
              if (!grouped[name]) grouped[name] = [];
              grouped[name].push(row);
          });

          let contentHtml = "";

          Object.keys(grouped).forEach(staffName => {
              const rows = grouped[staffName];
              let totalComm = 0;
              let totalProfit = 0;
              let totalPaid = 0;

              const rowsHtml = rows.map(row => {
                  totalComm += Number(row.doctorCommission || 0);
                  totalProfit += Number(row.clinicProfit || 0);
                  totalPaid += Number(row.paidAmount || 0);
                  
                  return `
                    <tr>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;">${row.date || "-"}</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;">${row.patientName || "-"}</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px; font-weight: 700;">${row.serviceSource || row.procedureDescription || row.description || "-"}</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;">${Math.floor(Number(row.paidAmount || 0)).toLocaleString()}</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;">${Math.floor(Number(row.labFee || 0)).toLocaleString()}</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;">${Math.floor(Number(row.netAmount || 0)).toLocaleString()}</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center; font-size: 10px;">${Number(row.commissionPct || 0).toFixed(1)}%</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px; font-weight: 800; color: #059669;">${Math.floor(Number(row.doctorCommission || 0)).toLocaleString()}</td>
                      <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px; font-weight: 800; color: #059669;">${Math.floor(Number(row.clinicProfit || 0)).toLocaleString()}</td>
                    </tr>
                  `;
              }).join("");

              const totalsHtml = `
                <tr style="background: #f1f5f9; font-weight: 800;">
                  <td colspan="3" style="padding: 10px 12px; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;">${language === 'ar' ? "الإجمالي" : "TOTAL"}</td>
                  <td style="padding: 10px 12px; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;">${Math.floor(totalPaid).toLocaleString()}</td>
                  <td style="padding: 10px 12px; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;"></td>
                  <td style="padding: 10px 12px; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px;"></td>
                  <td style="padding: 10px 12px; text-align: center; font-size: 10px;"></td>
                  <td style="padding: 10px 12px; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px; color: #059669;">${Math.floor(totalComm).toLocaleString()}</td>
                  <td style="padding: 10px 12px; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 10px; color: #059669;">${Math.floor(totalProfit).toLocaleString()}</td>
                </tr>
              `;

              const tableHtml = `
                <div style="margin-bottom: 32px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; page-break-inside: avoid;">
                  <div style="padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a;">${staffName}</h3>
                    <p style="margin: 4px 0 0 0; font-size: 11px; color: #64748b; font-weight: 700;">${rows[0].staffRole || 'Staff'}</p>
                  </div>
                  <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                      <tr>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "التاريخ" : "Date"}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "المريض" : "Patient"}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "الخدمة" : "Service"}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "المدفوع" : "Paid"}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "المعمل" : "Lab Fee"}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "الصافي" : "Net"}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: center;">${language === 'ar' ? "النسبة" : "% Split"}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "عمولة الطبيب" : "Doc Comm."}</th>
                        <th style="padding: 10px 12px; background: #ffffff; color: #475569; font-weight: 800; text-transform: uppercase; font-size: 9px; border-bottom: 1px solid #e2e8f0; text-align: ${language === 'ar' ? 'right' : 'left'};">${language === 'ar' ? "ربح العيادة" : "Clinic Profit"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rowsHtml}
                      ${totalsHtml}
                    </tbody>
                  </table>
                </div>
              `;
              contentHtml += tableHtml;
          });

          const title = language === 'ar' ? "تفاصيل عمولة الأطباء" : "Dentist Commission Details";
          const headerHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e2e8f0;">
              <div>
                <h1 style="margin: 0 0 4px 0; font-size: 24px; font-weight: 800; color: #0f172a;">${title}</h1>
                <p style="margin: 0; font-size: 14px; color: #64748b;">${startDate} — ${endDate}</p>
              </div>
            </div>
          `;

          const fullHtml = buildReportHtmlBase(title, language === 'ar' ? "ar" : "en", headerHtml + contentHtml);
          const blob = await htmlToPdfBlob(fullHtml);
          
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `Commission_Details_${startDate}_to_${endDate}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
      } catch (e) {
          console.error("PDF generation failed:", e);
          showToast(language === 'ar' ? "فشل إنشاء ملف PDF" : "Failed to generate PDF", "error");
      } finally {
          setActionLoading(false);
      }
  };

  // --- DATA PROCESSING ---
  const payrollData = useMemo(() => {
     if (!canAdmin && viewMode !== 'personal') return [];
     
     const staffMap: Record<string, any> = {};
     const staffListToProcess = (viewMode === 'personal' ? [myProfile].filter(Boolean) : allStaff).filter(s => {
         if (viewMode === 'personal') return true;
         if (filterRole !== 'all' && s.role !== filterRole) return false;
         if (filterUser !== 'all' && s.uid !== filterUser && s.id !== filterUser) return false;
         return true;
     });

     staffListToProcess.forEach(staff => {
         const schedule = staff.attendanceSchedule || getDefaultSchedule();
         const overtimeMultiplier = staff.overtimeMultiplier || 1.5;
         const baseSalary = Number(staff.baseSalary) || 0;
         const commissionPercentage = Number(staff.commissionPercentage) || 0;
         
         let expectedWeeklyMins = 0;
         Object.values(schedule).forEach((dayConfig: any) => {
             if (dayConfig.active) expectedWeeklyMins += (timeToMins(dayConfig.end) - timeToMins(dayConfig.start));
         });
         
         // 1. Fix Hourly Rate Math (average 4.33 weeks per month)
         const expectedMonthlyHours = (expectedWeeklyMins * 52) / (12 * 60); 
         const hourlyRate = expectedMonthlyHours > 0 ? (baseSalary / expectedMonthlyHours) : 0;

         staffMap[staff.uid || staff.id] = {
             id: staff.id, 
             uid: staff.uid, 
             name: staff.name, 
             role: staff.role, 
             schedule, overtimeMultiplier, hourlyRate, expectedMonthlyHours, baseSalary, commissionPercentage,
             regularMinutes: 0, approvedOvertimeMinutes: 0, pendingOvertimeMinutes: 0, missingMinutes: 0, 
             shiftsWorked: 0, activeNow: false, currentSessionMins: 0, registeredDeviceId: staff.registeredDeviceId
         };
     });

     const logsToProcess = viewMode === 'personal' ? personalLogs : allLogs;

     logsToProcess.forEach(log => {
         const uid = log.userId;
         if (!staffMap[uid]) return;

         let durationMinutes = log.durationMinutes || 0;

         if (log.status === 'active' && log.checkIn) {
             staffMap[uid].activeNow = true;
             const checkInDate = log.checkIn.toDate();
             const liveMins = Math.floor((now - checkInDate.getTime()) / 60000);
             durationMinutes = liveMins; 
             staffMap[uid].currentSessionMins = liveMins;
         } else if (log.status === 'completed' && log.durationMinutes) {
             staffMap[uid].shiftsWorked += 1;
         }

         if ((log.status === 'completed' && log.durationMinutes) || log.status === 'active') {
             const checkInDate = log.checkIn?.toDate();
             const checkOutDate = log.checkOut?.toDate() || new Date(now);
             if (!checkInDate) return;
             
             const dayOfWeek = checkInDate.getDay(); 
             const dayConfig = staffMap[uid].schedule[dayOfWeek];

             let logOvertime = 0;

             if (!dayConfig || !dayConfig.active) {
                 logOvertime = durationMinutes; // Working on an inactive day -> all overtime
             } else {
                 const schedStartMins = timeToMins(dayConfig.start);
                 const schedEndMins = timeToMins(dayConfig.end);
                 const expectedMins = Math.max(0, schedEndMins - schedStartMins);
                 
                 // 2. Shift Overlap Detection
                 const checkInMins = checkInDate.getHours() * 60 + checkInDate.getMinutes();
                 let checkOutMins = checkOutDate.getHours() * 60 + checkOutDate.getMinutes();
                 // Handle overnight/next-day shifts simply
                 if (checkOutMins < checkInMins) checkOutMins += 24 * 60;
                 
                 const overlapStart = Math.max(schedStartMins, checkInMins);
                 const overlapEnd = Math.min(schedEndMins, checkOutMins);
                 const overlapMins = Math.max(0, overlapEnd - overlapStart);
                 
                 staffMap[uid].regularMinutes += overlapMins;
                 if (log.status === 'completed') {
                     staffMap[uid].missingMinutes += Math.max(0, expectedMins - overlapMins);
                 }
                 
                 logOvertime = Math.max(0, durationMinutes - overlapMins);
             }

             if (logOvertime > 0) {
                 if (log.overtimeStatus === 'approved') {
                     staffMap[uid].approvedOvertimeMinutes += logOvertime;
                 } else if (log.overtimeStatus !== 'rejected') {
                     staffMap[uid].pendingOvertimeMinutes += logOvertime;
                 }
             }
         }
     });

     return Object.values(staffMap).map(staff => {
         const regularPay = (staff.regularMinutes / 60) * staff.hourlyRate;
         const overtimePay = (staff.approvedOvertimeMinutes / 60) * (staff.hourlyRate * staff.overtimeMultiplier);
         const estimatedBasePay = regularPay + overtimePay; 
         const earnedCommissions = ledgerCommissions[staff.id] || 0; 
         const finalTotalPay = estimatedBasePay + earnedCommissions; 

         return { ...staff, estimatedBasePay, earnedCommissions, finalTotalPay };
     }).sort((a,b) => b.finalTotalPay - a.finalTotalPay);

  }, [allLogs, personalLogs, allStaff, ledgerCommissions, myProfile, canAdmin, viewMode, filterRole, filterUser, now]);

  const myCalculatedStats = viewMode === 'personal' && payrollData.length > 0 ? payrollData[0] : null;
  const currentDevId = getStoredDeviceId();
  const isDeviceBlocked = Boolean(
      myProfile?.registeredDeviceId && myProfile.registeredDeviceId !== currentDevId && !activeSession
  );
  const isDeviceMismatch = Boolean(
      myProfile?.registeredDeviceId && myProfile.registeredDeviceId !== currentDevId
  );

  /**
   * The subscription gate must stay HERE, below every hook — not near the top where it used to be.
   *
   * `clinic` is null on the first render while ClinicContext loads, and hasFeature(null, …) is
   * false. So the first render took the early return and ran only the four hooks above it; once
   * the clinic arrived, the render continued past that point and ran eight more. React counts
   * hooks per render and throws "rendered more hooks than during the previous render" when the
   * number grows — the whole attendance screen crashed.
   *
   * Whether it crashed depended on whether the clinic document happened to resolve before the
   * first paint, which is why it failed on a cold load or a slow connection and worked on a warm
   * one. That is the "clock-in sometimes doesn't work" the team reported: not the button, the
   * entire page.
   */
  if (!hasFeature(clinic, 'attendance')) {
    return (
      <div className="p-4 lg:p-8">
        <UpgradeRequired featureName="Attendance & Staff Tracking" minTier="Pro" />
      </div>
    );
  }

  if (loading && !personalLogs.length && !allLogs.length) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent-soft" size={40}/></div>;

  return (
    <div className="max-w-[1600px] mx-auto p-4 md:p-8 space-y-8 animate-in fade-in pb-24 font-sans text-slate-800">
      
      {/* HEADER & ADMIN TOGGLE */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div>
            <h1 className="text-2xl md:text-3xl font-black text-ink tracking-tight flex items-center gap-3">
              <Clock className="text-accent-soft" size={28}/> {canAdmin && viewMode === 'team' ? 'Team Control Center' : 'My Worksheet'}
            </h1>
            <p className="text-xs md:text-sm text-ink-muted font-semibold mt-1">Track shifts, log attendance, and run payroll invoices.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:w-auto overflow-x-auto pb-1">
            {/* GLOBAL DATE RANGE SELECTOR */}
            <div className="flex items-center gap-2 bg-surface p-1 rounded-xl border border-line shadow-sm shrink-0">
                <select 
                    value={dateRangeType}
                    onChange={(e) => {
                        const val = e.target.value;
                        setDateRangeType(val);
                        const todayStr = getToday();
                        if (val === 'today') {
                            setStartDate(todayStr); setEndDate(todayStr);
                        } else if (val === 'week') {
                            const d = new Date(); d.setDate(d.getDate() - d.getDay());
                            setStartDate(d.toISOString().split('T')[0]); setEndDate(todayStr);
                        } else if (val === 'month') {
                            setStartDate(getFirstDay()); setEndDate(todayStr);
                        }
                    }}
                    className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer pl-3 py-1.5"
                >
                    <option value="today">{language === 'ar' ? 'اليوم' : 'Today'}</option>
                    <option value="week">{language === 'ar' ? 'هذا الأسبوع' : 'This Week'}</option>
                    <option value="month">{language === 'ar' ? 'هذا الشهر' : 'This Month'}</option>
                    <option value="custom">{language === 'ar' ? 'فترة مخصصة' : 'Custom Range'}</option>
                </select>

                {dateRangeType === 'custom' && (
                    <div className="flex items-center bg-surface-subtle rounded-lg px-2 py-1 mx-1 border border-slate-100">
                        <input type="date" value={startDate} onChange={e => {setStartDate(e.target.value); setDateRangeType('custom');}} className="bg-transparent text-xs font-bold text-ink-body outline-none w-[110px]" />
                        <span className="text-slate-300 mx-1 font-bold">-</span>
                        <input type="date" value={endDate} onChange={e => {setEndDate(e.target.value); setDateRangeType('custom');}} className="bg-transparent text-xs font-bold text-ink-body outline-none w-[110px]" />
                    </div>
                )}
            </div>

            {/* ADMIN TOGGLE */}
            {canAdmin ? (
                <div className="bg-surface-muted p-1 rounded-xl flex items-center shadow-inner border border-line shrink-0">
                    <button onClick={() => setViewMode('personal')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'personal' ? 'bg-surface text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-slate-700'}`}>{language === 'ar' ? 'تعقبي' : 'My Tracker'}</button>
                    <button onClick={() => setViewMode('team')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${viewMode === 'team' ? 'bg-surface text-accent shadow-sm border border-line' : 'text-ink-muted hover:text-slate-700'}`}><Users size={16}/> {language === 'ar' ? 'نظرة الفريق' : 'Team Overview'}</button>
                </div>
            ) : (
                <div className="bg-surface px-4 py-2 rounded-xl border border-line shadow-sm flex items-center gap-2 shrink-0">
                    <CalendarDays size={16} className="text-slate-400"/>
                    <span className="font-bold text-sm">{new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                </div>
            )}
        </div>
      </div>

      {/* VIEWS */}
      {viewMode === 'personal' && (
          <PersonalWorksheet 
              activeSession={activeSession} isDeviceBlocked={isDeviceBlocked} isDeviceMismatch={isDeviceMismatch} liveDuration={liveDuration} 
              actionLoading={actionLoading} handlePunch={handlePunch} myCalculatedStats={myCalculatedStats} 
              personalLogs={personalLogs} myProfile={myProfile} language={language}
          />
      )}
      {viewMode === 'team' && canAdmin && (
          <TeamOverview 
              startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} 
              filterRole={filterRole} setFilterRole={setFilterRole} filterUser={filterUser} setFilterUser={setFilterUser} 
              allStaff={allStaff} payrollData={payrollData} handleGeneratePayrollPDF={handleGeneratePayrollPDF} 
              handleGenerateCommissionPDF={handleGenerateCommissionPDF}
              openSettingsModal={openSettingsModal} openLogsModal={openLogsModal}
              commissionBreakdownRows={commissionBreakdownRows}
              handleUpdateCommissionEntry={handleUpdateCommissionEntry}
          />
      )}

      {/* MODALS */}
      {settingsModal.isOpen && (
          <StaffSettingsModal 
              settingsModal={settingsModal} setSettingsModal={setSettingsModal} 
              handleUpdateStaffSettings={handleUpdateStaffSettings} handleUnlinkDevice={handleUnlinkDevice} 
          />
      )}
      
      {logsModal.isOpen && (
          <StaffLogsModal 
              isOpen={logsModal.isOpen} 
              onClose={() => setLogsModal({isOpen: false, staffId: "", name: "", logs: []})} 
              staffName={logsModal.name} 
              logs={logsModal.logs} 
              handleUpdateLog={handleUpdateLog} 
              handleDeleteLog={handleDeleteLog} 
              handleOvertimeDecision={handleOvertimeDecision}
          />
      )}

    </div>
  );
}