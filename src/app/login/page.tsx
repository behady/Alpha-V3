"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck, KeyRound, AlertCircle, CheckCircle2, Building2, User } from "lucide-react";
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";

// Where the login page hands the chosen workspace to ClinicContext. Mirrors the existing
// superAdminClinicId pattern; ClinicContext clears both on logout.
const PREFERRED_CLINIC_KEY = "preferredClinicId";

export default function LoginPage() {
  const router = useRouter();
  const { language, isRTL } = useLanguage();

  /**
   * Three screens, not two. There used to be no way to create an account at all — a new clinic
   * owner arriving here could only sign in, reset a password they had never set, or use Google.
   * Typing their email and a password they had just invented returned "Incorrect email or
   * password", which reads as "you got your details wrong" when the truth is "you have no
   * account yet", so the only thing to do was try again. That is the loop this mode ends.
   */
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const isResetMode = mode === "reset";
  const isSignUpMode = mode === "signup";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [loading, setLoading] = useState(false);

  // Status states
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const switchMode = (next: "signin" | "signup" | "reset") => {
    setMode(next);
    setErrorMsg("");
    setSuccessMsg("");
  };

  // --- TRANSLATION DICTIONARY ---
  const txt = {
    welcome: language === 'ar' ? "مرحباً بك في ألفا" : "Welcome to Alpha",
    subWelcome: language === 'ar' ? "قم بتسجيل الدخول للوصول إلى نظام العيادة" : "Sign in to access your clinic system",
    signUpTitle: language === 'ar' ? "إنشاء حساب جديد" : "Create your account",
    signUpSub: language === 'ar'
      ? "افتح حساب، وبعدها هنطلب منك اسم العيادة على طول."
      : "Create an account, then we'll ask for your clinic name on the next screen.",
    resetTitle: language === 'ar' ? "استعادة كلمة المرور" : "Reset Password",
    resetSub: language === 'ar' ? "سنرسل لك رابطاً لإنشاء كلمة مرور جديدة" : "We'll send you a link to create a new password",
    name: language === 'ar' ? "اسمك" : "Your name",
    email: language === 'ar' ? "البريد الإلكتروني" : "Email Address",
    password: language === 'ar' ? "كلمة المرور" : "Password",
    passwordHint: language === 'ar' ? "٦ أحرف على الأقل." : "At least 6 characters.",
    loginBtn: language === 'ar' ? "تسجيل الدخول" : "Sign In",
    signUpBtn: language === 'ar' ? "إنشاء الحساب" : "Create account",
    resetBtn: language === 'ar' ? "إرسال رابط الاستعادة" : "Send Reset Link",
    forgotPass: language === 'ar' ? "نسيت كلمة المرور؟" : "Forgot Password?",
    backToLogin: language === 'ar' ? "العودة لتسجيل الدخول" : "Back to Sign In",
    newHere: language === 'ar' ? "عيادة جديدة؟" : "New clinic?",
    createOne: language === 'ar' ? "أنشئ حساباً" : "Create an account",
    haveAccount: language === 'ar' ? "عندك حساب بالفعل؟" : "Already have an account?",
    successReset: language === 'ar' ? "تم إرسال رابط الاستعادة! تفقد بريدك الإلكتروني." : "Reset link sent! Please check your inbox.",
    clinicId: language === 'ar' ? "رقم العيادة (اختياري)" : "Clinic ID (optional)",
    clinicHint: language === 'ar'
      ? "اتركه فارغاً للدخول إلى عيادتك الافتراضية."
      : "Leave blank to open your default clinic.",
  };

  // --- SMART ERROR TRANSLATOR ---
  const getFriendlyError = (errorCode: string) => {
    switch (errorCode) {
      case 'auth/invalid-email':
        return language === 'ar' ? "صيغة البريد الإلكتروني غير صحيحة." : "Invalid email address format.";
      case 'auth/user-disabled':
        return language === 'ar' ? "تم إيقاف هذا الحساب. يرجى مراجعة الإدارة." : "This account has been disabled. Contact admin.";
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        // Firebase deliberately will not say which of the two was wrong, so neither can we — but
        // "no account yet" is the single most likely reason someone lands here, and the old
        // wording sent those people back to retype the same details forever.
        return language === 'ar'
          ? "البريد الإلكتروني أو كلمة المرور غير صحيحة. لو لسه معندكش حساب، اضغط «أنشئ حساباً» تحت."
          : "Incorrect email or password. If you don't have an account yet, use \"Create an account\" below.";
      case 'auth/email-already-in-use':
        return language === 'ar'
          ? "فيه حساب بالبريد ده بالفعل. سجّل الدخول، أو استخدم «نسيت كلمة المرور؟»."
          : "An account with this email already exists. Sign in instead, or use \"Forgot Password?\".";
      case 'auth/weak-password':
        return language === 'ar' ? "كلمة المرور قصيرة. لازم ٦ أحرف على الأقل." : "Password is too short — use at least 6 characters.";
      case 'auth/operation-not-allowed':
        return language === 'ar'
          ? "تسجيل الحسابات بالبريد غير مفعّل على النظام. استخدم «المتابعة باستخدام حساب جوجل»."
          : "Email sign-up is not enabled on this system. Please use \"Continue with Google\".";
      case 'auth/too-many-requests':
        return language === 'ar' ? "محاولات كثيرة خاطئة. يرجى المحاولة لاحقاً." : "Too many failed attempts. Please try again later.";
      default:
        return language === 'ar' ? "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى." : "An unexpected error occurred. Please try again.";
    }
  };

  /**
   * Google sign-in fails for reasons email sign-in never does, and they need different answers —
   * a blocked pop-up is the user's browser, an unauthorised domain is the Firebase console, and a
   * closed pop-up is not an error at all. This path used to render one sentence for all of them,
   * which told nobody anything and made the failures impossible to report.
   */
  const getGoogleError = (errorCode: string) => {
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    switch (errorCode) {
      case 'auth/unauthorized-domain':
        return language === 'ar'
          ? `العنوان ده (${host}) مش مسموح بيه في Firebase. ضيفه من: Firebase Console ← Authentication ← Settings ← Authorized domains.`
          : `This address (${host}) is not on Firebase's allowed list. Add it in Firebase Console → Authentication → Settings → Authorized domains.`;
      case 'auth/popup-blocked':
        return language === 'ar'
          ? "المتصفح منع النافذة المنبثقة. اسمح بالنوافذ المنبثقة للموقع ده وجرّب تاني."
          : "Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.";
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return language === 'ar'
          ? "تم إغلاق نافذة جوجل قبل ما تكمل. جرّب تاني."
          : "The Google window closed before sign-in finished. Try again.";
      case 'auth/operation-not-allowed':
        return language === 'ar'
          ? "الدخول بحساب جوجل غير مفعّل على النظام. فعّله من: Firebase Console ← Authentication ← Sign-in method ← Google."
          : "Google sign-in is not enabled for this project. Turn it on in Firebase Console → Authentication → Sign-in method → Google.";
      case 'auth/account-exists-with-different-credential':
        return language === 'ar'
          ? "فيه حساب بنفس البريد ده مسجّل بطريقة تانية. سجّل الدخول بالبريد وكلمة المرور."
          : "An account with this email already exists using a different sign-in method. Sign in with email and password instead.";
      case 'auth/network-request-failed':
        return language === 'ar' ? "مفيش اتصال بالإنترنت. اتأكد من الشبكة وجرّب تاني." : "No network connection. Check your internet and try again.";
      default:
        return language === 'ar'
          ? `فشل تسجيل الدخول بواسطة جوجل (${errorCode || "unknown"}).`
          : `Google sign-in failed (${errorCode || "unknown"}).`;
    }
  };

  // Confirms the signed-in account actually holds a role in the requested clinic, and records the
  // choice for ClinicContext to pick up. Note this is a routing guard, not an auth factor: Firebase
  // authenticates on the credential alone, and Firestore rules are what actually keep one clinic's
  // data out of another's. This exists so a multi-clinic user lands in the workspace they asked for
  // and gets a clear message when they typo the ID — instead of silently opening the wrong clinic.
  const applyClinicSelection = async (uid: string): Promise<boolean> => {
    const requested = clinicId.trim();
    if (!requested) {
      sessionStorage.removeItem(PREFERRED_CLINIC_KEY);
      return true;
    }

    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : null;
    const hasRole = Boolean(data?.clinicRoles?.[requested]);

    if (!hasRole && data?.isSuperAdmin !== true) {
      await signOut(auth);
      sessionStorage.removeItem(PREFERRED_CLINIC_KEY);
      setErrorMsg(
        language === "ar"
          ? "هذا الحساب لا يملك صلاحية على هذه العيادة. تأكد من رقم العيادة."
          : "This account has no access to that clinic. Check the Clinic ID."
      );
      setLoading(false);
      return false;
    }

    sessionStorage.setItem(PREFERRED_CLINIC_KEY, requested);
    return true;
  };

  const handleGoogleLogin = async () => {
    setErrorMsg("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      if (!(await applyClinicSelection(cred.user.uid))) return;
      router.push("/"); // Redirect to dashboard on success
    } catch (error: any) {
      console.error("Google sign-in failed:", error?.code, error);
      setErrorMsg(getGoogleError(error?.code || ""));
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setErrorMsg("");
    setLoading(true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (!(await applyClinicSelection(cred.user.uid))) return;
      router.push("/");
    } catch (error: any) {
      console.error(error);
      setErrorMsg(getFriendlyError(error.code));
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setErrorMsg("");
    setLoading(true);

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const chosenName = name.trim();
      if (chosenName) {
        await updateProfile(cred.user, { displayName: chosenName });
        /**
         * AuthContext creates the user document the moment the account exists, which is before
         * updateProfile above has run — so the profile it writes says "Unknown User" and, being
         * driven by a snapshot listener, it never revisits that. Writing the name here is what
         * makes the onboarding screen greet the owner by name instead. Merge, and only this
         * field: firestore.rules forbid a user touching their own clinicRoles.
         */
        await setDoc(doc(db, "users", cred.user.uid), { name: chosenName }, { merge: true });
      }
      // A brand-new account has no clinic, so ClinicContext will route to /onboarding from here.
      router.push("/");
    } catch (error: any) {
      console.error(error);
      setErrorMsg(getFriendlyError(error.code));
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccessMsg(txt.successReset);
    } catch (error: any) {
      console.error(error);
      setErrorMsg(getFriendlyError(error.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans selection:bg-primary-100 selection:text-primary-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-md w-full bg-white rounded-[2.5rem] p-8 md:p-10 shadow-2xl shadow-slate-200/50 border border-slate-100 animate-in fade-in zoom-in-95 duration-500">
        
        {/* LOGO & HEADER */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-16 h-16 bg-slate-900 text-white rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-slate-900/20">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {isResetMode ? txt.resetTitle : isSignUpMode ? txt.signUpTitle : txt.welcome}
          </h1>
          <p className="text-slate-500 font-medium mt-2">
            {isResetMode ? txt.resetSub : isSignUpMode ? txt.signUpSub : txt.subWelcome}
          </p>
        </div>

        {/* ALERTS */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold flex items-start gap-3 border border-red-100 animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <p>{errorMsg}</p>
          </div>
        )}
        
        {successMsg && (
          <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-2xl text-sm font-bold flex items-start gap-3 border border-green-100 animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
            <p>{successMsg}</p>
          </div>
        )}

        {isResetMode ? (
          <form onSubmit={handleResetPassword} className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div>
              <div className="relative">
                <Mail size={20} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={txt.email}
                  className={`w-full py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-slate-800 font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
                  required
                />
              </div>
            </div>
            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <KeyRound size={18} />}
              {txt.resetBtn}
            </button>
          </form>
        ) : isSignUpMode ? (
          <form onSubmit={handleSignUp} className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="relative">
              <User size={20} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={txt.name}
                autoComplete="name"
                className={`w-full py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-slate-800 font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
                required
              />
            </div>
            <div className="relative">
              <Mail size={20} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={txt.email}
                autoComplete="email"
                className={`w-full py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-slate-800 font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
                required
              />
            </div>
            <div>
              <div className="relative">
                <Lock size={20} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={txt.password}
                  autoComplete="new-password"
                  minLength={6}
                  className={`w-full py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-slate-800 font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
                  required
                />
              </div>
              <p className={`text-xs font-medium text-slate-400 mt-2 ${isRTL ? 'pr-2' : 'pl-2'}`}>
                {txt.passwordHint}
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-emerald-900/20 hover:bg-accent-strong hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-60"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <>{txt.signUpBtn} {isRTL ? <ArrowRight size={18} className="rotate-180" /> : <ArrowRight size={18} />}</>}
            </button>

            <div className="relative flex py-5 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="shrink-0 mx-4 text-slate-400 text-xs font-bold uppercase tracking-wider">{language === 'ar' ? 'أو' : 'OR'}</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full bg-white border-2 border-slate-200 text-slate-700 py-4 rounded-2xl font-black text-sm shadow-sm hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin text-slate-400" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  {language === 'ar' ? 'المتابعة باستخدام حساب جوجل' : 'Continue with Google'}
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleEmailLogin} className="space-y-4 animate-in fade-in slide-in-from-left-4">
            <div>
              <div className="relative">
                <Mail size={20} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={txt.email}
                  className={`w-full py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-slate-800 font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
                  required
                />
              </div>
            </div>
            <div>
              <div className="relative">
                <Lock size={20} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={txt.password}
                  className={`w-full py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-slate-800 font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
                  required
                />
              </div>
            </div>
            
            <div>
              <div className="relative">
                <Building2 size={20} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="text"
                  value={clinicId}
                  onChange={(e) => setClinicId(e.target.value)}
                  placeholder={txt.clinicId}
                  autoComplete="off"
                  spellCheck={false}
                  className={`w-full py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-slate-800 font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
                />
              </div>
              <p className={`text-xs font-medium text-slate-400 mt-2 ${isRTL ? 'pr-2' : 'pl-2'}`}>
                {txt.clinicHint}
              </p>
            </div>

            <div className={`flex ${isRTL ? 'justify-start' : 'justify-end'} pt-1`}>
              <button
                type="button"
                onClick={() => switchMode("reset")}
                className="text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors"
              >
                {txt.forgotPass}
              </button>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2 mt-2"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <>{txt.loginBtn} {isRTL ? <ArrowRight size={18} className="rotate-180" /> : <ArrowRight size={18} />}</>}
            </button>
            
            <div className="relative flex py-5 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="shrink-0 mx-4 text-slate-400 text-xs font-bold uppercase tracking-wider">{language === 'ar' ? 'أو' : 'OR'}</span>
                <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* GOOGLE LOGIN BUTTON */}
            <button 
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full bg-white border-2 border-slate-200 text-slate-700 py-4 rounded-2xl font-black text-sm shadow-sm hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin text-slate-400" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  {language === 'ar' ? 'المتابعة باستخدام حساب جوجل' : 'Continue with Google'}
                </>
              )}
            </button>
          </form>
        )}

        {/* The way in and the way back. Without this a first-time owner has no signposted route
            to an account at all — which was the whole problem. */}
        <div className="mt-8 pt-6 border-t border-slate-100 text-center animate-in fade-in">
          {mode === "signin" ? (
            <p className="text-sm font-medium text-slate-500">
              {txt.newHere}{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="font-black text-accent hover:underline"
              >
                {txt.createOne}
              </button>
            </p>
          ) : mode === "signup" ? (
            <p className="text-sm font-medium text-slate-500">
              {txt.haveAccount}{" "}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="font-black text-slate-900 hover:underline"
              >
                {txt.loginBtn}
              </button>
            </p>
          ) : (
            <button
              onClick={() => switchMode("signin")}
              className="text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
            >
              {txt.backToLogin}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}