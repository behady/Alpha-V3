"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Calendar as CalendarIcon, Clock, User, Phone, CheckCircle, ChevronLeft, MapPin } from "lucide-react";

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-bold" dir="rtl">
        بنحمل النظام...
      </div>
    );
  }

  if (error || !clinic) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4" dir="rtl">
        <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-md w-full border border-slate-100">
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4" dir="rtl">
        <div className="bg-white p-10 rounded-3xl shadow-xl text-center max-w-md w-full border border-slate-100">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 mb-2">طلبك وصل!</h1>
          <p className="text-slate-500 font-medium">
            وصلنا طلب الحجز بتاعك ليوم {toArDigits(selectedDate)} الساعة {formatSlotAr(selectedTime)}
            {selectedBranch ? ` في ${selectedBranch.name}` : ""}. هنتواصل معاك قريب عشان نأكد.
          </p>
        </div>
      </div>
    );
  }

  const todayKey = new Date().toISOString().split("T")[0];
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 90);

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans" dir="rtl">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-slate-900">{clinic.clinicName}</h1>
          <p className="text-slate-500 font-medium mt-1">احجز ميعادك</p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
          <div className="flex bg-slate-50 border-b border-slate-200">
            <div
              className={`flex-1 text-center py-4 font-bold text-sm ${step === 1 ? "text-indigo-600 border-b-2 border-indigo-600" : "text-slate-400"}`}
            >
              ١. الميعاد والتاريخ
            </div>
            <div
              className={`flex-1 text-center py-4 font-bold text-sm ${step === 2 ? "text-indigo-600 border-b-2 border-indigo-600" : "text-slate-400"}`}
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
                    <label className="block text-sm font-bold text-slate-700">اختار الفرع</label>
                    <div className="grid grid-cols-1 gap-2">
                      {branches.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setSelectedBranchId(b.id)}
                          className={`w-full text-right rounded-xl border px-4 py-3 transition-all ${
                            selectedBranchId === b.id
                              ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                              : "bg-slate-50 text-slate-700 border-slate-200 hover:border-indigo-300"
                          }`}
                        >
                          <span className="flex items-center gap-2 font-bold text-sm">
                            <MapPin size={16} className={selectedBranchId === b.id ? "text-white" : "text-indigo-500"} />
                            {b.name}
                          </span>
                          {b.address && (
                            <span className={`block text-xs mt-1 font-medium ${selectedBranchId === b.id ? "text-indigo-100" : "text-slate-400"}`}>
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
                    <label className="block text-sm font-bold text-slate-700">اختار الدكتور (اختياري)</label>
                    <select
                      value={selectedDoctor}
                      onChange={(e) => setSelectedDoctor(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 font-medium outline-none focus:border-indigo-500 text-right"
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
                  <label className="block text-sm font-bold text-slate-700">اختار التاريخ</label>
                  {!branchChosen && (
                    <p className="text-xs text-slate-400 font-bold">اختار الفرع الأول عشان نعرض المواعيد المتاحة.</p>
                  )}
                  <input
                    type="date"
                    required
                    disabled={!branchChosen}
                    min={todayKey}
                    max={maxDate.toISOString().split("T")[0]}
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 font-bold outline-none focus:border-indigo-500 text-right"
                    style={{ textAlign: "right" }}
                  />
                </div>

                {selectedDate && (
                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-slate-700">المواعيد المتاحة</label>
                    {loadingSlots ? (
                      <div className="text-slate-500 text-sm py-4 text-center">بندور على مواعيد...</div>
                    ) : closedThatDay ? (
                      <div className="text-amber-700 text-sm py-4 text-center font-bold bg-amber-50 rounded-xl">
                        العيادة مقفولة في اليوم ده.
                      </div>
                    ) : availableSlots.length === 0 ? (
                      <div className="text-red-500 text-sm py-4 text-center font-bold bg-red-50 rounded-xl">
                        مفيش مواعيد متاحة في اليوم ده.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-3">
                        {availableSlots.map((time) => (
                          <button
                            key={time}
                            type="button"
                            onClick={() => setSelectedTime(time)}
                            className={`py-2 rounded-xl font-bold text-sm transition-all border ${
                              selectedTime === time
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-md scale-105"
                                : "bg-white text-slate-700 border-slate-200 hover:border-indigo-300"
                            }`}
                          >
                            {formatSlotAr(time)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!selectedTime}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl mt-6 flex justify-center items-center gap-2 disabled:opacity-50 transition-all"
                >
                  <ChevronLeft size={18} /> الخطوة الجاية
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6 animate-in slide-in-from-left">
                <div className="bg-indigo-50 text-indigo-800 p-4 rounded-xl flex items-center justify-between flex-wrap gap-2 font-bold text-sm mb-6">
                  {selectedBranch && (
                    <div className="flex items-center gap-2">
                      <MapPin size={16} /> {selectedBranch.name}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={16} /> {toArDigits(selectedDate)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={16} /> {formatSlotAr(selectedTime)}
                  </div>
                  <button type="button" onClick={() => setStep(1)} className="text-indigo-600 underline text-xs">
                    تعديل
                  </button>
                </div>

                {formError && (
                  <div className="bg-red-50 text-red-600 font-bold text-sm p-3 rounded-xl">{formError}</div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">الاسم بالكامل</label>
                  <div className="relative">
                    <User size={18} className="absolute right-3 top-3.5 text-slate-400" />
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="الاسم هنا"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 text-slate-700 font-bold outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">رقم التليفون</label>
                  <div className="relative">
                    <Phone size={18} className="absolute right-3 top-3.5 text-slate-400" />
                    <input
                      type="tel"
                      required
                      value={patientPhone}
                      onChange={(e) => setPatientPhone(e.target.value)}
                      placeholder="010XXXXXXXX"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 text-slate-700 font-bold outline-none focus:border-indigo-500"
                      dir="ltr"
                      style={{ textAlign: "right" }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">سبب الزيارة</label>
                  <select
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 font-bold outline-none focus:border-indigo-500"
                  >
                    <option value="" disabled>
                      اختار السبب...
                    </option>
                    {clinic.reasons.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !patientName || !patientPhone || !reason}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-xl mt-6 flex justify-center items-center gap-2 disabled:opacity-50 transition-all shadow-md"
                >
                  {submitting ? "جاري الطلب..." : "تأكيد الحجز"}
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
