"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Hand,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  UserRound,
} from "lucide-react";
import { limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";

/**
 * Every WhatsApp conversation the clinic has, as a chat screen.
 *
 * On the official channel the clinic's number lives on Meta's servers. There is no phone with
 * WhatsApp on it to pick up and scroll — the thread the server keeps (lib/bot/thread.ts) is the
 * only copy. This is where staff read it and answer in it: a list of numbers on one side, the
 * conversation on the other, the bot's turns and the receptionist's in the same stream.
 *
 * "Take over" is the switch that matters. A person answering a patient while the bot is also
 * answering is two voices in one thread, and until now a staff reply only silenced the bot for an
 * hour. Taking over holds it until someone hands the thread back.
 */

interface ChatRow {
  id: string;
  phone?: string;
  patientId?: string;
  patientName?: string;
  lastText?: string;
  lastAt?: number;
  lastMessageAt?: number;
  handoffAtMs?: number;
  lastDirection?: "in" | "out";
  lastAuthor?: string;
  lastInboundAt?: number;
  unreadCount?: number;
  needsHuman?: boolean;
  handoffReason?: string;
  severity?: "urgent" | "complaint" | "normal";
  botPaused?: boolean;
  humanActiveAtMs?: number;
  channel?: "meta" | "wapilot";
  optedOut?: boolean;
}

interface ThreadLine {
  id: string;
  direction: "in" | "out";
  author: "patient" | "bot" | "staff" | "system";
  text: string;
  at: number;
  media?: string;
  /** Filled in a few seconds after the message lands, once the file is copied from Meta. */
  mediaUrl?: string;
  mime?: string;
  name?: string;
  kind?: string;
}

type Filter = "all" | "needs" | "unread";

/** Meta drops free text sent more than 24h after the patient's last message. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The hour a staff reply keeps the bot out of the thread (mirrors HUMAN_CLAIM_MS). */
const HUMAN_CLAIM_MS = 60 * 60 * 1000;

function lastActivity(c: ChatRow): number {
  return Math.max(c.lastAt || 0, c.lastMessageAt || 0, c.handoffAtMs || 0);
}

function ago(ms: number, isAr: boolean): string {
  if (!ms) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return isAr ? "دلوقتي" : "now";
  if (mins < 60) return isAr ? `${mins} د` : `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isAr ? `${hours} س` : `${hours}h`;
  const days = Math.round(hours / 24);
  return isAr ? `${days} ي` : `${days}d`;
}

function clock(ms: number, isAr: boolean): string {
  if (!ms) return "";
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(isAr ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" })} · ${time}`;
}

/** The system's message kinds, in the receptionist's words. Unknown slugs show as-is. */
function kindLabel(kind: string, isAr: boolean): string {
  const map: Record<string, { en: string; ar: string }> = {
    appointment_new: { en: "Booking confirmation", ar: "تأكيد حجز" },
    appointment_edit: { en: "Appointment changed", ar: "تعديل ميعاد" },
    appointment_cancel: { en: "Appointment cancelled", ar: "إلغاء ميعاد" },
    new: { en: "Booking confirmation", ar: "تأكيد حجز" },
    edit: { en: "Appointment changed", ar: "تعديل ميعاد" },
    cancel: { en: "Appointment cancelled", ar: "إلغاء ميعاد" },
    reminder24h: { en: "Reminder", ar: "تذكير" },
    reminder: { en: "Reminder", ar: "تذكير" },
    invoice: { en: "Receipt", ar: "إيصال" },
    payment: { en: "Receipt", ar: "إيصال" },
    google_review: { en: "Review request", ar: "طلب تقييم" },
    reactivation: { en: "We miss you", ar: "وحشتنا" },
    lead_welcome: { en: "Lead welcome", ar: "ترحيب بعميل" },
    prescription_pdf: { en: "Prescription", ar: "روشتة" },
    treatment_plan_pdf: { en: "Treatment plan", ar: "خطة علاج" },
    followup_template: { en: "Follow-up template", ar: "قالب متابعة" },
  };
  const row = map[kind];
  return row ? (isAr ? row.ar : row.en) : kind.replace(/_/g, " ");
}

function mediaLabel(media: string, isAr: boolean): string {
  const map: Record<string, { en: string; ar: string }> = {
    image: { en: "📷 Photo", ar: "📷 صورة" },
    video: { en: "🎬 Video", ar: "🎬 فيديو" },
    audio: { en: "🎤 Voice note", ar: "🎤 رسالة صوتية" },
    document: { en: "📎 File", ar: "📎 ملف" },
    sticker: { en: "Sticker", ar: "ستيكر" },
    location: { en: "📍 Location", ar: "📍 لوكيشن" },
    contacts: { en: "👤 Contact card", ar: "👤 كارت اتصال" },
  };
  const row = map[media];
  return row ? (isAr ? row.ar : row.en) : media;
}

export default function ChatsPanel() {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { showToast } = useUI();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [chats, setChats] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>(searchParams.get("chat") || "");

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      getClinicCollection("whatsapp_conversations"),
      (snap) => {
        setChats(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatRow)));
        setLoading(false);
      },
      (e) => {
        console.error("Chats list failed:", e);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase().replace(/\s+/g, "");
    return chats
      .filter((c) => lastActivity(c) > 0)
      .filter((c) => (filter === "needs" ? c.needsHuman === true : filter === "unread" ? (c.unreadCount || 0) > 0 : true))
      .filter((c) => {
        if (!needle) return true;
        const hay = `${c.patientName || ""}${c.phone || ""}${c.id}`.toLowerCase().replace(/\s+/g, "");
        return hay.includes(needle);
      })
      .sort((a, b) => lastActivity(b) - lastActivity(a));
  }, [chats, filter, search]);

  const selected = chats.find((c) => c.id === selectedId) || null;
  const needsCount = chats.filter((c) => c.needsHuman === true).length;
  const unreadCount = chats.reduce((n, c) => n + (c.unreadCount || 0), 0);

  const open = (id: string) => {
    setSelectedId(id);
    router.replace(`/ai?tab=chats&chat=${encodeURIComponent(id)}`, { scroll: false });
  };
  const back = () => {
    setSelectedId("");
    router.replace(`/ai?tab=chats`, { scroll: false });
  };

  return (
    <div
      className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden grid md:grid-cols-[320px_1fr] h-[calc(100vh-260px)] min-h-[520px]"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* The list. On a phone it is the whole panel until a chat is opened. */}
      <aside
        className={`border-line md:border-e flex flex-col min-h-0 ${selected ? "hidden md:flex" : "flex"}`}
      >
        <div className="p-3 border-b border-line space-y-2">
          <div className="relative">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? "ابحث بالاسم أو الرقم" : "Search name or number"}
              className="w-full rounded-xl border border-line bg-surface-subtle ps-9 pe-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-1">
            {(
              [
                ["all", isAr ? "الكل" : "All", 0],
                ["needs", isAr ? "محتاج حد" : "Needs a person", needsCount],
                ["unread", isAr ? "غير مقروء" : "Unread", unreadCount],
              ] as [Filter, string, number][]
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${
                  filter === key ? "bg-ink-slab text-white" : "text-ink-muted hover:text-ink hover:bg-surface-subtle"
                }`}
              >
                {label}
                {count > 0 && (
                  <span
                    className={`text-[10px] font-black px-1.5 rounded-full ${
                      filter === key ? "bg-white/20" : key === "needs" ? "bg-warn-tint text-warn" : "bg-accent-tint text-accent-strong"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 flex justify-center text-ink-muted">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquareText size={28} className="mx-auto text-ink-faint" />
              <p className="text-sm font-bold text-ink-muted mt-2">
                {chats.length === 0
                  ? isAr
                    ? "لسه مفيش محادثات. أول ما مريض يبعت على واتساب العيادة هتظهر هنا."
                    : "No chats yet. The first patient to write to the clinic's WhatsApp appears here."
                  : isAr
                    ? "مفيش نتايج"
                    : "Nothing matches"}
              </p>
            </div>
          ) : (
            visible.map((c) => {
              const active = c.id === selectedId;
              const unread = (c.unreadCount || 0) > 0;
              const urgent = c.needsHuman && c.severity === "urgent";
              return (
                <button
                  key={c.id}
                  onClick={() => open(c.id)}
                  className={`w-full text-start px-3 py-2.5 border-b border-line/60 transition-colors ${
                    active ? "bg-accent-tint" : "hover:bg-surface-subtle"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-black ${
                        urgent ? "bg-danger-tint text-danger" : c.needsHuman ? "bg-warn-tint text-warn" : "bg-surface-muted text-ink-body"
                      }`}
                    >
                      {urgent ? <AlertTriangle size={14} /> : (c.patientName || c.phone || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm truncate ${unread ? "font-black text-ink" : "font-bold text-ink-body"}`}>
                          {c.patientName || c.phone || c.id}
                        </span>
                        <span className="ms-auto text-[10px] font-bold text-ink-muted shrink-0">{ago(lastActivity(c), isAr)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs truncate ${unread ? "text-ink font-semibold" : "text-ink-muted"}`} dir="auto">
                          {c.lastDirection === "out" ? (isAr ? "أنت: " : "You: ") : ""}
                          {c.lastText || ""}
                        </span>
                        {unread && (
                          <span className="ms-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-ink-on-accent text-[10px] font-black flex items-center justify-center">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* The thread. */}
      <section className={`min-h-0 flex-col ${selected ? "flex" : "hidden md:flex"}`}>
        {selected ? (
          <Thread key={selected.id} chat={selected} onBack={back} isAr={isAr} showToast={showToast} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <MessageSquareText size={32} className="mx-auto text-ink-faint" />
              <p className="text-sm font-bold text-ink-muted mt-2">
                {isAr ? "اختار محادثة من القائمة" : "Pick a conversation from the list"}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Thread({
  chat,
  onBack,
  isAr,
  showToast,
}: {
  chat: ChatRow;
  onBack: () => void;
  isAr: boolean;
  showToast: (msg: string, kind: "success" | "error") => void;
}) {
  const { user } = useAuth();
  const [lines, setLines] = useState<ThreadLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templateSentAt, setTemplateSentAt] = useState(0);
  const [toggling, setToggling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    // Newest 200, then reversed: the recent end of a long thread is what a person opens it for.
    const q = query(getClinicCollection(`whatsapp_conversations/${chat.id}/messages`), orderBy("at", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ThreadLine)).reverse());
        setLoading(false);
      },
      (e) => {
        console.error("Thread failed:", e);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user, chat.id]);

  // Opening the thread reads it. Cleared on the parent so the list badge goes with it.
  useEffect(() => {
    if ((chat.unreadCount || 0) > 0) {
      updateDoc(getClinicDoc("whatsapp_conversations", chat.id), { unreadCount: 0, lastReadAtMs: Date.now() }).catch(() => {});
    }
  }, [chat.id, chat.unreadCount]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const isLid = chat.id.startsWith("lid_");
  const windowClosed = !!chat.lastInboundAt && Date.now() - chat.lastInboundAt > REPLY_WINDOW_MS;
  // Meta drops out-of-window text silently; the unofficial gateway does not. Block only where it
  // would silently fail — a disabled box the receptionist can see beats a "sent" that never lands.
  const blocked = isLid || (windowClosed && chat.channel === "meta") || chat.optedOut === true;
  const humanHold = chat.botPaused === true || (chat.humanActiveAtMs || 0) > Date.now() - HUMAN_CLAIM_MS;
  const handling = chat.botPaused === true || chat.needsHuman === true || humanHold;

  const post = async (payload: Record<string, string>) => {
    const idToken = await auth.currentUser?.getIdToken();
    const res = await fetch("/api/whatsapp/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({
        phone: chat.phone,
        patientId: chat.patientId || "",
        patientName: chat.patientName || "",
        ...payload,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || "Send failed");
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !chat.phone || sending) return;
    setSending(true);
    try {
      await post({ text: body });
      setText("");
    } catch (e) {
      console.error("Reply failed:", e);
      showToast(isAr ? "الرسالة متبعتتش" : "Message was not sent", "error");
    } finally {
      setSending(false);
    }
  };

  /** The one message Meta delivers after the window closes: "we have an answer, write to us". */
  const sendTemplate = async () => {
    if (!chat.phone || sending) return;
    setSending(true);
    try {
      await post({ template: "followup" });
      setTemplateSentAt(Date.now());
      showToast(isAr ? "اتبعت قالب المتابعة ✓" : "Follow-up sent ✓", "success");
    } catch (e) {
      console.error("Template failed:", e);
      showToast(isAr ? "القالب متبعتش" : "Follow-up was not sent", "error");
    } finally {
      setSending(false);
    }
  };

  /**
   * The bot switch. Taking over pauses it with no clock; handing back clears every hold at once —
   * the pause, an open handoff, and the hour a reply claims — so "the bot is answering again"
   * means exactly that.
   */
  const toggleBot = async () => {
    setToggling(true);
    try {
      if (chat.botPaused) {
        await updateDoc(getClinicDoc("whatsapp_conversations", chat.id), {
          botPaused: false,
          needsHuman: false,
          handledAtMs: Date.now(),
          handledBy: user?.uid || null,
          humanActiveAtMs: 0,
        });
      } else {
        await updateDoc(getClinicDoc("whatsapp_conversations", chat.id), {
          botPaused: true,
          botPausedBy: user?.uid || null,
          botPausedAtMs: Date.now(),
        });
      }
    } catch (e) {
      console.error("Bot toggle failed:", e);
      showToast(isAr ? "حصل خطأ" : "Could not update", "error");
    } finally {
      setToggling(false);
    }
  };

  return (
    <>
      <header className="px-3 py-2.5 border-b border-line flex items-center gap-2">
        <button onClick={onBack} className="md:hidden p-1.5 rounded-lg hover:bg-surface-subtle text-ink-body">
          <ArrowLeft size={16} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold text-ink text-sm truncate">{chat.patientName || chat.phone || chat.id}</h3>
          <p className="text-[11px] text-ink-muted font-bold truncate" dir="ltr">
            {chat.patientName ? chat.phone : isAr ? "رقم غير مسجل" : "Not a registered patient"}
          </p>
        </div>
        {chat.patientId && (
          <Link
            href={`/patients/${chat.patientId}`}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line text-[11px] font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle"
          >
            <UserRound size={13} />
            {isAr ? "الملف" : "Patient"}
          </Link>
        )}
        <button
          onClick={() => void toggleBot()}
          disabled={toggling}
          title={
            chat.botPaused
              ? isAr
                ? "البوت واقف — أنت اللي بترد. اضغط عشان يرجع يرد"
                : "Bot is paused — you are answering. Click to hand back."
              : isAr
                ? "اضغط عشان توقف البوت وترد بنفسك"
                : "Click to pause the bot and answer yourself"
          }
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-colors disabled:opacity-50 ${
            chat.botPaused
              ? "bg-warn-tint text-warn border border-warn/30 hover:bg-warn/20"
              : "bg-ink-slab text-white hover:bg-ink-strong"
          }`}
        >
          {toggling ? <Loader2 size={13} className="animate-spin" /> : chat.botPaused ? <Bot size={13} /> : <Hand size={13} />}
          {chat.botPaused ? (isAr ? "رجّع البوت" : "Hand back to bot") : isAr ? "أنا هرد" : "Take over"}
        </button>
      </header>

      {/* One line of status under the header, only when it says something. */}
      {(handling || chat.optedOut) && (
        <div
          className={`px-3 py-1.5 text-[11px] font-bold border-b border-line ${
            chat.optedOut ? "bg-danger-tint text-danger" : "bg-warn-tint text-warn"
          }`}
        >
          {chat.optedOut
            ? isAr
              ? "المريض طلب إيقاف الرسايل. متبعتش من هنا."
              : "This patient asked to stop receiving messages. Do not write from here."
            : chat.botPaused
              ? isAr
                ? "البوت واقف — أنت اللي بترد على المريض ده."
                : "Bot paused — you are the one answering this patient."
              : chat.needsHuman
                ? isAr
                  ? "البوت سلّم المحادثة لحد من الفريق ومستني رد."
                  : "The bot handed this chat to a person and is waiting."
                : isAr
                  ? "حد من الفريق رد من شوية — البوت ساكت لمدة ساعة."
                  : "A team member replied recently — the bot stays quiet for an hour."}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 bg-surface-page">
        {loading ? (
          <div className="flex justify-center text-ink-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : lines.length === 0 ? (
          <p className="text-center text-xs font-bold text-ink-muted py-8">
            {isAr
              ? "المحادثة دي أقدم من سجل الشات. الرسايل الجديدة هتظهر هنا."
              : "This conversation predates the chat log. New messages will appear here."}
          </p>
        ) : (
          lines.map((l) => <Bubble key={l.id} line={l} isAr={isAr} />)
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-line p-2.5">
        {blocked ? (
          <p className="text-[11px] font-bold text-ink-muted px-1 py-1.5 flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-warn shrink-0" />
            {isLid
              ? isAr
                ? "واتساب مخفي رقم المرسل ده — مينفعش نرد عليه من هنا."
                : "WhatsApp hides this sender's number — it cannot be answered from here."
              : chat.optedOut
                ? isAr
                  ? "المريض طلب إيقاف الرسايل."
                  : "The patient opted out of messages."
                : isAr
                  ? "عدى أكتر من ٢٤ ساعة على آخر رسالة من المريض — واتساب مش هيوصّل رد حر."
                  : "Over 24h since the patient's last message — WhatsApp will not deliver a free reply."}
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              dir="auto"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={isAr ? "اكتب ردك… (Enter للإرسال)" : "Write a reply… (Enter to send)"}
              className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-1 focus:ring-accent resize-none"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              className="h-10 w-10 rounded-xl bg-accent text-ink-on-accent flex items-center justify-center hover:bg-accent-strong transition-colors disabled:opacity-50"
              aria-label={isAr ? "ابعت" : "Send"}
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="rtl:-scale-x-100" />}
            </button>
          </div>
        )}

        {/* The window is shut but the number is reachable: offer the template that re-opens it. */}
        {windowClosed && chat.channel === "meta" && !isLid && !chat.optedOut && (
          <div className="mt-1 rounded-xl border border-line bg-surface-subtle p-2.5">
            <p className="text-[11px] font-bold text-ink-body">
              {isAr
                ? "ابعت رسالة متابعة معتمدة من واتساب. لما المريض يرد، هتقدر تكتب له عادي لمدة ٢٤ ساعة."
                : "Send a WhatsApp-approved follow-up. When the patient replies, you can write freely for 24 hours."}
            </p>
            <p className="text-xs text-ink-muted mt-1 whitespace-pre-wrap" dir="rtl">
              {`مرحباً ${chat.patientName || "عميلنا العزيز"}، معاك [العيادة]. بخصوص رسالتك على واتساب، عندنا رد ليك — ابعتلنا أي رسالة عشان نكمل الكلام معاك.`}
            </p>
            <button
              onClick={() => void sendTemplate()}
              disabled={sending || templateSentAt > 0}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-ink-on-accent text-[11px] font-black uppercase tracking-wide hover:bg-accent-strong transition-colors disabled:opacity-50"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} className="rtl:-scale-x-100" />}
              {templateSentAt ? (isAr ? "اتبعت" : "Sent") : isAr ? "ابعت المتابعة" : "Send follow-up"}
            </button>
          </div>
        )}
      </footer>
    </>
  );
}

/**
 * The file a patient sent, rendered as what it is.
 *
 * Decided by MIME rather than WhatsApp's type: a "document" that is a PDF of a scan and a
 * "document" that is a JPEG should not look the same. Anything unknown becomes a download link —
 * a link that works beats a player that does not.
 */
function MediaView({ line, isAr }: { line: ThreadLine; isAr: boolean }) {
  const url = line.mediaUrl || "";
  const mime = (line.mime || "").split(";")[0].trim().toLowerCase();
  if (mime.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={mediaLabel("image", isAr)} className="rounded-xl max-h-72 w-auto max-w-full object-contain bg-surface-muted" loading="lazy" />
      </a>
    );
  }
  if (mime.startsWith("audio/")) {
    return <audio controls preload="none" src={url} className="max-w-full mb-1 h-10" />;
  }
  if (mime.startsWith("video/")) {
    return <video controls preload="metadata" src={url} className="rounded-xl max-h-72 max-w-full mb-1" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-black underline underline-offset-2 mb-1"
    >
      {mediaLabel(line.media || "document", isAr)}
      {mime === "application/pdf" ? " · PDF" : ""}
    </a>
  );
}

function Bubble({ line, isAr }: { line: ThreadLine; isAr: boolean }) {
  const mine = line.direction === "out";
  const who =
    line.author === "bot"
      ? isAr
        ? "البوت"
        : "Bot"
      : line.author === "staff"
        ? line.name || (isAr ? "الفريق" : "Team")
        : line.author === "system"
          ? kindLabel(line.kind || "", isAr)
          : "";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
          !mine
            ? "bg-surface text-ink rounded-bl-md"
            : line.author === "staff"
              ? "bg-accent text-ink-on-accent rounded-br-md"
              : "bg-surface-muted text-ink-body rounded-br-md"
        }`}
      >
        {who && (
          <p className={`text-[10px] font-black uppercase tracking-wide mb-0.5 ${line.author === "staff" ? "opacity-80" : "text-ink-muted"}`}>
            {who}
          </p>
        )}
        {line.media && !line.mediaUrl && (
          <p className="text-xs font-bold opacity-80 mb-0.5">{mediaLabel(line.media, isAr)}</p>
        )}
        {line.mediaUrl && <MediaView line={line} isAr={isAr} />}
        {(!line.media || !/^\[\w+\]$/.test(line.text)) && (
          <p className="text-sm whitespace-pre-wrap break-words" dir="auto">
            {line.text}
          </p>
        )}
        <p className={`text-[10px] mt-1 ${line.author === "staff" ? "opacity-70" : "text-ink-muted"} ${mine ? "text-end" : ""}`}>
          {clock(line.at, isAr)}
        </p>
      </div>
    </div>
  );
}
