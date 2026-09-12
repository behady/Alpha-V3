"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { CalendarPlus, Loader2, Plus, StickyNote, Tag, UserRound, Wallet, X } from "lucide-react";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";

/**
 * The patient, beside the conversation.
 *
 * "When is my appointment", "how much do I still owe", "when was I last in" are most of what a
 * patient writes about, and the answers live two pages away. This panel puts them next to the
 * message box — read live from the same records the calendar and ledger use, so a receptionist
 * answers from the record and not from memory — with a button that opens the calendar on this
 * patient for the one thing a chat cannot do, which is book.
 *
 * Below it, what the desk wants to remember about the CONVERSATION rather than the patient: a
 * note and a few tags. Kept on the conversation document, not the patient record, because "wants
 * veneers, call Sunday" is about this thread, and a tag like "complaint" is how the list gets
 * scanned tomorrow morning.
 */

export interface InfoChat {
  id: string;
  phone?: string;
  patientId?: string;
  patientName?: string;
  note?: string;
  tags?: string[];
  isDraft?: boolean;
}

interface Appt {
  id: string;
  date: string;
  time: string;
  doctor: string;
  status: string;
}

/** The tags a desk reaches for most. Anything else can be typed. */
const PRESET_TAGS: Array<{ id: string; en: string; ar: string; tone: string }> = [
  { id: "lead", en: "Lead", ar: "عميل محتمل", tone: "#e3f2fd" },
  { id: "followup", en: "Follow up", ar: "متابعة", tone: "#fff4dc" },
  { id: "complaint", en: "Complaint", ar: "شكوى", tone: "#fde8e8" },
  { id: "vip", en: "VIP", ar: "VIP", tone: "#ede7f6" },
  { id: "price", en: "Asked prices", ar: "سأل عن الأسعار", tone: "#e7fce3" },
];

export function tagLabel(id: string, isAr: boolean): string {
  const p = PRESET_TAGS.find((t) => t.id === id);
  return p ? (isAr ? p.ar : p.en) : id;
}

export function tagTone(id: string): string {
  return PRESET_TAGS.find((t) => t.id === id)?.tone || "var(--surface-subtle)";
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ChatInfoPanel({ chat, isAr, onClose }: { chat: InfoChat; isAr: boolean; onClose: () => void }) {
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [note, setNote] = useState(chat.note || "");
  const [savingNote, setSavingNote] = useState(false);
  const [customTag, setCustomTag] = useState("");

  // The note field follows the record when another screen changes it, but never while typing.
  const [noteDirty, setNoteDirty] = useState(false);
  useEffect(() => {
    if (!noteDirty) setNote(chat.note || "");
  }, [chat.note, noteDirty]);

  useEffect(() => {
    if (!chat.patientId) {
      setAppts([]);
      setBalance(0);
      return;
    }
    // No orderBy: a where-only query needs no composite index, and sorting a patient's own
    // appointments in the browser is nothing.
    const unsubA = onSnapshot(
      query(getClinicCollection("appointments"), where("patientId", "==", chat.patientId)),
      (snap) =>
        setAppts(
          snap.docs.map((d) => {
            const a = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              date: String(a.date || ""),
              time: String(a.time || ""),
              doctor: String(a.doctor || ""),
              status: normalizeAppointmentStatus(String(a.status || "")),
            };
          })
        ),
      () => setAppts([])
    );
    // Same arithmetic as the patient page: procedures billed minus payments taken.
    const unsubL = onSnapshot(
      query(getClinicCollection("ledger"), where("patientId", "==", chat.patientId)),
      (snap) => {
        let cost = 0;
        let paid = 0;
        for (const d of snap.docs) {
          const r = d.data() as Record<string, unknown>;
          if (r.type === "procedure") cost += Number(r.cost) || 0;
          if (r.type === "payment") paid += Number(r.paid) || 0;
        }
        setBalance(cost - paid);
      },
      () => setBalance(0)
    );
    return () => {
      unsubA();
      unsubL();
    };
  }, [chat.patientId]);

  const { next, last } = useMemo(() => {
    const today = todayKey();
    const live = (appts || []).filter((a) => a.date && !/cancel|no.?show/i.test(a.status));
    const upcoming = live
      .filter((a) => a.date >= today)
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
    const past = live
      .filter((a) => a.date < today)
      .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
    return { next: upcoming[0] || null, last: past[0] || null };
  }, [appts]);

  const saveNote = async () => {
    if (chat.isDraft || !noteDirty) return;
    setSavingNote(true);
    try {
      await updateDoc(getClinicDoc("whatsapp_conversations", chat.id), { note: note.trim().slice(0, 2000) });
      setNoteDirty(false);
    } catch (e) {
      console.error("Note save failed:", e);
    } finally {
      setSavingNote(false);
    }
  };

  const tags = chat.tags || [];
  const toggleTag = async (id: string) => {
    if (chat.isDraft) return;
    const clean = id.trim().toLowerCase().slice(0, 24);
    if (!clean) return;
    const next = tags.includes(clean) ? tags.filter((t) => t !== clean) : [...tags, clean].slice(0, 8);
    try {
      await updateDoc(getClinicDoc("whatsapp_conversations", chat.id), { tags: next });
    } catch (e) {
      console.error("Tag save failed:", e);
    }
  };

  const money = (n: number) => `${Math.abs(n).toLocaleString(isAr ? "ar-EG" : "en-EG")} ${isAr ? "ج.م" : "EGP"}`;
  const apptLine = (a: Appt) =>
    `${arabicDayLabel(a.date)} · ${arabicTimeLabel(a.time)}${a.doctor && a.doctor.toLowerCase() !== "any" ? ` · ${a.doctor}` : ""}`;

  return (
    <aside className="bg-surface dark:bg-slate-900 border-line dark:border-slate-800 md:border-s flex flex-col min-h-0 overflow-y-auto backdrop-blur-xl transition-colors">
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-line dark:border-slate-800 bg-surface-subtle dark:bg-slate-900/90 backdrop-blur-xl">
        <span className="text-[13px] font-black text-ink dark:text-slate-100">
          {isAr ? "بيانات المريض" : "Patient info"}
        </span>
        <button onClick={onClose} className="ms-auto w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface dark:hover:bg-slate-800 text-ink-muted dark:text-slate-400 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* The patient */}
      <div className="p-4 border-b border-line dark:border-slate-800">
        {chat.patientId ? (
          <>
            <p className="text-[15px] font-black text-ink dark:text-slate-100">
              {chat.patientName || "—"}
            </p>
            <p className="text-[12px] text-ink-muted dark:text-slate-400" dir="ltr">
              {chat.phone}
            </p>

            <dl className="mt-3 space-y-2.5 text-[13px]">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-muted dark:text-slate-500">
                  {isAr ? "الميعاد الجاي" : "Next appointment"}
                </dt>
                <dd className="font-semibold mt-0.5 text-ink dark:text-slate-200">
                  {appts === null ? <Loader2 size={13} className="animate-spin" /> : next ? apptLine(next) : isAr ? "مفيش ميعاد جاي" : "None booked"}
                  {next && (
                    <span className="ms-2 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-surface-subtle dark:bg-slate-800 text-ink-muted dark:text-slate-400">
                      {next.status}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-muted dark:text-slate-500">
                  {isAr ? "آخر زيارة" : "Last visit"}
                </dt>
                <dd className="font-semibold mt-0.5 text-ink dark:text-slate-200">
                  {appts === null ? "…" : last ? apptLine(last) : isAr ? "لسه مزارش" : "No past visit"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-muted dark:text-slate-500">
                  {isAr ? "الحساب" : "Balance"}
                </dt>
                <dd className={`font-black mt-0.5 flex items-center gap-1.5 ${balance && balance > 0 ? "text-[#c0392b] dark:text-[#fc8181]" : "text-accent dark:text-accent-soft"}`}>
                  <Wallet size={14} />
                  {balance === null
                    ? "…"
                    : balance > 0
                      ? `${isAr ? "عليه" : "Owes"} ${money(balance)}`
                      : balance < 0
                        ? `${isAr ? "له رصيد" : "Credit"} ${money(balance)}`
                        : isAr ? "مفيش مستحقات" : "Nothing owed"}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-col gap-2">
              <Link
                href={`/appointments?book=${encodeURIComponent(chat.patientId)}`}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-ink text-[12px] font-black bg-accent dark:bg-accent hover:brightness-110 shadow-sm transition-all"
              >
                <CalendarPlus size={15} />
                {isAr ? "احجز ميعاد" : "Book appointment"}
              </Link>
              <Link
                href={`/patients/${chat.patientId}`}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold border border-line dark:border-slate-700 hover:bg-surface-subtle dark:hover:bg-slate-800 text-ink-muted dark:text-slate-300 transition-colors"
              >
                <UserRound size={15} />
                {isAr ? "افتح الملف" : "Open patient file"}
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] font-bold text-ink dark:text-slate-100" dir="ltr">
              {chat.phone || chat.id}
            </p>
            <p className="text-[12px] mt-1 text-ink-muted dark:text-slate-400">
              {isAr ? "الرقم ده مش مسجل كمريض." : "This number is not a registered patient."}
            </p>
            <Link
              href="/patients"
              className="mt-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold border border-line dark:border-slate-700 hover:bg-surface-subtle dark:hover:bg-slate-800 text-ink-muted dark:text-slate-300 transition-colors"
            >
              <Plus size={15} />
              {isAr ? "أضفه كمريض" : "Add as a patient"}
            </Link>
          </>
        )}
      </div>

      {/* The conversation's own memory */}
      {!chat.isDraft && (
        <div className="p-4 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 text-ink-muted dark:text-slate-500">
              <Tag size={12} /> {isAr ? "علامات" : "Tags"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESET_TAGS.map((t) => {
                const on = tags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => void toggleTag(t.id)}
                    className={`text-[11px] font-bold px-2 py-1 rounded-full border transition-colors ${on ? "bg-accent-tint text-accent-strong dark:bg-accent-strong/30 dark:text-accent-soft border-transparent" : "bg-surface dark:bg-slate-800 border-line dark:border-slate-700 text-ink-muted dark:text-slate-400"}`}
                  >
                    {isAr ? t.ar : t.en}
                  </button>
                );
              })}
              {tags
                .filter((t) => !PRESET_TAGS.some((p) => p.id === t))
                .map((t) => (
                  <button
                    key={t}
                    onClick={() => void toggleTag(t)}
                    title={isAr ? "اضغط للحذف" : "Click to remove"}
                    className="text-[11px] font-bold px-2 py-1 rounded-full bg-surface-subtle dark:bg-slate-800 text-ink dark:text-slate-200 transition-colors"
                  >
                    {t} ×
                  </button>
                ))}
            </div>
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void toggleTag(customTag);
                setCustomTag("");
              }}
            >
              <input
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                placeholder={isAr ? "علامة جديدة" : "New tag"}
                className="flex-1 min-w-0 rounded-lg border border-line dark:border-slate-700 px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-accent/50 bg-surface dark:bg-slate-800 text-ink dark:text-slate-100 placeholder-ink-faint dark:placeholder-slate-500 transition-all"
                dir="auto"
              />
              <button type="submit" disabled={!customTag.trim()} className="px-2.5 rounded-lg text-[12px] font-bold border border-line dark:border-slate-700 hover:bg-surface-subtle dark:hover:bg-slate-800 disabled:opacity-40 text-ink-muted dark:text-slate-400 transition-colors">
                <Plus size={14} />
              </button>
            </form>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 text-ink-muted dark:text-slate-500">
              <StickyNote size={12} /> {isAr ? "ملاحظة" : "Note"}
              {savingNote && <Loader2 size={11} className="animate-spin" />}
            </p>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteDirty(true);
              }}
              onBlur={() => void saveNote()}
              rows={4}
              placeholder={isAr ? "مثلاً: عايز فينير، اتصل يوم الأحد" : "e.g. wants veneers, call Sunday"}
              className="mt-2 w-full rounded-lg border border-[#e0c46b] dark:border-[#a18833] px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#e0c46b]/50 resize-none bg-[#fffbe6] text-[#6b5500] dark:bg-[#4a3b00]/30 dark:text-[#fde68a] placeholder-[#b8a05c] dark:placeholder-[#8a7231] transition-all shadow-sm"
              dir="auto"
            />
            <p className="text-[10px] mt-1 text-ink-muted dark:text-slate-500">
              {isAr ? "بيتحفظ لوحده لما تسيب الخانة" : "Saves when you leave the box"}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
