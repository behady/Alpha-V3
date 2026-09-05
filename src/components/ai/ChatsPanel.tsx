"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellOff,
  Bot,
  Check,
  CheckCheck,
  FileText,
  Hand,
  Info,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  Paperclip,
  Search,
  Send,
  UserCheck,
  UserPlus,
  UserRound,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import QuickReplies from "./QuickReplies";
import ChatInfoPanel, { tagLabel, tagTone } from "./ChatInfoPanel";
import { getDocs, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, storage } from "@/lib/firebase";
import { chatSoundEnabled, playChatChime, requestChatNotifications, setChatSoundEnabled } from "@/lib/useChatAlerts";
import { getClinicCollection, getClinicDoc, getGlobalClinicId } from "@/lib/db-utils";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import { phoneMatchKey } from "@/lib/patientPhone";
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
  /** The team member handling this thread, so two receptionists do not answer the same person. */
  assignedTo?: string | null;
  assignedName?: string | null;
  assignedAtMs?: number;
  /** What the desk wants to remember about this thread — see ChatInfoPanel. */
  note?: string;
  tags?: string[];
  /**
   * A conversation the clinic is about to open: a patient picked from the directory who has no
   * conversation document yet. Exists only in this screen's memory until the first message is
   * sent, at which point the server writes the real row and this one is replaced by it.
   */
  isDraft?: boolean;
}

interface DirectoryPatient {
  id: string;
  name: string;
  phone: string;
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
  /** A voice note's words, attached a few seconds after it arrives. */
  transcript?: string;
}

/** What the clinic is about to send: a file picked from the computer, not yet uploaded. */
interface PendingFile {
  file: File;
  kind: "image" | "video" | "audio" | "document";
  previewUrl: string;
}

/** Meta's own per-type ceilings, with the bucket's 20MB as the outer wall. */
const FILE_LIMITS: Record<PendingFile["kind"], number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 20 * 1024 * 1024,
};

function fileKind(mime: string): PendingFile["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

type Filter = "all" | "unread" | "needs" | "mine";

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
  const [draft, setDraft] = useState<ChatRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const myUid = user?.uid || "";

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
      .filter((c) =>
        filter === "needs"
          ? c.needsHuman === true
          : filter === "unread"
            ? (c.unreadCount || 0) > 0
            : filter === "mine"
              ? !!myUid && c.assignedTo === myUid
              : true
      )
      .filter((c) => {
        if (!needle) return true;
        const hay = `${c.patientName || ""}${c.phone || ""}${c.id}${(c.tags || []).join(" ")}${c.note || ""}`
          .toLowerCase()
          .replace(/\s+/g, "");
        return hay.includes(needle);
      })
      .sort((a, b) => lastActivity(b) - lastActivity(a));
  }, [chats, filter, search, myUid]);

  // The real row wins the moment it exists: the first send creates it, and the draft retires.
  const selected = chats.find((c) => c.id === selectedId) || (draft && draft.id === selectedId ? draft : null);
  const needsCount = chats.filter((c) => c.needsHuman === true).length;
  const mineCount = user?.uid ? chats.filter((c) => c.assignedTo === user.uid).length : 0;
  const unreadCount = chats.reduce((n, c) => n + (c.unreadCount || 0), 0);

  const open = (id: string) => {
    setSelectedId(id);
    router.replace(`${basePath}?chat=${encodeURIComponent(id)}`, { scroll: false });
  };
  const back = () => {
    setSelectedId("");
    router.replace(basePath, { scroll: false });
  };

  /** A patient from the directory: open their existing thread, or a draft one if there is none. */
  const startWith = (p: DirectoryPatient) => {
    const key = phoneMatchKey(p.phone) || p.phone.replace(/\D/g, "");
    if (!key) return;
    setPickerOpen(false);
    if (!chats.some((c) => c.id === key)) {
      setDraft({ id: key, phone: p.phone, patientId: p.id, patientName: p.name, isDraft: true });
    }
    open(key);
  };

  return (
    <div
      className={`rounded-2xl border border-line shadow-sm overflow-hidden grid md:grid-cols-[360px_1fr] ${
        selected && infoOpen ? "lg:grid-cols-[340px_1fr_300px]" : ""
      } ${heightClass}`}
      style={{ background: WA.panel }}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* The list. On a phone it is the whole panel until a chat is opened. */}
      <aside
        className={`bg-white flex-col min-h-0 border-line md:border-e ${selected ? "hidden md:flex" : "flex"}`}
      >
        <div className="px-4 pt-4 pb-2 flex items-center" style={{ background: WA.panel }}>
          <h2 className="text-[22px] font-black" style={{ color: WA.text }}>
            {isAr ? "المحادثات" : "Chats"}
          </h2>
          <AlertControls isAr={isAr} showToast={showToast} />
          <button
            onClick={() => setPickerOpen((v) => !v)}
            title={isAr ? "محادثة جديدة" : "New chat"}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
            style={{ color: pickerOpen ? WA.green : "#54656f" }}
          >
            <MessageSquarePlus size={20} />
          </button>
        </div>
        {pickerOpen && (
          <NewChatPicker
            isAr={isAr}
            onPick={startWith}
            onClose={() => setPickerOpen(false)}
          />
        )}
        <div className={`px-3 py-2 space-y-2 bg-white border-b border-line ${pickerOpen ? "hidden" : ""}`}>
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
                ["mine", isAr ? "بتاعتي" : "Mine", mineCount],
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
                      style={{ background: key === "needs" ? "#f0a02a" : key === "mine" ? "#54656f" : WA.green }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto bg-white ${pickerOpen ? "hidden" : ""}`}>
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
                      {/* The first tag, as a colour the eye can scan the list by. */}
                      {c.tags && c.tags.length > 0 && (
                        <span
                          className="ms-auto shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full truncate max-w-[80px]"
                          style={{ background: tagTone(c.tags[0]), color: "#111b21" }}
                        >
                          {tagLabel(c.tags[0], isAr)}
                        </span>
                      )}
                      {/* Who has it. "You" in green; a colleague's first name in grey. */}
                      {c.assignedTo && (
                        <span
                          className="ms-auto shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full truncate max-w-[90px]"
                          style={
                            c.assignedTo === user?.uid
                              ? { background: "#e7fce3", color: WA.greenDark }
                              : { background: WA.panel, color: "#54656f" }
                          }
                        >
                          {c.assignedTo === user?.uid ? (isAr ? "أنت" : "You") : (c.assignedName || "").split(/\s+/)[0]}
                        </span>
                      )}
                      {c.needsHuman && !unread && (
                        <span
                          className={`${c.assignedTo || (c.tags && c.tags.length > 0) ? "" : "ms-auto"} shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full`}
                          style={{ background: "#fff4dc", color: "#9a5b00" }}
                        >
                          {isAr ? "محتاج رد" : "Needs reply"}
                        </span>
                      )}
                      {unread && (
                        <span
                          className={`${c.assignedTo || (c.tags && c.tags.length > 0) ? "" : "ms-auto"} shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-white text-[11px] font-black flex items-center justify-center`}
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
          <Thread
            key={selected.id}
            chat={selected}
            onBack={back}
            isAr={isAr}
            showToast={showToast}
            infoOpen={infoOpen}
            onToggleInfo={() => setInfoOpen((v) => !v)}
          />
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

      {/* The patient and the desk's notes, beside the thread. Wide screens only; on a phone the
          same panel would have to cover the conversation it is about. */}
      {selected && infoOpen && (
        <div className="hidden lg:flex min-h-0 flex-col">
          <ChatInfoPanel chat={selected} isAr={isAr} onClose={() => setInfoOpen(false)} />
        </div>
      )}
    </div>
  );
}

function Thread({
  chat,
  onBack,
  isAr,
  showToast,
  infoOpen,
  onToggleInfo,
}: {
  chat: ChatRow;
  onBack: () => void;
  isAr: boolean;
  showToast: (msg: string, kind: "success" | "error") => void;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  const { user } = useAuth();
  const [lines, setLines] = useState<ThreadLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [templateSentAt, setTemplateSentAt] = useState(0);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A picked file's preview URL is a blob the browser holds; release it when it is replaced.
  useEffect(() => {
    return () => {
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

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
  // A conversation the clinic opened has no patient message at all, which for the window rule is
  // the same as one older than a day: only a template delivers until they write back.
  const officialChannel = chat.channel === "meta" || chat.isDraft === true;
  const windowClosed = chat.isDraft
    ? true
    : !!chat.lastInboundAt && Date.now() - chat.lastInboundAt > REPLY_WINDOW_MS;
  // Meta drops out-of-window text silently; the unofficial gateway does not. Block only where it
  // would silently fail — a disabled box the receptionist can see beats a "sent" that never lands.
  const blocked = isLid || (windowClosed && officialChannel) || chat.optedOut === true;
  const humanHold = chat.botPaused === true || (chat.humanActiveAtMs || 0) > Date.now() - HUMAN_CLAIM_MS;
  const handling = chat.botPaused === true || chat.needsHuman === true || humanHold;

  const post = async (payload: Record<string, unknown>) => {
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
    // Answering claims the thread, when nobody has it yet: the person who replied is the person
    // handling it, and the row should say so without a second click.
    if (!chat.assignedTo && !chat.isDraft && user?.uid) {
      updateDoc(getClinicDoc("whatsapp_conversations", chat.id), {
        assignedTo: user.uid,
        assignedName: user.name || "",
        assignedAtMs: Date.now(),
      }).catch(() => {});
    }
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

  const pickFile = (file: File | null | undefined) => {
    if (!file) return;
    const kind = fileKind(file.type || "");
    if (file.size > FILE_LIMITS[kind]) {
      const mb = Math.round(FILE_LIMITS[kind] / 1024 / 1024);
      showToast(isAr ? `الملف أكبر من ${mb} ميجا` : `File is larger than ${mb}MB`, "error");
      return;
    }
    setPending({ file, kind, previewUrl: URL.createObjectURL(file) });
    inputRef.current?.focus();
  };

  /**
   * Claim, release, or take over. Taking a colleague's thread is one click on purpose — the
   * common case is "she went to lunch", and a confirmation would just be in the way.
   */
  const isMine = !!user?.uid && chat.assignedTo === user.uid;
  const toggleAssign = async () => {
    if (!user?.uid || chat.isDraft) return;
    setAssigning(true);
    try {
      await updateDoc(
        getClinicDoc("whatsapp_conversations", chat.id),
        isMine
          ? { assignedTo: null, assignedName: null, assignedAtMs: Date.now() }
          : { assignedTo: user.uid, assignedName: user.name || "", assignedAtMs: Date.now() }
      );
    } catch (e) {
      console.error("Assign failed:", e);
      showToast(isAr ? "حصل خطأ" : "Could not update", "error");
    } finally {
      setAssigning(false);
    }
  };

  const insertQuickReply = (snippet: string) => {
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n${snippet}` : snippet));
    setQuickOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    });
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !pending) || !chat.phone || sending) return;
    setSending(true);
    try {
      if (pending) {
        /*
         * The file goes to the clinic's own Storage folder first, from the browser, then the
         * server hands Meta the download URL. Uploading through the server would mean streaming
         * the bytes twice; this way they travel once, and the same URL is what the bubble shows.
         */
        const safeName = pending.file.name.replace(/[^\w.\-؀-ۿ]+/g, "_").slice(0, 80) || "file";
        const path = `clinics/${getGlobalClinicId()}/whatsapp_media/outbound/${Date.now()}_${safeName}`;
        const target = storageRef(storage, path);
        await uploadBytes(target, pending.file, { contentType: pending.file.type || "application/octet-stream" });
        const url = await getDownloadURL(target);
        await post({
          text: body,
          media: { url, mime: pending.file.type || "application/octet-stream", kind: pending.kind, filename: pending.file.name },
        });
        setPending(null);
      } else {
        await post({ text: body });
      }
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
            {chat.isDraft
              ? ` · ${isAr ? "محادثة جديدة" : "new conversation"}`
              : chat.botPaused
              ? ` · ${isAr ? "البوت واقف" : "bot paused"}`
              : chat.needsHuman
                ? ` · ${isAr ? "مستني رد" : "waiting for a reply"}`
                : ""}
          </p>
        </div>
        <button
          onClick={onToggleInfo}
          title={isAr ? "بيانات المريض والملاحظات" : "Patient info and notes"}
          className="hidden lg:flex w-9 h-9 rounded-full items-center justify-center hover:bg-black/5 transition-colors"
          style={{ color: infoOpen ? WA.green : "#54656f" }}
        >
          <Info size={18} />
        </button>
        {!chat.isDraft && (
          <button
            onClick={() => void toggleAssign()}
            disabled={assigning}
            title={
              isMine
                ? isAr ? "المحادثة دي معاك — اضغط عشان تسيبها" : "This chat is yours — click to release it"
                : chat.assignedTo
                  ? isAr ? `مع ${chat.assignedName || "زميل"} — اضغط عشان تاخدها` : `With ${chat.assignedName || "a colleague"} — click to take it`
                  : isAr ? "خد المحادثة دي" : "Claim this chat"
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold hover:bg-black/5 disabled:opacity-50 max-w-[160px]"
            style={{ color: isMine ? WA.greenDark : "#54656f" }}
          >
            {assigning ? <Loader2 size={15} className="animate-spin" /> : isMine ? <UserCheck size={15} /> : <UserPlus size={15} />}
            <span className="truncate">
              {isMine
                ? isAr ? "معاك" : "Mine"
                : chat.assignedTo
                  ? (chat.assignedName || "").split(/\s+/)[0] || (isAr ? "زميل" : "Colleague")
                  : isAr ? "خدها" : "Claim"}
            </span>
          </button>
        )}
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

      <footer className="relative px-3 py-2.5" style={{ background: WA.panel }}>
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
                : chat.isDraft
                  ? isAr
                    ? "المريض ده لسه مبعتش حاجة — ابدأ برسالة المتابعة اللي تحت، ولما يرد تقدر تكتب له عادي."
                    : "This patient hasn't written yet — start with the follow-up below; once they reply you can write freely."
                  : isAr
                    ? "عدى أكتر من ٢٤ ساعة على آخر رسالة من المريض — واتساب مش هيوصّل رد حر."
                    : "Over 24h since the patient's last message — WhatsApp will not deliver a free reply."}
          </p>
        ) : (
          <div className="flex items-end gap-2">
            {/* What is about to go with the message, with a way to drop it. */}
            {pending && (
              <div className="absolute bottom-full start-3 end-3 mb-1 rounded-xl bg-white shadow-md p-2 flex items-center gap-3">
                {pending.kind === "image" ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={pending.previewUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                ) : (
                  <span className="h-12 w-12 rounded-lg flex items-center justify-center" style={{ background: WA.panel, color: "#54656f" }}>
                    <FileText size={22} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold truncate" style={{ color: WA.text }} dir="auto">
                    {pending.file.name}
                  </p>
                  <p className="text-[11px]" style={{ color: WA.muted }}>
                    {(pending.file.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                    {isAr ? "اكتب تعليق تحت لو حابب" : "Add a caption below if you like"}
                  </p>
                </div>
                <button
                  onClick={() => setPending(null)}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5"
                  style={{ color: "#54656f" }}
                  aria-label={isAr ? "إلغاء الملف" : "Remove file"}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {quickOpen && (
              <QuickReplies
                isAr={isAr}
                patientName={chat.patientName}
                onInsert={insertQuickReply}
                onClose={() => setQuickOpen(false)}
              />
            )}
            <button
              onClick={() => setQuickOpen((v) => !v)}
              disabled={sending}
              title={isAr ? "ردود جاهزة" : "Quick replies"}
              className="h-[42px] w-[42px] rounded-full flex items-center justify-center hover:bg-black/5 transition-colors shrink-0 disabled:opacity-40"
              style={{ color: quickOpen ? WA.green : "#54656f" }}
            >
              <Zap size={20} />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title={isAr ? "إرفاق صورة أو ملف" : "Attach a photo or file"}
              className="h-[42px] w-[42px] rounded-full flex items-center justify-center hover:bg-black/5 transition-colors shrink-0 disabled:opacity-40"
              style={{ color: pending ? WA.green : "#54656f" }}
            >
              <Paperclip size={20} />
            </button>
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
                // "/" in an empty box opens the ready answers, as it does in most chat tools.
                if (e.key === "/" && !text.trim()) {
                  e.preventDefault();
                  setQuickOpen(true);
                }
                if (e.key === "Escape" && quickOpen) setQuickOpen(false);
              }}
              placeholder={pending ? (isAr ? "تعليق (اختياري)" : "Caption (optional)") : isAr ? "اكتب رسالة" : "Type a message"}
              className="flex-1 rounded-xl border-0 bg-white px-4 py-2.5 text-[15px] focus:outline-none focus:ring-0 resize-none leading-snug"
              style={{ color: WA.text, minHeight: 42 }}
            />
            <button
              onClick={() => void send()}
              disabled={sending || (!text.trim() && !pending)}
              className="h-[42px] w-[42px] rounded-full flex items-center justify-center text-white transition-colors disabled:opacity-40 shrink-0"
              style={{ background: WA.green }}
              aria-label={isAr ? "ابعت" : "Send"}
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} className="rtl:-scale-x-100" />}
            </button>
          </div>
        )}

        {/* The window is shut but the number is reachable: offer the template that re-opens it. */}
        {windowClosed && officialChannel && !isLid && !chat.optedOut && (
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

/**
 * The bell and the speaker: desktop notifications and the chime, for this browser.
 *
 * Notification permission is the browser's to grant and can only be asked for from a click, so
 * the bell asks when clicked; once granted or refused it becomes a status. The chime is a
 * per-browser preference, kept in localStorage — a front desk and a treatment room want
 * different things.
 */
function AlertControls({ isAr, showToast }: { isAr: boolean; showToast: (m: string, k: "success" | "error") => void }) {
  const [sound, setSound] = useState(true);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  // Read after mount, never during render: neither localStorage nor Notification exists on the
  // server, and seeding state from them would make the first client render disagree with the
  // HTML it hydrates.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read once after mount
    setSound(chatSoundEnabled());
    setPerm(typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setChatSoundEnabled(next);
    if (next) playChatChime();
  };

  const askPermission = async () => {
    const result = await requestChatNotifications();
    setPerm(result);
    if (result === "granted") showToast(isAr ? "هتوصلك إشعارات لما مريض يبعت ✓" : "You'll be notified when a patient writes ✓", "success");
    else if (result === "denied") showToast(isAr ? "المتصفح رافض الإشعارات — فعّلها من إعدادات الموقع" : "Notifications are blocked — enable them in the site settings", "error");
  };

  return (
    <div className="ms-auto flex items-center gap-1">
      <button
        onClick={toggleSound}
        title={sound ? (isAr ? "كتم صوت التنبيه" : "Mute the chime") : isAr ? "تشغيل صوت التنبيه" : "Turn the chime on"}
        className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
        style={{ color: sound ? "#54656f" : "#b0b8be" }}
      >
        {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
      </button>
      {perm !== "unsupported" && (
        <button
          onClick={() => void askPermission()}
          disabled={perm !== "default"}
          title={
            perm === "granted"
              ? isAr ? "إشعارات سطح المكتب شغالة" : "Desktop notifications are on"
              : perm === "denied"
                ? isAr ? "الإشعارات مقفولة من المتصفح" : "Notifications blocked by the browser"
                : isAr ? "فعّل إشعارات سطح المكتب" : "Enable desktop notifications"
          }
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors disabled:cursor-default"
          style={{ color: perm === "granted" ? WA.green : perm === "denied" ? "#b0b8be" : "#e0a02a" }}
        >
          {perm === "denied" ? <BellOff size={19} /> : <Bell size={19} />}
        </button>
      )}
    </div>
  );
}

/**
 * The patient directory, for opening a conversation the patient did not start.
 *
 * Loads the directory once when opened — the same ceiling the Patients page uses — and filters
 * with the same tolerant matcher, so a name typed the way reception types it, or three digits of
 * a phone, finds the person. Patients with no phone are listed but cannot be picked: there is
 * nowhere to send.
 */
function NewChatPicker({
  isAr,
  onPick,
  onClose,
}: {
  isAr: boolean;
  onPick: (p: DirectoryPatient) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState<DirectoryPatient[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDocs(query(getClinicCollection("patients"), limit(2500)))
      .then((snap) => {
        if (cancelled) return;
        const rows = snap.docs
          .map((d) => {
            const x = d.data() as Record<string, unknown>;
            return { id: d.id, name: String(x.name || "").trim(), phone: String(x.phone || "").trim() };
          })
          .filter((p) => p.name)
          .sort((a, b) => a.name.localeCompare(b.name, "ar"));
        setAll(rows);
      })
      .catch((e) => {
        console.error("Patient directory failed:", e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    if (!all) return [];
    const trimmed = q.trim();
    // Untyped, the list is the whole directory; capped so a 2,000-row clinic does not paint it all.
    const matched = trimmed ? all.filter((p) => patientMatchesSearch(trimmed, p.name, p.phone)) : all;
    return matched.slice(0, 80);
  }, [all, q]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white">
      <div className="px-3 py-2 border-b border-line flex items-center gap-2">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5" style={{ color: "#54656f" }}>
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="relative flex-1">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3" style={{ color: WA.muted }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isAr ? "اسم المريض أو رقمه" : "Patient name or number"}
            className="w-full rounded-lg border-0 ps-10 pe-3 py-2 text-sm focus:outline-none focus:ring-0"
            style={{ background: WA.panel, color: WA.text }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {failed ? (
          <p className="p-6 text-center text-sm font-bold" style={{ color: WA.muted }}>
            {isAr ? "مقدرناش نجيب قائمة المرضى" : "Could not load the patient list"}
          </p>
        ) : !all ? (
          <div className="p-6 flex justify-center" style={{ color: WA.muted }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <p className="p-6 text-center text-sm font-bold" style={{ color: WA.muted }}>
            {isAr ? "مفيش مريض بالاسم ده" : "No patient matches"}
          </p>
        ) : (
          results.map((p) => {
            const sendable = p.phone.replace(/\D/g, "").length >= 7;
            return (
              <button
                key={p.id}
                onClick={() => sendable && onPick(p)}
                disabled={!sendable}
                className="w-full text-start px-3 py-2.5 flex items-center gap-3 transition-colors hover:bg-[#f5f6f6] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-sm font-black text-white"
                  style={{ background: avatarTone(p.id) }}
                >
                  {initials(p.name)}
                </span>
                <div className="min-w-0 flex-1 border-b border-line/70 pb-2.5 -mb-2.5">
                  <p className="text-[15px] font-semibold truncate" style={{ color: WA.text }}>
                    {p.name}
                  </p>
                  <p className="text-[13px] truncate" style={{ color: WA.muted }} dir="ltr">
                    {sendable ? p.phone : isAr ? "مفيش رقم تليفون" : "No phone number"}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
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
    return (
      <div className="mb-1">
        <audio controls preload="none" src={url} className="max-w-full h-10 min-w-[240px]" />
        {/* The words, under the recording they came from — one bubble, not two. */}
        {line.transcript && (
          <p className="text-[13px] italic mt-1.5 whitespace-pre-wrap" style={{ color: "#3b4a54" }} dir="auto">
            🎤 {line.transcript}
          </p>
        )}
      </div>
    );
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
