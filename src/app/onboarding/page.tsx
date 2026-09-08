"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { doc, getDocFromServer } from "firebase/firestore";
import { Building2, Loader2, LogOut, Check, AlertCircle, ArrowLeft } from "lucide-react";
import { RELOADED_FOR_STORAGE, currentSignupKey, finishSignupAttempt } from "@/lib/onboardingSignup";
import { SETUP_ROUTE } from "@/lib/setupWizard";
import { PENDING_INVITE_STORAGE, inviteLinkPath, isValidInviteCode } from "@/lib/inviteLinks";

/**
 * First screen a new account sees: start a clinic, or ask to join one.
 *
 * The navigation here is deliberately not "call the API, then router.push('/')". Creating the
 * clinic grants the role server-side, but this page only learns about it when AuthContext's
 * snapshot listener delivers the updated user document — a round trip that has not happened yet
 * when the API responds. Navigating immediately meant ClinicContext read zero clinics and sent
 * the user straight back here, which is exactly the "it created my clinic but keeps asking me to
 * create a clinic" loop. So we wait for the role to actually arrive, and say so while waiting.
 *
 * And when it does not arrive — a listener that has gone quiet, a slow network — the page no
 * longer asks the person to refresh and hope. A tester did exactly that, came back to this same
 * form, typed the clinic name again, and owned two clinics. Now:
 *
 *   - the server has confirmed the clinic exists, so after a short grace period the page does a
 *     full reload into the dashboard itself, once, which fetches the user document fresh;
 *   - anyone who already belongs to a clinic is sent to the dashboard the moment this page
 *     loads, unless they came here on purpose to add another (`?new=1` from the clinic switcher);
 *   - every attempt carries a signup key the server uses to recognise a retry of the same
 *     signup, so even a second press cannot produce a second clinic.
 */

/** How long to give the snapshot listener before reloading into the dashboard ourselves. */
const ROLE_ARRIVAL_GRACE_MS = 5000;

/**
 * A full page load into the app. Unlike router.replace, this refetches the user document.
 * A clinic made just now goes to the setup wizard; anything else goes to the dashboard.
 */
function reloadIntoApp(freshClinic: boolean) {
  window.location.assign(freshClinic ? SETUP_ROUTE : "/");
}

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
  // The clinic a join request was just filed for. While set, this page watches for the role to
  // arrive and walks in by itself the moment the admin approves.
  const [awaitingClinicId, setAwaitingClinicId] = useState<string | null>(null);
  const [pendingClinicId, setPendingClinicId] = useState<string | null>(null);
  const [slowGrant, setSlowGrant] = useState(false);
  const [healing, setHealing] = useState(true);
  // True when the pending clinic was made by this screen just now — it goes to the setup wizard.
  // A repaired grant (self-heal) is an old clinic and goes to the dashboard.
  const [freshClinic, setFreshClinic] = useState(false);
  // Came here on purpose to add a clinic (clinic switcher → "Add clinic"). Read once, on the
  // client: the query string is not available during server rendering.
  const [wantsAnother, setWantsAnother] = useState<boolean | null>(null);
  useEffect(() => {
    setWantsAnother(new URLSearchParams(window.location.search).get("new") === "1");
  }, []);

  const existingClinics = Object.keys(user?.clinicRoles || {});
  const alreadyBelongs = existingClinics.length > 0;

  const t = {
    welcome: isAr ? `أهلاً ${user?.name || ""}` : `Welcome, ${user?.name || ""}`,
    noClinics: isAr
      ? "خطوة واحدة كمان: اختار اسم لعيادتك واضغط «إنشاء العيادة». هتدخل على النظام على طول."
      : "One step left: name your clinic and press Create clinic. You'll go straight in.",
    hasClinics: isAr ? "ابدأ عيادة جديدة أو انضم لواحدة." : "Start another clinic, or join an existing one.",
    createTitle: wantsAnother
      ? (isAr ? "إضافة عيادة جديدة" : "Add another clinic")
      : (isAr ? "أنا صاحب العيادة — ابدأ تجربة مجانية" : "I own the clinic — start a free trial"),
    anotherHelp: isAr
      ? "دي هتبقى عيادة تانية منفصلة بجانب عيادتك الحالية. لو عايز ترجع لعيادتك، اضغط «الرجوع للوحة التحكم»."
      : "This will be a separate, second clinic next to the one you already have. To go back to your clinic, press Back to dashboard.",
    createHelp: isAr
      ? "ده الاختيار الصح لو انت الدكتور أو صاحب العيادة. هتبقى مدير النظام وتقدر تضيف باقي الفريق بعدين من الإعدادات."
      : "Pick this if you're the dentist or the owner. You become the admin, and you can add the rest of your team later from Settings.",
    clinicNameLabel: isAr ? "اسم العيادة" : "Clinic name",
    clinicNamePlaceholder: isAr ? "مثال: عيادة النور للأسنان" : "e.g. Nour Dental Clinic",
    createBtn: isAr ? "إنشاء العيادة" : "Create clinic",
    creating: isAr ? "بنجهّز العيادة…" : "Setting up your clinic…",
    almost: isAr ? "خلصنا تقريباً — بنفعّل صلاحياتك…" : "Almost there — activating your access…",
    slow: isAr
      ? "عيادتك اتحفظت بالفعل. لو لوحة التحكم مفتحتش لوحدها، اضغط الزرار ده — ومتعملش العيادة تاني."
      : "Your clinic is already saved. If the dashboard doesn't open by itself, press the button below — and don't create the clinic again.",
    openClinic: isAr ? "افتح عيادتي" : "Open my clinic",
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
      ? "مدير العيادة هيلاقي طلبك في الإعدادات ← طلبات الانضمام. سيب الصفحة دي مفتوحة — أول ما يوافق هندخّلك لوحدنا."
      : "Your admin will see it under Settings → Join Requests. Leave this page open — the moment they approve, you'll be taken in automatically.",
    joinWaiting: isAr ? "مستنيين موافقة المدير…" : "Waiting for your admin to approve…",
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

  // Came in through an invite link, then signed in some other way (Google, a second tab): the
  // code was remembered by the join page, and the invite is what they want, not this form.
  useEffect(() => {
    if (!user) return;
    try {
      const pending = localStorage.getItem(PENDING_INVITE_STORAGE);
      if (pending && isValidInviteCode(pending)) router.replace(inviteLinkPath(pending));
    } catch {
      /* no storage, no memory of an invite */
    }
  }, [user, router]);

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

  /**
   * Already in a clinic, and not here to add one: go to the dashboard.
   *
   * This is the screen the tester saw after refreshing — the same "name your clinic" form,
   * because the page never checked whether they already had one. It is also the natural landing
   * for a refresh after a slow signup, so the signup attempt is closed here as well.
   */
  useEffect(() => {
    if (!user || wantsAnother === null || wantsAnother || pendingClinicId) return;
    if (alreadyBelongs) {
      finishSignupAttempt();
      router.replace("/");
    }
  }, [user, wantsAnother, alreadyBelongs, pendingClinicId, router]);

  // The role landed. Only now is it safe to leave — ClinicContext will find the clinic.
  useEffect(() => {
    if (!pendingClinicId) return;
    if (user?.clinicRoles?.[pendingClinicId]) {
      finishSignupAttempt();
      router.replace(freshClinic ? SETUP_ROUTE : "/");
    }
  }, [pendingClinicId, user, router, freshClinic]);

  /**
   * The listener is taking too long. The server has already confirmed the clinic and the role
   * exist, so reload into the dashboard — a full page load fetches the user document afresh,
   * which is what the quiet listener failed to deliver. Once per clinic per tab: if that reload
   * lands back here, something else is wrong and looping would only hide it, so the second time
   * round the page stops and shows a button instead.
   */
  useEffect(() => {
    if (!pendingClinicId) return;
    const timer = setTimeout(() => {
      let reloadedBefore = false;
      try {
        reloadedBefore = sessionStorage.getItem(RELOADED_FOR_STORAGE) === pendingClinicId;
        if (!reloadedBefore) sessionStorage.setItem(RELOADED_FOR_STORAGE, pendingClinicId);
      } catch {
        // No storage means no loop guard, so no automatic reload either — show the button.
        reloadedBefore = true;
      }
      if (reloadedBefore) setSlowGrant(true);
      else reloadIntoApp(freshClinic);
    }, ROLE_ARRIVAL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [pendingClinicId, freshClinic]);

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
      // The signup key is what lets the server tell "the same signup, tried again" from "a second
      // clinic on purpose": it is minted once per tab and survives a refresh.
      const res = await fetch("/api/onboarding/create-clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicName: name, signupKey: currentSignupKey() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || t.createFailed);

      // Hold here until the role reaches this client, rather than navigating into a dashboard
      // that would immediately reject us.
      setFreshClinic(true);
      setPendingClinicId(data.clinicId as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.createFailed);
      setCreating(false);
    }
  }, [clinicName, t.nameRequired, t.sessionExpired, t.createFailed]);

  /**
   * Approval arrives as a role on this user's document. The snapshot listener normally delivers
   * it within a second; a poll straight from the server every fifteen seconds covers the
   * listener going quiet, which is the failure that once made a fresh signup look broken.
   * Either way the person walks in without signing in again.
   */
  useEffect(() => {
    if (!awaitingClinicId || !user) return;
    const rememberClinic = () => {
      try {
        sessionStorage.setItem("preferredClinicId", awaitingClinicId);
      } catch {
        /* optional */
      }
    };
    if (user.clinicRoles?.[awaitingClinicId]) {
      rememberClinic();
      router.replace("/");
      return;
    }
    const uid = user.uid;
    const timer = setInterval(async () => {
      try {
        const snap = await getDocFromServer(doc(db, "users", uid));
        const roles = (snap.data()?.clinicRoles || {}) as Record<string, unknown>;
        if (roles[awaitingClinicId]) {
          rememberClinic();
          window.location.assign("/");
        }
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [awaitingClinicId, user, router]);

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
      setAwaitingClinicId(id);
      setJoinClinicId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.joinFailed);
    } finally {
      setJoining(false);
    }
  }, [joinClinicId, user, t.idRequired, t.joinFailed, t.sessionExpired]);

  // Hold the spinner until the "already belongs → dashboard" decision has been made, so the
  // create form is never flashed at someone who is about to be sent away from it.
  const leaving = alreadyBelongs && wantsAnother !== true && !pendingClinicId;
  if (!user || healing || leaving) {
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
                onClick={() => reloadIntoApp(freshClinic)}
                className="mt-6 w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-colors"
              >
                {t.openClinic}
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
            <p className="text-xs font-medium text-ink-muted leading-relaxed mb-4">
              {wantsAnother && alreadyBelongs ? t.anotherHelp : t.createHelp}
            </p>
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
                <p className="mt-3 text-xs font-bold text-accent flex items-center justify-center gap-2">
                  <Loader2 size={13} className="animate-spin" /> {t.joinWaiting}
                </p>
                <button
                  onClick={() => {
                    setJoinSent(false);
                    setAwaitingClinicId(null);
                  }}
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
