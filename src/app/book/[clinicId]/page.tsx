"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  Phone,
  CheckCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Stethoscope,
} from "lucide-react";

/**
 * Public booking page — the only screen in this system a patient sees.
 *
 * It talks to /api/public/* rather than to Firestore. The previous version read the database
 * straight from the browser, which the security rules deny to anyone without a clinic role, so
 * every genuine visitor got "problem loading clinic data". It looked fine in testing only because
 * the person testing it was already signed in to the clinic.
 *
 * The "my records" half of this page has been removed. It asked for a phone number and then showed
 * that person's appointment history and outstanding balance — no code, no verification, nothing.
 * A phone number is not a password: anyone who knows one, or who works through a range of them,
 * could read a stranger's dental debt. Under Law 151/2020 health data is sensitive personal data,
 * and this was the kind of thing that ends a clinic's trust in a supplier permanently.
 *
 * Bringing it back needs an actual identity check — send a one-time code over WhatsApp to the
 * number, verify it, and only then show that patient's own records. Until that exists, the page
 * does the one thing it can do safely: take a booking request.
 *
 * Layout note: step one is a month calendar rather than a native date box, so the patient can see
 * the clinic's week before committing to a day. The grid is drawn only from what the public clinic
 * route already returns — today's date and the weekly off-days. It deliberately does NOT know
 * which days are fully booked: answering that would mean probing the calendar day by day, which
 * tells a stranger how busy the clinic is. A day that looks open may still come back with no free
 * times, and the list underneath says so.
 */

type ClinicProfile = {
  clinicName: string;
  enableDoctorSelection: boolean;
  defaultDurationMinutes: number;
  reasons: string[];
  doctors: string[];
  branches: { id: string; name: string; address: string }[];
  offDays: string[];
  scheduleConfigured: boolean;
};

const toArDigits = (val: string | number): string => {
  const arabicNumbers = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(val).replace(/[0-9]/g, (w) => arabicNumbers[Number(w)]);
};

/** Slots arrive as the stored `hh:mm AM/PM`. Shown to the patient in Arabic. */
function formatSlotAr(timeKey: string): string {
  const m = timeKey.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!m) return timeKey;
  const suffix = m[3].toUpperCase() === "PM" ? "م" : "ص";
  return `${toArDigits(String(Number(m[1])))}:${toArDigits(m[2])} ${suffix}`;
}

/* ── Calendar helpers ──────────────────────────────────────────────────────────────────────── */

/**
 * Index 0 is Sunday, matching Date#getDay() and the lowercase names the clinic profile stores in
 * `offDays`. Reordering this silently shifts which days are treated as closed.
 */
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_LABELS_AR = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/**
 * `2026-09-12` for a Date, built from its local parts.
 *
 * toISOString() would be wrong here: it converts to UTC first, so a late-evening date in Egypt
 * comes back as the day before and the patient books the wrong day.
 */
function dateKeyOf(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** A human date for the summary lines: "السبت ١٢ سبتمبر". */
function formatDateAr(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return toArDigits(dateKey);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(d.getTime())) return toArDigits(dateKey);
  return `${DAY_LABELS_AR[d.getDay()]} ${toArDigits(d.getDate())} ${MONTHS_AR[d.getMonth()]}`;
}

type MonthCalendarProps = {
  value: string;
  onChange: (dateKey: string) => void;
  offDays: string[];
  minKey: string;
  maxKey: string;
  disabled?: boolean;
};

/**
 * A month grid the patient can see and step through, in place of the browser's native date box.
 *
 * The page is RTL, so the seven-column grid fills from the right on its own — Sunday lands on the
 * right-hand edge, which is where an Arabic reader looks first. No per-cell direction handling is
 * needed, and adding any would break it.
 */
function MonthCalendar({ value, onChange, offDays, minKey, maxKey, disabled = false }: MonthCalendarProps) {
  /**
   * Which month is on screen. Opened on the selected day's month, or on today's when nothing is
   * selected yet.
   *
   * There is no effect keeping this in step with `value`, and none is needed: the only way to
   * select a day is to click one of the cells drawn here, so the selection can never be in a month
   * this grid is not already showing. Stepping back from the details form remounts the component,
   * which re-runs this initialiser against the day already chosen.
   */
  const [view, setView] = useState(() => {
    const [y, m] = (value || minKey).split("-").map(Number);
    return new Date(y, (m || 1) - 1, 1);
  });

  const year = view.getFullYear();
  const month = view.getMonth();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthStartKey = dateKeyOf(new Date(year, month, 1));
  const monthEndKey = dateKeyOf(new Date(year, month, daysInMonth));
  const canGoBack = monthStartKey > minKey;
  const canGoForward = monthEndKey < maxKey;

  const offSet = useMemo(() => new Set((offDays || []).map((d) => String(d).toLowerCase())), [offDays]);

  const cells: Array<{ key: string; day: number; unavailable: boolean } | null> = [];
  for (let i = 0; i < leadingBlanks; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const d = new Date(year, month, day);
    const key = dateKeyOf(d);
    cells.push({
      key,
      day,
      unavailable: offSet.has(DAY_KEYS[d.getDay()]) || key < minKey || key > maxKey,
    });
  }

  return (
    <div className={disabled ? "opacity-50 pointer-events-none" : ""}>
      <div className="flex items-center justify-between mb-3">
        {/* RTL: "next" sits on the left, the direction reading travels. */}
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          disabled={!canGoForward}
          aria-label="الشهر اللي بعده"
          className="w-9 h-9 rounded-lg border border-line text-ink-body flex items-center justify-center disabled:opacity-30 hover:border-accent transition-colors"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="font-black text-ink text-base">
          {MONTHS_AR[month]} {toArDigits(year)}
        </div>

        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          disabled={!canGoBack}
          aria-label="الشهر اللي قبله"
          className="w-9 h-9 rounded-lg border border-line text-ink-body flex items-center justify-center disabled:opacity-30 hover:border-accent transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_LABELS_AR.map((label) => (
          <div key={label} className="text-center text-[11px] font-bold text-ink-muted py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, index) => {
          if (!cell) return <div key={`blank-${index}`} />;
          const selected = cell.key === value;
          return (
            <button
              key={cell.key}
              type="button"
              disabled={cell.unavailable}
              onClick={() => onChange(cell.key)}
              aria-label={formatDateAr(cell.key)}
              aria-pressed={selected}
              className={`aspect-square rounded-lg text-sm font-bold flex items-center justify-center border transition-all ${
                selected
                  ? "bg-accent text-ink-on-accent border-accent shadow-sm"
                  : cell.unavailable
                    ? "bg-surface-subtle text-ink-faint/50 border-transparent cursor-not-allowed"
                    : "bg-surface text-ink-strong border-line hover:border-accent hover:bg-accent-tint"
              }`}
            >
              {toArDigits(cell.day)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────────────────────── */

export default function OnlineBookingPage() {
  const params = useParams();
  const clinicId = (Array.isArray(params.clinicId) ? params.clinicId[0] : params.clinicId) as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const [clinic, setClinic] = useState<ClinicProfile | null>(null);

  // ?src=meta / ?src=google … — which channel this visitor came through. Read once from the URL
  // (not useSearchParams, which would force a Suspense boundary) and passed along with the
  // booking so the clinic's source report attributes it without anyone typing anything.
  const [sourceTag, setSourceTag] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("src") || "";
    setSourceTag(raw.slice(0, 40));
  }, []);

  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [reason, setReason] = useState("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [closedThatDay, setClosedThatDay] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/public/clinic?clinicId=${encodeURIComponent(clinicId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(
            res.status === 404
              ? "الحجز الأونلاين مش متفعل للعيادة دي حالياً."
              : "حصلت مشكلة واحنا بنحمل بيانات العيادة."
          );
        } else {
          const profile = data.clinic as ClinicProfile;
          setClinic(profile);
          // A single branch is not a choice — select it silently so the booking still records it.
          if ((profile.branches || []).length === 1) setSelectedBranchId(profile.branches[0].id);
        }
      } catch {
        if (!cancelled) setError("حصلت مشكلة واحنا بنحمل بيانات العيادة.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const loadSlots = useCallback(
    async (dateStr: string, doctorName: string, branchId: string) => {
      if (!dateStr) return;
      setLoadingSlots(true);
      setAvailableSlots([]);
      setSelectedTime("");
      setClosedThatDay(false);
      try {
        const qs = new URLSearchParams({ clinicId, date: dateStr });
        if (doctorName) qs.set("doctor", doctorName);
        if (branchId) qs.set("branch", branchId);
        const res = await fetch(`/api/public/slots?${qs.toString()}`);
        const data = await res.json();
        if (res.ok && data.ok) {
          setAvailableSlots(data.slots as string[]);
          setClosedThatDay(Boolean(data.closed));
        }
      } catch {
        setAvailableSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    },
    [clinicId]
  );

  const branches = clinic?.branches || [];
  const needsBranchChoice = branches.length > 1;
  const branchChosen = !needsBranchChoice || Boolean(selectedBranchId);
  const selectedBranch = branches.find((b) => b.id === selectedBranchId) || null;

  useEffect(() => {
    if (selectedDate && branchChosen) void loadSlots(selectedDate, selectedDoctor, selectedBranchId);
  }, [selectedDate, selectedDoctor, selectedBranchId, branchChosen, loadSlots]);

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId,
          date: selectedDate,
          time: selectedTime,
          doctor: selectedDoctor,
          branchId: selectedBranchId,
          patientName,
          patientPhone,
          reason,
          src: sourceTag,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        // 409 means somebody took the slot while this form was open — send them back to pick
        // again with a fresh list rather than leaving a dead button.
        if (res.status === 409) {
          setStep(1);
          void loadSlots(selectedDate, selectedDoctor, selectedBranchId);
        }
        throw new Error(data.error || "حصلت مشكلة في الحجز، جرب تاني.");
      }
      setSuccess(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "حصلت مشكلة في الحجز، جرب تاني.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-subtle text-ink-muted font-bold" dir="rtl">
        بنحمل النظام...
      </div>
    );
  }

  if (error || !clinic) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-subtle p-4" dir="rtl">
        <div className="bg-surface p-8 rounded-3xl shadow-xl text-center max-w-md w-full border border-slate-100">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">!</span>
          </div>
          <h1 className="text-xl font-black text-slate-800 mb-2">{error || "العيادة دي مش متاحة حالياً."}</h1>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-subtle p-4" dir="rtl">
        <div className="bg-surface p-10 rounded-3xl shadow-xl text-center max-w-md w-full border border-slate-100">
          <div className="w-20 h-20 bg-accent-tint text-accent-strong rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 mb-2">طلبك وصل!</h1>
          <p className="text-ink-muted font-medium">
            وصلنا طلب الحجز بتاعك يوم {formatDateAr(selectedDate)} الساعة {formatSlotAr(selectedTime)}
            {selectedBranch ? ` في ${selectedBranch.name}` : ""}. هنتواصل معاك قريب عشان نأكد.
          </p>
        </div>
      </div>
    );
  }

  const todayKey = dateKeyOf(new Date());
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 90);
  const maxKey = dateKeyOf(maxDate);

  // The reason moved out of the details step and into this one, so it now gates the Next button
  // alongside the time.
  const stepOneDone = Boolean(selectedTime && reason);

  return (
    <div className="min-h-screen bg-surface-subtle py-12 px-4 sm:px-6 lg:px-8 font-sans" dir="rtl">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-ink">{clinic.clinicName}</h1>
          <p className="text-ink-muted font-medium mt-1">احجز ميعادك</p>
        </div>

        <div className="bg-surface rounded-3xl shadow-sm border border-line overflow-hidden animate-in fade-in">
          <div className="flex bg-surface-subtle border-b border-line">
            <div
              className={`flex-1 text-center py-4 font-bold text-sm ${step === 1 ? "text-accent border-b-2 border-accent" : "text-ink-faint"}`}
            >
              ١. الميعاد والتاريخ
            </div>
            <div
              className={`flex-1 text-center py-4 font-bold text-sm ${step === 2 ? "text-accent border-b-2 border-accent" : "text-ink-faint"}`}
            >
              ٢. بياناتك
            </div>
          </div>

          <form
            onSubmit={
              step === 2
                ? handleSubmitBooking
                : (e) => {
                    e.preventDefault();
                    setStep(2);
                  }
            }
            className="p-6 sm:p-8"
          >
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in">
                {needsBranchChoice && (
                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-ink-strong">اختار الفرع</label>
                    <div className="grid grid-cols-1 gap-2">
                      {branches.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setSelectedBranchId(b.id)}
                          className={`w-full text-right rounded-xl border px-4 py-3 transition-all ${
                            selectedBranchId === b.id
                              ? "bg-accent text-ink-on-accent border-accent shadow-md"
                              : "bg-surface-subtle text-ink-strong border-line hover:border-accent"
                          }`}
                        >
                          <span className="flex items-center gap-2 font-bold text-sm">
                            <MapPin size={16} className={selectedBranchId === b.id ? "text-ink-on-accent" : "text-accent"} />
                            {b.name}
                          </span>
                          {b.address && (
                            <span
                              className={`block text-xs mt-1 font-medium ${selectedBranchId === b.id ? "text-white/80" : "text-ink-faint"}`}
                            >
                              {b.address}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {clinic.enableDoctorSelection && clinic.doctors.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-ink-strong">اختار الدكتور (اختياري)</label>
                    <select
                      value={selectedDoctor}
                      onChange={(e) => setSelectedDoctor(e.target.value)}
                      className="w-full bg-surface-subtle border border-line rounded-xl px-4 py-3 text-ink-strong font-medium outline-none focus:border-accent text-right"
                    >
                      <option value="">أي دكتور متاح</option>
                      {clinic.doctors.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-ink-strong">اختار التاريخ</label>
                  {!branchChosen && (
                    <p className="text-xs text-ink-faint font-bold">اختار الفرع الأول عشان نعرض المواعيد المتاحة.</p>
                  )}
                  <div className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
                    <MonthCalendar
                      value={selectedDate}
                      onChange={setSelectedDate}
                      offDays={clinic.offDays || []}
                      minKey={todayKey}
                      maxKey={maxKey}
                      disabled={!branchChosen}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-ink-strong">سبب الزيارة</label>
                  {clinic.reasons.length === 0 ? (
                    <p className="text-xs text-ink-faint font-bold">العيادة لسه ما ضافتش أسباب زيارة.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {clinic.reasons.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setReason(r)}
                          aria-pressed={reason === r}
                          className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-bold transition-all ${
                            reason === r
                              ? "bg-accent text-ink-on-accent border-accent shadow-sm"
                              : "bg-surface-subtle text-ink-strong border-line hover:border-accent"
                          }`}
                        >
                          <span className="flex items-center gap-2 text-right">
                            <Stethoscope size={16} className={reason === r ? "text-ink-on-accent" : "text-accent"} />
                            {r}
                          </span>
                          {reason === r && <Check size={16} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedDate && (
                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-ink-strong">
                      المواعيد المتاحة
                      {!loadingSlots && !closedThatDay && availableSlots.length > 0 && (
                        <span className="text-ink-muted font-medium"> — {toArDigits(availableSlots.length)} ميعاد</span>
                      )}
                    </label>
                    {loadingSlots ? (
                      <div className="text-ink-muted text-sm py-4 text-center">بندور على مواعيد...</div>
                    ) : closedThatDay ? (
                      <div className="text-amber-700 text-sm py-4 text-center font-bold bg-amber-50 rounded-xl">
                        العيادة مقفولة في اليوم ده.
                      </div>
                    ) : availableSlots.length === 0 ? (
                      <div className="text-red-500 text-sm py-4 text-center font-bold bg-red-50 rounded-xl">
                        مفيش مواعيد متاحة في اليوم ده.
                      </div>
                    ) : (
                      // No inner scroll box here on purpose. Capping the height cut the list off
                      // mid-row, so a busy day looked like it had five times, and a nested scroll
                      // area is awkward to hit on a phone. The page scrolls instead.
                      <div className="space-y-2">
                        {availableSlots.map((time) => (
                          <button
                            key={time}
                            type="button"
                            onClick={() => setSelectedTime(time)}
                            aria-pressed={selectedTime === time}
                            className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-bold transition-all ${
                              selectedTime === time
                                ? "bg-accent text-ink-on-accent border-accent shadow-sm"
                                : "bg-surface text-ink-strong border-line hover:border-accent hover:bg-accent-tint"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <Clock size={16} className={selectedTime === time ? "text-ink-on-accent" : "text-accent"} />
                              {formatSlotAr(time)}
                            </span>
                            {selectedTime === time && <Check size={16} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!stepOneDone}
                  className="w-full bg-accent hover:bg-accent-strong text-ink-on-accent font-bold py-4 rounded-xl mt-6 flex justify-center items-center gap-2 disabled:opacity-50 transition-all"
                >
                  <ChevronLeft size={18} /> الخطوة الجاية
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6 animate-in slide-in-from-left">
                <div className="bg-accent-tint text-accent-strong p-4 rounded-xl flex items-center justify-between flex-wrap gap-x-4 gap-y-2 font-bold text-sm mb-6">
                  {selectedBranch && (
                    <div className="flex items-center gap-2">
                      <MapPin size={16} /> {selectedBranch.name}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={16} /> {formatDateAr(selectedDate)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={16} /> {formatSlotAr(selectedTime)}
                  </div>
                  {reason && (
                    <div className="flex items-center gap-2">
                      <Stethoscope size={16} /> {reason}
                    </div>
                  )}
                  <button type="button" onClick={() => setStep(1)} className="text-accent underline text-xs">
                    تعديل
                  </button>
                </div>

                {formError && <div className="bg-red-50 text-red-600 font-bold text-sm p-3 rounded-xl">{formError}</div>}

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-ink-strong">الاسم بالكامل</label>
                  <div className="relative">
                    <User size={18} className="absolute right-3 top-3.5 text-ink-faint" />
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="الاسم هنا"
                      className="w-full bg-surface-subtle border border-line rounded-xl pr-10 pl-4 py-3 text-ink-strong font-bold outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-ink-strong">رقم التليفون</label>
                  <div className="relative">
                    <Phone size={18} className="absolute right-3 top-3.5 text-ink-faint" />
                    <input
                      type="tel"
                      required
                      value={patientPhone}
                      onChange={(e) => setPatientPhone(e.target.value)}
                      placeholder="010XXXXXXXX"
                      className="w-full bg-surface-subtle border border-line rounded-xl pr-10 pl-4 py-3 text-ink-strong font-bold outline-none focus:border-accent"
                      dir="ltr"
                      style={{ textAlign: "right" }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !patientName || !patientPhone || !reason}
                  className="w-full bg-accent hover:bg-accent-strong text-ink-on-accent font-black py-4 rounded-xl mt-6 flex justify-center items-center gap-2 disabled:opacity-50 transition-all shadow-md"
                >
                  {submitting ? "جاري الطلب..." : "تأكيد الحجز"}
                </button>
              </div>
            )}
          </form>

          <div className="h-2 bg-accent" />
        </div>
      </div>
    </div>
  );
}
