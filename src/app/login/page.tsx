"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck, KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";

export default function LoginPage() {
  const router = useRouter();
  const { language, isRTL } = useLanguage();

  const [isResetMode, setIsResetMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Status states
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // --- TRANSLATION DICTIONARY ---
  const txt = {
    welcome: language === 'ar' ? "مرحباً بك في ألفا" : "Welcome to Alpha",
    subWelcome: language === 'ar' ? "قم بتسجيل الدخول للوصول إلى نظام العيادة" : "Sign in to access your clinic system",
    resetTitle: language === 'ar' ? "استعادة كلمة المرور" : "Reset Password",
    resetSub: language === 'ar' ? "سندسل لك رابطاً لإنشاء كلمة مرور جديدة" : "We'll send you a link to create a new password",
    email: language === 'ar' ? "البريد الإلكتروني" : "Email Address",
    password: language === 'ar' ? "كلمة المرور" : "Password",
    loginBtn: language === 'ar' ? "تسجيل الدخول" : "Sign In",
    resetBtn: language === 'ar' ? "إرسال رابط الاستعادة" : "Send Reset Link",
    forgotPass: language === 'ar' ? "نسيت كلمة المرور؟" : "Forgot Password?",
    backToLogin: language === 'ar' ? "العودة لتسجيل الدخول" : "Back to Sign In",
    successReset: language === 'ar' ? "تم إرسال رابط الاستعادة! تفقد بريدك الإلكتروني." : "Reset link sent! Please check your inbox.",
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
        return language === 'ar' ? "البريد الإلكتروني أو كلمة المرور غير صحيحة." : "Incorrect email or password.";
      case 'auth/too-many-requests':
        return language === 'ar' ? "محاولات كثيرة خاطئة. يرجى المحاولة لاحقاً." : "Too many failed attempts. Please try again later.";
      default:
        return language === 'ar' ? "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى." : "An unexpected error occurred. Please try again.";
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      router.push("/"); // Redirect to dashboard on success
    } catch (error: any) {
      console.error(error);
      setErrorMsg(language === 'ar' ? "فشل تسجيل الدخول بواسطة جوجل. يرجى المحاولة مرة أخرى." : "Failed to sign in with Google. Please try again.");
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setErrorMsg("");
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
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
            {isResetMode ? txt.resetTitle : txt.welcome}
          </h1>
          <p className="text-slate-500 font-medium mt-2">
            {isResetMode ? txt.resetSub : txt.subWelcome}
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
            
            <div className={`flex ${isRTL ? 'justify-start' : 'justify-end'} pt-1`}>
              <button 
                type="button" 
                onClick={() => { setIsResetMode(true); setErrorMsg(""); setSuccessMsg(""); }}
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

        {isResetMode && (
          <div className="mt-8 text-center animate-in fade-in">
            <button 
              onClick={() => { setIsResetMode(false); setErrorMsg(""); setSuccessMsg(""); }}
              className="text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
            >
              {txt.backToLogin}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}