"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDoc, getDocs, limit, query, setDoc, writeBatch, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Check, ChevronRight, Clock, Loader2, ListChecks, Phone, Sparkles } from "lucide-react";
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

/**
 * The two-minute setup a new clinic lands on right after it is created.
 *
 * Three screens, each one fact the rest of the app needs on day one: opening hours (so the
 * calendar stops offering times you are closed), a starting price list (so the first invoice has
 * something to pick from), and the clinic's phone and address (so prescriptions print with them).
 * Every step can be skipped; nothing here is a gate. Steps already done — by this wizard, or by
 * someone who went straight to Settings — are shown as done and passed through.
 *
 * Writes exactly what the Settings screens write, to the same documents, so this is a second
 * door into the same records and not a parallel copy of them.
 */
export default function SetupWizardPage() {
  const router = useRouter();
  const { clinicId, clinic, isAdmin } = useClinic();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const welcome = useWelcomeOptional();
  const isAr = language === "ar";
  const lang: "en" | "ar" = isAr ? "ar" : "en";

  const [step, setStep] = useState<SetupStepId>("hours");
  const [loadingState, setLoadingState] = useState(true);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [schedule, setSchedule] = useState({ ...DEFAULT_SCHEDULE, offDays: [...DEFAULT_SCHEDULE.offDays] });
  const [hoursDone, setHoursDone] = useState(false);
  // Step 2
  const [choices, setChoices] = useState<ServiceChoice[]>(initialServiceChoices);
  const [existingServices, setExistingServices] = useState(false);
  // Step 3
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  const t = useMemo(
    () => ({
      title: isAr ? `يلا نجهّز ${clinic?.name || "العيادة"}` : `Let's set up ${clinic?.name || "your clinic"}`,
      sub: isAr
        ? "٣ خطوات، حوالي دقيقتين. تقدر تعدّي أي خطوة وترجعلها بعدين من الإعدادات."
        : "Three steps, about two minutes. Skip any of them and come back later from Settings.",
      steps: {
        hours: isAr ? "مواعيد العمل" : "Working hours",
        services: isAr ? "قائمة الأسعار" : "Price list",
        contact: isAr ? "بيانات العيادة" : "Clinic details",
      } as Record<SetupStepId, string>,
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
        const [info, svc] = await Promise.all([
          getDoc(getClinicDoc("settings", "clinic_info")),
          getDocs(query(getClinicCollection("services"), limit(1))),
        ]);
        if (cancelled) return;
        const data = (info.data() ?? {}) as Record<string, unknown>;
        const parsed = parseClinicSchedule(data);
        if (parsed.isConfigured) {
          setHoursDone(true);
          const stored = (data.schedule ?? {}) as Record<string, unknown>;
          setSchedule({
            start: typeof stored.start === "string" ? stored.start : DEFAULT_SCHEDULE.start,
            end: typeof stored.end === "string" ? stored.end : DEFAULT_SCHEDULE.end,
            slotDuration: String(stored.slotDuration ?? DEFAULT_SCHEDULE.slotDuration),
            offDays: Array.isArray(stored.offDays) ? stored.offDays.map(String) : [],
          });
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

  const stepIndex = SETUP_STEPS.indexOf(step);
  const goNext = () => {
    const next = SETUP_STEPS[stepIndex + 1];
    if (next) setStep(next);
    else finish();
  };

  const finish = async () => {
    try {
      await setDoc(getClinicDoc("settings", "clinic_info"), { setupWizardAt: new Date().toISOString() }, { merge: true });
    } catch {
      /* the stamp is informational */
    }
    welcome?.refresh();
    router.replace("/welcome");
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
      {/* Header */}
      <div className="rounded-[2rem] bg-slate-900 text-white p-6 sm:p-8 mb-6">
        <p className="font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45 mb-2">
          {isAr ? "الإعداد الأول" : "First-time setup"}
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight">{t.title}</h1>
        <p className="mt-2 text-[13px] font-medium text-white/60 max-w-lg">{t.sub}</p>

        <ol className="mt-6 flex items-center gap-2 text-xs font-bold">
          {SETUP_STEPS.map((id, i) => {
            const done = i < stepIndex;
            const active = id === step;
            return (
              <li key={id} className="flex items-center gap-2">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-figure text-[11px] ${
                    active ? "bg-white text-slate-900" : done ? "bg-emerald-400 text-slate-900" : "bg-white/15 text-white/60"
                  }`}
                >
                  {done ? <Check size={13} /> : i + 1}
                </span>
                <span className={active ? "text-white" : "text-white/50"}>{t.steps[id]}</span>
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
              primary={hoursDone ? t.next : t.saveNext}
              onPrimary={hoursDone && !saving ? goNext : saveHours}
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
            <Footer primary={t.finish} onPrimary={saveContact} onSkip={finish} skipLabel={t.skip} saving={saving} />
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

function Notice({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
      <Check size={16} /> {text}
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
        className="bg-accent hover:bg-accent-strong text-white font-black py-3 px-6 rounded-xl transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
        {primary}
      </button>
    </div>
  );
}
