"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { Calendar as CalendarIcon, Clock, User, Phone, CheckCircle, ChevronLeft, Stethoscope, FileText, Wallet, ArrowLeft, LogOut } from "lucide-react";

export default function OnlineBookingPage() {
  const params = useParams();
  const router = useRouter();
  const clinicId = (Array.isArray(params.clinicId) ? params.clinicId[0] : params.clinicId) as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [clinicName, setClinicName] = useState("");
  const [settings, setSettings] = useState<any>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);

  // Top Level Mode
  const [viewMode, setViewMode] = useState<"book" | "records">("book");

  // --- BOOKING STATE ---
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [reason, setReason] = useState("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // --- RECORDS STATE ---
  const [portalPhone, setPortalPhone] = useState("");
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [portalPatient, setPortalPatient] = useState<any>(null);
  const [portalAppointments, setPortalAppointments] = useState<any[]>([]);
  const [portalFinance, setPortalFinance] = useState({ totalCost: 0, totalPaid: 0, balance: 0 });
  const [recordsError, setRecordsError] = useState("");

  const toArDigits = (val: string | number): string => {
    const arabicNumbers = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
    return String(val).replace(/[0-9]/g, (w) => arabicNumbers[Number(w)]);
  };

  useEffect(() => {
    if (!clinicId) return;
    
    async function fetchClinicData() {
      try {
        const bookingSnap = await getDoc(doc(db, "clinics", clinicId, "settings", "onlineBooking"));
        if (!bookingSnap.exists() || !bookingSnap.data().enabled) {
          setError("الحجز الأونلاين مش متفعل للعيادة دي حالياً.");
          setLoading(false);
          return;
        }
        const bSettings = bookingSnap.data();
        
        const infoSnap = await getDoc(doc(db, "clinics", clinicId, "settings", "clinic_info"));
        let schedule = { start: "09:00", end: "17:00", slotDuration: "30", offDays: [] };
        if (infoSnap.exists()) {
          setClinicName(infoSnap.data().name || "عيادة أسنان");
          if (infoSnap.data().schedule) schedule = infoSnap.data().schedule;
        }

        setSettings({ ...bSettings, schedule });

        const reasonsSnap = await getDoc(doc(db, "clinics", clinicId, "settings", "visit_reasons"));
        if (reasonsSnap.exists() && Array.isArray(reasonsSnap.data().reasons)) {
          setReasons(reasonsSnap.data().reasons);
        } else {
          setReasons(["كشف", "استشارة", "متابعة", "طوارئ"]);
        }

        if (bSettings.enableDoctorSelection) {
          const usersSnap = await getDocs(query(collection(db, "clinics", clinicId, "users"), where("isDentist", "==", true)));
          setDoctors(usersSnap.docs.map(d => ({ id: d.id, name: d.data().name })));
        }

        setLoading(false);
      } catch (err) {
        console.error(err);
        setError("حصلت مشكلة واحنا بنحمل بيانات العيادة.");
        setLoading(false);
      }
    }
    
    fetchClinicData();
  }, [clinicId]);

  useEffect(() => {
    if (selectedDate && settings) {
      loadSlotsForDate(selectedDate);
    }
  }, [selectedDate, selectedDoctor]);

  const loadSlotsForDate = async (dateStr: string) => {
    setLoadingSlots(true);
    setAvailableSlots([]);
    setSelectedTime("");
    try {
      const q = query(
        collection(db, "clinics", clinicId, "appointments"),
        where("date", "==", dateStr)
      );
      const snap = await getDocs(q);
      const bookedTimes = snap.docs.map(d => d.data().time);

      const startMinutes = parseTime(settings.schedule.start);
      const endMinutes = parseTime(settings.schedule.end);
      const duration = parseInt(settings.defaultDurationMinutes || "30");

      const slots: string[] = [];
      for (let m = startMinutes; m + duration <= endMinutes; m += duration) {
        const timeStr = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
        if (!bookedTimes.includes(timeStr)) {
          slots.push(timeStr);
        }
      }
      setAvailableSlots(slots);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSlots(false);
    }
  };

  const parseTime = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  const format12HourAr = (time24: string) => {
    if (!time24) return "";
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'م' : 'ص';
    const h12 = h % 12 || 12;
    return `${toArDigits(h12.toString().padStart(2, '0'))}:${toArDigits(m.toString().padStart(2, '0'))} ${ampm}`;
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime || !patientName || !patientPhone) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/public/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId,
          date: selectedDate,
          time: selectedTime,
          doctor: selectedDoctor,
          patientName,
          patientPhone,
          reason,
          duration: parseInt(settings.defaultDurationMinutes || "30")
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to book");
      
      setSuccess(true);
    } catch (err: any) {
      alert(err.message || "حصلت مشكلة في الحجز، جرب تاني.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFetchRecords = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portalPhone) return;
    setLoadingRecords(true);
    setRecordsError("");
    setPortalPatient(null);
    setPortalAppointments([]);
    setPortalFinance({ totalCost: 0, totalPaid: 0, balance: 0 });

    try {
      let patient = null;
      let pId = "";
      
      const topLevelQ = query(collection(db, "patients"), where("phone", "==", portalPhone));
      const topLevelSnap = await getDocs(topLevelQ);
      
      if (!topLevelSnap.empty) {
        patient = topLevelSnap.docs[0].data();
        pId = topLevelSnap.docs[0].id;
      } else {
        const clinicQ = query(collection(db, "clinics", clinicId, "patients"), where("phone", "==", portalPhone));
        const clinicSnap = await getDocs(clinicQ);
        if (!clinicSnap.empty) {
          patient = clinicSnap.docs[0].data();
          pId = clinicSnap.docs[0].id;
        }
      }

      if (!patient) {
        setRecordsError("ملقيناش بيانات للرقم ده في النظام.");
        setLoadingRecords(false);
        return;
      }

      setPortalPatient({ id: pId, ...patient });

      const apptsQ = query(collection(db, "clinics", clinicId, "appointments"), where("patientPhone", "==", portalPhone));
      const apptsSnap = await getDocs(apptsQ);
      const appts = apptsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      appts.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.time.localeCompare(a.time);
      });
      setPortalAppointments(appts);

      const ledgerQ = query(collection(db, "ledger"), where("patientId", "==", pId));
      const ledgerSnap = await getDocs(ledgerQ);
      let tCost = 0;
      let tPaid = 0;
      ledgerSnap.forEach(d => {
        const item = d.data();
        if (item.type === "procedure") tCost += (Number(item.cost) || 0);
        if (item.type === "payment") tPaid += (Number(item.paid) || 0);
      });
      
      setPortalFinance({ totalCost: tCost, totalPaid: tPaid, balance: tCost - tPaid });

    } catch (err) {
      console.error(err);
      setRecordsError("حصلت مشكلة واحنا بنجيب البيانات، جرب تاني.");
    } finally {
      setLoadingRecords(false);
    }
  };

  const handleLogout = () => {
    setPortalPhone("");
    setPortalPatient(null);
    setPortalAppointments([]);
    setPortalFinance({ totalCost: 0, totalPaid: 0, balance: 0 });
    setRecordsError("");
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-bold" dir="rtl">بنحمل النظام...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4" dir="rtl">
        <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-md w-full border border-slate-100">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">!</span>
          </div>
          <h1 className="text-xl font-black text-slate-800 mb-2">{error}</h1>
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
          <p className="text-slate-500 font-medium mb-6">وصلنا طلب الحجز بتاعك ليوم {toArDigits(selectedDate)} الساعة {format12HourAr(selectedTime)}. هنتواصل معاك قريب عشان نأكد.</p>
          <button 
            onClick={() => { setSuccess(false); setStep(1); setViewMode("records"); }}
            className="w-full bg-indigo-50 text-indigo-700 font-bold py-3 rounded-xl hover:bg-indigo-100 transition-colors"
          >
            روح لملفي
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans" dir="rtl">
      <div className="max-w-xl mx-auto">
        
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-slate-900">{clinicName}</h1>
          <p className="text-slate-500 font-medium mt-1">بوابة المريض</p>
        </div>

        {/* Top Toggle Switch */}
        <div className="flex bg-slate-200/60 rounded-full p-1.5 mb-8 w-full max-w-sm mx-auto shadow-inner">
          <button
            onClick={() => setViewMode("book")}
            className={`flex-1 text-sm font-bold py-2.5 rounded-full transition-all ${viewMode === "book" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            احجز ميعاد
          </button>
          <button
            onClick={() => setViewMode("records")}
            className={`flex-1 text-sm font-bold py-2.5 rounded-full transition-all ${viewMode === "records" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            ملفي الطبي
          </button>
        </div>

        {viewMode === "book" && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            {/* Progress Indicator */}
            <div className="flex bg-slate-50 border-b border-slate-200">
              <div className={`flex-1 text-center py-4 font-bold text-sm ${step === 1 ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>١. الميعاد والتاريخ</div>
              <div className={`flex-1 text-center py-4 font-bold text-sm ${step === 2 ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>٢. بياناتك</div>
            </div>

            <form onSubmit={step === 2 ? handleSubmitBooking : (e) => { e.preventDefault(); setStep(2); }} className="p-6 sm:p-8">
              
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in">
                  {settings.enableDoctorSelection && doctors.length > 0 && (
                    <div className="space-y-2">
                      <label className="block text-sm font-bold text-slate-700">اختار الدكتور (اختياري)</label>
                      <select
                        value={selectedDoctor}
                        onChange={(e) => setSelectedDoctor(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 font-medium outline-none focus:border-indigo-500 text-right"
                      >
                        <option value="">أي دكتور متاح</option>
                        {doctors.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                      </select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-slate-700">اختار التاريخ</label>
                    <input
                      type="date"
                      required
                      min={new Date().toISOString().split('T')[0]}
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 font-bold outline-none focus:border-indigo-500 text-right"
                      style={{ textAlign: 'right' }}
                    />
                  </div>

                  {selectedDate && (
                    <div className="space-y-2">
                      <label className="block text-sm font-bold text-slate-700">المواعيد المتاحة</label>
                      {loadingSlots ? (
                        <div className="text-slate-500 text-sm py-4 text-center">بندور على مواعيد...</div>
                      ) : availableSlots.length === 0 ? (
                        <div className="text-red-500 text-sm py-4 text-center font-bold bg-red-50 rounded-xl">مفيش مواعيد متاحة في اليوم ده.</div>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          {availableSlots.map(time => (
                            <button
                              key={time}
                              type="button"
                              onClick={() => setSelectedTime(time)}
                              className={`py-2 rounded-xl font-bold text-sm transition-all border ${
                                selectedTime === time 
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' 
                                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                              }`}
                            >
                              {format12HourAr(time)}
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
                  <div className="bg-indigo-50 text-indigo-800 p-4 rounded-xl flex items-center justify-between font-bold text-sm mb-6">
                    <div className="flex items-center gap-2"><CalendarIcon size={16} /> {toArDigits(selectedDate)}</div>
                    <div className="flex items-center gap-2"><Clock size={16} /> {format12HourAr(selectedTime)}</div>
                    <button type="button" onClick={() => setStep(1)} className="text-indigo-600 underline text-xs">تعديل</button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-slate-700">الاسم بالكامل</label>
                    <div className="relative">
                      <User size={18} className="absolute right-3 top-3.5 text-slate-400" />
                      <input
                        type="text"
                        required
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
                        style={{ textAlign: 'right' }}
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
                      <option value="" disabled>اختار السبب...</option>
                      {reasons.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !patientName || !patientPhone || !reason}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-xl mt-6 flex justify-center items-center gap-2 disabled:opacity-50 transition-all shadow-md"
                  >
                    {submitting ? 'جاري الطلب...' : 'تأكيد الحجز'}
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {/* RECORDS DASHBOARD VIEW */}
        {viewMode === "records" && (
          <div className="animate-in fade-in">
            {!portalPatient ? (
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 text-center">
                <div className="w-16 h-16 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <FileText size={32} />
                </div>
                <h2 className="text-xl font-black text-slate-800 mb-2">شوف سجلاتك</h2>
                <p className="text-slate-500 font-medium text-sm mb-6">دخل رقم تليفونك المسجل عشان تشوف مواعيدك وحساباتك.</p>
                
                {recordsError && (
                  <div className="bg-red-50 text-red-600 font-bold text-sm p-3 rounded-xl mb-6">
                    {recordsError}
                  </div>
                )}

                <form onSubmit={handleFetchRecords} className="space-y-4">
                  <div className="relative">
                    <Phone size={18} className="absolute right-4 top-4 text-slate-400" />
                    <input
                      type="tel"
                      required
                      value={portalPhone}
                      onChange={(e) => setPortalPhone(e.target.value)}
                      placeholder="010XXXXXXXX"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl pr-12 pl-4 py-3.5 text-slate-700 font-bold outline-none focus:border-indigo-500 text-lg"
                      dir="ltr"
                      style={{ textAlign: 'right' }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!portalPhone || loadingRecords}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black py-4 rounded-2xl flex justify-center items-center gap-2 disabled:opacity-50 transition-all"
                  >
                    {loadingRecords ? 'بندور...' : 'عرض السجلات'} <ArrowLeft size={18} />
                  </button>
                </form>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white rounded-3xl p-6 flex justify-between items-center shadow-sm border border-slate-200">
                  <div>
                    <p className="text-slate-500 font-medium text-sm">أهلاً بيك</p>
                    <h2 className="text-2xl font-black text-slate-800">{portalPatient.name}</h2>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                    title="تسجيل خروج"
                  >
                    <LogOut size={18} />
                  </button>
                </div>

                <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-2xl" />
                  <div className="flex items-center gap-3 mb-6">
                    <Wallet size={24} className="text-indigo-200" />
                    <h3 className="font-bold text-lg">كشف الحساب</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-indigo-200 text-sm mb-1">إجمالي العلاج</p>
                      <p className="font-bold text-xl">{toArDigits(portalFinance.totalCost.toLocaleString())} ج.م</p>
                    </div>
                    <div>
                      <p className="text-indigo-200 text-sm mb-1">المدفوع</p>
                      <p className="font-bold text-xl">{toArDigits(portalFinance.totalPaid.toLocaleString())} ج.م</p>
                    </div>
                  </div>
                  <div className="mt-6 pt-4 border-t border-indigo-500/50 flex justify-between items-center">
                    <p className="text-indigo-100 font-medium">المتبقي المطلوب</p>
                    <p className="text-2xl font-black">{toArDigits(portalFinance.balance.toLocaleString())} ج.م</p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <CalendarIcon size={24} className="text-indigo-600" />
                    <h3 className="font-bold text-lg text-slate-800">مواعيدك السابقة</h3>
                  </div>
                  
                  {portalAppointments.length === 0 ? (
                    <div className="text-center py-6 text-slate-500 bg-slate-50 rounded-2xl font-medium">
                      مفيش مواعيد مسجلة.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {portalAppointments.map(appt => (
                        <div key={appt.id} className="flex gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                          <div className="flex flex-col items-center justify-center w-14 h-14 bg-white rounded-xl shadow-sm border border-slate-200 shrink-0">
                            <span className="text-lg font-black text-slate-800">{toArDigits(appt.date.split('-')[2])}</span>
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-800 text-lg">{appt.reason || "زيارة"}</h4>
                            <div className="flex items-center gap-4 text-slate-500 text-sm mt-1">
                              <span className="flex items-center gap-1"><Clock size={14} /> {format12HourAr(appt.time)}</span>
                              {appt.doctorName && <span className="flex items-center gap-1"><User size={14} /> {appt.doctorName}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
