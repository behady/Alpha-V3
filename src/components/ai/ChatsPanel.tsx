"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  Hand,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  UserRound,
} from "lucide-react";
import { limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc, getGlobalClinicId } from "@/lib/db-utils";
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
 * Deliberately drawn like WhatsApp Web — wallpaper, white and green bubbles, ticks — because that
 * is the screen every receptionist already knows, and the point of the page is to be the phone
 * they no longer have. The ticks are real: they come from Meta's status webhooks, so "sent" here
 * means what it means on a phone, and a message Meta dropped shows as not delivered instead of
 * quietly looking fine.
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

type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

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
  status?: DeliveryStatus;
  errorMessage?: string;
}

type Filter = "all" | "unread" | "needs";

/** Meta drops free text sent more than 24h after the patient's last message. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The hour a staff reply keeps the bot out of the thread (mirrors HUMAN_CLAIM_MS). */
const HUMAN_CLAIM_MS = 60 * 60 * 1000;

/** WhatsApp's own palette for the chat surface — the one part of the app drawn to match another. */
const WA = {
  wallpaper: "#efeae2",
  incoming: "#ffffff",
  outgoing: "#d9fdd3",
  text: "#111b21",
  muted: "#667781",
  green: "#00a884",
  greenDark: "#008f72",
  readTick: "#53bdeb",
  panel: "#f0f2f5",
};

/** A faint doodle so the wallpaper reads as WhatsApp's and not as a blank beige box. */
const WALLPAPER_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='0.045' stroke-width='1.4' stroke-linecap='round'%3E%3Ccircle cx='20' cy='22' r='6'/%3E%3Cpath d='M60 12l4 8 8 1-6 6 2 8-8-4-8 4 2-8-6-6 8-1z'/%3E%3Cpath d='M96 30c6-8 16-4 14 4-2 6-14 12-14 12s-12-6-14-12c-2-8 8-12 14-4z'/%3E%3Cpath d='M14 70h18M23 61v18'/%3E%3Cpath d='M56 66c0-8 14-8 14 0 0 6-7 6-7 12'/%3E%3Ccircle cx='63' cy='84' r='1'/%3E%3Cpath d='M92 76a8 8 0 1 0 8 8'/%3E%3Cpath d='M30 104c6-6 12 0 18-6'/%3E%3Cpath d='M76 108l6-8 6 8'/%3E%3C/g%3E%3C/svg%3E\")";

function lastActivity(c: ChatRow): number {
  return Math.max(c.lastAt || 0, c.lastMessageAt || 0, c.handoffAtMs || 0);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

/** A stable pastel per number, so the same person keeps the same colour between visits. */
function avatarTone(seed: string): string {
  const tones = ["#6ac2a3", "#7fb3e0", "#e0a97f", "#c39be0", "#e08b8b", "#8bc7e0", "#b8d17f", "#e0b97f"];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return tones[h % tones.length];
}

function listTime(ms: number, isAr: boolean): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(isAr ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return isAr ? "أمس" : "Yesterday";
  return d.toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" });
}

function bubbleTime(ms: number, isAr: boolean): string {
  return ms ? new Date(ms).toLocaleTimeString(isAr ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
}

function dayLabel(ms: number, isAr: boolean): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return isAr ? "اليوم" : "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return isAr ? "أمس" : "Yesterday";
  return d.toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
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

/** "[audio]" placeholders in list previews read better as the media word. */
function previewText(text: string, isAr: boolean): string {
  const m = /^\[(\w+)\]$/.exec(text.trim());
  return m ? mediaLabel(m[1], isAr) : text;
}

export default function ChatsPanel({
  basePath = "/chats",
  heightClass = "h-[calc(100vh-190px)] min-h-[560px]",
}: {
  /** The page this panel lives on; the open chat is reflected into its URL as `?chat=`. */
  basePath?: string;
  heightClass?: string;
}) {
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
    router.replace(`${basePath}?chat=${encodeURIComponent(id)}`, { scroll: false });
  };
  const back = () => {
    setSelectedId("");
    router.replace(basePath, { scroll: false });
  };

  return (
    <div
      className={`rounded-2xl border border-line shadow-sm overflow-hidden grid md:grid-cols-[360px_1fr] ${heightClass}`}
      style={{ background: WA.panel }}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* The list. On a phone it is the whole panel until a chat is opened. */}
      <aside
        className={`bg-white flex-col min-h-0 border-line md:border-e ${selected ? "hidden md:flex" : "flex"}`}
      >
        <div className="px-4 pt-4 pb-2" style={{ background: WA.panel }}>
          <h2 className="text-[22px] font-black" style={{ color: WA.text }}>
            {isAr ? "المحادثات" : "Chats"}
          </h2>
        </div>
        <div className="px-3 py-2 space-y-2 bg-white border-b border-line">
          <div className="relative">
            <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3" style={{ color: WA.muted }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? "ابحث أو ابدأ محادثة" : "Search or start a new chat"}
              className="w-full rounded-lg border-0 ps-10 pe-3 py-2 text-sm focus:outline-none focus:ring-0"
              style={{ background: WA.panel, color: WA.text }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(
              [
                ["all", isAr ? "الكل" : "All", 0],
                ["unread", isAr ? "غير مقروء" : "Unread", unreadCount],
                ["needs", isAr ? "محتاج رد" : "Needs reply", needsCount],
              ] as [Filter, string, number][]
            ).map(([key, label, count]) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold transition-colors"
                  style={
                    active
                      ? { background: "#e7fce3", color: WA.greenDark }
                      : { background: WA.panel, color: WA.muted }
                  }
                >
                  {label}
                  {count > 0 && (
                    <span
                      className="text-[10px] font-black px-1.5 min-w-[18px] rounded-full text-white text-center"
                      style={{ background: key === "needs" ? "#f0a02a" : WA.green }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          {loading ? (
            <div className="p-6 flex justify-center" style={{ color: WA.muted }}>
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquareText size={28} className="mx-auto" style={{ color: "#c5cdd3" }} />
              <p className="text-sm font-bold mt-2" style={{ color: WA.muted }}>
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
              const title = c.patientName || c.phone || c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => open(c.id)}
                  className="w-full text-start px-3 py-2.5 flex items-center gap-3 transition-colors hover:bg-[#f5f6f6]"
                  style={active ? { background: WA.panel } : undefined}
                >
                  <span
                    className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-sm font-black text-white"
                    style={{ background: urgent ? "#e35d5d" : avatarTone(c.id) }}
                  >
                    {urgent ? <AlertTriangle size={18} /> : initials(c.patientName || "") || <UserRound size={20} />}
                  </span>
                  <div className="min-w-0 flex-1 border-b border-line/70 pb-2.5 -mb-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[15px] truncate" style={{ color: WA.text, fontWeight: unread ? 800 : 600 }}>
                        {title}
                      </span>
                      <span
                        className="ms-auto text-[11px] shrink-0"
                        style={{ color: unread ? WA.green : WA.muted, fontWeight: unread ? 700 : 500 }}
                      >
                        {listTime(lastActivity(c), isAr)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {c.lastDirection === "out" && (
                        <CheckCheck size={14} className="shrink-0" style={{ color: WA.muted }} />
                      )}
                      <span
                        className="text-[13px] truncate"
                        style={{ color: unread ? WA.text : WA.muted, fontWeight: unread ? 600 : 400 }}
                        dir="auto"
                      >
                        {previewText(c.lastText || "", isAr)}
                      </span>
                      {c.needsHuman && !unread && (
                        <span
                          className="ms-auto shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "#fff4dc", color: "#9a5b00" }}
                        >
                          {isAr ? "محتاج رد" : "Needs reply"}
                        </span>
                      )}
                      {unread && (
                        <span
                          className="ms-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-white text-[11px] font-black flex items-center justify-center"
                          style={{ background: WA.green }}
                        >
                          {c.unreadCount}
                        </span>
                      )}
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
          <div
            className="flex-1 flex items-center justify-center p-8 text-center border-b-[6px]"
            style={{ background: WA.panel, borderColor: WA.green }}
          >
            <div>
              <MessageSquareText size={56} strokeWidth={1.2} className="mx-auto" style={{ color: "#8696a0" }} />
              <h3 className="text-[28px] font-light mt-4" style={{ color: "#41525d" }}>
                {isAr ? "واتساب العيادة" : "Clinic WhatsApp"}
              </h3>
              <p className="text-sm mt-2 max-w-sm" style={{ color: WA.muted }}>
                {isAr
                  ? "اختار محادثة من القائمة عشان تقراها وترد عليها من هنا."
                  : "Pick a conversation from the list to read it and reply from here."}
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
  const [toggling, setToggling] = useState(false);
  const [templateSentAt, setTemplateSentAt] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
        // The clinic on screen, always. Without it the server falls back to the account's
        // default clinic — which for the platform owner is a deleted one with no gateway, so
        // every reply was "sent" into a queue nobody would ever see.
        clinicId: getGlobalClinicId(),
        phone: chat.phone,
        patientId: chat.patientId || "",
        patientName: chat.patientName || "",
        ...payload,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || "Send failed");
    // No gateway on this clinic: the message is waiting in the manual send list, not on a phone.
    if (data?.mode === "queued") {
      showToast(
        isAr
          ? "العيادة دي مش متوصلة بواتساب الرسمي — الرسالة اتحطت في قائمة الإرسال اليدوي."
          : "This clinic has no WhatsApp gateway — the message went to the manual send list.",
        "error"
      );
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !chat.phone || sending) return;
    setSending(true);
    try {
      await post({ text: body });
      setText("");
      inputRef.current?.focus();
    } catch (e) {
      console.error("Reply failed:", e);
      const msg = e instanceof Error ? e.message : "";
      showToast(isAr ? `الرسالة متبعتتش${msg ? ` — ${msg}` : ""}` : `Message was not sent${msg ? ` — ${msg}` : ""}`, "error");
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

  // Day separators, like the phone draws them.
  const grouped = useMemo(() => {
    const out: Array<{ day: string; key: string; lines: ThreadLine[] }> = [];
    for (const l of lines) {
      const key = new Date(l.at).toDateString();
      const last = out[out.length - 1];
      if (last && last.key === key) last.lines.push(l);
      else out.push({ day: dayLabel(l.at, isAr), key, lines: [l] });
    }
    return out;
  }, [lines, isAr]);

  const title = chat.patientName || chat.phone || chat.id;

  return (
    <>
      <header className="px-3 py-2 flex items-center gap-3 border-b border-line" style={{ background: WA.panel }}>
        <button onClick={onBack} className="md:hidden p-1.5 rounded-lg hover:bg-black/5" style={{ color: "#54656f" }}>
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-black text-white"
          style={{ background: avatarTone(chat.id) }}
        >
          {initials(chat.patientName || "") || <UserRound size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[15px] truncate leading-tight" style={{ color: WA.text }}>
            {title}
          </h3>
          <p className="text-[12px] truncate leading-tight mt-0.5" style={{ color: WA.muted }} dir="ltr">
            {chat.patientName ? chat.phone : isAr ? "رقم غير مسجل كمريض" : "Not a registered patient"}
            {chat.botPaused
              ? ` · ${isAr ? "البوت واقف" : "bot paused"}`
              : chat.needsHuman
                ? ` · ${isAr ? "مستني رد" : "waiting for a reply"}`
                : ""}
          </p>
        </div>
        {chat.patientId && (
          <Link
            href={`/patients/${chat.patientId}`}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold hover:bg-black/5"
            style={{ color: "#54656f" }}
          >
            <UserRound size={15} />
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-black transition-colors disabled:opacity-50"
          style={chat.botPaused ? { background: "#fff4dc", color: "#9a5b00" } : { background: WA.green, color: "#fff" }}
        >
          {toggling ? <Loader2 size={14} className="animate-spin" /> : chat.botPaused ? <Bot size={14} /> : <Hand size={14} />}
          {chat.botPaused ? (isAr ? "رجّع البوت" : "Hand back to bot") : isAr ? "أنا هرد" : "Take over"}
        </button>
      </header>

      <div
        className="flex-1 overflow-y-auto px-4 sm:px-8 py-3"
        style={{ background: WA.wallpaper, backgroundImage: WALLPAPER_PATTERN }}
      >
        {/* One pill of status at the top, only when it says something. */}
        {(handling || chat.optedOut) && (
          <div className="flex justify-center mb-3">
            <span
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg shadow-sm text-center max-w-md"
              style={chat.optedOut ? { background: "#fde8e8", color: "#9b1c1c" } : { background: "#fdf3d0", color: "#7a4d00" }}
            >
              {chat.optedOut
                ? isAr
                  ? "المريض طلب إيقاف الرسايل. متبعتش من هنا."
                  : "This patient asked to stop receiving messages. Do not write from here."
                : chat.botPaused
                  ? isAr
                    ? "🤖 البوت واقف — أنت اللي بترد على المريض ده."
                    : "🤖 Bot paused — you are the one answering this patient."
                  : chat.needsHuman
                    ? isAr
                      ? "البوت سلّم المحادثة لحد من الفريق ومستني رد."
                      : "The bot handed this chat to a person and is waiting."
                    : isAr
                      ? "حد من الفريق رد من شوية — البوت ساكت لمدة ساعة."
                      : "A team member replied recently — the bot stays quiet for an hour."}
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center" style={{ color: WA.muted }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : lines.length === 0 ? (
          <div className="flex justify-center py-8">
            <span className="text-[12px] font-semibold px-3 py-1.5 rounded-lg shadow-sm bg-white" style={{ color: WA.muted }}>
              {isAr
                ? "المحادثة دي أقدم من سجل الشات. الرسايل الجديدة هتظهر هنا."
                : "This conversation predates the chat log. New messages will appear here."}
            </span>
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.key}>
              <div className="flex justify-center my-3">
                <span className="text-[12px] font-semibold px-3 py-1 rounded-lg shadow-sm bg-white" style={{ color: WA.muted }}>
                  {g.day}
                </span>
              </div>
              <div className="space-y-1">
                {g.lines.map((l) => (
                  <Bubble key={l.id} line={l} isAr={isAr} />
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="px-3 py-2.5" style={{ background: WA.panel }}>
        {blocked ? (
          <p className="text-[12px] font-semibold px-1 py-1.5 flex items-center gap-1.5" style={{ color: WA.muted }}>
            <AlertTriangle size={13} className="shrink-0" style={{ color: "#f0a02a" }} />
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
              ref={inputRef}
              rows={1}
              dir="auto"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Grow with the text, up to a few lines, the way the phone's box does.
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={isAr ? "اكتب رسالة" : "Type a message"}
              className="flex-1 rounded-xl border-0 bg-white px-4 py-2.5 text-[15px] focus:outline-none focus:ring-0 resize-none leading-snug"
              style={{ color: WA.text, minHeight: 42 }}
            />
            <button
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              className="h-[42px] w-[42px] rounded-full flex items-center justify-center text-white transition-colors disabled:opacity-40 shrink-0"
              style={{ background: WA.green }}
              aria-label={isAr ? "ابعت" : "Send"}
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} className="rtl:-scale-x-100" />}
            </button>
          </div>
        )}

        {/* The window is shut but the number is reachable: offer the template that re-opens it. */}
        {windowClosed && chat.channel === "meta" && !isLid && !chat.optedOut && (
          <div className="mt-2 rounded-xl bg-white p-3 shadow-sm">
            <p className="text-[12px] font-bold" style={{ color: WA.text }}>
              {isAr
                ? "ابعت رسالة متابعة معتمدة من واتساب. لما المريض يرد، هتقدر تكتب له عادي لمدة ٢٤ ساعة."
                : "Send a WhatsApp-approved follow-up. When the patient replies, you can write freely for 24 hours."}
            </p>
            <p className="text-[13px] mt-1.5 whitespace-pre-wrap rounded-lg px-3 py-2" style={{ background: WA.outgoing, color: WA.text }} dir="rtl">
              {`مرحباً ${chat.patientName || "عميلنا العزيز"}، معاك [العيادة]. بخصوص رسالتك على واتساب، عندنا رد ليك — ابعتلنا أي رسالة عشان نكمل الكلام معاك.`}
            </p>
            <button
              onClick={() => void sendTemplate()}
              disabled={sending || templateSentAt > 0}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[12px] font-black transition-colors disabled:opacity-50"
              style={{ background: WA.green }}
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

/** The ticks. Real ones — drawn from Meta's status webhooks, not from "the API said ok". */
function Ticks({ status }: { status?: DeliveryStatus }) {
  if (!status) return null;
  if (status === "failed") return <AlertCircle size={14} style={{ color: "#e35d5d" }} />;
  if (status === "sent") return <Check size={15} style={{ color: WA.muted }} />;
  return <CheckCheck size={15} style={{ color: status === "read" ? WA.readTick : WA.muted }} />;
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
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-1 -mx-1 -mt-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={mediaLabel("image", isAr)} className="rounded-lg max-h-80 w-auto max-w-full object-contain" loading="lazy" />
      </a>
    );
  }
  if (mime.startsWith("audio/")) {
    return <audio controls preload="none" src={url} className="max-w-full mb-1 h-10 min-w-[240px]" />;
  }
  if (mime.startsWith("video/")) {
    return <video controls preload="metadata" src={url} className="rounded-lg max-h-80 max-w-full mb-1" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[13px] font-bold underline underline-offset-2 mb-1"
      style={{ color: WA.greenDark }}
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
        ? "🤖 البوت"
        : "🤖 Bot"
      : line.author === "staff"
        ? line.name || (isAr ? "الفريق" : "Team")
        : line.author === "system"
          ? kindLabel(line.kind || "", isAr)
          : "";
  const placeholderOnly = !!line.media && /^\[\w+\]$/.test(line.text.trim());
  const failed = line.status === "failed";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[75%] sm:max-w-[65%] rounded-lg px-2.5 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${
          mine ? "rounded-te-none" : "rounded-ts-none"
        }`}
        style={{ background: mine ? WA.outgoing : WA.incoming, color: WA.text }}
      >
        {who && (
          <p className="text-[11px] font-bold mb-0.5" style={{ color: line.author === "staff" ? WA.greenDark : "#8a6d00" }}>
            {who}
          </p>
        )}
        {line.media && !line.mediaUrl && (
          <p className="text-[13px] font-semibold mb-0.5" style={{ color: WA.muted }}>
            {mediaLabel(line.media, isAr)}
          </p>
        )}
        {line.mediaUrl && <MediaView line={line} isAr={isAr} />}
        {/*
          The time floats at the end of the last line, WhatsApp's own trick: when the line has
          room it sits beside the words, and when it does not it drops beneath them. It was
          pinned to the corner before, and pinned means it sat on top of whatever the last line
          held — Arabic text ends on the other side from where the pin was.
        */}
        {!placeholderOnly ? (
          <p className="text-[14.5px] whitespace-pre-wrap break-words leading-[1.35] flow-root" dir="auto">
            {line.text}
            <span className="float-end ms-2 mt-1.5 inline-flex items-center gap-1 text-[11px] leading-none" style={{ color: WA.muted }}>
              {bubbleTime(line.at, isAr)}
              {mine && <Ticks status={line.status} />}
            </span>
          </p>
        ) : (
          <div className="flex justify-end items-center gap-1 text-[11px] mt-0.5" style={{ color: WA.muted }}>
            {bubbleTime(line.at, isAr)}
            {mine && <Ticks status={line.status} />}
          </div>
        )}
        {failed && (
          <p className="text-[11px] font-bold mt-1 pt-1 border-t border-black/10" style={{ color: "#c0392b" }}>
            {isAr ? "موصلتش: " : "Not delivered: "}
            {line.errorMessage || (isAr ? "واتساب رفض الرسالة" : "WhatsApp refused the message")}
          </p>
        )}
      </div>
    </div>
  );
}
