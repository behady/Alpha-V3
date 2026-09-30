"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDoc, getDocs, limit, query, setDoc, writeBatch, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import dynamic from "next/dynamic";
import { Bot, Check, ChevronRight, Clock, Loader2, ListChecks, MessageCircle, Phone, ShieldPlus, Sparkles } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useWelcomeOptional } from "@/context/WelcomeContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { parseClinicSchedule } from "@/lib/clinicSchedule";
import { categoryOf, suggestCategory, suggestIcon } from "@/lib/dentalIcons";
import {
  DEFAULT_SCHEDULE,
  SERVICE_TEMPLATES,
  SETUP_STEPS,
  WEEK_DAYS,
  initialServiceChoices,
  normalizePhone,
  scheduleDocFrom,
  serviceDocsFrom,
  type ServiceChoice,
  type SetupStepId,
} from "@/lib/setupWizard";
import PageHeader from "@/components/dashboard/PageHeader";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/context/UnsavedChangesContext";
import { PRIVATE_PAYER_ID, parsePayers } from "@/lib/payers";
import WhatsAppConnectStep from "@/components/setup/WhatsAppConnectStep";
import WhatsAppQuestionsStep from "@/components/setup/WhatsAppQuestionsStep";

// The insurer editor is the Settings screen itself, loaded only when the clinic says it has insurers.
const PayersSettings = dynamic(() => import("@/components/settings/PayersSettings"), {
  loading: () => <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" aria-hidden />,
});

/**
 * The clinic setup a new clinic lands on right after it is created — and that any admin can run
 * again from the "Quick clinic setup" button in Settings.
 *
 * Six screens. The first three are the facts the rest of the app needs on day one: opening hours
 * (so the calendar stops offering times you are closed), a starting price list (so the first
 * invoice has something to pick from), and the clinic's phone and address (so prescriptions print
 * with them). The last three make the clinic reachable: which insurers it works with, linking its
 * WhatsApp number by QR, and what that WhatsApp should do — asked as plain questions.
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

  const [step, setStep] = useState<SetupStepId>("hours");
  const [loadingState, setLoadingState] = useState(true);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [schedule, setSchedule] = useState({ ...DEFAULT_SCHEDULE, offDays: [...DEFAULT_SCHEDULE.offDays] });
  const [hoursDone, setHoursDone] = useState(false);
  /**
   * The hours as stored, to tell "already set" from "already set and just edited". Before the
   * Settings button existed nobody came back here, so a done step could simply say "Next"; on a
   * re-run that button quietly dropped whatever the admin had just changed.
   */
  const [storedSchedule, setStoredSchedule] = useState("");
  // Step 2
  const [choices, setChoices] = useState<ServiceChoice[]>(initialServiceChoices);
  const [existingServices, setExistingServices] = useState(false);
  // Step 3
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  // Step 4
  const [insurerCount, setInsurerCount] = useState(0);
  const [takesInsurance, setTakesInsurance] = useState<boolean | null>(null);
  // Step 5
  const [waConnected, setWaConnected] = useState(false);
  /** Run before: finishing returns to Settings instead of to the new-clinic welcome guide. */
  const [isRerun, setIsRerun] = useState(false);

  const t = useMemo(
    () => ({
      title: isAr ? `يلا نجهّز ${clinic?.name || "العيادة"}` : `Let's set up ${clinic?.name || "your clinic"}`,
      sub: isAr
        ? "٦ خطوات، حوالي ٥ دقايق. تقدر تعدّي أي خطوة وترجعلها بعدين من الإعدادات."
        : "Six steps, about five minutes. Skip any of them and come back later from Settings.",
      steps: {
        hours: isAr ? "مواعيد العمل" : "Working hours",
        services: isAr ? "قائمة الأسعار" : "Price list",
        contact: isAr ? "بيانات العيادة" : "Clinic details",
        insurance: isAr ? "التأمين" : "Insurance",
        whatsapp: isAr ? "ربط واتساب" : "Connect WhatsApp",
        assistant: isAr ? "مهام واتساب" : "WhatsApp tasks",
      } as Record<SetupStepId, string>,
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
        ? "عندك خدمات بالفعل، فمش هنضيف قائمة جاهزة فوقها."
        : "You already have services, so we won't add a template on top of them.",
      selectAll: isAr ? "تحديد الكل" : "Select all",
      selectNone: isAr ? "إلغاء الكل" : "Clear all",
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
        const [info, svc, payers] = await Promise.all([
          getDoc(getClinicDoc("settings", "clinic_info")),
          getDocs(query(getClinicCollection("services"), limit(1))),
          getDoc(getClinicDoc("settings", "payers")),
        ]);
        if (cancelled) return;
        const data = (info.data() ?? {}) as Record<string, unknown>;
        setIsRerun(typeof data.setupWizardAt === "string");
        const insurers = parsePayers(payers.exists() ? payers.data() : null).filter((p) => p.id !== PRIVATE_PAYER_ID && p.active).length;
        setInsurerCount(insurers);
        // Insurers already on file answer the question for the clinic.
        if (insurers > 0) setTakesInsurance(true);
        const parsed = parseClinicSchedule(data);
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
        }
        setExistingServices(!svc.empty);
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

  // `?step=whatsapp` opens the wizard on one step — the Settings button starts at the top, but a
  // link from the WhatsApp screen can land straight on the QR. Read once, from the URL, so the
  // page needs no Suspense boundary for useSearchParams.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("step");
    if (requested && (SETUP_STEPS as string[]).includes(requested)) setStep(requested as SetupStepId);
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
    router.replace(isRerun ? "/settings" : "/welcome");
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

  const toggleDay = (day: string) =>
    setSchedule((s) => ({
      ...s,
      offDays: s.offDays.includes(day) ? s.offDays.filter((d) => d !== day) : [...s.offDays, day],
    }));

  const selectedCount = choices.filter((c) => c.selected).length;
  const hoursUnchanged = hoursDone && JSON.stringify(schedule) === storedSchedule;
  const isLast = stepIndex === SETUP_STEPS.length - 1;

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
        {/* Six labels do not fit a phone in one row: there, only the current step keeps its name
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
        {/* ---------- Step 1: hours ---------- */}
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

        {/* ---------- Step 2: services ---------- */}
        {step === "services" && (
          <div className="space-y-6">
            <StepHeading icon={<ListChecks size={20} />} title={t.steps.services} why={t.servicesWhy} />
            {existingServices ? (
              <>
                <Notice text={t.servicesAlready} />
                <Footer primary={t.next} onPrimary={goNext} saving={false} />
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-ink-muted">
                    {isAr ? `${selectedCount} من ${SERVICE_TEMPLATES.length} محددة` : `${selectedCount} of ${SERVICE_TEMPLATES.length} selected`}
                  </span>
                  <span className="flex gap-3">
                    <button type="button" className="text-accent hover:underline" onClick={() => setChoices((c) => c.map((x) => ({ ...x, selected: true })))}>{t.selectAll}</button>
                    <button type="button" className="text-ink-muted hover:underline" onClick={() => setChoices((c) => c.map((x) => ({ ...x, selected: false })))}>{t.selectNone}</button>
                  </span>
                </div>
                <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden max-h-[46vh] overflow-y-auto">
                  {SERVICE_TEMPLATES.map((tpl) => {
                    const choice = choices.find((c) => c.key === tpl.key)!;
                    return (
                      <li key={tpl.key} className={`flex items-center gap-3 px-4 py-2.5 ${choice.selected ? "" : "opacity-50"}`}>
                        <input
                          type="checkbox"
                          checked={choice.selected}
                          onChange={(e) => setChoices((c) => c.map((x) => (x.key === tpl.key ? { ...x, selected: e.target.checked } : x)))}
                          className="w-4 h-4 accent-slate-900"
                          aria-label={tpl.name[lang]}
                        />
                        <span className="flex-1 min-w-0 text-sm font-semibold text-ink truncate">
                          {tpl.name[lang]}
                          {tpl.requiresLab && <span className="ms-2 text-[10px] font-black uppercase tracking-wider text-amber-600">{t.lab}</span>}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={choice.price}
                            onChange={(e) => setChoices((c) => c.map((x) => (x.key === tpl.key ? { ...x, price: Number(e.target.value) } : x)))}
                            className="w-24 px-2 py-1.5 bg-surface-subtle border border-line rounded-lg font-figure font-bold text-ink text-end outline-none focus:border-accent-soft"
                            aria-label={`${tpl.name[lang]} ${t.egp}`}
                          />
                          <span className="text-xs font-bold text-ink-muted w-8">{t.egp}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Footer
                  primary={selectedCount > 0 ? t.saveNext : t.next}
                  onPrimary={saveServices}
                  onSkip={goNext}
                  skipLabel={t.skip}
                  saving={saving}
                />
              </>
            )}
          </div>
        )}

        {/* ---------- Step 3: contact ---------- */}
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

        {/* ---------- Step 4: insurance ---------- */}
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

        {/* ---------- Step 5: connect WhatsApp ---------- */}
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

        {/* ---------- Step 6: what WhatsApp does ---------- */}
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
