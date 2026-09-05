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
  return PRESET_TAGS.find((t) => t.id === id)?.tone || "#f0f2f5";
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
    <aside className="bg-white border-line md:border-s flex flex-col min-h-0 overflow-y-auto">
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-line" style={{ background: "#f0f2f5" }}>
        <span className="text-[13px] font-black" style={{ color: "#111b21" }}>
          {isAr ? "بيانات المريض" : "Patient info"}
        </span>
        <button onClick={onClose} className="ms-auto w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color: "#54656f" }}>
          <X size={16} />
        </button>
      </div>

      {/* The patient */}
      <div className="p-4 border-b border-line">
        {chat.patientId ? (
          <>
            <p className="text-[15px] font-black" style={{ color: "#111b21" }}>
              {chat.patientName || "—"}
            </p>
            <p className="text-[12px]" style={{ color: "#667781" }} dir="ltr">
              {chat.phone}
            </p>

            <dl className="mt-3 space-y-2.5 text-[13px]">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "#667781" }}>
                  {isAr ? "الميعاد الجاي" : "Next appointment"}
                </dt>
                <dd className="font-semibold mt-0.5" style={{ color: "#111b21" }}>
                  {appts === null ? <Loader2 size={13} className="animate-spin" /> : next ? apptLine(next) : isAr ? "مفيش ميعاد جاي" : "None booked"}
                  {next && (
                    <span className="ms-2 text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#f0f2f5", color: "#54656f" }}>
                      {next.status}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "#667781" }}>
                  {isAr ? "آخر زيارة" : "Last visit"}
                </dt>
                <dd className="font-semibold mt-0.5" style={{ color: "#111b21" }}>
                  {appts === null ? "…" : last ? apptLine(last) : isAr ? "لسه مزارش" : "No past visit"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "#667781" }}>
                  {isAr ? "الحساب" : "Balance"}
                </dt>
                <dd className="font-black mt-0.5 flex items-center gap-1.5" style={{ color: balance && balance > 0 ? "#c0392b" : "#008f72" }}>
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
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white text-[12px] font-black"
                style={{ background: "#00a884" }}
              >
                <CalendarPlus size={15} />
                {isAr ? "احجز ميعاد" : "Book appointment"}
              </Link>
              <Link
                href={`/patients/${chat.patientId}`}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold border border-line hover:bg-black/5"
                style={{ color: "#54656f" }}
              >
                <UserRound size={15} />
                {isAr ? "افتح الملف" : "Open patient file"}
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] font-bold" style={{ color: "#111b21" }} dir="ltr">
              {chat.phone || chat.id}
            </p>
            <p className="text-[12px] mt-1" style={{ color: "#667781" }}>
              {isAr ? "الرقم ده مش مسجل كمريض." : "This number is not a registered patient."}
            </p>
            <Link
              href="/patients"
              className="mt-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold border border-line hover:bg-black/5"
              style={{ color: "#54656f" }}
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
            <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "#667781" }}>
              <Tag size={12} /> {isAr ? "علامات" : "Tags"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESET_TAGS.map((t) => {
                const on = tags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => void toggleTag(t.id)}
                    className="text-[11px] font-bold px-2 py-1 rounded-full border transition-colors"
                    style={on ? { background: t.tone, borderColor: "transparent", color: "#111b21" } : { background: "#fff", borderColor: "#e0e4e7", color: "#54656f" }}
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
                    className="text-[11px] font-bold px-2 py-1 rounded-full"
                    style={{ background: "#f0f2f5", color: "#111b21" }}
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
                className="flex-1 min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-[#00a884]"
                dir="auto"
              />
              <button type="submit" disabled={!customTag.trim()} className="px-2.5 rounded-lg text-[12px] font-bold border border-line hover:bg-black/5 disabled:opacity-40" style={{ color: "#54656f" }}>
                <Plus size={14} />
              </button>
            </form>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "#667781" }}>
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
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-[13px] focus:outline-none focus:border-[#00a884] resize-none"
              style={{ background: "#fffbe6" }}
              dir="auto"
            />
            <p className="text-[10px] mt-1" style={{ color: "#8696a0" }}>
              {isAr ? "بيتحفظ لوحده لما تسيب الخانة" : "Saves when you leave the box"}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
