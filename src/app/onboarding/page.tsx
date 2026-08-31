"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
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
  const { user, loading: authLoading, logout } = useAuth();
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
  const [healing, setHealing] = useState(true);

  const existingClinics = Object.keys(user?.clinicRoles || {});

  const t = {
    welcome: isAr ? `أهلاً ${user?.name || ""}` : `Welcome, ${user?.name || ""}`,
    noClinics: isAr
      ? "خطوة واحدة كمان: اختار اسم لعيادتك واضغط «إنشاء العيادة». هتدخل على النظام على طول."
      : "One step left: name your clinic and press Create clinic. You'll go straight in.",
    hasClinics: isAr ? "ابدأ عيادة جديدة أو انضم لواحدة." : "Start another clinic, or join an existing one.",
    createTitle: isAr ? "أنا صاحب العيادة — ابدأ تجربة مجانية" : "I own the clinic — start a free trial",
    createHelp: isAr
      ? "ده الاختيار الصح لو انت الدكتور أو صاحب العيادة. هتبقى مدير النظام وتقدر تضيف باقي الفريق بعدين من الإعدادات."
      : "Pick this if you're the dentist or the owner. You become the admin, and you can add the rest of your team later from Settings.",
    clinicNameLabel: isAr ? "اسم العيادة" : "Clinic name",
    clinicNamePlaceholder: isAr ? "مثال: عيادة النور للأسنان" : "e.g. Nour Dental Clinic",
    createBtn: isAr ? "إنشاء العيادة" : "Create clinic",
    creating: isAr ? "بنجهّز العيادة…" : "Setting up your clinic…",
    almost: isAr ? "خلصنا تقريباً — بنفعّل صلاحياتك…" : "Almost there — activating your access…",
    slow: isAr
      ? "التفعيل واخد وقت أطول من المعتاد. اعمل تحديث للصفحة — عيادتك محفوظة وهتلاقيها زي ما هي."
      : "This is taking longer than usual. Refresh the page — your clinic is saved and will be waiting.",
    refresh: isAr ? "تحديث الصفحة" : "Refresh page",
    checking: isAr ? "بنراجع حسابك…" : "Checking your account…",
    joinTitle: isAr ? "أنا موظف — انضم لعيادة موجودة" : "I work at a clinic — join an existing one",
    joinIdLabel: isAr ? "معرّف العيادة" : "Clinic ID",
    joinIdHelp: isAr
      ? "اطلب المعرّف من مدير عيادتك. هيلاقيه في: الإعدادات ← المستخدمين ← «معرّف العيادة». متعملش حساب جديد للعيادة لو فيه واحدة موجودة."
      : "Ask your clinic's admin for it. They'll find it under Settings → Users → Clinic ID. Don't create a second clinic if yours already exists.",
    joinIdPlaceholder: isAr ? "الصق المعرّف هنا" : "Paste the ID here",
    joinBtn: isAr ? "إرسال طلب الانضمام" : "Send join request",
    joinSentTitle: isAr ? "تم إرسال طلبك" : "Request sent",
    joinSentBody: isAr
      ? "مدير العيادة هيلاقي طلبك في الإعدادات ← طلبات الانضمام. هتقدر تدخل أول ما يوافق — سجّل دخول تاني وقتها."
      : "Your admin will see it under Settings → Join Requests. You'll get access as soon as they approve — sign in again then.",
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

  // Signed out — this page has nothing to show and no way to recover on its own. It used to sit
  // on a spinner forever for anyone who opened it directly or came back after their session ended.
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  /**
   * Repair first, ask second.
   *
   * Someone can arrive here already owning a clinic whose role grant never landed. To them the app
   * simply says "you're not part of a clinic yet" every single time they sign in, and pressing
   * Create looks like the only move — which is how one owner ends up with several empty clinics
   * and still no way in. So before rendering the form, hand the server the chance to give the role
   * back. A healthy account gets `healed: []` and falls through to the form as normal.
   */
  const healRan = useRef(false);
  useEffect(() => {
    if (!user || healRan.current) return;
    healRan.current = true;

    (async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;
        const res = await fetch("/api/onboarding/self-heal", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok && Array.isArray(data.healed) && data.healed.length > 0) {
          // Same wait as after a fresh create: hold until the role reaches this client.
          setPendingClinicId(data.healed[0] as string);
        }
      } catch {
        // Nothing to recover, or the check itself failed — show the normal form either way.
      } finally {
        setHealing(false);
      }
    })();
  }, [user]);

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
      // Filed server-side. A write from here cannot check that the Clinic ID is real — the rules
      // deny reading a clinic you hold no role in, which is exactly this situation — so a typo
      // used to be accepted silently and waited on forever. The route looks the clinic up, takes
      // the name and email from the signed-in Auth record rather than anything typed here, and
      // keys the request on (user, clinic) so a second press cannot file a duplicate.
      const token = await auth.currentUser?.getIdToken();
      if (!token) return setError(t.sessionExpired);
      const res = await fetch("/api/join-requests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId: id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        return setError(payload?.error || t.joinFailed);
      }
      setJoinSent(true);
      setJoinClinicId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.joinFailed);
    } finally {
      setJoining(false);
    }
  }, [joinClinicId, user, t.idRequired, t.joinFailed, t.sessionExpired]);

  if (!user || healing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-ink-muted font-semibold">
        <Loader2 className="animate-spin" size={22} />
        <p className="text-sm">{t.checking}</p>
      </div>
    );
  }

  // Waiting for the grant to propagate — a real state, not a spinner over a lie.
  if (pendingClinicId) {
    return (
      <div className="min-h-screen bg-surface-subtle flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
        <div className="bg-surface rounded-3xl border border-line shadow-sm p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent-tint text-accent flex items-center justify-center mx-auto mb-6">
            {slowGrant ? <AlertCircle size={28} /> : <Loader2 size={28} className="animate-spin" />}
          </div>
          <h1 className="text-xl font-black text-ink mb-2">{t.creating}</h1>
          <p className="text-sm font-medium text-ink-muted">{slowGrant ? t.slow : t.almost}</p>
          {slowGrant && (
            <>
              <button
                onClick={() => window.location.reload()}
                className="mt-6 w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-colors"
              >
                {t.refresh}
              </button>
              <button
                onClick={logout}
                className="mt-3 text-sm font-medium text-ink-muted hover:text-ink inline-flex items-center gap-1.5"
              >
                <LogOut size={15} />
                {t.signOut}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-subtle py-12 px-4 sm:px-6" dir={isAr ? "rtl" : "ltr"}>
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent-tint text-accent flex items-center justify-center mx-auto mb-4">
            <Building2 size={26} />
          </div>
          <h1 className="text-2xl font-black text-ink tracking-tight">{t.welcome}</h1>
          <p className="mt-2 text-sm font-medium text-ink-muted">
            {existingClinics.length > 0 ? t.hasClinics : t.noClinics}
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 text-sm font-bold">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-surface rounded-3xl border border-line shadow-sm p-6 sm:p-8 space-y-8">
          {/* Create */}
          <div>
            <h2 className="text-base font-black text-ink mb-1.5">{t.createTitle}</h2>
            <p className="text-xs font-medium text-ink-muted leading-relaxed mb-4">{t.createHelp}</p>
            <label className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">
              {t.clinicNameLabel}
            </label>
            <input
              type="text"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !creating && void handleCreateClinic()}
              placeholder={t.clinicNamePlaceholder}
              disabled={creating}
              className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all disabled:opacity-60"
            />
            <button
              onClick={() => void handleCreateClinic()}
              disabled={creating || joining}
              className="mt-4 w-full bg-accent hover:bg-accent-strong text-white font-black py-3.5 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 size={18} className="animate-spin" /> : null}
              {creating ? t.creating : t.createBtn}
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-surface text-xs font-bold text-slate-400 uppercase tracking-widest">
                {t.orDivider}
              </span>
            </div>
          </div>

          {/* Join */}
          <div>
            <h2 className="text-base font-black text-ink mb-4">{t.joinTitle}</h2>

            {joinSent ? (
              <div className="rounded-2xl bg-accent-tint border border-emerald-200 p-5 text-center">
                <div className="w-11 h-11 rounded-full bg-surface text-accent flex items-center justify-center mx-auto mb-3">
                  <Check size={22} />
                </div>
                <p className="font-black text-ink text-sm">{t.joinSentTitle}</p>
                <p className="text-xs font-medium text-ink-body mt-1.5 leading-relaxed">{t.joinSentBody}</p>
                <button
                  onClick={() => setJoinSent(false)}
                  className="mt-4 text-xs font-bold text-accent hover:underline"
                >
                  {t.sendAnother}
                </button>
              </div>
            ) : (
              <>
                <label className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">
                  {t.joinIdLabel}
                </label>
                <input
                  type="text"
                  value={joinClinicId}
                  onChange={(e) => setJoinClinicId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !joining && void handleJoinClinic()}
                  placeholder={t.joinIdPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={joining}
                  className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all disabled:opacity-60"
                />
                <p className="mt-2 text-xs font-medium text-slate-400 leading-relaxed">{t.joinIdHelp}</p>
                <button
                  onClick={() => void handleJoinClinic()}
                  disabled={joining || creating}
                  className="mt-4 w-full bg-surface border border-line-strong text-slate-700 font-bold py-3 rounded-xl hover:bg-surface-subtle transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
              className="text-sm font-bold text-accent hover:underline flex items-center gap-1.5"
            >
              <ArrowLeft size={15} className={isAr ? "rotate-180" : ""} />
              {t.backToDashboard}
            </button>
          )}
          <button
            onClick={logout}
            className="text-sm font-medium text-ink-muted hover:text-ink flex items-center gap-1.5"
          >
            <LogOut size={15} />
            {t.signOut}
          </button>
        </div>
      </div>
    </div>
  );
}
