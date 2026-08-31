"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Star, Loader2, CheckCircle2, HeartHandshake } from "lucide-react";

/**
 * The patient-facing happy-check page — opened from a WhatsApp link after a visit.
 *
 * One question, five stars. 4–5 forwards to the clinic's Google review page; 1–3 opens a
 * private "tell us what went wrong" box that reaches the clinic manager only. Arabic-first
 * because that is the patients' language; every label carries an English echo.
 *
 * Public and unauthenticated on purpose — see /api/public/review for the security story.
 */
export default function PublicReviewPage() {
  const params = useParams<{ clinicId: string; requestId: string }>();
  const clinicId = String(params?.clinicId || "");
  const requestId = String(params?.requestId || "");

  const [phase, setPhase] = useState<"loading" | "rate" | "feedback" | "thanks" | "google" | "invalid" | "already">("loading");
  const [clinicName, setClinicName] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clinicId || !requestId) {
      setPhase("invalid");
      return;
    }
    fetch(`/api/public/review?c=${encodeURIComponent(clinicId)}&r=${encodeURIComponent(requestId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setPhase("invalid");
          return;
        }
        setClinicName(String(data.clinicName || ""));
        setPhase(data.alreadyRated ? "already" : "rate");
      })
      .catch(() => setPhase("invalid"));
  }, [clinicId, requestId]);

  const submit = async (stars: number, text: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/public/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, requestId, rating: stars, feedback: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPhase(res.status === 409 ? "already" : "invalid");
        return;
      }
      if (data.happy && data.redirectUrl) {
        setPhase("google");
        window.location.href = data.redirectUrl;
        return;
      }
      setPhase("thanks");
    } catch {
      setPhase("invalid");
    } finally {
      setBusy(false);
    }
  };

  const pick = (stars: number) => {
    setRating(stars);
    if (stars >= 4) {
      void submit(stars, "");
    } else {
      setPhase("feedback");
    }
  };

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-gradient-to-b from-emerald-50 via-white to-white flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-surface rounded-3xl border border-line shadow-xl shadow-emerald-100/40 p-7 text-center">
        {phase === "loading" && <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto my-12" />}

        {phase === "invalid" && (
          <div className="py-10">
            <p className="text-lg font-black text-slate-800 mb-1">هذا الرابط غير صالح</p>
            <p className="text-sm text-slate-400 font-bold">This link is not valid</p>
          </div>
        )}

        {phase === "already" && (
          <div className="py-10">
            <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-4" />
            <p className="text-lg font-black text-slate-800 mb-1">تم تسجيل تقييمك من قبل — شكراً لك 💚</p>
            <p className="text-sm text-slate-400 font-bold">This visit was already rated — thank you</p>
          </div>
        )}

        {(phase === "rate" || phase === "feedback") && (
          <>
            <p className="text-xs font-black tracking-wide text-emerald-600 mb-2">{clinicName}</p>
            <h1 className="text-xl font-black text-ink mb-1">كيف كانت زيارتك لنا؟</h1>
            <p className="text-xs text-slate-400 font-bold mb-6">How was your visit?</p>

            <div className="flex justify-center gap-2 mb-2" dir="ltr">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  disabled={busy || phase === "feedback"}
                  onClick={() => pick(s)}
                  onMouseEnter={() => setHover(s)}
                  onMouseLeave={() => setHover(0)}
                  className="p-1.5 transition-transform hover:scale-110 disabled:hover:scale-100"
                  aria-label={`${s} stars`}
                >
                  <Star
                    size={38}
                    className={
                      s <= (hover || rating)
                        ? "text-amber-400 fill-amber-400"
                        : "text-slate-200 fill-slate-100"
                    }
                  />
                </button>
              ))}
            </div>
            <p className="text-[11px] font-bold text-slate-300 mb-4">اضغط على النجوم للتقييم · tap to rate</p>

            {phase === "feedback" && (
              <div className="text-start space-y-3 animate-in fade-in slide-in-from-bottom-2">
                <p className="text-sm font-black text-slate-700 text-center">
                  نعتذر إن كانت الزيارة أقل من توقعاتك 🙏
                  <span className="block text-xs text-slate-400 font-bold mt-1">
                    قولنا إيه اللي ضايقك — رسالتك تصل لإدارة العيادة مباشرة، ولا تُنشر في أي مكان
                  </span>
                </p>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  dir="auto"
                  placeholder="اكتب هنا…"
                  className="w-full bg-surface-subtle border border-line rounded-2xl p-3.5 text-sm text-slate-800 outline-none focus:border-emerald-400 resize-none"
                />
                <button
                  onClick={() => void submit(rating, feedback)}
                  disabled={busy}
                  className="w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-60"
                >
                  {busy ? "جارٍ الإرسال…" : "إرسال للإدارة"}
                </button>
                <button
                  onClick={() => void submit(rating, "")}
                  disabled={busy}
                  className="w-full py-2 text-xs font-bold text-slate-400 hover:text-ink-body"
                >
                  إرسال بدون تفاصيل
                </button>
              </div>
            )}
          </>
        )}

        {phase === "google" && (
          <div className="py-10">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
            <p className="text-sm font-black text-slate-700">جارٍ تحويلك لصفحة التقييم على جوجل…</p>
            <p className="text-xs text-slate-400 font-bold mt-1">Taking you to Google reviews…</p>
          </div>
        )}

        {phase === "thanks" && (
          <div className="py-10">
            <HeartHandshake size={40} className="mx-auto text-emerald-500 mb-4" />
            <p className="text-lg font-black text-slate-800 mb-1">وصلت رسالتك لإدارة العيادة</p>
            <p className="text-sm text-ink-muted font-bold leading-relaxed">
              شكراً لصراحتك — سنتواصل معك لنصحح الأمر 💚
            </p>
            <p className="text-xs text-slate-400 font-bold mt-2">Your message went straight to the clinic&apos;s management — thank you.</p>
          </div>
        )}
      </div>
    </div>
  );
}
