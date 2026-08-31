"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MessageCircle, Send, Check, Loader2, Inbox, Clock, ExternalLink, RotateCcw,
} from "lucide-react";
import { onSnapshot, query, where, updateDoc } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";

/**
 * The WhatsApp send list — messages the system wrote, waiting for a person to send.
 *
 * WhatsApp gives no way for an outside app to send on a clinic's behalf, so the honest free
 * option is this: the system decides who to message and writes the words; a human presses send.
 * The Android app has had this list for a while; this is the same queue on a computer, where
 * reception actually sits — clicking a row opens WhatsApp Web with the message already typed.
 *
 * Marking sent happens when the row is opened, not on a separate button, because a person who
 * has just been handed a prefilled chat sends it — and a list that needs two actions per message
 * is a list nobody finishes.
 */

interface QueuedMessage {
  id: string;
  to: string;
  text: string;
  type: string;
  patientName?: string;
  createdAt: string;
}

/** Matches the server and the Android app: after this a message is more confusing than useful. */
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** wa.me is WhatsApp's own documented link format — it opens the app on a phone and Web on a desktop. */
function waLink(phone: string, text: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function typeLabel(type: string, isAr: boolean): string {
  const map: Record<string, { en: string; ar: string }> = {
    lead_welcome: { en: "New lead reply", ar: "رد على عميل محتمل" },
    reminder24h: { en: "Appointment reminder", ar: "تذكير بموعد" },
    new: { en: "New appointment", ar: "موعد جديد" },
    edit: { en: "Appointment changed", ar: "تعديل موعد" },
    cancel: { en: "Appointment cancelled", ar: "إلغاء موعد" },
    invoice: { en: "Payment receipt", ar: "إيصال دفع" },
    treatment: { en: "Treatment summary", ar: "ملخص علاج" },
    google_review: { en: "Review request", ar: "طلب تقييم" },
    reactivation: { en: "We miss you", ar: "نفتقدك" },
  };
  // The appointment queue writer prefixes its types (`appointment_new`), the reminder sweep and
  // lead reply do not (`reminder24h`, `lead_welcome`) — accept both spellings of the same thing.
  const row = map[type] || map[type.replace(/^appointment_/, "")];
  return row ? (isAr ? row.ar : row.en) : type;
}

function ago(iso: string, isAr: boolean): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return isAr ? "دلوقتي" : "just now";
  if (mins < 60) return isAr ? `من ${mins} دقيقة` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isAr ? `من ${hours} ساعة` : `${hours}h ago`;
  return isAr ? `من ${Math.round(hours / 24)} يوم` : `${Math.round(hours / 24)}d ago`;
}

export default function MessagesPage() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { showToast } = useUI();

  const [messages, setMessages] = useState<QueuedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [showSent, setShowSent] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(getClinicCollection("whatsapp_outbox"), where("status", "==", showSent ? "sent" : "queued"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as QueuedMessage));
        setMessages(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [user, showSent]);

  const visible = useMemo(() => {
    const now = Date.now();
    return messages
      .filter((m) => showSent || now - Date.parse(m.createdAt || "") < STALE_MS)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [messages, showSent]);

  const markSent = async (m: QueuedMessage) => {
    setBusyId(m.id);
    try {
      await updateDoc(getClinicDoc("whatsapp_outbox", m.id), {
        status: "sent",
        sentAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Mark sent failed:", e);
      showToast(isAr ? "حصل خطأ" : "Could not update", "error");
    } finally {
      setBusyId("");
    }
  };

  const openAndSend = (m: QueuedMessage) => {
    window.open(waLink(m.to, m.text), "_blank", "noopener,noreferrer");
    void markSent(m);
  };

  return (
    <PermissionGuard permission="access.patients">
      <div className="min-h-screen bg-transparent pb-24 lg:pb-10" dir={isAr ? "rtl" : "ltr"}>
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-5 sm:py-8">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                <MessageCircle size={22} />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  {isAr ? "رسائل للإرسال" : "Messages to send"}
                </h1>
                <p className="text-xs text-ink-muted font-bold">
                  {isAr
                    ? "الرسايل جاهزة — اضغط وابعت من واتساب ويب"
                    : "Written and ready — click to send from WhatsApp Web"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowSent((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-line text-xs font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle transition-colors"
            >
              {showSent ? <Inbox size={14} /> : <RotateCcw size={14} />}
              {showSent ? (isAr ? "المنتظرة" : "Waiting") : (isAr ? "المرسلة" : "Sent")}
            </button>
          </div>

          {/* How it works — reception should not have to be told twice. */}
          {!showSent && visible.length > 0 && (
            <p className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 mb-4 leading-relaxed">
              {isAr
                ? "اضغط على أي رسالة: واتساب هيفتح والكلام مكتوب — انت بس تدوس إرسال. الرسالة هتتشال من القايمة لوحدها."
                : "Click any message: WhatsApp opens with the words already typed — you just press send. It leaves this list by itself."}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-16 bg-surface rounded-2xl border border-dashed border-line">
              <p className="text-slate-400 font-bold text-sm">
                {showSent
                  ? isAr ? "مفيش رسايل اتبعتت لسه." : "Nothing sent yet."
                  : isAr ? "مفيش رسايل مستنية. كله متبعت 👌" : "Nothing waiting. All caught up 👌"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((m) => (
                <div
                  key={m.id}
                  className="bg-surface rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-4 flex items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-extrabold text-ink text-sm truncate">
                        {m.patientName || m.to}
                      </h3>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-surface-muted text-ink-body">
                        {typeLabel(m.type, isAr)}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                        <Clock size={10} /> {ago(m.createdAt, isAr)}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted font-bold mt-0.5" dir="ltr">{m.to}</p>
                    <p className="text-xs text-ink-body font-medium mt-1.5 whitespace-pre-wrap line-clamp-4 bg-surface-subtle rounded-xl px-3 py-2">
                      {m.text}
                    </p>
                  </div>

                  {showSent ? (
                    <span className="text-emerald-600 shrink-0 p-2" title={isAr ? "تم الإرسال" : "Sent"}>
                      <Check size={18} />
                    </span>
                  ) : (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => openAndSend(m)}
                        disabled={busyId === m.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-600 transition-colors disabled:opacity-50"
                      >
                        {busyId === m.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {isAr ? "ابعت" : "Send"}
                        <ExternalLink size={11} className="opacity-70" />
                      </button>
                      <button
                        onClick={() => void markSent(m)}
                        disabled={busyId === m.id}
                        className="text-[10px] font-bold text-slate-400 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-surface-subtle transition-colors"
                      >
                        {isAr ? "شيلها" : "Dismiss"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}
