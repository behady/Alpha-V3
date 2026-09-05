"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  arrayUnion, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where,
} from "firebase/firestore";
import {
  Armchair, ArrowUpRight, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, FlaskConical, Loader2, PenLine,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { localYmd } from "@/lib/clinicDate";
import { parseClinicSchedule, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { getAppointmentStageLabel, getAppointmentStatusStyles } from "@/lib/appointmentStages";
import { isDentistStaff } from "@/lib/staffRoles";
import { LAB_CASES_COLLECTION, workTypeLabel } from "@/lib/labCases";
import { treatmentsByTooth } from "@/lib/toothTreatments";
import { suggestCategory } from "@/lib/dentalIcons";
import { saveBooking } from "@/lib/bookingService";
import BookingModal from "@/components/BookingModal";
import ServiceEditorDrawer from "@/components/clinical-notes/ServiceEditorDrawer";
import DentistReport from "@/components/dashboard/DentistReport";
import type { Note, Service, Staff } from "@/components/clinical-notes/types";
import type { ToothData } from "@/lib/diagnosisCatalog";
import {
  daysBetween, isDone, isMine, labReturns, moneyToday, openPlans, owedByMyPatients, owedByPatient,
  pickChair, sortDay, waitingMinutes, type DentistIdentity, type Row,
} from "@/lib/dentistHome";

/**
 * What a dentist sees on sign-in, instead of the reception desk.
 *
 * The main dashboard is a desk: booking, check-in, taking money, printing receipts. A dentist does
 * none of that. Their question is "who is next, what am I doing to them, and what came back from
 * the lab?" — so this is one quiet screen answering exactly that, from what the clinic already
 * records: the next patient in the chair, the day as a list, the lab cases waiting on them, the
 * patients they left mid-treatment with no next visit booked, and the money that is theirs.
 *
 * Only their own rows: every booking, ledger row, lab case and clinical note already carries the
 * dentist it belongs to, so nothing new has to be typed in for this screen to fill.
 *
 * Reads are live subscriptions, not fetches — reception checks a patient in and the slab flips
 * to "waiting" on the dentist's screen without anyone pressing anything. Rules already let any
 * clinic member read these collections, so no server route stands between the screen and the
 * data.
 */

type Patient = { id: string; name?: string; teethData?: Record<string, ToothData>; [k: string]: unknown };

type NoteContext = {
  apt: Row;
  patient: Patient;
  notes: Note[];
  initialNote: Note | null;
};

const SEATABLE = new Set(["Scheduled", "Confirmed", "Delayed", "Checked In", "Late", "Pending"]);

export default function DentistHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { branches, activeBranch, matches, scopeBranchId, ready: branchReady } = useActiveBranch();
  const isAr = language === "ar";
  const today = localYmd();

  // A clock for "waiting 6 min" and the greeting. Half a minute is plenty for a wait counter.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // --- Who am I, on the team list? ----------------------------------------------------------
  // undefined = still looking; null = no staff row carries this login.
  const [me, setMe] = useState<DentistIdentity | null | undefined>(undefined);
  useEffect(() => {
    if (!user?.uid || !clinicId) return;
    const q = query(getClinicCollection("staff"), where("uid", "==", user.uid), limit(1));
    return onSnapshot(
      q,
      (snap) => {
        const d = snap.docs[0];
        if (!d) return setMe(null);
        const data = d.data();
        setMe({
          staffId: d.id,
          name: String(data.name || user.name || ""),
          commissionPct: Number(data.commissionPercentage) || 0,
        });
      },
      () => setMe(null)
    );
  }, [user?.uid, user?.name, clinicId]);

  // --- Live rows -----------------------------------------------------------------------------
  const [todayAppts, setTodayAppts] = useState<Row[]>([]);
  /**
   * The day the list is showing. The chair and the money are always today — they are live things —
   * but the list can page to tomorrow to see what is coming, or back to see what happened.
   */
  const [viewDate, setViewDate] = useState(today);
  const [dayAppts, setDayAppts] = useState<Row[]>([]);
  const [futureAppts, setFutureAppts] = useState<Row[]>([]);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [labCases, setLabCases] = useState<Row[]>([]);
  const [notes, setNotes] = useState<Row[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [config, setConfig] = useState<ClinicScheduleConfig | null>(null);
  const [showShare, setShowShare] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!me || !clinicId) return;
    const rows = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): Row[] =>
      snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const unsubs = [
      onSnapshot(query(getClinicCollection("appointments"), where("date", "==", today)), (s) => {
        setTodayAppts(rows(s));
        setLoaded(true);
      }),
      // Only to know which mid-treatment patients already have something booked.
      onSnapshot(query(getClinicCollection("appointments"), where("date", ">", today)), (s) => setFutureAppts(rows(s))),
      // Every charge and payment attributed to this dentist — the payment inherits the procedure's
      // dentist when it is taken, so one filter covers both sides.
      onSnapshot(query(getClinicCollection("ledger"), where("doctorId", "==", me.staffId)), (s) => setLedger(rows(s))),
      onSnapshot(query(getClinicCollection(LAB_CASES_COLLECTION), where("doctorId", "==", me.staffId)), (s) => setLabCases(rows(s))),
      onSnapshot(query(getClinicCollection("clinical_notes"), where("doctorId", "==", me.staffId)), (s) => setNotes(rows(s))),
      onSnapshot(query(getClinicCollection("patients"), orderBy("name"), limit(2500)), (s) => setPatients(rows(s) as Patient[])),
      onSnapshot(getClinicCollection("staff"), (s) =>
        setDoctors(
          rows(s)
            .filter((d) => isDentistStaff(d as { role?: string; isDentist?: boolean }))
            .map((d) => ({
              id: String(d.id),
              name: String(d.name || ""),
              role: String(d.role || ""),
              commissionPercentage: Number(d.commissionPercentage) || 0,
            }))
        )
      ),
      onSnapshot(getClinicCollection("services"), (s) => setServices(rows(s) as unknown as Service[])),
      onSnapshot(getClinicDoc("settings", "clinic_info"), (snap) => {
        const data = (snap.data() || {}) as Record<string, unknown>;
        setConfig(parseClinicSchedule(data));
        const home = (data.dentistHome || {}) as { showShare?: boolean };
        // On unless the clinic switched it off: a dentist's share is their own pay.
        setShowShare(home.showShare !== false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [me, clinicId, today]);

  // The viewed day's list. Its own subscription so paging never disturbs the chair's.
  useEffect(() => {
    if (!me || !clinicId) return;
    return onSnapshot(query(getClinicCollection("appointments"), where("date", "==", viewDate)), (s) =>
      setDayAppts(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [me, clinicId, viewDate]);

  // --- What the screen is made of --------------------------------------------------------------
  const mine = useMemo(
    () => (me ? todayAppts.filter((a) => isMine(a, me) && matches(a.branchId as string | null | undefined)) : []),
    [todayAppts, me, matches]
  );
  const dayMine = useMemo(
    () => (me ? dayAppts.filter((a) => isMine(a, me) && matches(a.branchId as string | null | undefined)) : []),
    [dayAppts, me, matches]
  );
  const day = useMemo(() => sortDay(dayMine), [dayMine]);
  const viewingToday = viewDate === today;
  const chair = useMemo(() => pickChair(mine), [mine]);
  const hero = chair.current || chair.next;
  const heroIsCurrent = !!chair.current;
  const after = chair.current ? chair.next : chair.after;

  const money = useMemo(() => (me ? moneyToday(ledger, me, today) : { paid: 0, share: 0 }), [ledger, me, today]);
  const owed = useMemo(() => (me ? owedByMyPatients(ledger, me) : 0), [ledger, me]);
  const lab = useMemo(() => (me ? labReturns(labCases, me, today) : []), [labCases, me, today]);
  const patientName = useCallback(
    (id: string) => patients.find((p) => p.id === id)?.name || (isAr ? "مريض" : "Patient"),
    [patients, isAr]
  );
  const plans = useMemo(() => (me ? openPlans(notes, futureAppts, me, today) : []), [notes, futureAppts, me, today]);

  const heroPatientId = String(hero?.patientId || "");
  const heroBalance = useMemo(
    () => (me && heroPatientId ? owedByPatient(ledger, me, heroPatientId) : 0),
    [ledger, me, heroPatientId]
  );
  const heroLastSeen = useMemo(() => {
    if (!heroPatientId) return null;
    const dates = notes
      .filter((n) => String(n.patientId) === heroPatientId && String(n.date || "") < today)
      .map((n) => String(n.date));
    if (!dates.length) return null;
    return daysBetween(dates.sort().at(-1) as string, today);
  }, [notes, heroPatientId, today]);
  const heroWaiting = hero && String(hero.status) === "Checked In" ? waitingMinutes(hero.checkInTime, now) : null;

  const fmt = (n: number) => n.toLocaleString(isAr ? "ar-EG" : "en-US");
  const dayDone = dayMine.filter((a) => isDone(a.status)).length;
  const dayLabel = (() => {
    const delta = daysBetween(today, viewDate);
    if (delta === 0) return isAr ? "النهارده" : "Today";
    if (delta === 1) return isAr ? "بكرة" : "Tomorrow";
    if (delta === -1) return isAr ? "إمبارح" : "Yesterday";
    const d = new Date(`${viewDate}T12:00:00`);
    return d.toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "short" });
  })();
  const shiftDay = (delta: number) => {
    const d = new Date(`${viewDate}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setViewDate(localYmd(d));
  };

  // --- Acting from it ---------------------------------------------------------------------------
  const [busyId, setBusyId] = useState("");

  /**
   * The same write the reception dashboard makes for a status change, so the two screens leave
   * identical trails. A dentist never checks a patient in (reception does), so the check-in
   * stamp and attendance row are not repeated here; the check-out stamp is, because "done" from
   * the chair is exactly the moment the dashboard stamps it.
   */
  const setStatus = async (apt: Row, nextStatus: "In Chair" | "Checking Out") => {
    if (busyId) return;
    setBusyId(String(apt.id));
    try {
      const payload: Record<string, unknown> = {
        status: nextStatus,
        modifiedBy: user?.name || "System",
        updatedAt: serverTimestamp(),
        statusHistory: arrayUnion({ status: nextStatus, timestamp: new Date(), modifiedBy: user?.name || "System" }),
      };
      if (nextStatus === "Checking Out" && !apt.checkOutTime) payload.checkOutTime = serverTimestamp();
      await updateDoc(getClinicDoc("appointments", String(apt.id)), payload);
    } catch (e) {
      console.error("Status change failed:", e);
      showToast(isAr ? "حصل خطأ" : "Could not update", "error");
    } finally {
      setBusyId("");
    }
  };

  // Today's note: the one already linked to this visit if there is one, else a fresh one on this
  // visit. The chart needs the patient's tooth data and every note on them (not just this
  // dentist's) — the moment of deciding which tooth to treat is the wrong moment for a blank mouth.
  const [noteCtx, setNoteCtx] = useState<NoteContext | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const openNote = async (apt: Row) => {
    const patientId = String(apt.patientId || "");
    if (!patientId || noteLoading) return;
    setNoteLoading(true);
    try {
      const [pSnap, nSnap] = await Promise.all([
        getDoc(getClinicDoc("patients", patientId)),
        getDocs(query(getClinicCollection("clinical_notes"), where("patientId", "==", patientId))),
      ]);
      const patient = { id: patientId, ...(pSnap.data() || {}) } as Patient;
      const all = nSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Note);
      const linked = apt.clinicalNoteId ? all.find((n) => n.id === apt.clinicalNoteId) : undefined;
      const onVisit = all.find((n) => n.appointmentId === apt.id);
      setNoteCtx({ apt, patient, notes: all, initialNote: linked || onVisit || null });
    } catch (e) {
      console.error("Open note failed:", e);
      showToast(isAr ? "مقدرناش نفتح الملاحظة" : "Could not open the note", "error");
    } finally {
      setNoteLoading(false);
    }
  };
  const noteTreatments = useMemo(() => {
    if (!noteCtx) return {};
    const categoryById = new Map(services.map((s) => [s.id, s.category]));
    return treatmentsByTooth(noteCtx.notes, (id) => categoryById.get(id) || undefined, (name) => suggestCategory(name));
  }, [noteCtx, services]);

  // Booking the next visit, with this patient and this dentist already filled in.
  const [booking, setBooking] = useState<{ id: string; name: string } | null>(null);
  const ownerAlert = async (alertKey: string, message: string) => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      await fetch("/api/whatsapp/owner-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ alertKey, message }),
      });
    } catch (e) {
      console.warn("Owner WhatsApp alert", e);
    }
  };
  const handleSaveBooking = async (data: Parameters<typeof saveBooking>[0]) => {
    try {
      await saveBooking(
        data,
        { uid: user?.uid || "", name: user?.name || "System", role: user?.role || "", language: isAr ? "ar" : "en" },
        ownerAlert
      );
      setBooking(null);
      showToast(isAr ? "تم الحجز" : "Booked", "success");
    } catch (e) {
      console.error("Booking save error:", e);
      showToast(isAr ? "حدث خطأ" : "Could not book", "error");
    }
  };

  // --- Copy ------------------------------------------------------------------------------------
  const hour = new Date(now).getHours();
  const greeting = isAr
    ? hour < 12 ? "صباح الخير،" : "مساء الخير،"
    : hour < 12 ? "Good morning," : hour < 18 ? "Good afternoon," : "Good evening,";
  const firstName = (me?.name || user?.name || "").split(" ").filter(Boolean)[0] || "";
  const dateLine = new Date(now).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  const timeLine = new Date(now).toLocaleTimeString(isAr ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  // --- Render ----------------------------------------------------------------------------------
  if (me === undefined || (me && (!loaded || !branchReady))) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-ink-faint" />
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" dir={isRTL ? "rtl" : "ltr"}>
        <div className="max-w-md rounded-[2rem] bg-surface border border-line shadow-sm p-8 text-center">
          <Armchair size={28} className="mx-auto text-ink-faint mb-4" />
          <h1 className="font-display text-xl font-bold text-ink">
            {isAr ? "حسابك مش مربوط بطبيب في قائمة الفريق" : "Your login isn't linked to a dentist on the team list"}
          </h1>
          <p className="text-sm font-medium text-ink-muted mt-2 leading-relaxed">
            {isAr
              ? "اطلب من المدير يضيفك من الإعدادات ← المستخدمين، وبعدها الشاشة دي هتتملي لوحدها."
              : "Ask your admin to add you under Settings → Users. This screen fills itself in from there."}
          </p>
        </div>
      </div>
    );
  }

  const eyebrow = "font-display text-[11px] font-black uppercase tracking-[0.12em] text-ink-muted";
  const ghost =
    "inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-xl bg-surface border border-line text-ink text-[12px] font-extrabold uppercase tracking-wide shadow-sm hover:bg-surface-subtle transition-colors disabled:opacity-50 whitespace-nowrap";
  const navBtn =
    "relative inline-flex items-center justify-center w-7 h-7 rounded-lg bg-surface border border-line text-ink-body hover:bg-surface-subtle hover:text-ink transition-colors";

  return (
    <div className="min-h-screen lg:min-h-0 lg:h-full pb-24 lg:pb-4 text-ink-strong" dir={isRTL ? "rtl" : "ltr"}>
      <div className="w-full max-w-[1400px] mx-auto p-4 md:p-6 lg:p-5 flex flex-col gap-4">

        {/* Header: greeting, and the dentist's own money */}
        <div className="flex flex-wrap items-end justify-between gap-4 px-1">
          <div>
            <h1 className="font-display text-[26px] md:text-[28px] font-medium text-ink-strong leading-tight">
              {greeting} <span className="font-bold text-ink">{isAr ? `د. ${firstName}` : `Dr. ${firstName}`}</span>
            </h1>
            <p className="text-xs font-semibold text-ink-muted mt-1">
              {dateLine} · {timeLine}
              {branches.length > 0 && activeBranch ? ` · ${activeBranch.name}` : ""}
            </p>
          </div>
          <div className="flex items-stretch bg-surface border border-line rounded-2xl shadow-sm px-1.5 py-2.5">
            <Figure label={isAr ? "دفعوا النهارده" : "My patients paid today"} value={fmt(money.paid)} isAr={isAr} />
            {showShare && (
              <>
                <span className="w-px bg-line my-0.5" />
                <Figure label={isAr ? "نصيبي" : "My share"} value={fmt(money.share)} isAr={isAr} />
              </>
            )}
            <span className="w-px bg-line my-0.5" />
            <Figure label={isAr ? "لسه عليهم" : "Still owed by my patients"} value={fmt(owed)} isAr={isAr} />
          </div>
        </div>

        {/* Row 2: the chair, and the day */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 relative overflow-hidden rounded-[2rem] bg-ink-slab text-white p-7 md:p-9 min-h-[360px] flex flex-col justify-between shadow-[0_20px_50px_rgba(26,33,48,0.18)]">
            <div className="absolute -top-[120px] -end-[80px] w-[380px] h-[380px] rounded-full bg-white/[0.04] pointer-events-none" />
            {hero ? (
              <>
                <div className="relative flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`${eyebrow} text-white/55`}>
                      {heroIsCurrent ? (isAr ? "على الكرسي دلوقتي" : "In the chair now") : (isAr ? "التالي على الكرسي" : "Next in the chair")}
                    </span>
                    <span className="inline-flex items-center gap-2 h-6 px-2.5 rounded-full bg-white/[0.08] text-[11px] font-bold text-white/85">
                      <span className={`w-2 h-2 rounded-full ${getAppointmentStatusStyles(String(hero.status)).dot}`} />
                      {getAppointmentStageLabel(String(hero.status || ""), isAr ? "ar" : "en")}
                      {heroWaiting !== null && ` · ${isAr ? `مستني ${heroWaiting} دقيقة` : `waiting ${heroWaiting} min`}`}
                    </span>
                  </div>
                  <div>
                    <p className="font-figure text-sm font-semibold text-white/60 tracking-wide">
                      {String(hero.time || "")}
                      {hero.roomName ? ` · ${String(hero.roomName)}` : ""}
                    </p>
                    <h2 className="font-display text-[34px] md:text-[44px] font-semibold leading-[1.05] text-white mt-1">
                      {String(hero.patientName || "")}
                    </h2>
                    <p className="text-[15px] font-semibold text-white/70 mt-2">
                      {String(hero.serviceName || hero.treatment || (isAr ? "بدون إجراء محدد" : "No procedure set"))}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {heroLastSeen !== null && (
                      <Chip>{isAr ? `آخر زيارة من ${heroLastSeen} يوم` : `Last visit ${heroLastSeen} days ago`}</Chip>
                    )}
                    {heroBalance > 0 && <Chip>{isAr ? `عليه ${fmt(heroBalance)} ج.م` : `Balance ${fmt(heroBalance)} EGP`}</Chip>}
                    {!!hero.clinicalNoteId && <Chip>{isAr ? "الملاحظة بدأت" : "Note started"}</Chip>}
                  </div>
                </div>
                <div className="relative flex flex-wrap items-end justify-between gap-4 mt-6">
                  <div className="flex flex-wrap gap-2.5">
                    {heroIsCurrent ? (
                      <SlabButton primary onClick={() => void setStatus(hero, "Checking Out")} busy={busyId === hero.id}>
                        <Check size={16} strokeWidth={2.5} /> {isAr ? "خلصت — للاستقبال" : "Done — to the desk"}
                      </SlabButton>
                    ) : (
                      SEATABLE.has(String(hero.status)) && (
                        <SlabButton primary onClick={() => void setStatus(hero, "In Chair")} busy={busyId === hero.id}>
                          <Armchair size={16} strokeWidth={2.5} /> {isAr ? "دخّل المريض" : "Seat patient"}
                        </SlabButton>
                      )
                    )}
                    <SlabButton onClick={() => void openNote(hero)} busy={noteLoading}>
                      <PenLine size={15} /> {hero.clinicalNoteId ? (isAr ? "افتح ملاحظة النهارده" : "Open today's note") : (isAr ? "ابدأ ملاحظة النهارده" : "Start today's note")}
                    </SlabButton>
                    <button onClick={() => router.push(`/patients/${hero.patientId}`)} className="inline-flex items-center gap-1 h-11 px-3 text-[12px] font-bold text-white/60 hover:text-white transition-colors">
                      {isAr ? "الملف" : "File"} <ArrowUpRight size={13} />
                    </button>
                  </div>
                  {after && (
                    <div className="flex flex-col items-end gap-0.5 text-end">
                      <span className={`${eyebrow} text-white/40 text-[10px]`}>{isAr ? "بعده" : "After"}</span>
                      <span className="text-[13px] font-bold text-white/75">
                        {String(after.time || "")} · {String(after.patientName || "")}
                        {after.serviceName || after.treatment ? ` · ${String(after.serviceName || after.treatment)}` : ""}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="relative flex flex-col justify-center h-full gap-2">
                <span className={`${eyebrow} text-white/55`}>{isAr ? "الكرسي" : "The chair"}</span>
                <h2 className="font-display text-[30px] font-semibold text-white leading-tight">
                  {mine.length === 0
                    ? (isAr ? "مفيش مرضى محجوزين ليك النهارده" : "No patients booked for you today")
                    : (isAr ? "خلصت مرضى النهارده" : "Done for today")}
                </h2>
                <p className="text-sm font-semibold text-white/60">
                  {mine.length === 0
                    ? (isAr ? "اللي تحت لسه محتاج نظرة." : "What's below still needs a look.")
                    : (isAr ? `${mine.length} ${isAr ? "مرضى" : ""} اتشافوا.` : `${mine.length} patients seen.`)}
                </p>
              </div>
            )}
          </div>

          <Card className="lg:col-span-2 min-h-[360px]">
            <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className={eyebrow}>{isAr ? "يومي" : "My day"}</span>
                <span className={`font-figure text-xs font-bold truncate ${viewingToday ? "text-ink-faint" : "text-ink"}`}>· {dayLabel}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => shiftDay(-1)} aria-label={isAr ? "اليوم اللي قبله" : "Previous day"} className={navBtn}>
                  <ChevronLeft size={14} className="rtl:rotate-180" />
                </button>
                {!viewingToday && (
                  <button onClick={() => setViewDate(today)} className="h-7 px-2.5 rounded-lg bg-ink-slab text-white text-[11px] font-extrabold uppercase tracking-wide">
                    {isAr ? "النهارده" : "Today"}
                  </button>
                )}
                <label className={navBtn} title={isAr ? "اختار يوم" : "Pick a day"}>
                  <CalendarDays size={14} />
                  <input
                    type="date"
                    value={viewDate}
                    onChange={(e) => e.target.value && setViewDate(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </label>
                <button onClick={() => shiftDay(1)} aria-label={isAr ? "اليوم اللي بعده" : "Next day"} className={navBtn}>
                  <ChevronRight size={14} className="rtl:rotate-180" />
                </button>
              </div>
            </div>
            <p className="px-6 pb-2 font-figure text-xs font-bold text-ink-faint">
              {dayMine.length} {isAr ? "مرضى" : "patients"}
              {viewDate <= today ? ` · ${dayDone} ${isAr ? "خلصوا" : "done"}` : ""}
            </p>
            {day.length === 0 ? (
              <Empty>
                {viewingToday
                  ? (isAr ? "مفيش مواعيد ليك النهارده." : "Nothing booked for you today.")
                  : (isAr ? "مفيش مواعيد ليك في اليوم ده." : "Nothing booked for you on this day.")}
              </Empty>
            ) : (
              <div className="flex flex-col">
                {day.map((a) => {
                  const done = isDone(a.status);
                  const isHero = viewingToday && hero?.id === a.id;
                  return (
                    <div
                      key={String(a.id)}
                      onClick={() => router.push(`/patients/${a.patientId}`)}
                      className={`flex items-center gap-3.5 px-6 py-2.5 border-t border-surface-muted first:border-t-0 cursor-pointer hover:bg-surface-subtle transition-colors ${done ? "opacity-50" : ""} ${isHero ? "bg-surface-subtle" : ""}`}
                    >
                      <span className={`font-figure text-[13px] w-[64px] shrink-0 ${isHero ? "font-extrabold text-ink" : "font-semibold text-ink-body"}`}>{String(a.time || "")}</span>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${getAppointmentStatusStyles(String(a.status)).dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-ink truncate">{String(a.patientName || "")}</p>
                        <p className="text-xs font-semibold text-ink-muted truncate">
                          {String(a.serviceName || a.treatment || "")}
                          {a.serviceName || a.treatment ? " · " : ""}
                          {getAppointmentStageLabel(String(a.status || ""), isAr ? "ar" : "en")}
                        </p>
                      </div>
                      {viewingToday && !done && String(a.status) !== "In Chair" && SEATABLE.has(String(a.status)) && !chair.current && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void setStatus(a, "In Chair"); }}
                          disabled={!!busyId}
                          className={`${ghost} h-[30px] px-3 text-[11px]`}
                        >
                          {busyId === a.id ? <Loader2 size={12} className="animate-spin" /> : null}
                          {isAr ? "دخّل" : "Seat"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Row 3: what came back, and what was left open */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHead
              title={isAr ? "رجع من المعمل" : "Back from the lab"}
              right={lab.length ? `${lab.length} · ${lab.filter((c) => c.kind === "late").length} ${isAr ? "متأخر" : "late"}` : ""}
              eyebrow={eyebrow}
            />
            {lab.length === 0 ? (
              <Empty>{isAr ? "مفيش حالات مستنياك." : "Nothing waiting on you at the lab."}</Empty>
            ) : (
              <div className="flex flex-col">
                {lab.map((c) => {
                  const pid = String(c.patientId || "");
                  const tone =
                    c.kind === "late" ? "bg-danger-tint text-danger"
                    : c.kind === "due_today" ? "bg-warn-tint text-warn"
                    : c.kind === "back" ? "bg-ok-tint text-ok"
                    : "bg-info-tint text-info";
                  const tag =
                    c.kind === "late" ? (isAr ? "متأخر" : "Late at lab")
                    : c.kind === "due_today" ? (isAr ? "مستحق النهارده" : "Due today")
                    : c.kind === "back" ? (isAr ? "وصل" : "Back")
                    : (isAr ? "بروفة" : "Try-in back");
                  return (
                    <div key={String(c.id)} className="flex flex-wrap items-center gap-3 px-6 py-3 border-t border-surface-muted first:border-t-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-ink truncate">{String(c.patientName || patientName(pid))}</p>
                        <p className="text-xs font-semibold text-ink-muted truncate">
                          {workTypeLabel(String(c.workType || ""), isAr ? "ar" : "en")}
                          {Array.isArray(c.teeth) && c.teeth.length ? ` · ${(c.teeth as number[]).join(", ")}` : ""}
                          {c.labName ? ` · ${String(c.labName)}` : ""}
                        </p>
                      </div>
                      <span className={`inline-flex items-center h-[22px] px-2.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${tone}`}>{tag}</span>
                      {(c.kind === "back" || c.kind === "tryin") && pid && (
                        <button onClick={() => setBooking({ id: pid, name: String(c.patientName || patientName(pid)) })} className={ghost}>
                          <CalendarPlus size={13} /> {isAr ? "احجز التركيب" : "Book fitting"}
                        </button>
                      )}
                      {(c.kind === "late" || c.kind === "due_today") && (
                        <button onClick={() => router.push("/lab")} className={ghost}>
                          <FlaskConical size={13} /> {isAr ? "افتح المعمل" : "Open lab"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title={isAr ? "خطط سايبها مفتوحة" : "Plans I left open"} right={plans.length ? (isAr ? "من غير موعد جاي" : "No next visit booked") : ""} eyebrow={eyebrow} />
            {plans.length === 0 ? (
              <Empty>{isAr ? "كل مريض في نص علاج عنده موعد جاي." : "Every patient mid-treatment has a next visit."}</Empty>
            ) : (
              <div className="flex flex-col">
                {plans.slice(0, 8).map((p) => {
                  const ago = p.lastNoteDate ? daysBetween(p.lastNoteDate, today) : null;
                  return (
                    <div key={p.patientId} className="flex flex-wrap items-center gap-3 px-6 py-3 border-t border-surface-muted first:border-t-0">
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => router.push(`/patients/${p.patientId}`)}>
                        <p className="text-sm font-bold text-ink truncate">{patientName(p.patientId)}</p>
                        <p className="text-xs font-semibold text-ink-muted truncate">
                          {p.procedure || (isAr ? "علاج جاري" : "Ongoing treatment")}
                          {p.ongoing > 1 ? ` · ${p.ongoing} ${isAr ? "مفتوحين" : "open"}` : ""}
                          {ago !== null ? ` · ${isAr ? `آخر زيارة من ${ago} يوم` : `last seen ${ago} days ago`}` : ""}
                        </p>
                      </div>
                      <button onClick={() => setBooking({ id: p.patientId, name: patientName(p.patientId) })} className={ghost}>
                        <CalendarPlus size={13} /> {isAr ? "احجز اللي بعده" : "Book next"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* How the period went — the dentist's own numbers, charted. */}
        <DentistReport me={me} ledger={ledger} patients={patients} showShare={showShare} today={today} isAr={isAr} />
      </div>

      {booking && config && (
        <BookingModal
          isOpen={true}
          inlineDesktop={false}
          onClose={() => setBooking(null)}
          onSave={handleSaveBooking}
          patients={patients.map((p) => ({ ...p, id: p.id, name: String(p.name || "") }))}
          doctors={doctors}
          servicesList={services}
          settingsConfig={config}
          preSelectedDate={today}
          preSelectedTime=""
          preSelectedDoctor={me.name}
          preSelectedPatient={booking}
          preSelectedBranchId={scopeBranchId}
        />
      )}

      {noteCtx && (
        <ServiceEditorDrawer
          isOpen={true}
          inline={false}
          onClose={() => setNoteCtx(null)}
          patientId={noteCtx.patient.id}
          patientName={String(noteCtx.patient.name || noteCtx.apt.patientName || "")}
          patientDefaultPriceListId={(noteCtx.patient.defaultPriceListId as string | undefined) || null}
          branchId={(noteCtx.apt.branchId as string | undefined) || null}
          appointmentId={String(noteCtx.apt.id)}
          initialNote={noteCtx.initialNote}
          servicesList={services}
          doctors={doctors}
          teethData={noteCtx.patient.teethData || {}}
          treatments={noteTreatments}
          onSaved={() => {
            setNoteCtx(null);
            showToast(isAr ? "اتحفظت" : "Saved", "success");
          }}
        />
      )}
    </div>
  );
}

// --- Small pieces, kept here because nothing else uses them ------------------------------------

function Figure({ label, value, isAr }: { label: string; value: string; isAr: boolean }) {
  return (
    <div className="flex flex-col justify-center gap-1.5 px-4 md:px-5">
      <span className="font-display text-[10px] font-black uppercase tracking-[0.12em] text-ink-muted whitespace-nowrap">{label}</span>
      <span className="font-figure text-[22px] font-extrabold text-ink leading-none">
        {value} <span className="text-[11px] font-semibold text-ink-faint tracking-[0.1em]">{isAr ? "ج.م" : "EGP"}</span>
      </span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center h-[26px] px-3 rounded-full border border-white/[0.18] text-[11px] font-bold text-white/80">
      {children}
    </span>
  );
}

function SlabButton({ children, onClick, primary, busy }: { children: React.ReactNode; onClick: () => void; primary?: boolean; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-2 h-11 px-5 rounded-[14px] text-[13px] font-extrabold uppercase tracking-wide transition-all active:scale-[0.98] disabled:opacity-60 ${
        primary ? "bg-white text-ink hover:bg-white/90" : "border border-white/[0.28] text-white hover:bg-white/[0.06]"
      }`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[2rem] border border-white/60 bg-white/80 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-3xl overflow-hidden flex flex-col ${className}`}>
      {children}
    </div>
  );
}

function CardHead({ title, right, eyebrow }: { title: string; right?: string; eyebrow: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
      <span className={eyebrow}>{title}</span>
      {right ? <span className="font-figure text-xs font-bold text-ink-faint">{right}</span> : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 pb-6 pt-2 text-sm font-semibold text-ink-faint">{children}</p>;
}
