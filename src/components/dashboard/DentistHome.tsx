"use client";

import { foldArabicDigits } from "@/lib/phoneNumber";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  arrayUnion, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where,
} from "firebase/firestore";
import { Armchair, CalendarDays, Check, Loader2, Plus, Search, User, X } from "lucide-react";
import ChairPopup from "@/components/chair/ChairPopup";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { localYmd } from "@/lib/clinicDate";
import { getAppointmentStageLabel, getAppointmentStatusStyles } from "@/lib/appointmentStages";
import { isDentistStaff } from "@/lib/staffRoles";
import { treatmentsByTooth } from "@/lib/toothTreatments";
import { suggestCategory } from "@/lib/dentalIcons";
import { syncClaimLineFromAppointment } from "@/lib/insurance/appointmentSync";
import ServiceEditorDrawer from "@/components/clinical-notes/ServiceEditorDrawer";
import type { Note, Service, Staff } from "@/components/clinical-notes/types";
import type { ToothData } from "@/lib/diagnosisCatalog";
import { isDone, isMine, pickChair, sortDay, waitingMinutes, type DentistIdentity, type Row } from "@/lib/dentistHome";
import PageHeader from "@/components/dashboard/PageHeader";
import HomeViewTabs from "@/components/dashboard/HomeViewTabs";

/**
 * What a dentist sees on sign-in, instead of the reception desk.
 *
 * One screen, one job (owner, 2026-10-12: "more basic and simple"): the next patient, and the
 * day as a list. Each booking carries two buttons — Profile opens the patient's file, Service opens
 * the clinical-note pop-up on a blank treatment for that visit. Lab returns, x-rays to sign, open
 * plans and the dentist's own report left the home on purpose; they live on their own pages.
 *
 * Only their own bookings, read live: reception checks a patient in and the screen flips to
 * "waiting" without anyone pressing anything. No money is read here at all.
 */

type Patient = { id: string; name?: string; teethData?: Record<string, ToothData>; [k: string]: unknown };

type NoteContext = {
  apt: Row;
  patient: Patient;
  notes: Note[];
};

const SEATABLE = new Set(["Scheduled", "Confirmed", "Delayed", "Checked In", "Late", "Pending"]);

export default function DentistHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { branches, activeBranch, matches, ready: branchReady } = useActiveBranch();
  const isAr = language === "ar";
  const today = localYmd();
  const tomorrow = useMemo(() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return localYmd(d);
  }, [today]);

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
   * The day the list shows: Today and Tomorrow are one tap; any other day comes from the calendar
   * tab, which then names it. The chair is always today.
   */
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;
  const isTomorrow = viewDate === tomorrow;
  const otherDay = !isToday && !isTomorrow;
  const [dayAppts, setDayAppts] = useState<Row[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
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
    ];
    return () => unsubs.forEach((u) => u());
  }, [me, clinicId, today]);

  // The viewed day's list. Its own subscription so switching days never disturbs the chair's.
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
  const chair = useMemo(() => pickChair(mine), [mine]);
  const hero = chair.current || chair.next;
  const heroIsCurrent = !!chair.current;
  const heroWaiting = hero && String(hero.status) === "Checked In" ? waitingMinutes(hero.checkInTime, now) : null;
  const dayDone = dayMine.filter((a) => isDone(a.status)).length;

  // --- Acting from it ---------------------------------------------------------------------------
  const [busyId, setBusyId] = useState("");

  /**
   * The same write the reception dashboard makes for a status change, so the two screens leave
   * identical trails. A dentist never checks a patient in (reception does); the check-out stamp is
   * repeated, because "done" from the chair is exactly the moment the dashboard stamps it.
   */
  const setStatus = async (apt: Row, nextStatus: "In Chair" | "Checking Out") => {
    if (busyId) return false;
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
      // "Done" from the chair marks the insurance service done on its approval, with this dentist on it.
      void syncClaimLineFromAppointment(clinicId, { ...apt, status: nextStatus });
      return true;
    } catch (e) {
      console.error("Status change failed:", e);
      showToast(isAr ? "حصل خطأ" : "Could not update", "error");
      return false;
    } finally {
      setBusyId("");
    }
  };

  /** The chair popup: a patient, and today's visit when there is one. */
  const [chairPop, setChairPop] = useState<{ patientId: string; appointment: { id: string; branchId?: string | null } | null } | null>(null);
  const openChairFor = (a: Row) =>
    setChairPop({ patientId: String(a.patientId || ""), appointment: { id: String(a.id), branchId: (a.branchId as string | null | undefined) ?? null } });

  /** Start: seat the patient, then straight into the chair. */
  const start = async (a: Row) => {
    if (SEATABLE.has(String(a.status)) && !(await setStatus(a, "In Chair"))) return;
    openChairFor(a);
  };

  // The Service button: a blank treatment on this visit, in the clinical-note pop-up. The chart
  // needs the patient's tooth data and every note on them (not just this dentist's).
  const [noteCtx, setNoteCtx] = useState<NoteContext | null>(null);
  const [noteLoadingId, setNoteLoadingId] = useState("");
  const addService = async (apt: Row) => {
    const patientId = String(apt.patientId || "");
    if (!patientId || noteLoadingId) return;
    setNoteLoadingId(String(apt.id));
    try {
      const [pSnap, nSnap] = await Promise.all([
        getDoc(getClinicDoc("patients", patientId)),
        getDocs(query(getClinicCollection("clinical_notes"), where("patientId", "==", patientId))),
      ]);
      const patient = { id: patientId, ...(pSnap.data() || {}) } as Patient;
      setNoteCtx({ apt, patient, notes: nSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Note) });
    } catch (e) {
      console.error("Open note failed:", e);
      showToast(isAr ? "مقدرناش نفتح الملاحظة" : "Could not open the note", "error");
    } finally {
      setNoteLoadingId("");
    }
  };
  const noteTreatments = useMemo(() => {
    if (!noteCtx) return {};
    const categoryById = new Map(services.map((s) => [s.id, s.category]));
    return treatmentsByTooth(noteCtx.notes, (id) => categoryById.get(id) || undefined, (name) => suggestCategory(name));
  }, [noteCtx, services]);

  /** Any patient, into the chair — a walk-in or a follow-up without a booking. Hidden behind the magnifier. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const searchHits = useMemo(() => {
    // Arabic-Indic digits on either side — the keyboard and stored records both have them.
    const q = foldArabicDigits(searchQ).trim().toLowerCase();
    if (q.length < 2) return [];
    return patients
      .filter((p) => String(p.name || "").toLowerCase().includes(q) || foldArabicDigits(String(p.phone || "")).includes(q))
      .slice(0, 8);
  }, [searchQ, patients]);

  // --- Copy ------------------------------------------------------------------------------------
  const hour = new Date(now).getHours();
  const greeting = isAr
    ? hour < 12 ? "صباح الخير،" : "مساء الخير،"
    : hour < 12 ? "Good morning," : hour < 18 ? "Good afternoon," : "Good evening,";
  const firstName = (me?.name || user?.name || "").split(" ").filter(Boolean)[0] || "";
  const dateLine = new Date(now).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long" });

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

  const eyebrow = "text-[11px] font-bold uppercase tracking-[0.12em]";
  const tab = (on: boolean) =>
    `h-9 px-4 rounded-full text-[13px] font-bold transition-colors ${on ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`;
  const pill = "inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-colors disabled:opacity-50";

  return (
    /* pb-2 below lg: <main> already leaves 128px under the page for the bottom bar and the orb. */
    <div className="min-h-full pb-2 lg:pb-6 text-ink-strong" dir={isRTL ? "rtl" : "ltr"}>
      <div className="w-full max-w-2xl mx-auto p-4 md:p-6 lg:p-5 flex flex-col gap-4">

        <PageHeader
          title={<><span className="font-light">{greeting}</span> {isAr ? `د. ${firstName}` : `Dr. ${firstName}`}</>}
          subtitle={`${dateLine}${branches.length > 0 && activeBranch ? ` · ${activeBranch.name}` : ""}`}
        >
          {/* Renders nothing for a plain dentist — this screen is simply their home. */}
          <HomeViewTabs />
        </PageHeader>

        {/* The next patient. Nobody left to seat: the list below already says so. */}
        {hero && (
          <div className="rounded-[2rem] bg-ink-slab text-white p-6 max-md:p-5 flex flex-col gap-5 shadow-[0_20px_50px_rgba(26,33,48,0.18)]">
            <div className="flex flex-col gap-1.5">
              <span className={`${eyebrow} text-white/55`}>
                {heroIsCurrent ? (isAr ? "على الكرسي دلوقتي" : "In the chair now") : (isAr ? "التالي" : "Next")}
                {heroWaiting !== null && ` · ${isAr ? `مستني ${heroWaiting} دقيقة` : `waiting ${heroWaiting} min`}`}
              </span>
              <h2 className="font-display text-[32px] md:text-[38px] font-semibold leading-[1.05] text-white break-words">
                {String(hero.patientName || "")}
              </h2>
              <p className="text-[15px] font-semibold text-white/70">
                <span className="font-figure text-white">{String(hero.time || "")}</span>
                {" · "}
                {String(hero.serviceName || hero.treatment || (isAr ? "بدون إجراء محدد" : "No procedure set"))}
              </p>
            </div>
            <div className="flex gap-2.5">
              {heroIsCurrent ? (
                <button
                  type="button"
                  onClick={() => void setStatus(hero, "Checking Out")}
                  disabled={busyId === hero.id}
                  className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full bg-accent text-ink-on-accent text-[15px] font-bold disabled:opacity-60"
                >
                  {busyId === hero.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={17} strokeWidth={2.5} />}
                  {isAr ? "خلصت — للاستقبال" : "Done — to the desk"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void start(hero)}
                  disabled={busyId === hero.id}
                  className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-full bg-accent text-ink-on-accent text-[15px] font-bold disabled:opacity-60"
                >
                  {busyId === hero.id ? <Loader2 size={16} className="animate-spin" /> : null}
                  {isAr ? "ابدأ" : "Start"}
                </button>
              )}
              {heroIsCurrent && (
                <button
                  type="button"
                  onClick={() => openChairFor(hero)}
                  className="inline-flex items-center justify-center gap-1.5 h-12 px-5 rounded-full border border-white/25 text-white text-[14px] font-semibold hover:bg-white/[0.06]"
                >
                  <Armchair size={15} /> {isAr ? "الكرسي" : "Chair"}
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push(`/patients/${hero.patientId}`)}
                className="inline-flex items-center justify-center h-12 px-5 rounded-full border border-white/25 text-white text-[14px] font-semibold hover:bg-white/[0.06]"
              >
                {isAr ? "الملف" : "File"}
              </button>
            </div>
          </div>
        )}

        {/* The day. */}
        <div className="rounded-[2rem] border border-line bg-surface shadow-[0_8px_40px_rgba(0,0,0,0.04)] max-lg:relative max-lg:z-10">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            <div className="flex gap-1 p-1 rounded-full bg-surface-muted" role="tablist">
              <button type="button" role="tab" aria-selected={isToday} onClick={() => setViewDate(today)} className={tab(isToday)}>
                {isAr ? "النهارده" : "Today"}
              </button>
              <button type="button" role="tab" aria-selected={isTomorrow} onClick={() => setViewDate(tomorrow)} className={tab(isTomorrow)}>
                {isAr ? "بكرة" : "Tomorrow"}
              </button>
              {/* Any other day: the native date picker sits invisibly over the tab, so one tap opens it. */}
              <label
                role="tab"
                aria-selected={otherDay}
                title={isAr ? "اختار يوم" : "Pick a day"}
                className={`relative inline-flex items-center gap-1.5 cursor-pointer ${tab(otherDay)} ${otherDay ? "" : "px-3"}`}
              >
                <CalendarDays size={15} />
                {otherDay && (
                  <span className="font-figure">
                    {new Date(`${viewDate}T12:00:00`).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                )}
                <input
                  type="date"
                  value={viewDate}
                  onChange={(e) => e.target.value && setViewDate(e.target.value)}
                  aria-label={isAr ? "اختار يوم" : "Pick a day"}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-figure text-xs font-bold text-ink-muted">
                {dayMine.length} {isAr ? "مرضى" : "patients"}
                {viewDate <= today && dayDone ? ` · ${dayDone} ${isAr ? "خلصوا" : "done"}` : ""}
              </span>
              <button
                type="button"
                onClick={() => { setSearchOpen((o) => !o); setSearchQ(""); }}
                aria-label={isAr ? "دوّر على مريض" : "Find a patient"}
                aria-expanded={searchOpen}
                className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-line text-ink hover:bg-surface-subtle"
              >
                {searchOpen ? <X size={17} /> : <Search size={17} />}
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="relative px-5 pb-2">
              <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface-subtle px-3 text-ink-muted focus-within:border-ink">
                <Search size={15} />
                <input
                  type="search"
                  autoFocus
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder={isAr ? "دوّر على مريض بالاسم أو التليفون" : "Find a patient by name or phone"}
                  className="w-full bg-transparent text-[14px] font-bold text-ink outline-none placeholder:text-ink-faint"
                />
              </label>
              {searchHits.length > 0 && (
                <div className="absolute inset-x-5 top-full z-40 -mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
                  {searchHits.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSearchQ("");
                        setSearchOpen(false);
                        setChairPop({ patientId: p.id, appointment: null });
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 min-h-12 text-start hover:bg-surface-subtle"
                    >
                      <span className="break-words text-[14px] font-bold text-ink">{String(p.name || "")}</span>
                      <bdi dir="ltr" className="font-figure text-[12px] font-semibold text-ink-muted shrink-0">{String(p.phone || "")}</bdi>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {day.length === 0 ? (
            <p className="px-5 pb-6 pt-3 text-sm font-semibold text-ink-faint">
              {isToday
                ? (isAr ? "مفيش مواعيد ليك النهارده." : "Nothing booked for you today.")
                : isTomorrow
                  ? (isAr ? "مفيش مواعيد ليك بكرة." : "Nothing booked for you tomorrow.")
                  : (isAr ? "مفيش مواعيد ليك في اليوم ده." : "Nothing booked for you on this day.")}
            </p>
          ) : (
            <div className="flex flex-col px-5 pb-2">
              {day.map((a) => {
                const done = isDone(a.status);
                const what = String(a.serviceName || a.treatment || "");
                const stage = getAppointmentStageLabel(String(a.status || ""), isAr ? "ar" : "en");
                const name = String(a.patientName || "");
                return (
                  <div
                    key={String(a.id)}
                    className={`flex items-center gap-3 min-h-[66px] py-2 border-t border-surface-muted first:border-t-0 ${done ? "opacity-55" : ""}`}
                  >
                    <span className="w-12 shrink-0 font-figure text-[15px] font-semibold text-ink">{String(a.time || "")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[15px] font-bold text-ink">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${getAppointmentStatusStyles(String(a.status)).dot}`} title={stage} aria-label={stage} />
                        <span className="truncate">{name}</span>
                      </p>
                      <p className="text-[12px] font-semibold text-ink-muted truncate">
                        {a.claimId ? (isAr ? "تأمين · " : "Insurance · ") : ""}
                        {what || stage}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => router.push(`/patients/${a.patientId}`)}
                        aria-label={isAr ? `ملف ${name}` : `Open ${name}'s profile`}
                        className={`${pill} border border-line text-ink hover:bg-surface-subtle`}
                      >
                        <User size={13} strokeWidth={2.4} /> {isAr ? "الملف" : "Profile"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void addService(a)}
                        disabled={!!noteLoadingId}
                        aria-label={isAr ? `أضف خدمة لـ ${name}` : `Add a service for ${name}`}
                        className={`${pill} bg-ink-slab text-white hover:opacity-90`}
                      >
                        {noteLoadingId === a.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2.6} />}
                        {isAr ? "خدمة" : "Service"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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
          initialNote={null}
          servicesList={services}
          doctors={doctors}
          teethData={noteCtx.patient.teethData || {}}
          treatments={noteTreatments}
          dentistMode
          meStaffId={me?.staffId ?? ""}
          onSaved={() => {
            setNoteCtx(null);
            showToast(isAr ? "اتحفظت" : "Saved", "success");
          }}
        />
      )}

      {chairPop && me && (
        <ChairPopup
          isOpen={true}
          onClose={() => setChairPop(null)}
          patientId={chairPop.patientId}
          appointment={chairPop.appointment}
          me={me}
          services={services}
          doctors={doctors}
        />
      )}
    </div>
  );
}
