"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCheck, Clock, Loader2, MessageSquareText, Reply, Send, UserRound } from "lucide-react";
import { onSnapshot, query, where, updateDoc } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc, getGlobalClinicId } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";

/**
 * The conversations the WhatsApp assistant handed to a person.
 *
 * The bot promises "someone from the clinic will contact you" in a dozen situations — a medical
 * message, a complaint, a photo it cannot read, a question the clinic never wrote an answer for.
 * Every one of those is a row here until somebody deals with it. Before this list existed the
 * promise was a flag on a document no screen read; a swollen face at 1am reached exactly as many
 * people as a sticker.
 *
 * The reply box is the other half. On the official channel the clinic's number lives on Meta's
 * servers, not in a phone, so this is the only way a receptionist can answer at all — and
 * replying tells the bot to stay out of the thread for an hour.
 */

interface Handoff {
  id: string;
  phone?: string;
  patientId?: string;
  patientName?: string;
  handoffReason?: string;
  lastInbound?: string;
  severity?: "urgent" | "complaint" | "normal";
  handoffAtMs?: number;
}

/** Free-form replies on the official channel only deliver inside 24h of the patient's message. */
const REPLY_WINDOW_WARN_MS = 23 * 60 * 60 * 1000;

/** Why the bot stepped back, in the receptionist's words. */
function handoffLabel(reason: string, isAr: boolean): string {
  const map: Record<string, { en: string; ar: string }> = {
    clinical: { en: "Medical — needs a dentist", ar: "حالة طبية — محتاجة دكتور" },
    ai_handoff_medical: { en: "Medical question", ar: "سؤال طبي" },
    media_image: { en: "Sent a photo", ar: "بعت صورة" },
    media_video: { en: "Sent a video", ar: "بعت فيديو" },
    media_audio: { en: "Sent a voice note", ar: "بعت رسالة صوتية" },
    media_document: { en: "Sent a file", ar: "بعت ملف" },
    media_location: { en: "Sent a location", ar: "بعت لوكيشن" },
    complaint: { en: "Complaint", ar: "شكوى" },
    ai_handoff_complaint: { en: "Complaint", ar: "شكوى" },
    ai_handoff_staff: { en: "Asked about a named dentist", ar: "سأل عن دكتور بالاسم" },
    ai_handoff_other: { en: "Question the bot couldn't answer", ar: "سؤال البوت معرفش يجاوبه" },
    asked_for_human: { en: "Asked for a person", ar: "طلب يكلم حد" },
    gave_up: { en: "Bot didn't understand", ar: "البوت مفهمش" },
    booking_request: { en: "Wants to book (no schedule set)", ar: "عايز يحجز (المواعيد مش متظبطة)" },
    booking_abandoned: { en: "Gave up mid-booking", ar: "سابها في نص الحجز" },
    too_many_open: { en: "Already has 3 open bookings", ar: "عنده ٣ حجوزات مفتوحة" },
    no_open_days: { en: "No open days to offer", ar: "مفيش أيام متاحة" },
    appointment_cancel: { en: "Wants to cancel", ar: "عايز يلغي الميعاد" },
    appointment_reschedule: { en: "Wants to move the appointment", ar: "عايز يغير الميعاد" },
    appointment_late: { en: "Running late", ar: "هيتأخر" },
    rate_limited: { en: "Messaged too many times", ar: "بعت رسايل كتير" },
    too_many_turns: { en: "Very long conversation", ar: "محادثة طويلة جداً" },
    unknown_number: { en: "Unknown number", ar: "رقم غير مسجل" },
    lid_unidentified: { en: "Couldn't identify the sender", ar: "مش عارفين مين اللي بعت" },
  };
  if (reason.endsWith("_unknown")) {
    return isAr ? "سؤال ملوش إجابة في الإعدادات" : "Question with no answer in Settings";
  }
  const row = map[reason];
  return row ? (isAr ? row.ar : row.en) : reason;
}

function ago(ms: number, isAr: boolean): string {
  if (!ms) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return isAr ? "دلوقتي" : "just now";
  if (mins < 60) return isAr ? `من ${mins} دقيقة` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isAr ? `من ${hours} ساعة` : `${hours}h ago`;
  return isAr ? `من ${Math.round(hours / 24)} يوم` : `${Math.round(hours / 24)}d ago`;
}

export default function HandoffInbox() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { showToast } = useUI();

  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [busyId, setBusyId] = useState("");
  const [replyFor, setReplyFor] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  // Sorted here rather than in the query so no composite index has to be deployed.
  useEffect(() => {
    if (!user) return;
    const q = query(getClinicCollection("whatsapp_conversations"), where("needsHuman", "==", true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Handoff))
          .sort((a, b) => (b.handoffAtMs || 0) - (a.handoffAtMs || 0));
        setHandoffs(rows);
      },
      (e) => console.error("Handoff inbox failed:", e)
    );
    return () => unsub();
  }, [user]);

  const markHandled = async (h: Handoff) => {
    setBusyId(h.id);
    try {
      await updateDoc(getClinicDoc("whatsapp_conversations", h.id), {
        needsHuman: false,
        handledAtMs: Date.now(),
        handledBy: user?.uid || null,
      });
    } catch (e) {
      console.error("Mark handled failed:", e);
      showToast(isAr ? "حصل خطأ" : "Could not update", "error");
    } finally {
      setBusyId("");
    }
  };

  const sendReply = async (h: Handoff) => {
    const text = replyText.trim();
    if (!text || !h.phone) return;
    setReplyBusy(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/whatsapp/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({
          // The clinic on screen — the server's fallback is the account's default clinic, which
          // is not necessarily this one (see ChatsPanel).
          clinicId: getGlobalClinicId(),
          phone: h.phone,
          text,
          patientId: h.patientId || "",
          patientName: h.patientName || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Send failed");
      // The server closed the row already; clear the composer so the next one starts clean.
      setReplyFor("");
      setReplyText("");
      // "Sent" only when it actually left. Queued means it is sitting in the manual send list.
      if (data?.mode === "queued") {
        showToast(isAr ? "اتحطت في قائمة الإرسال اليدوي (مفيش بوابة واتساب)" : "Saved to the manual send list (no WhatsApp gateway)", "error");
      } else {
        showToast(isAr ? "اتبعتت ✓" : "Sent ✓", "success");
      }
    } catch (e) {
      console.error("Reply failed:", e);
      showToast(isAr ? "الرسالة متبعتتش" : "Message was not sent", "error");
    } finally {
      setReplyBusy(false);
    }
  };

  if (handoffs.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-xl bg-amber-500 text-white flex items-center justify-center">
          <AlertTriangle size={14} />
        </span>
        <h2 className="text-sm font-black text-ink uppercase tracking-wide">
          {isAr ? "محتاجين حد يرد" : "Waiting for a person"}
        </h2>
        <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
          {handoffs.length}
        </span>
      </div>

      <div className="space-y-2">
        {handoffs.map((h) => {
          const urgent = h.severity === "urgent";
          const complaint = h.severity === "complaint";
          const stale = (h.handoffAtMs || 0) < Date.now() - REPLY_WINDOW_WARN_MS;
          const open = replyFor === h.id;
          return (
            <div
              key={h.id}
              className={`bg-surface rounded-2xl border shadow-sm p-3 sm:p-4 ${
                urgent ? "border-rose-300" : complaint ? "border-amber-300" : "border-line"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-extrabold text-ink text-sm truncate">
                      {h.patientName || h.phone || h.id}
                    </h3>
                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                        urgent
                          ? "bg-rose-100 text-rose-800"
                          : complaint
                            ? "bg-amber-100 text-amber-900"
                            : "bg-surface-muted text-ink-body"
                      }`}
                    >
                      {handoffLabel(h.handoffReason || "", isAr)}
                    </span>
                    {h.handoffAtMs ? (
                      <span className="text-[10px] font-bold text-ink-muted flex items-center gap-1">
                        <Clock size={10} /> {ago(h.handoffAtMs, isAr)}
                      </span>
                    ) : null}
                  </div>
                  {h.phone ? (
                    <p className="text-xs text-ink-muted font-bold mt-0.5" dir="ltr">{h.phone}</p>
                  ) : null}
                  {h.lastInbound ? (
                    <p
                      className="text-sm text-ink font-medium mt-1.5 whitespace-pre-wrap bg-surface-subtle rounded-xl px-3 py-2"
                      dir="auto"
                    >
                      {h.lastInbound}
                    </p>
                  ) : null}
                  {stale && (
                    <p className="text-[11px] font-bold text-amber-800 mt-1.5">
                      {isAr
                        ? "عدى أكتر من يوم — الرد من هنا ممكن ميوصلش على الرقم الرسمي. كلمه بالتليفون."
                        : "Over a day old — a reply from here may not deliver on the official number. Call them."}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  {h.phone && (
                    <button
                      onClick={() => {
                        setReplyFor(open ? "" : h.id);
                        setReplyText("");
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-600 transition-colors"
                    >
                      <Reply size={14} />
                      {isAr ? "رد" : "Reply"}
                    </button>
                  )}
                  <Link
                    href={`/ai?tab=chats&chat=${encodeURIComponent(h.id)}`}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface border border-line text-xs font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle transition-colors"
                  >
                    <MessageSquareText size={14} />
                    {isAr ? "المحادثة" : "Open chat"}
                  </Link>
                  {h.patientId && (
                    <Link
                      href={`/patients/${h.patientId}`}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface border border-line text-xs font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle transition-colors"
                    >
                      <UserRound size={14} />
                      {isAr ? "الملف" : "Patient"}
                    </Link>
                  )}
                  <button
                    onClick={() => void markHandled(h)}
                    disabled={busyId === h.id}
                    className="flex items-center gap-1 text-[10px] font-bold text-ink-muted hover:text-ink px-2 py-1 rounded-lg hover:bg-surface-subtle transition-colors disabled:opacity-50"
                  >
                    {busyId === h.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
                    {isAr ? "اتعامل معاه" : "Handled"}
                  </button>
                </div>
              </div>

              {open && (
                <div className="mt-3 flex items-end gap-2">
                  <textarea
                    rows={2}
                    dir="auto"
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={isAr ? "اكتب ردك للمريض…" : "Write your reply to the patient…"}
                    className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 resize-y"
                  />
                  <button
                    onClick={() => void sendReply(h)}
                    disabled={replyBusy || !replyText.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {replyBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {isAr ? "ابعت" : "Send"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
