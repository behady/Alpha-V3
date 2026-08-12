"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { Building2, Loader2, LogOut, Check, AlertCircle, ArrowLeft } from "lucide-react";

/**
 * First screen a new account sees: start a clinic, or ask to join one.
 *
 * The navigation here is deliberately not "call the API, then router.push('/')". Creating the
 * clinic grants the role server-side, but this page only learns about it when AuthContext's
 * snapshot listener delivers the updated user document — a round trip that has not happened yet
 * when the API responds. Navigating immediately meant ClinicContext read zero clinics and sent
 * the user straight back here, which is exactly the "it created my clinic but keeps asking me to
 * create a clinic" loop. So we wait for the role to actually arrive, and say so while waiting.
 */

/** How long to wait for the new role before assuming something is wrong and offering a way out. */
const ROLE_ARRIVAL_TIMEOUT_MS = 15000;

export default function OnboardingPage() {
  const { user, logout } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const isAr = language === "ar";

  const [clinicName, setClinicName] = useState("");
  const [joinClinicId, setJoinClinicId] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [joinSent, setJoinSent] = useState(false);
  const [pendingClinicId, setPendingClinicId] = useState<string | null>(null);
  const [slowGrant, setSlowGrant] = useState(false);

  const existingClinics = Object.keys(user?.clinicRoles || {});

  const t = {
    welcome: isAr ? `أهلاً ${user?.name || ""}` : `Welcome, ${user?.name || ""}`,
    noClinics: isAr
      ? "لسه مش مرتبط بأي عيادة. ابدأ عيادتك أو اطلب الانضمام لواحدة."
      : "You're not part of a clinic yet. Start your own, or ask to join one.",
    hasClinics: isAr ? "ابدأ عيادة جديدة أو انضم لواحدة." : "Start another clinic, or join an existing one.",
    createTitle: isAr ? "ابدأ تجربة مجانية" : "Start a free trial",
    clinicNameLabel: isAr ? "اسم العيادة" : "Clinic name",
    clinicNamePlaceholder: isAr ? "مثال: عيادة النور للأسنان" : "e.g. Nour Dental Clinic",
    createBtn: isAr ? "إنشاء العيادة" : "Create clinic",
    creating: isAr ? "بنجهّز العيادة…" : "Setting up your clinic…",
    almost: isAr ? "خلصنا تقريباً — بنفعّل صلاحياتك…" : "Almost there — activating your access…",
    slow: isAr
      ? "التفعيل واخد وقت أطول من المعتاد. جرّب تعمل تحديث للصفحة."
      : "This is taking longer than usual. Try refreshing the page.",
    refresh: isAr ? "تحديث الصفحة" : "Refresh page",
    joinTitle: isAr ? "انضم لعيادة موجودة" : "Join an existing clinic",
    joinIdLabel: isAr ? "معرّف العيادة" : "Clinic ID",
    joinIdHelp: isAr
      ? "اطلب المعرّف من مدير العيادة — هيلاقيه في الإعدادات."
      : "Ask the clinic's admin for this — they'll find it in Settings.",
    joinBtn: isAr ? "إرسال طلب الانضمام" : "Send join request",
    joinSentTitle: isAr ? "تم إرسال طلبك" : "Request sent",
    joinSentBody: isAr
      ? "مدير العيادة هيراجع طلبك. هتقدر تدخل أول ما يوافق."
      : "The clinic's admin will review it. You'll get access as soon as they approve.",
    sendAnother: isAr ? "إرسال طلب تاني" : "Send another request",
    orDivider: isAr ? "أو" : "or",
    backToDashboard: isAr ? "الرجوع للوحة التحكم" : "Back to dashboard",
    signOut: isAr ? "تسجيل الخروج" : "Sign out",
    nameRequired: isAr ? "اكتب اسم العيادة" : "Enter a clinic name",
    idRequired: isAr ? "اكتب معرّف العيادة" : "Enter the clinic ID",
    createFailed: isAr ? "تعذّر إنشاء العيادة" : "Could not create the clinic",
    joinFailed: isAr ? "تعذّر إرسال الطلب" : "Could not send the request",
    sessionExpired: isAr ? "انتهت الجلسة. سجّل الدخول تاني." : "Session expired. Please sign in again.",
  };

  // The role landed. Only now is it safe to leave — ClinicContext will find the clinic.
  useEffect(() => {
    if (!pendingClinicId) return;
    if (user?.clinicRoles?.[pendingClinicId]) {
      router.replace("/");
    }
  }, [pendingClinicId, user, router]);

  // Don't spin forever if the grant never shows up.
  useEffect(() => {
    if (!pendingClinicId) return;
    const timer = setTimeout(() => setSlowGrant(true), ROLE_ARRIVAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingClinicId]);

  const handleCreateClinic = useCallback(async () => {
    const name = clinicName.trim();
    if (!name) return setError(t.nameRequired);

    setError("");
    setCreating(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(t.sessionExpired);

      // Clinic creation and the Admin grant happen server-side: Firestore rules lock direct
      // client writes to `clinics` and `users.clinicRoles` down to superadmin only.
      const res = await fetch("/api/onboarding/create-clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicName: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || t.createFailed);

      // Hold here until the role reaches this client, rather than navigating into a dashboard
      // that would immediately reject us.
      setPendingClinicId(data.clinicId as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.createFailed);
      setCreating(false);
    }
  }, [clinicName, t.nameRequired, t.sessionExpired, t.createFailed]);

  const handleJoinClinic = useCallback(async () => {
    const id = joinClinicId.trim();
    if (!id) return setError(t.idRequired);
    if (!user) return;

    setError("");
    setJoining(true);
    try {
      const requestRef = doc(getClinicCollection("join_requests"));
      await setDoc(requestRef, {
        clinicId: id,
        userId: user.uid,
        userEmail: user.email,
        userName: user.name,
        status: "Pending",
        requestedAt: serverTimestamp(),
      });
      setJoinSent(true);
      setJoinClinicId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.joinFailed);
    } finally {
      setJoining(false);
    }
  }, [joinClinicId, user, t.idRequired, t.joinFailed]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 font-semibold">
        <Loader2 className="animate-spin me-2" size={20} />
      </div>
    );
  }

  // Waiting for the grant to propagate — a real state, not a spinner over a lie.
  if (pendingClinicId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#E8F7F0] text-[#27ae60] flex items-center justify-center mx-auto mb-6">
            {slowGrant ? <AlertCircle size={28} /> : <Loader2 size={28} className="animate-spin" />}
          </div>
          <h1 className="text-xl font-black text-slate-900 mb-2">{t.creating}</h1>
          <p className="text-sm font-medium text-slate-500">{slowGrant ? t.slow : t.almost}</p>
          {slowGrant && (
            <button
              onClick={() => window.location.reload()}
              className="mt-6 w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-colors"
            >
              {t.refresh}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6" dir={isAr ? "rtl" : "ltr"}>
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#E8F7F0] text-[#27ae60] flex items-center justify-center mx-auto mb-4">
            <Building2 size={26} />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{t.welcome}</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">
            {existingClinics.length > 0 ? t.hasClinics : t.noClinics}
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 text-sm font-bold">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-8">
          {/* Create */}
          <div>
            <h2 className="text-base font-black text-slate-900 mb-4">{t.createTitle}</h2>
            <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">
              {t.clinicNameLabel}
            </label>
            <input
              type="text"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !creating && void handleCreateClinic()}
              placeholder={t.clinicNamePlaceholder}
              disabled={creating}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 outline-none focus:bg-white focus:border-[#60d297] transition-all disabled:opacity-60"
            />
            <button
              onClick={() => void handleCreateClinic()}
              disabled={creating || joining}
              className="mt-4 w-full bg-[#27ae60] hover:bg-[#219150] text-white font-black py-3.5 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 size={18} className="animate-spin" /> : null}
              {creating ? t.creating : t.createBtn}
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-white text-xs font-bold text-slate-400 uppercase tracking-widest">
                {t.orDivider}
              </span>
            </div>
          </div>

          {/* Join */}
          <div>
            <h2 className="text-base font-black text-slate-900 mb-4">{t.joinTitle}</h2>

            {joinSent ? (
              <div className="rounded-2xl bg-[#E8F7F0] border border-emerald-200 p-5 text-center">
                <div className="w-11 h-11 rounded-full bg-white text-[#27ae60] flex items-center justify-center mx-auto mb-3">
                  <Check size={22} />
                </div>
                <p className="font-black text-slate-900 text-sm">{t.joinSentTitle}</p>
                <p className="text-xs font-medium text-slate-600 mt-1.5 leading-relaxed">{t.joinSentBody}</p>
                <button
                  onClick={() => setJoinSent(false)}
                  className="mt-4 text-xs font-bold text-[#27ae60] hover:underline"
                >
                  {t.sendAnother}
                </button>
              </div>
            ) : (
              <>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">
                  {t.joinIdLabel}
                </label>
                <input
                  type="text"
                  value={joinClinicId}
                  onChange={(e) => setJoinClinicId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !joining && void handleJoinClinic()}
                  disabled={joining}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 outline-none focus:bg-white focus:border-[#60d297] transition-all disabled:opacity-60"
                />
                <p className="mt-2 text-xs font-medium text-slate-400">{t.joinIdHelp}</p>
                <button
                  onClick={() => void handleJoinClinic()}
                  disabled={joining || creating}
                  className="mt-4 w-full bg-white border border-slate-300 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {joining ? <Loader2 size={18} className="animate-spin" /> : null}
                  {t.joinBtn}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          {existingClinics.length > 0 && (
            <button
              onClick={() => router.push("/")}
              className="text-sm font-bold text-[#27ae60] hover:underline flex items-center gap-1.5"
            >
              <ArrowLeft size={15} className={isAr ? "rotate-180" : ""} />
              {t.backToDashboard}
            </button>
          )}
          <button
            onClick={logout}
            className="text-sm font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1.5"
          >
            <LogOut size={15} />
            {t.signOut}
          </button>
        </div>
      </div>
    </div>
  );
}
