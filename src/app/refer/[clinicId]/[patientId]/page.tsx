"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, CheckCircle2, Phone, User, Gift } from "lucide-react";

/**
 * The friend's landing page — opened from a patient's referral QR card or shared link.
 *
 * One promise, two fields, done. The visitor becomes a lead in the clinic's inbox tagged
 * with WHO sent them, and reception calls back. Arabic-first with an English echo, same
 * as the review page, and public by design (see /api/public/referral for the guards).
 */
export default function PublicReferralPage() {
  const params = useParams<{ clinicId: string; patientId: string }>();
  const clinicId = String(params?.clinicId || "");
  const referrerId = String(params?.patientId || "");

  const [phase, setPhase] = useState<"loading" | "form" | "done" | "invalid">("loading");
  const [clinicName, setClinicName] = useState("");
  const [referrerFirstName, setReferrerFirstName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clinicId || !referrerId) {
      setPhase("invalid");
      return;
    }
    fetch(`/api/public/referral?c=${encodeURIComponent(clinicId)}&p=${encodeURIComponent(referrerId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setPhase("invalid");
          return;
        }
        setClinicName(String(data.clinicName || ""));
        setReferrerFirstName(String(data.referrerFirstName || ""));
        setPhase("form");
      })
      .catch(() => setPhase("invalid"));
  }, [clinicId, referrerId]);

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/public/referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, referrerId, name, phone, website: honeypot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(String(data.error || "Something went wrong"));
        return;
      }
      setPhase("done");
    } catch {
      setError("تعذر الإرسال — حاول مرة أخرى / Could not send, try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-gradient-to-b from-emerald-50 via-white to-white flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-surface rounded-3xl border border-line shadow-xl shadow-emerald-100/40 p-7">
        {phase === "loading" && <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto my-12" />}

        {phase === "invalid" && (
          <div className="py-10 text-center">
            <p className="text-lg font-black text-slate-800 mb-1">هذا الرابط غير صالح</p>
            <p className="text-sm text-slate-400 font-bold">This link is not valid</p>
          </div>
        )}

        {phase === "form" && (
          <>
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-emerald-500 text-white rounded-3xl flex items-center justify-center mx-auto mb-4">
                <Gift size={24} />
              </div>
              <p className="text-xs font-black tracking-wide text-emerald-600 mb-2">{clinicName}</p>
              <h1 className="text-xl font-black text-slate-900 leading-snug">
                {referrerFirstName ? `${referrerFirstName} رشّحلك عيادتنا 🦷` : "صديقك رشّحلك عيادتنا 🦷"}
              </h1>
              <p className="text-sm text-ink-muted font-bold mt-2 leading-relaxed">
                سيب اسمك ورقمك وهنكلمك نحجزلك موعد يناسبك
              </p>
              <p className="text-[11px] text-slate-400 font-bold mt-1">
                Leave your name and number — we&apos;ll call you back to book
              </p>
            </div>

            <div className="space-y-3">
              {/* Honeypot — invisible to people, irresistible to bots. */}
              <input
                type="text"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute opacity-0 h-0 w-0 pointer-events-none"
                placeholder="website"
              />
              <div className="relative">
                <User size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  dir="auto"
                  maxLength={120}
                  placeholder="الاسم / Name"
                  className="w-full ps-10 pe-4 py-3.5 bg-surface-subtle border border-line rounded-2xl text-sm font-bold text-slate-800 outline-none focus:border-emerald-400"
                />
              </div>
              <div className="relative">
                <Phone size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                  inputMode="tel"
                  maxLength={30}
                  placeholder="01xxxxxxxxx"
                  className="w-full ps-10 pe-4 py-3.5 bg-surface-subtle border border-line rounded-2xl text-sm font-bold text-slate-800 outline-none focus:border-emerald-400 text-left"
                />
              </div>

              {error && <p className="text-xs font-bold text-rose-600 text-center">{error}</p>}

              <button
                onClick={submit}
                disabled={busy || name.trim().length < 2 || phone.trim().length < 8}
                className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-50"
              >
                {busy ? "جارٍ الإرسال…" : "اطلب مكالمة من العيادة"}
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <div className="py-10 text-center">
            <CheckCircle2 size={44} className="mx-auto text-emerald-500 mb-4" />
            <p className="text-lg font-black text-slate-800 mb-1">وصلنا طلبك 🎉</p>
            <p className="text-sm text-ink-muted font-bold leading-relaxed">
              هنكلمك في أقرب وقت نحجزلك موعدك في {clinicName}
            </p>
            <p className="text-xs text-slate-400 font-bold mt-2">We got it — the clinic will call you shortly.</p>
          </div>
        )}
      </div>
    </div>
  );
}
