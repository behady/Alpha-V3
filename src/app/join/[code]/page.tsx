"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, Building2, Check, Loader2, LogIn, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { auth } from "@/lib/firebase";
import { PENDING_INVITE_STORAGE, isValidInviteCode, normalizeInviteCode } from "@/lib/inviteLinks";

/**
 * Where an invite link lands.
 *
 * Signed out: say what the link is for (clinic and role, from the public peek), remember the
 * code, and send the person to sign in or sign up. Signed in: accept the invite, wait for the
 * new role to reach this browser, and open the clinic. Errors are said in words the person can
 * act on — "expired, ask for a new one" — never as a spinner.
 */
type Peek = { found: boolean; status?: string; clinicName?: string; role?: string };

const ROLE_AR: Record<string, string> = { Dentist: "طبيب", Receptionist: "استقبال", Assistant: "مساعد" };

/** The role arrives through a listener; if it is quiet, a full load fetches it. */
const ROLE_ARRIVAL_GRACE_MS = 5000;

export default function JoinByInvitePage() {
  const params = useParams<{ code: string }>();
  const code = normalizeInviteCode(params?.code);
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [peek, setPeek] = useState<Peek | null>(null);
  const [error, setError] = useState("");
  const [joinedClinicId, setJoinedClinicId] = useState<string | null>(null);
  const [joinedName, setJoinedName] = useState("");
  const accepted = useRef(false);

  const roleLabel = (role?: string) => (role ? (isAr ? ROLE_AR[role] || role : role) : "");

  const t = {
    checking: isAr ? "بنراجع الرابط…" : "Checking your link…",
    invalid: isAr ? "الرابط ده مش صحيح. اتأكد إنك فتحته زي ما اتبعت." : "This link isn't valid. Make sure you opened it exactly as it was sent.",
    notFound: isAr ? "الرابط ده مش موجود. اطلب رابط جديد من العيادة." : "This invite doesn't exist. Ask the clinic for a new link.",
    expired: isAr ? "الرابط ده انتهت صلاحيته. اطلب رابط جديد من العيادة." : "This invite link has expired. Ask the clinic for a new one.",
    revoked: isAr ? "العيادة لغت الرابط ده." : "The clinic cancelled this invite link.",
    used: isAr ? "الرابط ده اتستخدم بالفعل. اطلب رابط جديد من العيادة." : "This invite link has already been used. Ask the clinic for a new one.",
    youAreInvited: (clinic: string, role: string) =>
      isAr ? `معزوم تنضم لفريق ${clinic} بصفة ${role}` : `You're invited to join ${clinic} as ${role}`,
    signInToJoin: isAr ? "سجّل دخول أو اعمل حساب عشان تنضم" : "Sign in or create an account to join",
    joining: isAr ? "بنضيفك للعيادة…" : "Adding you to the clinic…",
    joined: (clinic: string) => (isAr ? `تمام! انت دلوقتي في ${clinic}` : `Done! You're now part of ${clinic}`),
    opening: isAr ? "بنفتح العيادة…" : "Opening the clinic…",
    openClinic: isAr ? "افتح العيادة" : "Open the clinic",
    signOut: isAr ? "تسجيل الخروج" : "Sign out",
    dashboard: isAr ? "الرجوع للوحة التحكم" : "Go to dashboard",
    failed: isAr ? "تعذّر قبول الدعوة." : "Could not accept the invite.",
  };

  // What is this link? Shown before sign-in, and used for the error copy after.
  useEffect(() => {
    if (!isValidInviteCode(code)) {
      setPeek({ found: false });
      setError(t.invalid);
      return;
    }
    fetch(`/api/invites/accept?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((data) => setPeek(data?.ok ? (data as Peek) : { found: false }))
      .catch(() => setPeek({ found: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Signed in with a good link: accept it, once.
  useEffect(() => {
    if (authLoading || !user || !peek?.found || accepted.current || error) return;
    if (peek.status && peek.status !== "active") {
      setError(peek.status === "revoked" ? t.revoked : peek.status === "expired" ? t.expired : t.used);
      return;
    }
    accepted.current = true;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/invites/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || t.failed);
        try {
          localStorage.removeItem(PENDING_INVITE_STORAGE);
          // Land in this clinic, not whichever one the account last used.
          sessionStorage.setItem("preferredClinicId", data.clinicId);
        } catch {
          /* storage optional */
        }
        setJoinedName(peek.clinicName || "");
        setJoinedClinicId(data.clinicId as string);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.failed);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, peek, error, code]);

  // The role reached this browser: go in. If it is slow, a full load fetches it.
  useEffect(() => {
    if (!joinedClinicId) return;
    if (user?.clinicRoles?.[joinedClinicId]) {
      router.replace("/");
      return;
    }
    const timer = setTimeout(() => window.location.assign("/"), ROLE_ARRIVAL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [joinedClinicId, user, router]);

  const goSignIn = () => {
    try {
      localStorage.setItem(PENDING_INVITE_STORAGE, code);
    } catch {
      /* the query string carries it too */
    }
    router.push(`/login?invite=${encodeURIComponent(code)}`);
  };

  const notFoundError = peek && !peek.found && !error ? t.notFound : "";
  const shownError = error || notFoundError;

  return (
    <div className="min-h-screen bg-surface-subtle flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="bg-surface rounded-3xl border border-line shadow-sm p-8 sm:p-10 max-w-md w-full text-center">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 ${shownError ? "bg-red-50 text-red-600" : "bg-accent-tint text-accent"}`}>
          {shownError ? <AlertCircle size={28} /> : joinedClinicId ? <Check size={28} /> : <Building2 size={28} />}
        </div>

        {shownError ? (
          <>
            <p className="text-base font-bold text-ink">{shownError}</p>
            <div className="mt-6 flex flex-col gap-3">
              {user ? (
                <button onClick={() => router.replace("/")} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl">{t.dashboard}</button>
              ) : (
                <button onClick={() => router.replace("/login")} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl">{isAr ? "تسجيل الدخول" : "Sign in"}</button>
              )}
            </div>
          </>
        ) : !peek || authLoading ? (
          <>
            <Loader2 className="animate-spin mx-auto text-ink-muted" size={22} />
            <p className="mt-3 text-sm font-semibold text-ink-muted">{t.checking}</p>
          </>
        ) : joinedClinicId ? (
          <>
            <h1 className="text-xl font-black text-ink">{t.joined(joinedName || (isAr ? "العيادة" : "the clinic"))}</h1>
            <p className="mt-2 text-sm font-medium text-ink-muted flex items-center justify-center gap-2">
              <Loader2 className="animate-spin" size={14} /> {t.opening}
            </p>
            <button onClick={() => window.location.assign("/")} className="mt-6 w-full bg-slate-900 text-white font-bold py-3 rounded-xl">{t.openClinic}</button>
          </>
        ) : !user ? (
          <>
            <h1 className="text-xl font-black text-ink">{t.youAreInvited(peek.clinicName || "", roleLabel(peek.role))}</h1>
            <button onClick={goSignIn} className="mt-6 w-full bg-accent hover:bg-accent-strong text-white font-black py-3.5 rounded-xl inline-flex items-center justify-center gap-2">
              <LogIn size={18} /> {t.signInToJoin}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-black text-ink">{t.youAreInvited(peek.clinicName || "", roleLabel(peek.role))}</h1>
            <p className="mt-3 text-sm font-medium text-ink-muted flex items-center justify-center gap-2">
              <Loader2 className="animate-spin" size={14} /> {t.joining}
            </p>
          </>
        )}

        {user && !joinedClinicId && (
          <button onClick={logout} className="mt-5 text-sm font-medium text-ink-muted hover:text-ink inline-flex items-center gap-1.5">
            <LogOut size={15} /> {t.signOut}
          </button>
        )}
      </div>
    </div>
  );
}
