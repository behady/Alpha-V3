"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDoc, getDocs, limit, onSnapshot, query, setDoc, writeBatch, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import dynamic from "next/dynamic";
import { Bot, Check, ChevronRight, Clock, Copy, ExternalLink, Globe, Loader2, ListChecks, Lock, MapPin, MessageCircle, Phone, Plus, ShieldPlus, Sparkles, Trash2, Users } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useWelcomeOptional } from "@/context/WelcomeContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { parseClinicSchedule } from "@/lib/clinicSchedule";
import { categoryOf, suggestCategory, suggestIcon } from "@/lib/dentalIcons";
import {
  BOOKING_DURATIONS,
  DEFAULT_SCHEDULE,
  SERVICE_TEMPLATES,
  SETUP_STEPS,
  WEEK_DAYS,
  bookingAnswersFrom,
  bookingDocFrom,
  clockInDocFrom,
  clockInPinFrom,
  customServiceChoice,
  initialServiceChoices,
  normalizePhone,
  scheduleDocFrom,
  serviceDocsFrom,
  setupReturnPath,
  type BookingAnswers,
  type ClockInPin,
  type ServiceChoice,
  type SetupStepId,
} from "@/lib/setupWizard";
import { isUnlocked, SUPPORT_WHATSAPP } from "@/lib/featureCatalog";
import { isDentistStaff } from "@/lib/staffRoles";
import PageHeader from "@/components/dashboard/PageHeader";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/context/UnsavedChangesContext";
import { PRIVATE_PAYER_ID, parsePayers } from "@/lib/payers";
import WhatsAppConnectStep from "@/components/setup/WhatsAppConnectStep";
import WhatsAppQuestionsStep from "@/components/setup/WhatsAppQuestionsStep";
import TeamStep, { type TeamMember } from "@/components/setup/TeamStep";
import ClockInLocationStep from "@/components/setup/ClockInLocationStep";

// The insurer editor is the Settings screen itself, loaded only when the clinic says it has insurers.
const PayersSettings = dynamic(() => import("@/components/settings/PayersSettings"), {
  loading: () => <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" aria-hidden />,
});

/**
 * The clinic setup a new clinic lands on right after it is created — and that any admin can run
 * again from the "Quick clinic setup" button in Settings or the wand in the top bar.
 *
 * Nine screens. The clinic's phone and address (so prescriptions print with them), where it is (so
 * a phone clock-in only counts from inside it), its opening hours (so the calendar stops offering
 * times you are closed), a starting price list (so the first
 * invoice has something to pick from), and the online booking page (which shows patients all
 * three). Then the team (so each colleague has a login and the dentists exist to be booked), which
 * insurers it works with, linking its WhatsApp number by QR, and what that WhatsApp should do —
 * asked as plain questions.
 *
 * Every step can be skipped; nothing here is a gate. Steps already done — by this wizard, or by
 * someone who went straight to Settings — are shown as done and passed through.
 *
 * Writes exactly what the Settings screens write, to the same documents, so this is a second
 * door into the same records and not a parallel copy of them. The insurance step goes further:
 * it IS the Settings screen, embedded.
 */
export default function SetupWizardPage() {
  // The embedded insurer editor flags unsaved work; this provider is what turns that flag into a
  // question before "Next" throws a half-typed insurer away.
  return (
    <UnsavedChangesProvider>
      <SetupWizard />
    </UnsavedChangesProvider>
  );
}

function SetupWizard() {
  const router = useRouter();
  const { clinicId, clinic, isAdmin } = useClinic();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const welcome = useWelcomeOptional();
  const { confirmLeave } = useUnsavedChanges();
  const isAr = language === "ar";
  const lang: "en" | "ar" = isAr ? "ar" : "en";

  const [step, setStep] = useState<SetupStepId>(SETUP_STEPS[0]);
  const [loadingState, setLoadingState] = useState(true);
  const [saving, setSaving] = useState(false);

  // Clinic location — the pin phone clock-ins are checked against, and the pin as stored.
  const [pin, setPin] = useState<ClockInPin>(() => clockInPinFrom(undefined));
  const [storedPin, setStoredPin] = useState<ClockInPin>(() => clockInPinFrom(undefined));
  // Hours
  const [schedule, setSchedule] = useState({ ...DEFAULT_SCHEDULE, offDays: [...DEFAULT_SCHEDULE.offDays] });
  const [hoursDone, setHoursDone] = useState(false);
  /**
   * The hours as stored, to tell "already set" from "already set and just edited". Before the
   * Settings button existed nobody came back here, so a done step could simply say "Next"; on a
   * re-run that button quietly dropped whatever the admin had just changed.
   */
  const [storedSchedule, setStoredSchedule] = useState("");
  // Team — listened to for the whole wizard, not just its step: the booking step counts the dentists.
  const [team, setTeam] = useState<TeamMember[]>([]);
  // Services
  const [choices, setChoices] = useState<ServiceChoice[]>(initialServiceChoices);
  const [existingServices, setExistingServices] = useState(false);
  // Contact
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  // Online booking
  const [booking, setBooking] = useState<BookingAnswers>(() => bookingAnswersFrom(undefined, DEFAULT_SCHEDULE.slotDuration));
  /** As stored, to tell "Next" from "Save & next" — and a page being switched off from one never on. */
  const [storedBooking, setStoredBooking] = useState<BookingAnswers>(() => bookingAnswersFrom(undefined, DEFAULT_SCHEDULE.slotDuration));
  /** The yes/no answer; unasked until pressed, unless the page is already live. */
  const [bookingOn, setBookingOn] = useState<boolean | null>(null);
  // Insurance
  const [insurerCount, setInsurerCount] = useState(0);
  const [takesInsurance, setTakesInsurance] = useState<boolean | null>(null);
  // WhatsApp
  const [waConnected, setWaConnected] = useState(false);
  /** Run before: finishing returns to where it was opened from instead of the new-clinic welcome guide. */
  const [isRerun, setIsRerun] = useState(false);
  /** The page the top-bar button was pressed on (`?back=`); Settings when there is none. */
  const [returnTo, setReturnTo] = useState<string | null>(null);

  const t = useMemo(
    () => ({
      title: isAr ? `يلا نجهّز ${clinic?.name || "العيادة"}` : `Let's set up ${clinic?.name || "your clinic"}`,
      sub: isAr
        ? "٩ خطوات، حوالي ١٠ دقايق. تقدر تعدّي أي خطوة وترجعلها في أي وقت من زرار «إعداد سريع» اللي فوق."
        : "Nine steps, about ten minutes. Skip any of them and come back any time from the Quick setup button at the top.",
      steps: {
        location: isAr ? "موقع العيادة" : "Clinic location",
        hours: isAr ? "مواعيد العمل" : "Working hours",
        team: isAr ? "فريق العمل" : "Team",
        services: isAr ? "قائمة الأسعار" : "Price list",
        contact: isAr ? "بيانات العيادة" : "Clinic details",
        booking: isAr ? "الحجز أونلاين" : "Online booking",
        insurance: isAr ? "التأمين" : "Insurance",
        whatsapp: isAr ? "ربط واتساب" : "Connect WhatsApp",
        assistant: isAr ? "مهام واتساب" : "WhatsApp tasks",
      } as Record<SetupStepId, string>,
      locationWhy: isAr
        ? "عشان تسجيل الحضور من الموبايل يتحسب بس لما الموظف يكون في العيادة فعلاً. ثبّت مكان العيادة مرة واحدة، وكل تسجيل حضور بيتقارن بيه."
        : "So a clock-in from a phone only counts when the person is actually at the clinic. Pin the clinic once, and every phone clock-in is checked against it.",
      locationLater: isAr ? "هثبّته وأنا في العيادة" : "I'll pin it from the clinic",
      locationLocked: isAr
        ? "تسجيل الحضور من الموبايل جزء من «الحضور والرواتب»، ومش ضمن باقة العيادة. كلّمنا على واتساب وإحنا نفعّله:"
        : "Clocking in from a phone is part of Attendance & Payroll, which isn't in this clinic's plan. Message us and we'll switch it on:",
      teamWhy: isAr
        ? "ضيف الأطباء والاستقبال والمساعدين. كل واحد بيدخل بحسابه وبيشوف اللي دوره يسمح بيه بس، والأطباء بيظهروا في المواعيد."
        : "Add your dentists, reception and assistants. Each signs in with their own login and sees only what their role allows; dentists show up in the calendar.",
      teamLater: isAr ? "هضيفهم بعدين" : "I'll add them later",
      bookingWhy: isAr
        ? "صفحة حجز باسم عيادتك، المريض يفتحها من لينك ويطلب ميعاد في مواعيد شغلك. كل طلب بيوصل التقويم ويستنى الاستقبال يأكده."
        : "A booking page in your clinic's name: patients open a link and ask for a time within your hours. Every request lands in the calendar for the desk to confirm.",
      bookingAsk: isAr ? "عايز المرضى يحجزوا أونلاين؟" : "Let patients book online?",
      bookingLink: isAr ? "لينك الحجز" : "Your booking link",
      bookingShare: isAr
        ? "حطّه في البايو بتاع إنستجرام، وعلى جوجل مابس، وفي ستيتس واتساب."
        : "Put it in your Instagram bio, on Google Maps, and in your WhatsApp status.",
      bookingOpen: isAr ? "افتح الصفحة" : "Open the page",
      bookingCopy: isAr ? "نسخ" : "Copy",
      bookingCopied: isAr ? "تم نسخ الرابط" : "Link copied",
      bookingCopyFailed: isAr ? "تعذّر النسخ — حدّد الرابط وانسخه" : "Couldn't copy — select the link and copy it",
      bookingDoctor: isAr ? "المريض يختار الطبيب" : "Let patients pick the dentist",
      bookingDoctorHint: (n: number) =>
        n === 0
          ? isAr
            ? "هتضيف الأطباء في الخطوة الجاية. لو فتحتها دلوقتي، الاختيار هيظهر للمرضى أول ما يبقى فيه أطباء. لو مقفولة، الاستقبال بيحدد."
            : "You add your dentists in the next step. Switch this on now and patients see the choice once there are dentists; off, and the desk assigns one."
          : isAr
            ? `عندك ${n === 1 ? "طبيب واحد" : `${n} أطباء`} في الفريق. لو مقفولة، الاستقبال بيحدد مين المتاح.`
            : `${n} dentist${n === 1 ? "" : "s"} on the team. Off, and the desk assigns whoever is free.`,
      bookingLength: isAr ? "الطلب بيحجز قد إيه في الجدول" : "How long a request holds on the schedule",
      minutes: isAr ? "دقيقة" : "minutes",
      bookingMore: isAr
        ? "لينك لكل قناة (الإعلانات، إنستجرام، جوجل) وصورة الغلاف في الإعدادات ← الحجز الإلكتروني."
        : "One link per channel (ads, Instagram, Google) and a cover image are under Settings → Online booking.",
      bookingOff: isAr
        ? "صفحة الحجز هتتقفل، واللينك هيبطل يشتغل لحد ما تفتحها تاني."
        : "The booking page will be switched off; the link stops working until you turn it back on.",
      bookingNo: isAr ? "تمام. تقدر تفتحها في أي وقت من الإعدادات ← الحجز الإلكتروني." : "Fine. You can switch it on any time in Settings → Online booking.",
      bookingLocked: isAr
        ? "الحجز الإلكتروني مش ضمن باقة العيادة. كلّمنا على واتساب وإحنا نفعّله:"
        : "Online booking isn't in this clinic's plan. Message us and we'll switch it on:",
      insuranceWhy: isAr
        ? "لو بتتعامل مع شركات تأمين، كل شركة ليها أسعارها والعلاجات اللي بتغطيها ونسبة الدكاترة عليها."
        : "If you work with insurers, each one gets its own prices, the treatments it covers, and the dentists' share on its cases.",
      insuranceAsk: isAr ? "العيادة بتتعامل مع شركات تأمين؟" : "Does the clinic work with insurance companies?",
      insuranceHowTo: isAr
        ? "اضغط «ضيف شركة تأمين» تحت وجاوب على ٣ أسئلة: اسمها، بتغطي إيه وبتدفع كام، والدكتور بياخد كام. ضيف كل الشركات وبعدين اضغط «التالي»."
        : "Press “Add an insurer” below and answer three questions: its name, what it covers and pays, and what each dentist earns. Add them all, then press Next.",
      insuranceAlready: (n: number) =>
        isAr ? `عندك ${n} ${n === 1 ? "شركة تأمين" : "شركات تأمين"} بالفعل. تقدر تضيف أو تعدّل هنا.` : `You already have ${n} insurer${n === 1 ? "" : "s"}. Add or edit them here.`,
      insuranceNo: isAr ? "كل المرضى هيتحاسبوا بأسعارك العادية. تقدر تضيف شركة في أي وقت من الإعدادات ← التأمين." : "Every patient is charged your normal prices. You can add an insurer any time in Settings → Payers & Insurance.",
      yes: isAr ? "أيوه" : "Yes",
      no: isAr ? "لأ" : "No",
      whatsappWhy: isAr
        ? "عشان التأكيدات والتذكيرات وردود المرضى تطلع من رقم العيادة."
        : "So confirmations, reminders and replies to patients come from the clinic's own number.",
      whatsappLater: isAr ? "هوصّل بعدين" : "I'll connect later",
      assistantWhy: isAr
        ? "كام سؤال بسيط، وإحنا نظبط الرسائل والبوت على إجاباتك."
        : "A few simple questions, and we set up the messages and the bot from your answers.",
      hoursWhy: isAr
        ? "عشان التقويم يبطل يعرض مواعيد وانت قافل، والمساعد يحجز صح."
        : "So the calendar stops offering times you're closed, and the assistant books correctly.",
      open: isAr ? "من" : "Open from",
      close: isAr ? "إلى" : "Close at",
      slot: isAr ? "مدة الموعد (دقيقة)" : "Appointment length (minutes)",
      closedDays: isAr ? "أيام الإجازة" : "Days closed",
      hoursAlready: isAr ? "مواعيد العمل متظبطة بالفعل." : "Your working hours are already set.",
      servicesWhy: isAr
        ? "أسعار مبدئية لعيادة عامة في مصر. عدّل الأرقام، شيل اللي مش بتعمله، وضيف الباقي بعدين من الإعدادات ← الأسعار."
        : "Starting prices for a general practice in Egypt. Edit the numbers, untick what you don't do, and add the rest later under Settings → Prices.",
      servicesAlready: isAr
        ? "عندك خدمات بالفعل، فمش هنضيف القائمة الجاهزة فوقها. ضيف اللي ناقصك تحت."
        : "You already have services, so the template is not added on top of them. Add any you are missing below.",
      selectAll: isAr ? "تحديد الكل" : "Select all",
      selectNone: isAr ? "إلغاء الكل" : "Clear all",
      addService: isAr ? "ضيف خدمة تانية" : "Add another service",
      serviceName: isAr ? "اسم الخدمة" : "Service name",
      remove: isAr ? "حذف" : "Remove",
      contactWhy: isAr
        ? "بيتطبعوا على الروشتة والفاتورة، والمرضى بيتصلوا على الرقم ده."
        : "Printed on every prescription and invoice; the number patients call or WhatsApp.",
      phone: isAr ? "رقم العيادة" : "Clinic phone",
      address: isAr ? "العنوان" : "Address",
      next: isAr ? "التالي" : "Next",
      saveNext: isAr ? "حفظ والتالي" : "Save & next",
      finish: isAr ? "حفظ وابدأ" : "Save & start",
      skip: isAr ? "تعدّي الخطوة دي" : "Skip this step",
      skipAll: isAr ? "تعدّي الإعداد كله" : "Skip setup",
      saved: isAr ? "تم الحفظ" : "Saved",
      failed: isAr ? "فشل الحفظ. جرّب تاني." : "Save failed. Try again.",
      egp: isAr ? "ج.م" : "EGP",
      lab: isAr ? "معمل" : "lab",
      dayNames: {
        Saturday: isAr ? "السبت" : "Sat",
        Sunday: isAr ? "الأحد" : "Sun",
        Monday: isAr ? "الاثنين" : "Mon",
        Tuesday: isAr ? "الثلاثاء" : "Tue",
        Wednesday: isAr ? "الأربعاء" : "Wed",
        Thursday: isAr ? "الخميس" : "Thu",
        Friday: isAr ? "الجمعة" : "Fri",
      } as Record<string, string>,
    }),
    [isAr, clinic?.name]
  );

  // Only an admin can write settings. Anyone else lands on the dashboard.
  useEffect(() => {
    if (clinicId && !isAdmin) router.replace("/");
  }, [clinicId, isAdmin, router]);

  // What is already done, so a finished step is passed through instead of asked again.
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        const [info, svc, payers, bookingSnap] = await Promise.all([
          getDoc(getClinicDoc("settings", "clinic_info")),
          getDocs(query(getClinicCollection("services"), limit(1))),
          getDoc(getClinicDoc("settings", "payers")),
          getDoc(getClinicDoc("settings", "onlineBooking")),
        ]);
        if (cancelled) return;
        const data = (info.data() ?? {}) as Record<string, unknown>;
        setIsRerun(typeof data.setupWizardAt === "string");
        const insurers = parsePayers(payers.exists() ? payers.data() : null).filter((p) => p.id !== PRIVATE_PAYER_ID && p.active).length;
        setInsurerCount(insurers);
        // Insurers already on file answer the question for the clinic.
        if (insurers > 0) setTakesInsurance(true);
        const storedClockIn = clockInPinFrom(data);
        setPin(storedClockIn);
        setStoredPin(storedClockIn);
        const parsed = parseClinicSchedule(data);
        let slotDuration = DEFAULT_SCHEDULE.slotDuration;
        if (parsed.isConfigured) {
          setHoursDone(true);
          const stored = (data.schedule ?? {}) as Record<string, unknown>;
          const loaded = {
            start: typeof stored.start === "string" ? stored.start : DEFAULT_SCHEDULE.start,
            end: typeof stored.end === "string" ? stored.end : DEFAULT_SCHEDULE.end,
            slotDuration: String(stored.slotDuration ?? DEFAULT_SCHEDULE.slotDuration),
            offDays: Array.isArray(stored.offDays) ? stored.offDays.map(String) : [],
          };
          setSchedule(loaded);
          setStoredSchedule(JSON.stringify(loaded));
          slotDuration = loaded.slotDuration;
        }
        const bookingAnswers = bookingAnswersFrom(bookingSnap.exists() ? bookingSnap.data() : undefined, slotDuration);
        setBooking(bookingAnswers);
        setStoredBooking(bookingAnswers);
        // A page already live answers the question; one switched off is asked again.
        if (bookingAnswers.enabled) setBookingOn(true);
        setExistingServices(!svc.empty);
        // The template is only for an empty clinic; with services on file the list starts blank.
        if (!svc.empty) setChoices([]);
        if (typeof data.phone === "string") setPhone(data.phone);
        if (typeof data.address === "string") setAddress(data.address);
      } catch {
        // Unknown state reads as "not done"; the worst case is asking once more.
      } finally {
        if (!cancelled) setLoadingState(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  // The team, live: someone who opens an invite link while the owner is still here appears at once.
  useEffect(() => {
    if (!clinicId) return;
    return onSnapshot(
      getClinicCollection("staff"),
      (snap) => setTeam(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamMember)),
      () => {
        /* the list is a courtesy; adding people still works without it */
      }
    );
  }, [clinicId]);

  // `?step=whatsapp` opens the wizard on one step — the Settings button starts at the top, but a
  // link from the WhatsApp screen can land straight on the QR. `?back=` is where the top-bar button
  // was pressed, to return there at the end. Read once, from the URL, so the page needs no Suspense
  // boundary for useSearchParams.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("step");
    if (requested && (SETUP_STEPS as string[]).includes(requested)) setStep(requested as SetupStepId);
    setReturnTo(setupReturnPath(params.get("back")));
  }, []);

  const stepIndex = SETUP_STEPS.indexOf(step);
  const goNext = async () => {
    // The insurer editor may hold a half-typed insurer; leaving the step would drop it silently.
    if (!(await confirmLeave())) return;
    const next = SETUP_STEPS[stepIndex + 1];
    if (next) setStep(next);
    else void finish();
  };

  const finish = async () => {
    if (!(await confirmLeave())) return;
    try {
      await setDoc(getClinicDoc("settings", "clinic_info"), { setupWizardAt: new Date().toISOString() }, { merge: true });
    } catch {
      /* the stamp is informational */
    }
    welcome?.refresh();
    router.replace(isRerun ? returnTo ?? "/settings" : "/welcome");
  };

  const saveHours = async () => {
    setSaving(true);
    try {
      await setDoc(
        getClinicDoc("settings", "clinic_info"),
        { schedule: scheduleDocFrom(schedule), updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setHoursDone(true);
      setStoredSchedule(JSON.stringify(schedule));
      // A booking page not yet switched on follows the appointment length just chosen.
      if (bookingOn !== true) {
        const { defaultDurationMinutes } = bookingAnswersFrom(undefined, schedule.slotDuration);
        setBooking((b) => ({ ...b, defaultDurationMinutes }));
      }
      showToast(t.saved, "success");
      goNext();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveServices = async () => {
    const docs = serviceDocsFrom(choices, lang);
    if (docs.length === 0) return goNext();
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const col = getClinicCollection("services");
      for (const { englishName, doc: fields } of docs) {
        // Category and icon are keyword-matched from the ENGLISH name, whatever language the
        // stored name is in — the matcher only knows English keywords.
        const category = suggestCategory(englishName);
        const icon = suggestIcon(englishName) || categoryOf(category).icon;
        batch.set(doc(col), { ...fields, category, icon });
      }
      await batch.commit();
      setExistingServices(true);
      showToast(t.saved, "success");
      goNext();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveContact = async () => {
    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (phone.trim()) payload.phone = normalizePhone(phone);
    if (address.trim()) payload.address = address.trim();
    if (Object.keys(payload).length === 1) return goNext();
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", "clinic_info"), payload, { merge: true });
      showToast(t.saved, "success");
      goNext();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveLocation = async () => {
    const fields = clockInDocFrom(pin);
    if (!fields) return goNext();
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", "clinic_info"), { ...fields, updatedAt: new Date().toISOString() }, { merge: true });
      setStoredPin(pin);
      showToast(t.saved, "success");
      goNext();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveBooking = async () => {
    setSaving(true);
    try {
      const answers = { ...booking, enabled: bookingOn === true };
      await setDoc(getClinicDoc("settings", "onlineBooking"), bookingDocFrom(answers), { merge: true });
      setStoredBooking(answers);
      showToast(t.saved, "success");
      goNext();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const copyBookingLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(t.bookingCopied, "success");
    } catch {
      showToast(t.bookingCopyFailed, "error");
    }
  };

  const toggleDay = (day: string) =>
    setSchedule((s) => ({
      ...s,
      offDays: s.offDays.includes(day) ? s.offDays.filter((d) => d !== day) : [...s.offDays, day],
    }));

  const selectedCount = choices.filter((c) => c.selected).length;
  const hoursUnchanged = hoursDone && JSON.stringify(schedule) === storedSchedule;
  const isLast = stepIndex === SETUP_STEPS.length - 1;
  const clockInInPlan = isUnlocked(clinic, "attendance");
  const pinFields = clockInDocFrom(pin);
  const pinChanged = pinFields !== null && JSON.stringify(pinFields) !== JSON.stringify(clockInDocFrom(storedPin));
  const bookingInPlan = isUnlocked(clinic, "onlineBooking");
  const bookingChanged =
    JSON.stringify(bookingDocFrom({ ...booking, enabled: bookingOn === true })) !== JSON.stringify(bookingDocFrom(storedBooking));
  const dentistCount = team.filter(isDentistStaff).length;
  const bookingUrl = typeof window !== "undefined" && clinicId ? `${window.location.origin}/book/${clinicId}` : "";

  if (!clinicId || loadingState) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const inputCls =
    "w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12" dir={isAr ? "rtl" : "ltr"}>
      {/* The wizard's title moved into the layout's black band, so this card is now the step
          tracker alone — which is what a person here is actually watching. */}
      <PageHeader
        eyebrow={isRerun ? (isAr ? "إعداد سريع للعيادة" : "Quick clinic setup") : isAr ? "الإعداد الأول" : "First-time setup"}
        title={t.title}
        subtitle={t.sub}
      />

      <div className="rounded-[2rem] bg-ink-slab text-white p-6 sm:p-8 mb-6">
        {/* Nine labels do not fit a phone in one row: there, only the current step keeps its name
            and the rest are numbered dots. Every dot is a button — a step is optional, so jumping
            to it is too. */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-3 text-xs font-bold">
          {SETUP_STEPS.map((id, i) => {
            const done = i < stepIndex;
            const active = id === step;
            return (
              <li key={id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (id !== step && (await confirmLeave())) setStep(id);
                  }}
                  aria-current={active ? "step" : undefined}
                  aria-label={t.steps[id]}
                  title={t.steps[id]}
                  // A save in flight moves on by itself when it lands; a jump now would be undone by it.
                  disabled={saving}
                  className="flex items-center gap-2 disabled:cursor-wait"
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-figure text-[11px] ${
                      active ? "bg-white text-slate-900" : done ? "bg-emerald-400 text-slate-900" : "bg-white/15 text-white/60"
                    }`}
                  >
                    {done ? <Check size={13} /> : i + 1}
                  </span>
                  <span className={active ? "text-white" : "hidden lg:inline text-white/50 hover:text-white/80"}>{t.steps[id]}</span>
                </button>
                {i < SETUP_STEPS.length - 1 && <ChevronRight size={14} className={`text-white/30 ${isAr ? "rotate-180" : ""}`} />}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="bg-surface rounded-[2rem] border border-line shadow-sm p-6 sm:p-8">
        {/* ---------- Step 1: contact ---------- */}
        {step === "contact" && (
          <div className="space-y-6">
            <StepHeading icon={<Phone size={20} />} title={t.steps.contact} why={t.contactWhy} />
            <label className="block">
              <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.phone}</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" dir="ltr" className={inputCls} autoComplete="tel" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.address}</span>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} autoComplete="street-address" />
            </label>
            <Footer primary={t.saveNext} onPrimary={saveContact} onSkip={goNext} skipLabel={t.skip} saving={saving} />
          </div>
        )}

        {/* ---------- Step 2: clinic location (for clock-in) ---------- */}
        {step === "location" && (
          <div className="space-y-6">
            <StepHeading icon={<MapPin size={20} />} title={t.steps.location} why={t.locationWhy} />
            {!clockInInPlan ? (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-3">
                  <Lock size={15} className="text-ink-muted" /> {t.locationLocked}
                  <a href={`https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="underline" dir="ltr">
                    {SUPPORT_WHATSAPP}
                  </a>
                </p>
                <Footer primary={t.next} onPrimary={() => void goNext()} saving={false} />
              </>
            ) : (
              <>
                <ClockInLocationStep pin={pin} stored={storedPin} onChange={setPin} />
                <Footer
                  primary={pinChanged ? t.saveNext : t.next}
                  onPrimary={pinChanged && !saving ? saveLocation : () => void goNext()}
                  onSkip={pinFields === null ? goNext : undefined}
                  skipLabel={t.locationLater}
                  saving={saving}
                />
              </>
            )}
          </div>
        )}

        {/* ---------- Step 3: hours ---------- */}
        {step === "hours" && (
          <div className="space-y-6">
            <StepHeading icon={<Clock size={20} />} title={t.steps.hours} why={t.hoursWhy} />
            {hoursDone && <Notice text={t.hoursAlready} />}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="block">
                <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.open}</span>
                <input type="time" value={schedule.start} onChange={(e) => setSchedule((s) => ({ ...s, start: e.target.value }))} className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.close}</span>
                <input type="time" value={schedule.end} onChange={(e) => setSchedule((s) => ({ ...s, end: e.target.value }))} className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.slot}</span>
                <select value={schedule.slotDuration} onChange={(e) => setSchedule((s) => ({ ...s, slotDuration: e.target.value }))} className={inputCls}>
                  {["15", "20", "30", "45", "60"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.closedDays}</span>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map((day) => {
                  const off = schedule.offDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-pressed={off}
                      className={`px-3.5 py-2 rounded-xl text-sm font-bold border transition-colors ${
                        off ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-surface-subtle border-line text-ink-body hover:border-line-strong"
                      }`}
                    >
                      {t.dayNames[day]}
                    </button>
                  );
                })}
              </div>
            </div>
            <Footer
              primary={hoursUnchanged ? t.next : t.saveNext}
              onPrimary={hoursUnchanged && !saving ? goNext : saveHours}
              onSkip={goNext}
              skipLabel={t.skip}
              saving={saving}
            />
          </div>
        )}

        {/* ---------- Step 4: services ---------- */}
        {step === "services" && (
          <div className="space-y-6">
            <StepHeading icon={<ListChecks size={20} />} title={t.steps.services} why={t.servicesWhy} />
            {/* A clinic that already has services is not offered the template again — but the
                list below still takes rows, so a re-run can add what the clinic is missing
                without a trip to the Prices screen. */}
            {existingServices && <Notice text={t.servicesAlready} />}
            {!existingServices && (
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-ink-muted">
                  {isAr ? `${selectedCount} من ${choices.length} محددة` : `${selectedCount} of ${choices.length} selected`}
                </span>
                <span className="flex gap-3">
                  <button type="button" className="text-accent hover:underline" onClick={() => setChoices((c) => c.map((x) => ({ ...x, selected: true })))}>{t.selectAll}</button>
                  <button type="button" className="text-ink-muted hover:underline" onClick={() => setChoices((c) => c.map((x) => ({ ...x, selected: false })))}>{t.selectNone}</button>
                </span>
              </div>
            )}
            {/* Every name is a box, not a label: a clinic that calls a scaling a "cleaning"
                should not have to save the template and rename it on the Prices screen. A
                template row's box is empty until edited and shows the template name as its
                placeholder, so clearing it puts the default back rather than saving a blank.
                Rows the clinic adds have no default, and a bin beside the price. */}
            {choices.length > 0 && (
              <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden max-h-[46vh] overflow-y-auto">
                {choices.map((choice) => {
                  const tpl = choice.custom ? undefined : SERVICE_TEMPLATES.find((x) => x.key === choice.key);
                  const shownName = (choice.name ?? "").trim() || tpl?.name[lang] || t.serviceName;
                  const update = (patch: Partial<ServiceChoice>) =>
                    setChoices((c) => c.map((x) => (x.key === choice.key ? { ...x, ...patch } : x)));
                  return (
                    <li key={choice.key} className={`flex items-center gap-3 px-3 sm:px-4 py-2 ${choice.selected ? "" : "opacity-50"}`}>
                      <input
                        type="checkbox"
                        checked={choice.selected}
                        onChange={(e) => update({ selected: e.target.checked })}
                        className="w-4 h-4 accent-slate-900 shrink-0"
                        aria-label={shownName}
                      />
                      <span className="flex-1 min-w-0 flex items-center gap-2">
                        <input
                          type="text"
                          value={choice.name ?? ""}
                          placeholder={tpl ? tpl.name[lang] : t.serviceName}
                          onChange={(e) => update({ name: e.target.value })}
                          className={`flex-1 min-w-0 px-2 py-1.5 -mx-2 bg-transparent border border-transparent rounded-lg text-sm font-semibold text-ink outline-none transition-colors truncate hover:border-line focus:bg-surface-subtle focus:border-accent-soft ${
                            tpl ? "placeholder:text-ink placeholder:font-semibold" : "placeholder:text-ink-faint placeholder:font-medium"
                          }`}
                          aria-label={t.serviceName}
                          autoFocus={choice.custom && !(choice.name ?? "").trim()}
                        />
                        {tpl?.requiresLab && <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 shrink-0">{t.lab}</span>}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={choice.price}
                          onChange={(e) => update({ price: Number(e.target.value) })}
                          className="w-20 sm:w-24 px-2 py-1.5 bg-surface-subtle border border-line rounded-lg font-figure font-bold text-ink text-end outline-none focus:border-accent-soft"
                          aria-label={`${shownName} ${t.egp}`}
                        />
                        <span className="text-xs font-bold text-ink-muted w-8">{t.egp}</span>
                        {choice.custom && (
                          <button
                            type="button"
                            onClick={() => setChoices((c) => c.filter((x) => x.key !== choice.key))}
                            aria-label={`${t.remove} ${shownName}`}
                            title={t.remove}
                            className="w-8 h-8 -me-1 grid place-items-center rounded-lg text-ink-faint hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setChoices((c) => [...c, customServiceChoice(c)])}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-accent-ink hover:underline"
            >
              <Plus size={15} /> {t.addService}
            </button>
            <Footer
              primary={selectedCount > 0 ? t.saveNext : t.next}
              onPrimary={saveServices}
              onSkip={goNext}
              skipLabel={t.skip}
              saving={saving}
            />
          </div>
        )}

        {/* ---------- Step 5: online booking ---------- */}
        {step === "booking" && (
          <div className="space-y-6">
            <StepHeading icon={<Globe size={20} />} title={t.steps.booking} why={t.bookingWhy} />
            {!bookingInPlan ? (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-3">
                  <Lock size={15} className="text-ink-muted" /> {t.bookingLocked}
                  <a href={`https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="underline" dir="ltr">
                    {SUPPORT_WHATSAPP}
                  </a>
                </p>
                <Footer primary={t.next} onPrimary={() => void goNext()} saving={false} />
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <p className="text-base font-black text-ink">{t.bookingAsk}</p>
                  <div className="grid grid-cols-2 gap-3 max-w-sm">
                    {([true, false] as const).map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        aria-pressed={bookingOn === v}
                        onClick={() => {
                          setBookingOn(v);
                          // "No" to a page that was never on is a complete answer; "No" to a live
                          // one switches it off, which waits for the Save below.
                          if (!v && !storedBooking.enabled) void goNext();
                        }}
                        className={`rounded-xl border px-4 py-3.5 text-base font-black transition-colors ${
                          bookingOn === v ? "border-accent bg-accent/5 ring-1 ring-accent text-ink" : "border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
                        }`}
                      >
                        {v ? t.yes : t.no}
                      </button>
                    ))}
                  </div>
                  {bookingOn === false && (
                    <p className="text-sm font-medium text-ink-muted">{storedBooking.enabled ? t.bookingOff : t.bookingNo}</p>
                  )}
                </div>

                {bookingOn === true && (
                  <div className="space-y-5">
                    <div className="rounded-2xl bg-ink-slab text-white px-5 py-4 space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">{t.bookingLink}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="min-w-0 break-all font-figure text-[13px] text-white/85 select-all" dir="ltr">{bookingUrl}</code>
                        <button
                          type="button"
                          onClick={() => void copyBookingLink(bookingUrl)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white/80 hover:bg-white/20 hover:text-white"
                        >
                          <Copy size={13} /> {t.bookingCopy}
                        </button>
                        {/* The page answers "not found" until the switch is saved, so it is only
                            offered once it is live. */}
                        {storedBooking.enabled && (
                          <a
                            href={bookingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white/80 hover:bg-white/20 hover:text-white"
                          >
                            <ExternalLink size={13} /> {t.bookingOpen}
                          </a>
                        )}
                      </div>
                      <p className="text-xs font-medium text-white/60">{t.bookingShare}</p>
                    </div>

                    <div className="rounded-2xl border border-line divide-y divide-line">
                      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-ink">{t.bookingDoctor}</p>
                          <p className="text-xs font-medium text-ink-muted mt-0.5 leading-relaxed">{t.bookingDoctorHint(dentistCount)}</p>
                        </div>
                        <Toggle
                          checked={booking.enableDoctorSelection}
                          onChange={(next) => setBooking((b) => ({ ...b, enableDoctorSelection: next }))}
                          label={t.bookingDoctor}
                        />
                      </div>
                      <label className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3.5">
                        <span className="text-sm font-black text-ink">{t.bookingLength}</span>
                        <select
                          value={booking.defaultDurationMinutes}
                          onChange={(e) => setBooking((b) => ({ ...b, defaultDurationMinutes: e.target.value }))}
                          className="sm:w-40 px-3 py-2 bg-surface-subtle border border-line rounded-xl font-bold text-ink outline-none focus:border-accent-soft"
                        >
                          {BOOKING_DURATIONS.map((m) => (
                            <option key={m} value={m}>{m} {t.minutes}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="text-xs font-medium text-ink-muted">{t.bookingMore}</p>
                  </div>
                )}

                <Footer
                  primary={bookingChanged ? t.saveNext : t.next}
                  onPrimary={bookingChanged && !saving ? saveBooking : () => void goNext()}
                  onSkip={bookingOn === null ? goNext : undefined}
                  skipLabel={t.skip}
                  saving={saving}
                />
              </>
            )}
          </div>
        )}

        {/* ---------- Step 6: team ---------- */}
        {step === "team" && (
          <div className="space-y-6">
            <StepHeading icon={<Users size={20} />} title={t.steps.team} why={t.teamWhy} />
            <TeamStep team={team} />
            <Footer
              primary={t.next}
              onPrimary={() => void goNext()}
              onSkip={team.length <= 1 ? goNext : undefined}
              skipLabel={t.teamLater}
              saving={false}
            />
          </div>
        )}

        {/* ---------- Step 7: insurance ---------- */}
        {step === "insurance" && (
          <div className="space-y-6">
            <StepHeading icon={<ShieldPlus size={20} />} title={t.steps.insurance} why={t.insuranceWhy} />
            {/* Once "Yes" opens the editor the question goes away: a "No" pressed then would unmount
                the editor, and a half-typed insurer with it, before anything could ask. */}
            {insurerCount === 0 && takesInsurance !== true && (
              <div className="space-y-3">
                <p className="text-base font-black text-ink">{t.insuranceAsk}</p>
                <div className="grid grid-cols-2 gap-3 max-w-sm">
                  {([true, false] as const).map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      aria-pressed={takesInsurance === v}
                      onClick={() => {
                        setTakesInsurance(v);
                        // "No" is a complete answer; there is nothing else on this step to do.
                        if (!v) void goNext();
                      }}
                      className={`rounded-xl border px-4 py-3.5 text-base font-black transition-colors ${
                        takesInsurance === v ? "border-accent bg-accent/5 ring-1 ring-accent text-ink" : "border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
                      }`}
                    >
                      {v ? t.yes : t.no}
                    </button>
                  ))}
                </div>
                {takesInsurance === false && <p className="text-sm font-medium text-ink-muted">{t.insuranceNo}</p>}
              </div>
            )}
            {takesInsurance === true && (
              <>
                <Notice text={insurerCount > 0 ? t.insuranceAlready(insurerCount) : t.insuranceHowTo} tone={insurerCount > 0 ? "done" : "info"} />
                <div className="rounded-2xl border border-line p-4 sm:p-6">
                  <PayersSettings canEdit />
                </div>
              </>
            )}
            <Footer primary={t.next} onPrimary={() => void goNext()} onSkip={takesInsurance === null ? goNext : undefined} skipLabel={t.skip} saving={false} />
          </div>
        )}

        {/* ---------- Step 8: connect WhatsApp ---------- */}
        {step === "whatsapp" && (
          <div className="space-y-6">
            <StepHeading icon={<MessageCircle size={20} />} title={t.steps.whatsapp} why={t.whatsappWhy} />
            <WhatsAppConnectStep onConnectedChange={setWaConnected} />
            <Footer
              primary={t.next}
              onPrimary={() => void goNext()}
              onSkip={waConnected ? undefined : goNext}
              skipLabel={t.whatsappLater}
              saving={false}
            />
          </div>
        )}

        {/* ---------- Step 9: what WhatsApp does ---------- */}
        {step === "assistant" && (
          <div className="space-y-6">
            <StepHeading icon={<Bot size={20} />} title={t.steps.assistant} why={t.assistantWhy} />
            <WhatsAppQuestionsStep onDone={() => void finish()} onSkip={() => void finish()} />
          </div>
        )}
      </div>

      {!isLast && (
        <div className="mt-4 text-center">
          <button type="button" onClick={finish} className="text-xs font-bold text-ink-muted hover:text-ink inline-flex items-center gap-1.5">
            <Sparkles size={13} /> {t.skipAll}
          </button>
        </div>
      )}
    </div>
  );
}

function StepHeading({ icon, title, why }: { icon: React.ReactNode; title: string; why: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-accent-tint text-accent flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <h2 className="text-lg font-black text-ink">{title}</h2>
        <p className="text-sm font-medium text-ink-muted mt-0.5">{why}</p>
      </div>
    </div>
  );
}

/** An on/off switch whose knob slides toward the reading direction's end, in both languages. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-surface-muted"}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-surface shadow-md transition-all ${checked ? "start-7" : "start-1"}`} />
    </button>
  );
}

function Notice({ text, tone = "done" }: { text: string; tone?: "done" | "info" }) {
  if (tone === "info") {
    return <p className="text-sm font-semibold text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-3 leading-relaxed">{text}</p>;
  }
  return (
    <p className="flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
      <Check size={16} className="shrink-0" /> {text}
    </p>
  );
}

function Footer({
  primary,
  onPrimary,
  onSkip,
  skipLabel,
  saving,
}: {
  primary: string;
  onPrimary: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
      {onSkip ? (
        <button type="button" onClick={onSkip} disabled={saving} className="text-sm font-bold text-ink-muted hover:text-ink disabled:opacity-50">
          {skipLabel}
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onPrimary}
        disabled={saving}
        className="bg-accent hover:bg-accent-strong text-ink font-black py-3 px-6 rounded-xl transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
        {primary}
      </button>
    </div>
  );
}
